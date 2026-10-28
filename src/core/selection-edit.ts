import { CHUNK_VOLUME, FACE_NORMALS } from './coords';
import type { VoxelDocument } from './document';
import type { Command } from './history';
import type { Modifier } from './modifiers';
import type { VoxelObject } from './scene';
import { MASK_WORDS, SelectionMask } from './selection';

/** How a new region combines with the current selection. */
export type SelectMode = 'replace' | 'add' | 'subtract' | 'intersect';

/** Selection mode from modifiers: Shift adds, Alt subtracts, Shift + Alt intersects. */
export function selectModeOf(
  shift: boolean,
  alt: boolean,
  fallback: SelectMode = 'replace',
): SelectMode {
  if (shift && alt) return 'intersect';
  if (shift) return 'add';
  if (alt) return 'subtract';
  return fallback;
}

interface ChunkChange {
  key: number;
  before: Uint32Array | null;
  after: Uint32Array | null;
}

/** A selection change of one object: before and after copies of the touched chunk masks. */
export class SelectionCommand implements Command {
  readonly bytes: number;

  constructor(
    readonly label: string,
    private readonly object: VoxelObject,
    private readonly changes: readonly ChunkChange[],
  ) {
    this.bytes = 64 + changes.reduce((s, c) => s + (c.before ? 4096 : 0) + (c.after ? 4096 : 0), 0);
  }

  apply(doc: VoxelDocument): void {
    for (const c of this.changes) this.object.selection.putChunk(c.key, c.after?.slice() ?? null);
    doc.notifySelection(this.object);
  }

  revert(doc: VoxelDocument): void {
    for (const c of this.changes) this.object.selection.putChunk(c.key, c.before?.slice() ?? null);
    doc.notifySelection(this.object);
  }
}

function sameMask(a: Uint32Array | null, b: Uint32Array | null): boolean {
  if (!a || !b) return a === b;
  for (let w = 0; w < MASK_WORDS; w++) if (a[w] !== b[w]) return false;
  return true;
}

/**
 * Collects selection writes of one object into one command, like VoxelTransaction for voxels:
 * the first touch of a chunk snapshots its mask, commit compares and keeps only real changes.
 */
export class SelectionTransaction {
  private readonly originals = new Map<number, Uint32Array | null>();

  constructor(readonly object: VoxelObject) {}

  private touch(key: number): void {
    if (!this.originals.has(key))
      this.originals.set(key, this.object.selection.getChunk(key)?.slice() ?? null);
  }

  /** Replaces the mask of a chunk (null clears it). Takes ownership of `mask`. */
  putChunk(key: number, mask: Uint32Array | null): void {
    this.touch(key);
    this.object.selection.putChunk(key, mask);
  }

  /** Combines a region into the selection chunk by chunk. */
  combine(region: SelectionMask, mode: SelectMode): void {
    const selection = this.object.selection;
    if (mode === 'replace' || mode === 'intersect') {
      for (const key of [...selection.chunkKeys()]) {
        const r = region.getChunk(key);
        if (!r) {
          this.putChunk(key, null);
        } else if (mode === 'intersect') {
          const m = selection.getChunk(key)!.slice();
          for (let w = 0; w < MASK_WORDS; w++) m[w] = m[w]! & r[w]!;
          this.putChunk(key, m);
        }
      }
      if (mode === 'intersect') return;
    }
    for (const key of region.chunkKeys()) {
      const r = region.getChunk(key)!;
      const current = selection.getChunk(key);
      const m = mode === 'replace' || !current ? new Uint32Array(MASK_WORDS) : current.slice();
      for (let w = 0; w < MASK_WORDS; w++) {
        if (mode === 'subtract') m[w] = m[w]! & ~r[w]!;
        else m[w] = m[w]! | r[w]!;
      }
      this.putChunk(key, m);
    }
  }

  /** The change as one undoable command, or null when nothing changed. */
  commit(label: string): SelectionCommand | null {
    const changes: ChunkChange[] = [];
    for (const [key, before] of this.originals) {
      const after = this.object.selection.getChunk(key) ?? null;
      if (!sameMask(before, after)) changes.push({ key, before, after: after?.slice() ?? null });
    }
    return changes.length > 0 ? new SelectionCommand(label, this.object, changes) : null;
  }

  cancel(): void {
    for (const [key, before] of this.originals) this.object.selection.putChunk(key, before);
  }
}

/** Every filled voxel of the object as a region. */
export function filledRegion(object: VoxelObject): SelectionMask {
  const region = new SelectionMask();
  const dense = new Uint16Array(CHUNK_VOLUME);
  for (const [key, chunk] of object.volume.chunks()) {
    const mask = new Uint32Array(MASK_WORDS);
    if (chunk.isFull) mask.fill(0xffffffff);
    else {
      chunk.decodeInto(dense);
      for (let i = 0; i < CHUNK_VOLUME; i++)
        if (dense[i] !== 0) mask[i >>> 5] = mask[i >>> 5]! | (1 << (i & 31));
    }
    region.putChunk(key, mask);
  }
  return region;
}

/** Filled voxels that are not selected. */
export function invertedRegion(object: VoxelObject): SelectionMask {
  const region = filledRegion(object);
  for (const key of [...region.chunkKeys()]) {
    const s = object.selection.getChunk(key);
    if (!s) continue;
    const m = region.getChunk(key)!.slice();
    for (let w = 0; w < MASK_WORDS; w++) m[w] = m[w]! & ~s[w]!;
    region.putChunk(key, m);
  }
  return region;
}

/** The selection plus filled voxels touching it across a face. */
export function grownRegion(object: VoxelObject): SelectionMask {
  const region = object.selection.clone();
  const volume = object.volume;
  object.selection.forEach((x, y, z) => {
    for (const [nx, ny, nz] of FACE_NORMALS) {
      const px = x + nx;
      const py = y + ny;
      const pz = z + nz;
      if (volume.get(px, py, pz) !== 0) region.set(px, py, pz, true);
    }
  });
  return region;
}

/** The selection without voxels that touch an unselected cell across a face. */
export function shrunkRegion(object: VoxelObject): SelectionMask {
  const region = object.selection.clone();
  const selection = object.selection;
  selection.forEach((x, y, z) => {
    for (const [nx, ny, nz] of FACE_NORMALS) {
      if (!selection.has(x + nx, y + ny, z + nz)) {
        region.set(x, y, z, false);
        return;
      }
    }
  });
  return region;
}

/** Voxels whose colour is one of `colors`. */
export function colorRegion(object: VoxelObject, colors: ReadonlySet<number>): SelectionMask {
  const region = new SelectionMask();
  const dense = new Uint16Array(CHUNK_VOLUME);
  for (const [key, chunk] of object.volume.chunks()) {
    chunk.decodeInto(dense);
    let mask: Uint32Array | null = null;
    for (let i = 0; i < CHUNK_VOLUME; i++) {
      if (!colors.has(dense[i]!)) continue;
      mask ??= new Uint32Array(MASK_WORDS);
      mask[i >>> 5] = mask[i >>> 5]! | (1 << (i & 31));
    }
    if (mask) region.putChunk(key, mask);
  }
  return region;
}

/** The colours of the selected voxels, each once, in the order first met. */
export function selectedColors(object: VoxelObject): number[] {
  const seen = new Set<number>();
  object.selection.forEach((x, y, z) => {
    const c = object.volume.get(x, y, z);
    if (c) seen.add(c);
  });
  return [...seen];
}

/** Where edits may go relative to the selection: anywhere, only inside it, only outside it. */
export type EditMask = 'all' | 'inside' | 'outside';

/** Keeps an edit inside or outside the selection (edit only the selected voxels). */
export function selectionMaskModifier(selection: SelectionMask, mask: EditMask): Modifier {
  return (op) =>
    mask === 'all'
      ? op
      : {
          action: op.action,
          forEachCell(visit) {
            op.forEachCell((x, y, z, c) => {
              if (selection.has(x, y, z) === (mask === 'inside')) visit(x, y, z, c);
            });
          },
        };
}
