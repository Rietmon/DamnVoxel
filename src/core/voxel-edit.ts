import type { Chunk } from './chunk';
import {
  CHUNK_BITS,
  CHUNK_MASK,
  CHUNK_SIZE,
  CHUNK_VOLUME,
  chunkKey,
  indexX,
  indexY,
  indexZ,
  keyX,
  keyY,
  keyZ,
  voxelIndex,
} from './coords';
import type { VoxelDocument } from './document';
import type { Command } from './history';
import type { VoxelObject } from './scene';
import type { VolumeReader } from './volume';

/** Changes of one chunk. Small edits keep only changed voxels; large ones whole chunks. */
type ChunkDiff =
  | {
      readonly kind: 'sparse';
      readonly key: number;
      readonly indices: Uint16Array;
      readonly before: Uint16Array;
      readonly after: Uint16Array;
    }
  | {
      readonly kind: 'full';
      readonly key: number;
      readonly before: Chunk | null;
      readonly after: Chunk | null;
    };

interface ObjectDiff {
  readonly object: VoxelObject;
  readonly chunks: readonly ChunkDiff[];
}

/** Above this many changed voxels a chunk diff stores whole chunks: it is cheaper. */
const SPARSE_LIMIT = CHUNK_VOLUME / 4;

const denseBefore = new Uint16Array(CHUNK_VOLUME);
const denseAfter = new Uint16Array(CHUNK_VOLUME);
const changed = new Uint16Array(CHUNK_VOLUME);

function decodeOrEmpty(chunk: Chunk | null | undefined, dense: Uint16Array): void {
  if (chunk) chunk.decodeInto(dense);
  else dense.fill(0);
}

function diffChunk(key: number, before: Chunk | null, after: Chunk | null): ChunkDiff | null {
  if (!before && !after) return null;
  if (before && after && before.uniform >= 0 && before.uniform === after.uniform) return null;
  decodeOrEmpty(before, denseBefore);
  decodeOrEmpty(after, denseAfter);
  let n = 0;
  for (let i = 0; i < CHUNK_VOLUME; i++) if (denseBefore[i] !== denseAfter[i]) changed[n++] = i;
  if (n === 0) return null;
  if (n > SPARSE_LIMIT) return { kind: 'full', key, before, after: after ? after.clone() : null };
  const indices = changed.slice(0, n);
  const b = new Uint16Array(n);
  const a = new Uint16Array(n);
  for (let k = 0; k < n; k++) {
    b[k] = denseBefore[indices[k]!]!;
    a[k] = denseAfter[indices[k]!]!;
  }
  return { kind: 'sparse', key, indices, before: b, after: a };
}

function diffBytes(diff: ChunkDiff): number {
  if (diff.kind === 'sparse') return 48 + diff.indices.byteLength * 3;
  return 48 + (diff.before?.memoryBytes() ?? 0) + (diff.after?.memoryBytes() ?? 0);
}

function applyChunk(object: VoxelObject, diff: ChunkDiff, forward: boolean): void {
  const volume = object.volume;
  if (diff.kind === 'full') {
    const chunk = forward ? diff.after : diff.before;
    // The volume owns what it gets; the command keeps its pristine copy.
    volume.putChunk(diff.key, chunk ? chunk.clone() : null);
    return;
  }
  const values = forward ? diff.after : diff.before;
  const ox = keyX(diff.key) * CHUNK_SIZE;
  const oy = keyY(diff.key) * CHUNK_SIZE;
  const oz = keyZ(diff.key) * CHUNK_SIZE;
  for (let k = 0; k < diff.indices.length; k++) {
    const i = diff.indices[k]!;
    volume.set(ox + indexX(i), oy + indexY(i), oz + indexZ(i), values[k]!);
  }
}

/** A voxel change of one or more objects, stored as per-chunk diffs. */
export class VoxelEditCommand implements Command {
  readonly bytes: number;

  constructor(
    readonly label: string,
    private readonly diffs: readonly ObjectDiff[],
  ) {
    let bytes = 64;
    for (const d of diffs) for (const c of d.chunks) bytes += diffBytes(c);
    this.bytes = bytes;
  }

  /** Number of changed chunks over all objects; for tests and diagnostics. */
  get chunkCount(): number {
    return this.diffs.reduce((sum, d) => sum + d.chunks.length, 0);
  }

  apply(_doc: VoxelDocument): void {
    for (const d of this.diffs) for (const c of d.chunks) applyChunk(d.object, c, true);
  }

  revert(_doc: VoxelDocument): void {
    for (let i = this.diffs.length - 1; i >= 0; i--) {
      const d = this.diffs[i]!;
      for (let k = d.chunks.length - 1; k >= 0; k--) applyChunk(d.object, d.chunks[k]!, false);
    }
  }
}

/**
 * Records voxel writes so that they become one command. Writes go into the document at once —
 * a stroke must show up within the frame — and the first write into a chunk snapshots it.
 * `commit` compares snapshots with the current chunks and builds the diff once, so a stroke of
 * any length costs one comparison per touched chunk.
 */
export class VoxelTransaction {
  /** Per object: chunk key → chunk as it was before the first write (null: did not exist). */
  private readonly originals = new Map<VoxelObject, Map<number, Chunk | null>>();
  private finished = false;

  get isEmpty(): boolean {
    return this.originals.size === 0;
  }

  get(object: VoxelObject, x: number, y: number, z: number): number {
    return object.volume.get(x, y, z);
  }

  /** Writes a voxel and returns the previous value. */
  set(object: VoxelObject, x: number, y: number, z: number, value: number): number {
    this.snapshot(object, chunkKey(x >> CHUNK_BITS, y >> CHUNK_BITS, z >> CHUNK_BITS));
    return object.volume.set(x, y, z, value);
  }

  /** Replaces a whole chunk (kernels, pastes). The volume takes ownership of `chunk`. */
  putChunk(object: VoxelObject, key: number, chunk: Chunk | null): void {
    this.snapshot(object, key);
    object.volume.putChunk(key, chunk);
  }

  /** The value a voxel had before this transaction touched it. */
  original(object: VoxelObject, x: number, y: number, z: number): number {
    const key = chunkKey(x >> CHUNK_BITS, y >> CHUNK_BITS, z >> CHUNK_BITS);
    const snapshots = this.originals.get(object);
    if (!snapshots?.has(key)) return object.volume.get(x, y, z);
    const chunk = snapshots.get(key);
    return chunk ? chunk.get(voxelIndex(x & CHUNK_MASK, y & CHUNK_MASK, z & CHUNK_MASK)) : 0;
  }

  /**
   * The object as it was before the transaction. Strokes pick against it, so voxels added by
   * the stroke itself do not pile up towards the camera.
   */
  baseOf(object: VoxelObject): VolumeReader {
    return {
      get: (x, y, z) => this.original(object, x, y, z),
      getChunk: (key) => {
        const snapshots = this.originals.get(object);
        if (snapshots?.has(key)) return snapshots.get(key) ?? undefined;
        return object.volume.getChunk(key);
      },
    };
  }

  /** Ends the transaction; returns the command, or null when nothing changed. */
  commit(label: string): VoxelEditCommand | null {
    this.finish();
    const diffs: ObjectDiff[] = [];
    for (const [object, snapshots] of this.originals) {
      const chunks: ChunkDiff[] = [];
      for (const [key, before] of snapshots) {
        const diff = diffChunk(key, before, object.volume.getChunk(key) ?? null);
        if (diff) chunks.push(diff);
      }
      if (chunks.length > 0) diffs.push({ object, chunks });
    }
    return diffs.length > 0 ? new VoxelEditCommand(label, diffs) : null;
  }

  /** Ends the transaction and restores every touched chunk. */
  cancel(): void {
    this.finish();
    for (const [object, snapshots] of this.originals) {
      for (const [key, before] of snapshots) object.volume.putChunk(key, before);
    }
  }

  private snapshot(object: VoxelObject, key: number): void {
    if (this.finished) throw new Error('Transaction is already finished');
    let snapshots = this.originals.get(object);
    if (!snapshots) {
      snapshots = new Map();
      this.originals.set(object, snapshots);
    }
    if (!snapshots.has(key)) snapshots.set(key, object.volume.getChunk(key)?.clone() ?? null);
  }

  private finish(): void {
    if (this.finished) throw new Error('Transaction is already finished');
    this.finished = true;
  }
}
