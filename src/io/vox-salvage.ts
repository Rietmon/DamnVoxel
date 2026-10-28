import type { VoxelDocument } from '../core/document';
import { decodeChunk, type VoxChunk, writeVoxFile } from '../formats/vox-chunks';
import { readVox } from './vox-read';

/**
 * What can be read from a damaged .vox (docs/formats.md, “Damaged files”), like
 * MagicaVoxel's recovery: chunks are found by their tags even past garbage, a cut-off voxel
 * list keeps the voxels that made it, a broken size is worked out from the voxels, and a scene
 * graph that loses models gives way to every model at the origin. Nothing is made up; what was
 * lost is listed.
 */

/** Chunk ids MagicaVoxel writes: what a resync looks for. */
const KNOWN = new Set([
  'PACK',
  'SIZE',
  'XYZI',
  'RGBA',
  'MATL',
  'MATT',
  'nTRN',
  'nGRP',
  'nSHP',
  'LAYR',
  'rOBJ',
  'rCAM',
  'NOTE',
  'IMAP',
  'META',
]);
const GRAPH = new Set(['nTRN', 'nGRP', 'nSHP']);
/** A model side MagicaVoxel can have. */
const sane = (n: number) => n >= 1 && n <= 256;

export interface SalvageReport {
  /** What was wrong, in words for the person. */
  problems: string[];
  /** Models and voxels that were recovered. */
  models: number;
  voxels: number;
}

const tagAt = (b: Uint8Array, p: number) =>
  String.fromCharCode(b[p]!, b[p + 1]!, b[p + 2]!, b[p + 3]!);
const i32At = (b: Uint8Array, p: number) =>
  b[p]! | (b[p + 1]! << 8) | (b[p + 2]! << 16) | (b[p + 3]! << 24);

/** The next place at or after `from` that looks like a chunk header, or -1. */
function nextChunk(b: Uint8Array, from: number): number {
  for (let p = from; p + 12 <= b.length; p++) {
    if (!KNOWN.has(tagAt(b, p))) continue;
    const n = i32At(b, p + 4);
    const m = i32At(b, p + 8);
    if (n >= 0 && m >= 0 && n < b.length) return p;
  }
  return -1;
}

/** Voxels of an XYZI whose bytes run from `start` to `end`: as many whole ones as are there. */
function voxelsBetween(b: Uint8Array, start: number, end: number): Uint8Array {
  const claimed = start + 4 <= end ? i32At(b, start) : 0;
  const fit = Math.max(0, Math.floor((end - start - 4) / 4));
  const n = claimed > 0 ? Math.min(claimed, fit) : fit;
  return b.slice(start + 4, start + 4 + n * 4);
}

/** Voxels across the objects of a document and their animation frames, each volume once. */
function voxelCount(doc: VoxelDocument): number {
  const seen = new Set<unknown>();
  let n = 0;
  for (const o of doc.scene.objects())
    for (const v of [o.volume, ...(o.keys?.volumes.values() ?? [])]) {
      if (seen.has(v)) continue;
      seen.add(v);
      n += v.voxelCount;
    }
  return n;
}

/** Reads what survives of a damaged file; null when not one voxel does. */
export function salvageVox(
  bytes: Uint8Array,
): { doc: VoxelDocument; report: SalvageReport } | null {
  const problems: string[] = [];
  const chunks: VoxChunk[] = [];
  let p: number;
  if (bytes.length >= 20 && tagAt(bytes, 0) === 'VOX ' && tagAt(bytes, 8) === 'MAIN') p = 20;
  else {
    problems.push('The file header is damaged');
    p = nextChunk(bytes, 0);
  }
  while (p >= 0 && p + 12 <= bytes.length) {
    const id = tagAt(bytes, p);
    const n = i32At(bytes, p + 4);
    const m = i32At(bytes, p + 8);
    if (!KNOWN.has(id) || n < 0 || m < 0) {
      const q = nextChunk(bytes, p + 1);
      problems.push(`Skipped ${(q < 0 ? bytes.length : q) - p} bytes of garbage`);
      p = q;
      continue;
    }
    const start = p + 12;
    let end = start + n + m;
    if (end > bytes.length) {
      // Cut off, or a size that lies: the chunk ends where the next one starts.
      const q = nextChunk(bytes, start);
      end = q < 0 ? bytes.length : q;
      if (id === 'XYZI') {
        const voxels = voxelsBetween(bytes, start, end);
        chunks.push({ id, voxels });
        problems.push(`Model truncated: ${voxels.length / 4} voxels saved`);
      } else problems.push(`Chunk ${id} truncated and skipped`);
      p = q;
      continue;
    }
    const chunk = decodeChunk(id, bytes.subarray(start, start + n), bytes.subarray(start + n, end));
    if ('raw' in chunk && id === 'XYZI') {
      const voxels = voxelsBetween(bytes, start, start + n);
      chunks.push({ id, voxels });
      problems.push(`Voxel list damaged: ${voxels.length / 4} saved`);
    } else if (
      id === 'SIZE' &&
      (chunk.id !== 'SIZE' || 'raw' in chunk || ![chunk.x, chunk.y, chunk.z].every(sane))
    ) {
      problems.push('Model size is damaged: taken from the voxels');
    } else chunks.push(chunk);
    p = end;
  }
  const models = chunks.filter((c) => c.id === 'XYZI');
  if (models.length === 0) return null;
  const read = (list: VoxChunk[]): VoxelDocument | null => {
    try {
      return readVox(writeVoxFile({ version: 150, chunks: list }));
    } catch {
      return null;
    }
  };
  let doc = read(chunks);
  // Every model at the origin keeps them all: the fallback when the scene graph drops some.
  const flat = read(chunks.filter((c) => !GRAPH.has(c.id)));
  const all = flat ? voxelCount(flat) : 0;
  if (flat && (!doc || voxelCount(doc) < all)) {
    if (doc || chunks.some((c) => GRAPH.has(c.id)))
      problems.push('Scene damaged: models placed at the origin');
    doc = flat;
  }
  if (!doc) return null;
  return { doc, report: { problems, models: models.length, voxels: voxelCount(doc) } };
}
