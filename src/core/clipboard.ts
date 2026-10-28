import { Chunk } from './chunk';
import { blue, green, red } from './color';
import { CHUNK_SIZE, CHUNK_VOLUME, keyX, keyY, keyZ } from './coords';
import type { Palette } from './palette';
import type { VoxelObject } from './scene';
import { VoxelVolume } from './volume';

/**
 * Copied voxels: their palette ids in object-local coordinates, plus the colour of every id
 * used, so a paste into another document can find the same colours in its own palette.
 */
export interface VoxelClip {
  volume: VoxelVolume;
  colors: Map<number, number>;
}

const dense = new Uint16Array(CHUNK_VOLUME);

/** The selected voxels of an object (all of them without a selection), or null when empty. */
export function copyVoxels(object: VoxelObject, palette: Palette): VoxelClip | null {
  const volume = new VoxelVolume();
  const colors = new Map<number, number>();
  const selection = object.selection.isEmpty ? null : object.selection;
  for (const [key, chunk] of object.volume.chunks()) {
    const bits = selection?.getChunk(key);
    if (selection && !bits) continue;
    chunk.decodeInto(dense);
    let any = false;
    for (let i = 0; i < CHUNK_VOLUME; i++) {
      const v = dense[i]!;
      if (v === 0) continue;
      if (bits && (bits[i >>> 5]! & (1 << (i & 31))) === 0) {
        dense[i] = 0;
        continue;
      }
      if (!colors.has(v)) colors.set(v, palette.color(v));
      any = true;
    }
    if (any) volume.putChunk(key, Chunk.fromDense(dense));
  }
  volume.takeMeshDirty();
  return volume.isEmpty ? null : { volume, colors };
}

/** The palette id whose colour is closest to an RGBA colour (exact matches win). */
export function nearestPaletteId(palette: Palette, rgba: number): number {
  let best = 1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const id of palette.displayOrder()) {
    const c = palette.color(id);
    if (c === rgba) return id;
    const d =
      (red(c) - red(rgba)) ** 2 + (green(c) - green(rgba)) ** 2 + (blue(c) - blue(rgba)) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = id;
    }
  }
  return best;
}

/**
 * The clip's voxels with ids for `palette`: an id keeps its number when that entry has the same
 * colour (pasting into the same document), otherwise it maps to the nearest colour.
 */
export function remapClip(clip: VoxelClip, palette: Palette): VoxelVolume {
  const map = new Map<number, number>();
  for (const [id, rgba] of clip.colors) {
    map.set(
      id,
      palette.has(id) && palette.color(id) === rgba ? id : nearestPaletteId(palette, rgba),
    );
  }
  const out = new VoxelVolume();
  for (const [key, chunk] of clip.volume.chunks()) {
    chunk.decodeInto(dense);
    for (let i = 0; i < CHUNK_VOLUME; i++)
      if (dense[i] !== 0) dense[i] = map.get(dense[i]!) ?? dense[i]!;
    out.putChunk(key, Chunk.fromDense(dense));
  }
  out.takeMeshDirty();
  return out;
}

/** Marker of clipboard text that holds voxels. */
const PREFIX = 'voxels-clip/1 ';

/** Text form of a clip for the system clipboard: survives switching tabs and windows. */
export function serializeClip(clip: VoxelClip): string {
  const voxels: number[] = [];
  for (const [key, chunk] of clip.volume.chunks()) {
    chunk.decodeInto(dense);
    const ox = keyX(key) * CHUNK_SIZE;
    const oy = keyY(key) * CHUNK_SIZE;
    const oz = keyZ(key) * CHUNK_SIZE;
    for (let i = 0; i < CHUNK_VOLUME; i++) {
      const v = dense[i]!;
      if (v !== 0) voxels.push(ox + (i & 31), oy + ((i >> 5) & 31), oz + (i >> 10), v);
    }
  }
  return PREFIX + JSON.stringify({ colors: [...clip.colors], voxels });
}

/** The clip in clipboard text, or null when the text is something else. */
export function parseClip(text: string): VoxelClip | null {
  if (!text.startsWith(PREFIX)) return null;
  try {
    const data = JSON.parse(text.slice(PREFIX.length)) as {
      colors: [number, number][];
      voxels: number[];
    };
    const volume = new VoxelVolume();
    for (let i = 0; i + 3 < data.voxels.length; i += 4) {
      volume.set(data.voxels[i]!, data.voxels[i + 1]!, data.voxels[i + 2]!, data.voxels[i + 3]!);
    }
    volume.takeMeshDirty();
    return volume.isEmpty ? null : { volume, colors: new Map(data.colors) };
  } catch {
    return null;
  }
}
