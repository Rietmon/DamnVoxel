import { blue, green, type Hsv, hsvToRgb, packRgba, red, rgbToHsv } from './color';
import type { Modifier } from './modifiers';
import type { Operation } from './operation';
import type { Palette } from './palette';
import type { VolumeReader } from './volume';

/**
 * Painting modifiers. They sit in the modifier chain, so every
 * tool gets them: the colour lock keeps edits on voxels of chosen colours, a shade makes each
 * voxel lighter, darker, warmer or cooler instead of one colour, and a pattern gives each cell a
 * colour from a ramp by its position (gradient, noise, cells, splatter). `reader` is the model as
 * it was before the gesture, so a stroke passing twice does not shade a voxel twice.
 */

/** Edits of existing voxels (paint, erase) touch only voxels of the allowed colours. */
export function colorLockModifier(
  reader: VolumeReader,
  allowed: ReadonlySet<number> | null,
): Modifier {
  return (op) =>
    !allowed || op.action === 'add'
      ? op
      : {
          action: op.action,
          forEachCell(visit) {
            op.forEachCell((x, y, z, c) => {
              if (allowed.has(reader.get(x, y, z))) visit(x, y, z, c);
            });
          },
        };
}

export type Shade = 'lighter' | 'darker' | 'warmer' | 'cooler';
export type ShadeSource = 'palette' | 'hsl';

export const SHADE_TITLES: Record<Shade, string> = {
  lighter: 'Lighter',
  darker: 'Darker',
  warmer: 'Warmer',
  cooler: 'Cooler',
};

const luma = (c: number) => 0.2126 * red(c) + 0.7152 * green(c) + 0.0722 * blue(c);
const hsvOf = (c: number) => rgbToHsv(red(c), green(c), blue(c));
/** Warm and cool ends of the hue circle: orange and blue. */
const WARM = 30;
const COOL = 220;

/** Signed steps from hue `h` towards `to` on the circle, at most `by` degrees. */
function hueToward(h: number, to: number, by: number): number {
  const d = ((to - h + 540) % 360) - 180;
  return h + Math.sign(d) * Math.min(Math.abs(d), by);
}

/** How well colour `c` goes the way of `shade` from `from` (> 0: it does). */
function towards(shade: Shade, from: number, c: number): number {
  if (shade === 'lighter') return luma(c) - luma(from);
  if (shade === 'darker') return luma(from) - luma(c);
  const a = hsvOf(from);
  const b = hsvOf(c);
  const target = shade === 'warmer' ? WARM : COOL;
  const dist = (h: number) => Math.abs(((target - h + 540) % 360) - 180);
  return a.s < 0.05 || b.s < 0.05 ? -1 : dist(a.h) - dist(b.h);
}

/**
 * The palette colour one shade step from `id`. By the palette: a neighbour in the panel order
 * (ramps sit side by side) that goes the right way. By HSL: the colour nudged in value or hue,
 * matched to the nearest other palette colour that goes the right way. `id` itself when nothing
 * does.
 */
export function shadeColor(
  palette: Palette,
  id: number,
  shade: Shade,
  source: ShadeSource,
): number {
  const from = palette.color(id);
  if (source === 'palette') {
    const order = palette.displayOrder();
    const at = order.indexOf(id);
    const candidates = [order[at - 1], order[at + 1]].filter((c): c is number => c !== undefined);
    let best = id;
    let score = 0;
    for (const c of candidates) {
      const s = towards(shade, from, palette.color(c));
      if (s > score) {
        best = c;
        score = s;
      }
    }
    return best;
  }
  const hsv: Hsv = hsvOf(from);
  const next: Hsv =
    shade === 'lighter'
      ? { ...hsv, v: Math.min(1, hsv.v + 0.12), s: Math.max(0, hsv.s - 0.04) }
      : shade === 'darker'
        ? { ...hsv, v: Math.max(0, hsv.v - 0.12) }
        : { ...hsv, h: hueToward(hsv.h, shade === 'warmer' ? WARM : COOL, 15) };
  const target = packRgba(...hsvToRgb(next));
  let best = id;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const c of palette.displayOrder()) {
    if (c === id) continue;
    const col = palette.color(c);
    if (towards(shade, from, col) <= 0) continue;
    const d =
      (red(col) - red(target)) ** 2 +
      (green(col) - green(target)) ** 2 +
      (blue(col) - blue(target)) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = c;
    }
  }
  return best;
}

/** Paint shades each voxel from its own colour instead of laying one colour. */
export function shadeModifier(
  reader: VolumeReader,
  palette: Palette,
  shade: Shade | null,
  source: ShadeSource,
): Modifier {
  if (!shade) return (op) => op;
  const cache = new Map<number, number>();
  return (op) =>
    op.action !== 'paint'
      ? op
      : {
          action: 'paint',
          forEachCell(visit) {
            op.forEachCell((x, y, z) => {
              const current = reader.get(x, y, z);
              if (!current) return;
              let next = cache.get(current);
              if (next === undefined) {
                next = shadeColor(palette, current, shade, source);
                cache.set(current, next);
              }
              visit(x, y, z, next);
            });
          },
        };
}

export type PaintPattern =
  | 'solid'
  | 'gradient'
  | 'random'
  | 'perlin'
  | 'worley'
  | 'voronoi'
  | 'splatter';

export const PATTERN_TITLES: Record<PaintPattern, string> = {
  solid: 'Solid',
  gradient: 'Gradient',
  random: 'Random',
  perlin: 'Perlin noise',
  worley: 'Cells (Worley)',
  voronoi: 'Voronoi',
  splatter: 'Splatter',
};

export interface PatternOptions {
  pattern: PaintPattern;
  /** The ramp, in order: the palette selection or colours around the current one. */
  colors: readonly number[];
  /** Feature size of noise and cells, voxels. */
  scale: number;
  /** Gradient: along which axis, between which coordinates. */
  axis: 0 | 1 | 2;
  from: number;
  to: number;
}

/** A repeatable hash of a cell (and a seed) into [0, 1). */
export function hash01(x: number, y: number, z: number, seed = 0): number {
  let h = Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(z, 0xcb1ab31f) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 0x100000000;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Smooth 3D value noise in [0, 1). */
function valueNoise(x: number, y: number, z: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const tx = fade(x - x0);
  const ty = fade(y - y0);
  const tz = fade(z - z0);
  let sum = 0;
  for (let k = 0; k < 8; k++) {
    const dx = k & 1;
    const dy = (k >> 1) & 1;
    const dz = (k >> 2) & 1;
    const w = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz);
    sum += w * hash01(x0 + dx, y0 + dy, z0 + dz, 7);
  }
  return sum;
}

/** Nearest feature point of a jittered grid: its distance (in cells) and its cell. */
function nearestFeature(x: number, y: number, z: number): { d: number; id: number } {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  const cz = Math.floor(z);
  let best = Number.POSITIVE_INFINITY;
  let id = 0;
  for (let k = -1; k <= 1; k++)
    for (let j = -1; j <= 1; j++)
      for (let i = -1; i <= 1; i++) {
        const gx = cx + i;
        const gy = cy + j;
        const gz = cz + k;
        const px = gx + hash01(gx, gy, gz, 1);
        const py = gy + hash01(gx, gy, gz, 2);
        const pz = gz + hash01(gx, gy, gz, 3);
        const d = Math.hypot(px - x, py - y, pz - z);
        if (d < best) {
          best = d;
          id = Math.floor(hash01(gx, gy, gz, 4) * 1e9);
        }
      }
  return { d: best, id };
}

/** The ramp position 0…1 a cell gets under a pattern (null: leave the colour as it is). */
export function patternValue(o: PatternOptions, x: number, y: number, z: number): number | null {
  const s = Math.max(1, o.scale);
  switch (o.pattern) {
    case 'solid':
      return null;
    case 'gradient': {
      const c = [x, y, z][o.axis]!;
      const span = o.to - o.from;
      return span === 0 ? 0 : Math.max(0, Math.min(1, (c - o.from) / span));
    }
    case 'random':
      return hash01(x, y, z, 11);
    case 'perlin': {
      // Two octaves, stretched to fill the ramp.
      const n =
        (valueNoise(x / s, y / s, z / s) * 2 + valueNoise((x * 2) / s, (y * 2) / s, (z * 2) / s)) /
        3;
      return Math.max(0, Math.min(1, (n - 0.2) / 0.6));
    }
    case 'worley':
      return Math.min(1, nearestFeature(x / s, y / s, z / s).d / 1.2);
    case 'voronoi':
      return (nearestFeature(x / s, y / s, z / s).id % 1000) / 1000;
    case 'splatter': {
      // Mostly the middle of the ramp, sometimes a step lighter or darker.
      const h = hash01(x, y, z, 13);
      return h < 0.6 ? 0.5 : h < 0.8 ? 0.25 : 0.75;
    }
  }
}

/** The colour of a ramp at position t. */
export function rampColor(colors: readonly number[], t: number): number {
  const n = colors.length;
  return colors[Math.min(n - 1, Math.floor(t * n))]!;
}

/** Adding and painting give each cell its colour from the pattern. */
export function patternModifier(o: PatternOptions | null): Modifier {
  if (!o || o.pattern === 'solid' || o.colors.length === 0) return (op) => op;
  return (op: Operation) =>
    op.action === 'erase'
      ? op
      : {
          action: op.action,
          forEachCell(visit) {
            op.forEachCell((x, y, z, c) => {
              const t = patternValue(o, x, y, z);
              visit(x, y, z, t === null ? c : rampColor(o.colors, t));
            });
          },
        };
}

/**
 * A ramp around a colour: up to `reach` neighbours on each side in the palette panel order,
 * where ramps usually sit together.
 */
export function rampAround(palette: Palette, id: number, reach = 2): number[] {
  const order = palette.displayOrder();
  const at = order.indexOf(id);
  if (at < 0) return [id];
  return order.slice(Math.max(0, at - reach), at + reach + 1);
}
