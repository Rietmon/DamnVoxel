import { nearestPaletteId } from './clipboard';
import { alpha, blue, green, packRgba, red } from './color';
import { CHUNK_SIZE, CHUNK_VOLUME, indexX, indexY, indexZ, keyX, keyY, keyZ } from './coords';
import type { Palette } from './palette';
import { VoxelVolume } from './volume';

/**
 * Pictures to voxels and back (PNG slices, picture import): a picture as a
 * plane of voxels or as a height map, a sheet of slices as a model, and a model as slices —
 * the way voxel art travels between pixel editors and voxel editors. Colours go to the nearest
 * entry of the palette; pixels with alpha under half are empty.
 */

/** RGBA pixels, rows from the top. */
export interface Picture {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

const OPAQUE = 128;

/** Palette ids for colours, remembered: pictures repeat their colours. */
function colourIds(palette: Palette): (r: number, g: number, b: number) => number {
  const known = new Map<number, number>();
  return (r, g, b) => {
    const key = (r << 16) | (g << 8) | b;
    let id = known.get(key);
    if (id === undefined) {
      id = nearestPaletteId(palette, packRgba(r, g, b));
      known.set(key, id);
    }
    return id;
  };
}

export type PlaneFacing = 'upright' | 'flat';

/**
 * A voxel per opaque pixel: standing in the XY plane (x right, y up), or lying in the XZ plane
 * as a map seen from above (the top row farthest, at z = 0).
 */
export function pictureToVolume(pic: Picture, palette: Palette, facing: PlaneFacing): VoxelVolume {
  const id = colourIds(palette);
  const v = new VoxelVolume();
  for (let y = 0; y < pic.height; y++)
    for (let x = 0; x < pic.width; x++) {
      const i = (y * pic.width + x) * 4;
      if (pic.data[i + 3]! < OPAQUE) continue;
      const c = id(pic.data[i]!, pic.data[i + 1]!, pic.data[i + 2]!);
      if (facing === 'upright') v.set(x, pic.height - 1 - y, 0, c);
      else v.set(x, 0, y, c);
    }
  v.takeMeshDirty();
  return v;
}

/**
 * A height map: each opaque pixel a solid column on the XZ plane, as tall as the pixel is
 * bright (at least one voxel, at most `maxHeight`), coloured like the pixel or with one id.
 */
export function heightmapToVolume(
  pic: Picture,
  palette: Palette,
  maxHeight: number,
  colorId: number | null,
): VoxelVolume {
  const id = colourIds(palette);
  const v = new VoxelVolume();
  for (let z = 0; z < pic.height; z++)
    for (let x = 0; x < pic.width; x++) {
      const i = (z * pic.width + x) * 4;
      if (pic.data[i + 3]! < OPAQUE) continue;
      const r = pic.data[i]!;
      const g = pic.data[i + 1]!;
      const b = pic.data[i + 2]!;
      const light = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const h = Math.max(1, Math.round(light * maxHeight));
      const c = colorId ?? id(r, g, b);
      for (let y = 0; y < h; y++) v.set(x, y, z, c);
    }
  v.takeMeshDirty();
  return v;
}

/**
 * A sheet of slices as a model: cells of `width × depth` pixels in a grid, read left to right
 * and down; cell k is layer y = k from the bottom, x to the right and z down within it — the
 * layout {@link volumeSlices} gives. Fully empty cells past the last layer are dropped.
 */
export function slicesToVolume(
  pic: Picture,
  width: number,
  depth: number,
  palette: Palette,
): VoxelVolume {
  const id = colourIds(palette);
  const v = new VoxelVolume();
  const columns = Math.floor(pic.width / width);
  const rows = Math.floor(pic.height / depth);
  for (let k = 0; k < columns * rows; k++) {
    const x0 = (k % columns) * width;
    const y0 = Math.floor(k / columns) * depth;
    for (let z = 0; z < depth; z++)
      for (let x = 0; x < width; x++) {
        const i = ((y0 + z) * pic.width + x0 + x) * 4;
        if (pic.data[i + 3]! < OPAQUE) continue;
        v.set(x, k, z, id(pic.data[i]!, pic.data[i + 1]!, pic.data[i + 2]!));
      }
  }
  v.takeMeshDirty();
  return v;
}

/**
 * A model's layers along Y as pictures, bottom first: x to the right and z down in each, empty
 * cells transparent. Null for an empty volume.
 */
export function volumeSlices(
  volume: VoxelVolume,
  palette: Palette,
): { width: number; depth: number; layers: Uint8ClampedArray<ArrayBuffer>[] } | null {
  const b = volume.getBounds();
  if (!b) return null;
  const width = b.maxX - b.minX + 1;
  const depth = b.maxZ - b.minZ + 1;
  const layers = Array.from(
    { length: b.maxY - b.minY + 1 },
    () => new Uint8ClampedArray(width * depth * 4),
  );
  const dense = new Uint16Array(CHUNK_VOLUME);
  for (const [key, chunk] of volume.chunks()) {
    chunk.decodeInto(dense);
    const ox = keyX(key) * CHUNK_SIZE;
    const oy = keyY(key) * CHUNK_SIZE;
    const oz = keyZ(key) * CHUNK_SIZE;
    for (let i = 0; i < CHUNK_VOLUME; i++) {
      const id = dense[i]!;
      if (!id) continue;
      const c = palette.color(id);
      const layer = layers[oy + indexY(i) - b.minY]!;
      const p = ((oz + indexZ(i) - b.minZ) * width + ox + indexX(i) - b.minX) * 4;
      layer[p] = red(c);
      layer[p + 1] = green(c);
      layer[p + 2] = blue(c);
      layer[p + 3] = alpha(c) || 255;
    }
  }
  return { width, depth, layers };
}

/** A sheet's grid: about square, so even 256 layers stay within what a canvas can hold. */
export function sheetColumns(layers: number): number {
  return Math.max(1, Math.ceil(Math.sqrt(layers)));
}
