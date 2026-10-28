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
import type { Box, VoxelVolume } from './volume';

/** Words of a chunk bitmask: one bit per voxel of a 32³ chunk. */
export const MASK_WORDS = CHUNK_VOLUME / 32;

/** Number of set bits in a 32-bit word. */
export function popcount(v: number): number {
  let n = v - ((v >>> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/**
 * The selection of one object: sparse bitmasks, one Uint32Array(1024) — 4 KB — per chunk that
 * has selected voxels (docs/data-model.md, "Selection"). Set operations work word by word.
 */
export class SelectionMask {
  private readonly masks = new Map<number, Uint32Array>();
  private readonly counts = new Map<number, number>();
  private total = 0;
  private changes = 0;

  /** Grows with every change: cheap "did the selection change" checks. */
  get revision(): number {
    return this.changes;
  }

  get count(): number {
    return this.total;
  }

  get isEmpty(): boolean {
    return this.total === 0;
  }

  chunkKeys(): IterableIterator<number> {
    return this.masks.keys();
  }

  getChunk(key: number): Uint32Array | undefined {
    return this.masks.get(key);
  }

  has(x: number, y: number, z: number): boolean {
    const mask = this.masks.get(chunkKey(x >> CHUNK_BITS, y >> CHUNK_BITS, z >> CHUNK_BITS));
    if (!mask) return false;
    const i = voxelIndex(x & CHUNK_MASK, y & CHUNK_MASK, z & CHUNK_MASK);
    return (mask[i >>> 5]! & (1 << (i & 31))) !== 0;
  }

  /** Sets one bit; returns true when it changed. */
  set(x: number, y: number, z: number, on: boolean): boolean {
    const key = chunkKey(x >> CHUNK_BITS, y >> CHUNK_BITS, z >> CHUNK_BITS);
    let mask = this.masks.get(key);
    if (!mask) {
      if (!on) return false;
      mask = new Uint32Array(MASK_WORDS);
      this.masks.set(key, mask);
      this.counts.set(key, 0);
    }
    const i = voxelIndex(x & CHUNK_MASK, y & CHUNK_MASK, z & CHUNK_MASK);
    const bit = 1 << (i & 31);
    const word = mask[i >>> 5]!;
    if (((word & bit) !== 0) === on) return false;
    mask[i >>> 5] = on ? word | bit : word & ~bit;
    this.changes++;
    const count = this.counts.get(key)! + (on ? 1 : -1);
    this.total += on ? 1 : -1;
    if (count === 0) {
      this.masks.delete(key);
      this.counts.delete(key);
    } else {
      this.counts.set(key, count);
    }
    return true;
  }

  /** Replaces a whole chunk mask (null or all zero removes it). Takes ownership. */
  putChunk(key: number, mask: Uint32Array | null): void {
    this.changes++;
    this.total -= this.counts.get(key) ?? 0;
    this.masks.delete(key);
    this.counts.delete(key);
    if (!mask) return;
    let count = 0;
    for (let w = 0; w < MASK_WORDS; w++) count += popcount(mask[w]!);
    if (count === 0) return;
    this.masks.set(key, mask);
    this.counts.set(key, count);
    this.total += count;
  }

  clear(): void {
    if (this.total > 0) this.changes++;
    this.masks.clear();
    this.counts.clear();
    this.total = 0;
  }

  clone(): SelectionMask {
    const copy = new SelectionMask();
    for (const [key, mask] of this.masks) copy.putChunk(key, mask.slice());
    return copy;
  }

  /** Visits every selected voxel. */
  forEach(visit: (x: number, y: number, z: number) => void): void {
    for (const [key, mask] of this.masks) {
      const ox = keyX(key) * CHUNK_SIZE;
      const oy = keyY(key) * CHUNK_SIZE;
      const oz = keyZ(key) * CHUNK_SIZE;
      for (let w = 0; w < MASK_WORDS; w++) {
        let word = mask[w]!;
        while (word !== 0) {
          const bit = 31 - Math.clz32(word & -word);
          word &= word - 1;
          const i = (w << 5) | bit;
          visit(ox + (i & 31), oy + ((i >> 5) & 31), oz + (i >> 10));
        }
      }
    }
  }

  getBounds(): Box | null {
    let box: Box | null = null;
    this.forEach((x, y, z) => {
      if (!box) box = { minX: x, minY: y, minZ: z, maxX: x, maxY: y, maxZ: z };
      else {
        if (x < box.minX) box.minX = x;
        if (x > box.maxX) box.maxX = x;
        if (y < box.minY) box.minY = y;
        if (y > box.maxY) box.maxY = y;
        if (z < box.minZ) box.minZ = z;
        if (z > box.maxZ) box.maxZ = z;
      }
    });
    return box;
  }
}

const dense = new Uint16Array(CHUNK_VOLUME);

/** Fills a volume with 1 wherever the selection is set: what the selection overlay draws. */
export function selectionToVolume(selection: SelectionMask, volume: VoxelVolume): void {
  volume.clear();
  for (const key of selection.chunkKeys()) {
    const mask = selection.getChunk(key)!;
    for (let w = 0; w < MASK_WORDS; w++) {
      const word = mask[w]!;
      const base = w << 5;
      for (let b = 0; b < 32; b++) dense[base + b] = (word >>> b) & 1;
    }
    volume.putChunk(key, Chunk.fromDense(dense));
  }
}
