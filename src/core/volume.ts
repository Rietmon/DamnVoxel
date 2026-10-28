import { Chunk } from './chunk';
import {
  CHUNK_BITS,
  CHUNK_MASK,
  CHUNK_SIZE,
  CHUNK_VOLUME,
  chunkKey,
  keyX,
  keyY,
  keyZ,
  voxelIndex,
} from './coords';

/** Axis-aligned box of voxels, bounds inclusive. */
export interface Box {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export function boxSize(box: Box): [number, number, number] {
  return [box.maxX - box.minX + 1, box.maxY - box.minY + 1, box.maxZ - box.minZ + 1];
}

/** Read access shared by volumes and views over them (picking, kernels, previews). */
export interface VolumeReader {
  get(x: number, y: number, z: number): number;
  getChunk(key: number): Chunk | undefined;
}

interface CachedBounds {
  version: number;
  box: Box;
}

const scratch = new Uint16Array(CHUNK_VOLUME);

/** Bounds of the non-empty voxels of a chunk in local coordinates. */
function localBounds(chunk: Chunk): Box {
  if (chunk.isFull) {
    return { minX: 0, minY: 0, minZ: 0, maxX: CHUNK_MASK, maxY: CHUNK_MASK, maxZ: CHUNK_MASK };
  }
  chunk.decodeInto(scratch);
  let minX = CHUNK_SIZE;
  let minY = CHUNK_SIZE;
  let minZ = CHUNK_SIZE;
  let maxX = -1;
  let maxY = -1;
  let maxZ = -1;
  let i = 0;
  for (let z = 0; z < CHUNK_SIZE; z++)
    for (let y = 0; y < CHUNK_SIZE; y++)
      for (let x = 0; x < CHUNK_SIZE; x++, i++) {
        if (scratch[i] === 0) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

/**
 * Sparse voxel volume of one object: chunks by key, no empty chunks stored.
 *
 * Every change bumps the chunk version (a per-volume counter, so a recreated chunk never
 * repeats a version) and records which chunk meshes went stale. A mesh depends on the
 * occupancy of a one-voxel shell around its chunk (face culling and AO), so an occupancy change
 * on the chunk border also marks the neighbours across that border, edges and corners included.
 */
export class VoxelVolume implements VolumeReader {
  private readonly map = new Map<number, Chunk>();
  private readonly meshDirty = new Set<number>();
  private readonly boundsCache = new Map<number, CachedBounds>();
  private versionCounter = 0;
  private total = 0;
  private bounds: Box | null = null;
  private boundsValid = true;
  private lastKey = Number.NaN;
  private lastChunk: Chunk | undefined;

  get chunkCount(): number {
    return this.map.size;
  }

  get voxelCount(): number {
    return this.total;
  }

  /** Grows with every change of any voxel: cheap "has anything changed" checks. */
  get revision(): number {
    return this.versionCounter;
  }

  get isEmpty(): boolean {
    return this.total === 0;
  }

  chunks(): IterableIterator<[number, Chunk]> {
    return this.map.entries();
  }

  chunkKeys(): IterableIterator<number> {
    return this.map.keys();
  }

  getChunk(key: number): Chunk | undefined {
    if (key === this.lastKey) return this.lastChunk;
    const chunk = this.map.get(key);
    this.lastKey = key;
    this.lastChunk = chunk;
    return chunk;
  }

  get(x: number, y: number, z: number): number {
    const chunk = this.getChunk(chunkKey(x >> CHUNK_BITS, y >> CHUNK_BITS, z >> CHUNK_BITS));
    return chunk ? chunk.get(voxelIndex(x & CHUNK_MASK, y & CHUNK_MASK, z & CHUNK_MASK)) : 0;
  }

  /** Writes one voxel and returns the previous value. */
  set(x: number, y: number, z: number, value: number): number {
    const cx = x >> CHUNK_BITS;
    const cy = y >> CHUNK_BITS;
    const cz = z >> CHUNK_BITS;
    const key = chunkKey(cx, cy, cz);
    let chunk = this.getChunk(key);
    if (!chunk) {
      if (value === 0) return 0;
      chunk = new Chunk();
      this.map.set(key, chunk);
      this.lastKey = key;
      this.lastChunk = chunk;
    }
    const lx = x & CHUNK_MASK;
    const ly = y & CHUNK_MASK;
    const lz = z & CHUNK_MASK;
    const old = chunk.set(voxelIndex(lx, ly, lz), value);
    if (old === value) return old;
    chunk.version = ++this.versionCounter;
    this.boundsValid = false;
    this.meshDirty.add(key);
    if ((old === 0) !== (value === 0)) {
      this.total += value === 0 ? -1 : 1;
      if (chunk.isEmpty) this.removeChunk(key);
      this.markBorderNeighbours(cx, cy, cz, lx, ly, lz);
    }
    return old;
  }

  /**
   * Replaces a whole chunk; `null` or an empty chunk removes it. The chunk is owned by the
   * volume afterwards. Used by history, kernels and loaders.
   */
  putChunk(key: number, chunk: Chunk | null): void {
    const old = this.map.get(key);
    if (old) this.total -= old.count;
    if (chunk && !chunk.isEmpty) {
      chunk.version = ++this.versionCounter;
      this.map.set(key, chunk);
      this.total += chunk.count;
      if (key === this.lastKey) this.lastChunk = chunk;
    } else if (old) {
      this.removeChunk(key);
      this.versionCounter++;
    } else {
      return;
    }
    this.boundsValid = false;
    this.markAllNeighbours(key);
  }

  clear(): void {
    if (this.map.size > 0) this.versionCounter++;
    for (const key of this.map.keys()) this.markAllNeighbours(key);
    this.map.clear();
    this.boundsCache.clear();
    this.total = 0;
    this.bounds = null;
    this.boundsValid = true;
    this.lastKey = Number.NaN;
    this.lastChunk = undefined;
  }

  /** Returns and forgets the keys of chunks whose meshes are stale. Keys may have no chunk. */
  takeMeshDirty(): number[] {
    const keys = [...this.meshDirty];
    this.meshDirty.clear();
    return keys;
  }

  get hasMeshDirty(): boolean {
    return this.meshDirty.size > 0;
  }

  /** Bounds of all non-empty voxels, or null for an empty volume. Recomputed lazily per chunk. */
  getBounds(): Box | null {
    if (this.boundsValid) return this.bounds;
    let box: Box | null = null;
    for (const [key, chunk] of this.map) {
      let cached = this.boundsCache.get(key);
      if (!cached || cached.version !== chunk.version) {
        cached = { version: chunk.version, box: localBounds(chunk) };
        this.boundsCache.set(key, cached);
      }
      const ox = keyX(key) * CHUNK_SIZE;
      const oy = keyY(key) * CHUNK_SIZE;
      const oz = keyZ(key) * CHUNK_SIZE;
      const b = cached.box;
      if (!box) {
        box = {
          minX: ox + b.minX,
          minY: oy + b.minY,
          minZ: oz + b.minZ,
          maxX: ox + b.maxX,
          maxY: oy + b.maxY,
          maxZ: oz + b.maxZ,
        };
      } else {
        box.minX = Math.min(box.minX, ox + b.minX);
        box.minY = Math.min(box.minY, oy + b.minY);
        box.minZ = Math.min(box.minZ, oz + b.minZ);
        box.maxX = Math.max(box.maxX, ox + b.maxX);
        box.maxY = Math.max(box.maxY, oy + b.maxY);
        box.maxZ = Math.max(box.maxZ, oz + b.maxZ);
      }
    }
    this.bounds = box;
    this.boundsValid = true;
    return box;
  }

  private removeChunk(key: number): void {
    this.map.delete(key);
    this.boundsCache.delete(key);
    if (key === this.lastKey) this.lastChunk = undefined;
  }

  private markBorderNeighbours(
    cx: number,
    cy: number,
    cz: number,
    lx: number,
    ly: number,
    lz: number,
  ): void {
    const dx = lx === 0 ? -1 : lx === CHUNK_MASK ? 1 : 0;
    const dy = ly === 0 ? -1 : ly === CHUNK_MASK ? 1 : 0;
    const dz = lz === 0 ? -1 : lz === CHUNK_MASK ? 1 : 0;
    if (dx === 0 && dy === 0 && dz === 0) return;
    for (const ox of dx === 0 ? [0] : [0, dx])
      for (const oy of dy === 0 ? [0] : [0, dy])
        for (const oz of dz === 0 ? [0] : [0, dz]) {
          if (ox !== 0 || oy !== 0 || oz !== 0)
            this.meshDirty.add(chunkKey(cx + ox, cy + oy, cz + oz));
        }
  }

  private markAllNeighbours(key: number): void {
    const cx = keyX(key);
    const cy = keyY(key);
    const cz = keyZ(key);
    for (let ox = -1; ox <= 1; ox++)
      for (let oy = -1; oy <= 1; oy++)
        for (let oz = -1; oz <= 1; oz++) this.meshDirty.add(chunkKey(cx + ox, cy + oy, cz + oz));
  }
}
