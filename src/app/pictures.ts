import { CHUNK_SIZE, CHUNK_VOLUME, indexX, indexY, indexZ, keyX, keyY, keyZ } from '../core/coords';
import type { Picture, PlaneFacing } from '../core/image-voxels';
import { type VoxelObject, worldTransform } from '../core/scene';
import { cellToWorld } from '../core/transform';
import { VoxelVolume } from '../core/volume';

/**
 * Pictures in and out (PNG slices, picture import): the settings of the
 * picture window, reading a picture file into pixels, and the visible scene as one volume for
 * slicing.
 */

export type PictureMode = 'plane' | 'heightmap' | 'slices';

export interface PictureSettings {
  mode: PictureMode;
  facing: PlaneFacing;
  /** Plane and height map: pictures larger than this are scaled down. */
  maxSide: number;
  /** Height map: the height of white. */
  maxHeight: number;
  /** Height map: columns in the current colour instead of the picture's. */
  oneColor: boolean;
  /** Slice sheet: one slice's size in pixels (width = x, height = z). */
  sliceWidth: number;
  sliceDepth: number;
  /** Slices out: the whole visible scene instead of the active object. */
  wholeScene: boolean;
  /** Slices out: a PNG per layer in a ZIP instead of one sheet. */
  separate: boolean;
}

export const DEFAULT_PICTURES: PictureSettings = {
  mode: 'plane',
  facing: 'upright',
  maxSide: 256,
  maxHeight: 32,
  oneColor: false,
  sliceWidth: 32,
  sliceDepth: 32,
  wholeScene: false,
  separate: false,
};

export function vetPictures(s: PictureSettings): PictureSettings {
  const d = DEFAULT_PICTURES;
  const int = (v: number, lo: number, hi: number, f: number) =>
    Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : f;
  return {
    mode: (['plane', 'heightmap', 'slices'] as const).includes(s.mode) ? s.mode : d.mode,
    facing: s.facing === 'flat' ? 'flat' : 'upright',
    maxSide: int(s.maxSide, 8, 1024, d.maxSide),
    maxHeight: int(s.maxHeight, 1, 256, d.maxHeight),
    oneColor: s.oneColor === true,
    sliceWidth: int(s.sliceWidth, 1, 1024, d.sliceWidth),
    sliceDepth: int(s.sliceDepth, 1, 1024, d.sliceDepth),
    wholeScene: s.wholeScene === true,
    separate: s.separate === true,
  };
}

/**
 * The slice size a sheet's file name tells ("… 24x16x40.png", as the slice export names it),
 * or a guess: square slices in a row or a column.
 */
export function guessSlices(
  name: string,
  width: number,
  height: number,
): { width: number; depth: number } {
  const m = /(\d+)\s*[x×]\s*(\d+)\s*[x×]\s*(\d+)/i.exec(name);
  if (m) return { width: Number(m[1]), depth: Number(m[2]) };
  if (width % height === 0) return { width: height, depth: height };
  if (height % width === 0) return { width, depth: width };
  const side = Math.min(width, height);
  return { width: side, depth: side };
}

/** A picture file as pixels, scaled down to `maxSide` if larger (Infinity keeps every pixel). */
export async function readPicture(file: Blob, maxSide: number): Promise<Picture> {
  const bitmap = await createImageBitmap(file);
  const k = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * k));
  const height = Math.max(1, Math.round(bitmap.height * k));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error('No 2D canvas');
  // Pixel art at its own size stays crisp; only a real downscale averages.
  g.imageSmoothingEnabled = k < 1;
  g.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return { width, height, data: g.getImageData(0, 0, width, height).data };
}

/** Objects together in world cells, as one volume: the scene to slice. */
export function worldVolume(objects: readonly VoxelObject[]): VoxelVolume {
  const out = new VoxelVolume();
  const dense = new Uint16Array(CHUNK_VOLUME);
  for (const o of objects) {
    const t = worldTransform(o);
    for (const [key, chunk] of o.volume.chunks()) {
      chunk.decodeInto(dense);
      const ox = keyX(key) * CHUNK_SIZE;
      const oy = keyY(key) * CHUNK_SIZE;
      const oz = keyZ(key) * CHUNK_SIZE;
      for (let i = 0; i < CHUNK_VOLUME; i++) {
        const id = dense[i]!;
        if (!id) continue;
        const [x, y, z] = cellToWorld(t, ox + indexX(i), oy + indexY(i), oz + indexZ(i));
        out.set(x, y, z, id);
      }
    }
  }
  return out;
}

/** Pixels as a PNG through a canvas (real compression; the browser's encoder). */
export async function pngBlob(
  pixels: Uint8ClampedArray<ArrayBuffer>,
  width: number,
  height: number,
): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.putImageData(new ImageData(pixels, width, height), 0, 0);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
