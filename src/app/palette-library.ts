import { packRgba } from '../core/color';
import { MAGICAVOXEL_DEFAULT_PALETTE } from '../core/default-palette';
import {
  formatOf,
  type NamedColors,
  parseAct,
  parseGpl,
  parseHex,
  parsePal,
  writeAct,
  writeGpl,
  writeHex,
  writePal,
} from '../formats/palette-formats';
import { readVox } from '../io/vox-read';
import { writable } from './store';

/**
 * The palette library: a few well-known palettes, the
 * person's own saved ones (in the browser), and palette files in and out.
 */

const hex = (list: string) =>
  list
    .split(/\s+/)
    .filter(Boolean)
    .map((h) => {
      const n = Number.parseInt(h, 16);
      return packRgba((n >> 16) & 255, (n >> 8) & 255, n & 255);
    });

function greys(n: number): number[] {
  return Array.from({ length: n }, (_, i) => {
    const v = Math.round((255 * i) / (n - 1));
    return packRgba(v, v, v);
  });
}

export const PRESETS: readonly NamedColors[] = [
  { name: 'MagicaVoxel', colors: MAGICAVOXEL_DEFAULT_PALETTE.slice(1, 256) },
  {
    name: 'PICO-8',
    colors: hex(
      '000000 1d2b53 7e2553 008751 ab5236 5f574f c2c3c7 fff1e8 ff004d ffa300 ffec27 00e436 29adff 83769c ff77a8 ffccaa',
    ),
  },
  {
    name: 'Sweetie 16',
    colors: hex(
      '1a1c2c 5d275d b13e53 ef7d57 ffcd75 a7f070 38b764 257179 29366f 3b5dc9 41a6f6 73eff7 f4f4f4 94b0c2 566c86 333c57',
    ),
  },
  {
    name: 'Endesga 32',
    colors: hex(
      'be4a2f d77643 ead4aa e4a672 b86f50 733e39 3e2731 a22633 e43b44 f77622 feae34 fee761 63c74d 3e8948 265c42 193c3e 124e89 0099db 2ce8f5 ffffff c0cbdc 8b9bb4 5a6988 3a4466 262b44 181425 ff0044 68386c b55088 f6757a e8b796 c28569',
    ),
  },
  { name: 'Greys 16', colors: greys(16) },
];

const KEY = 'voxels:palettes';

/** Palettes the person saved, kept in the browser. */
export class PaletteLibrary {
  readonly saved = writable<NamedColors[]>(load());

  save(p: NamedColors): void {
    this.saved.update((list) => [...list.filter((s) => s.name !== p.name), p]);
    store(this.saved.get());
  }

  remove(name: string): void {
    this.saved.update((list) => list.filter((s) => s.name !== name));
    store(this.saved.get());
  }
}

function load(): NamedColors[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as NamedColors[];
    return raw.filter((p) => typeof p.name === 'string' && Array.isArray(p.colors));
  } catch {
    return [];
  }
}

function store(list: NamedColors[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Blocked storage: the list lives until the page closes.
  }
}

/** A palette from a file: text formats, ACT, a PNG (its pixels in order), or a .vox's palette. */
export async function readPaletteFile(file: File): Promise<NamedColors> {
  const name = file.name.replace(/\.[^.]+$/, '');
  const format = formatOf(file.name);
  if (format === 'gpl') return { ...parseGpl(await file.text()), name };
  if (format === 'hex') return parseHex(await file.text(), name);
  if (format === 'pal') return parsePal(await file.text(), name);
  if (format === 'act') return parseAct(new Uint8Array(await file.arrayBuffer()), name);
  if (format === 'vox') {
    const doc = readVox(new Uint8Array(await file.arrayBuffer()));
    const p = doc.palette;
    return { name, colors: p.displayOrder().map((id) => p.color(id)) };
  }
  if (format === 'png') return { name, colors: await pngColors(file) };
  throw new Error('Unknown palette format');
}

/** The distinct colours of a picture, row by row, at most 255. */
async function pngColors(file: File): Promise<number[]> {
  const image = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const g = canvas.getContext('2d');
  if (!g) return [];
  g.drawImage(image, 0, 0);
  const data = g.getImageData(0, 0, image.width, image.height).data;
  const seen = new Set<number>();
  const out: number[] = [];
  for (let i = 0; i < data.length && out.length < 255; i += 4) {
    if (data[i + 3]! < 128) continue;
    const c = packRgba(data[i]!, data[i + 1]!, data[i + 2]!);
    if (seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}

/** A palette as a file to download. */
export function paletteFile(p: NamedColors, format: 'gpl' | 'hex' | 'pal' | 'act'): Blob {
  if (format === 'act') return new Blob([writeAct(p) as BlobPart]);
  const text = format === 'gpl' ? writeGpl(p) : format === 'hex' ? writeHex(p) : writePal(p);
  return new Blob([text], { type: 'text/plain' });
}

/** A palette as a PNG strip: one pixel per colour. */
export async function palettePng(p: NamedColors): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = p.colors.length;
  canvas.height = 1;
  const g = canvas.getContext('2d');
  if (!g) return null;
  const img = g.createImageData(p.colors.length, 1);
  p.colors.forEach((c, i) => {
    img.data[i * 4] = c & 255;
    img.data[i * 4 + 1] = (c >>> 8) & 255;
    img.data[i * 4 + 2] = (c >>> 16) & 255;
    img.data[i * 4 + 3] = 255;
  });
  g.putImageData(img, 0, 0);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
export type { NamedColors } from '../formats/palette-formats';
