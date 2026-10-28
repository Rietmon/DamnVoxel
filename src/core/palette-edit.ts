import { alpha, blue, green, hsvToRgb, packRgba, red, rgbToHsv } from './color';
import { CHUNK_SIZE, CHUNK_VOLUME, indexX, indexY, indexZ, keyX, keyY, keyZ } from './coords';
import type { VoxelDocument } from './document';
import { type Command, CompositeCommand } from './history';
import type { Palette, PaletteEntry } from './palette';
import type { Scene } from './scene';
import { VoxelTransaction } from './voxel-edit';

/** New values for some palette entries; edits of the same entries in one gesture merge. */
export class PaletteEntriesCommand implements Command {
  readonly bytes: number;
  private readonly before: PaletteEntry[];

  constructor(
    readonly label: string,
    palette: Palette,
    private readonly ids: readonly number[],
    private after: readonly PaletteEntry[],
  ) {
    this.before = ids.map((id) => palette.entry(id));
    this.bytes = 64 + ids.length * 64;
  }

  apply(doc: VoxelDocument): void {
    this.ids.forEach((id, i) => {
      doc.palette.setEntry(id, this.after[i]!);
    });
    doc.notify('palette');
  }

  revert(doc: VoxelDocument): void {
    this.ids.forEach((id, i) => {
      doc.palette.setEntry(id, this.before[i]!);
    });
    doc.notify('palette');
  }

  merge(next: Command): boolean {
    if (!(next instanceof PaletteEntriesCommand) || next.label !== this.label) return false;
    if (next.ids.length !== this.ids.length || next.ids.some((id, i) => id !== this.ids[i])) {
      return false;
    }
    this.after = next.after;
    return true;
  }
}

/** A new display order; voxels keep their ids, only the panel changes. */
export class PaletteOrderCommand implements Command {
  readonly bytes: number;
  private readonly before: readonly number[];

  constructor(
    readonly label: string,
    palette: Palette,
    private readonly after: readonly number[],
  ) {
    this.before = [...palette.displayOrder()];
    this.bytes = 64 + after.length * 8;
  }

  apply(doc: VoxelDocument): void {
    doc.palette.setDisplayOrder(this.after);
    doc.notify('palette');
  }

  revert(doc: VoxelDocument): void {
    doc.palette.setDisplayOrder(this.before);
    doc.notify('palette');
  }
}

/**
 * The display order with `ids` taken out and put back together, in their current order, right
 * before `before` (at the end when null).
 */
export function movedOrder(
  order: readonly number[],
  ids: readonly number[],
  before: number | null,
): number[] {
  const moving = new Set(ids);
  const kept = order.filter((id) => !moving.has(id));
  const block = order.filter((id) => moving.has(id));
  // The reference may be one of the moved ids: the next one that stays takes its place.
  let ref = before;
  if (ref !== null && moving.has(ref)) {
    const from = order.indexOf(ref);
    ref = order.slice(from).find((id) => !moving.has(id)) ?? null;
  }
  const at = ref === null ? kept.length : kept.indexOf(ref);
  return [...kept.slice(0, at), ...block, ...kept.slice(at)];
}

/** Ids `ids` sorted by their place in the display order. */
export function inDisplayOrder(palette: Palette, ids: Iterable<number>): number[] {
  const order = palette.displayOrder();
  const place = new Map(order.map((id, i) => [id, i]));
  return [...new Set(ids)]
    .filter((id) => place.has(id))
    .sort((a, b) => place.get(a)! - place.get(b)!);
}

/** How many voxels of each palette id the scene has (index = id; 0 is not counted). */
export function colorCounts(scene: Scene): Uint32Array {
  const counts = new Uint32Array(65536);
  const dense = new Uint16Array(CHUNK_VOLUME);
  const seen = new Set<unknown>();
  for (const object of scene.objects()) {
    // Linked copies share voxels: they are counted once.
    if (seen.has(object.volume)) continue;
    seen.add(object.volume);
    for (const [, chunk] of object.volume.chunks()) {
      if (chunk.storageBits === 0) {
        counts[chunk.uniform] = counts[chunk.uniform]! + CHUNK_VOLUME;
        continue;
      }
      chunk.decodeInto(dense);
      for (let i = 0; i < CHUNK_VOLUME; i++) counts[dense[i]!] = counts[dense[i]!]! + 1;
    }
  }
  counts[0] = 0;
  return counts;
}

/** A palette entry named: the name also goes into its material as _name, which .vox keeps. */
export function namedEntry(entry: PaletteEntry, name: string): PaletteEntry {
  const material = new Map(entry.material);
  if (name) material.set('_name', name);
  else material.delete('_name');
  return { ...entry, name, material };
}

/** New notes for the palette rows. */
export class PaletteNotesCommand implements Command {
  readonly bytes = 256;
  readonly label = 'Palette note';
  private readonly before: string[];

  constructor(
    palette: Palette,
    private readonly after: readonly string[],
  ) {
    this.before = [...palette.notes];
  }

  apply(doc: VoxelDocument): void {
    doc.palette.notes = [...this.after];
    doc.notify('palette');
  }

  revert(doc: VoxelDocument): void {
    doc.palette.notes = [...this.before];
    doc.notify('palette');
  }
}

/** Palette ids used by any voxel of the scene. */
export function usedIds(scene: Scene): Set<number> {
  const used = new Set<number>();
  const dense = new Uint16Array(CHUNK_VOLUME);
  for (const object of scene.objects()) {
    for (const [, chunk] of object.volume.chunks()) {
      if (chunk.storageBits === 0) {
        used.add(chunk.uniform);
        continue;
      }
      chunk.decodeInto(dense);
      for (let i = 0; i < CHUNK_VOLUME; i++) used.add(dense[i]!);
    }
  }
  used.delete(0);
  return used;
}

// OKLab keeps gradients even to the eye: a straight RGB blend dips in the middle.
function toLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function fromLinear(v: number): number {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, c)) * 255);
}

function toOklab(rgba: number): [number, number, number] {
  const r = toLinear(red(rgba));
  const g = toLinear(green(rgba));
  const b = toLinear(blue(rgba));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, A, B]: [number, number, number], a: number): number {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return packRgba(
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    a,
  );
}

/** Colour between two at `t` (0…1), blended in OKLab; alpha blends linearly. */
export function blendColor(from: number, to: number, t: number): number {
  const a = toOklab(from);
  const b = toOklab(to);
  const mix: [number, number, number] = [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
  return fromOklab(mix, Math.round(alpha(from) + (alpha(to) - alpha(from)) * t));
}

/**
 * Fills the entries between the first and the last of `ids` (in display order) with a smooth
 * blend of those two colours, as one step. Needs at least three entries.
 */
export function paletteGradient(doc: VoxelDocument, ids: readonly number[]): boolean {
  const palette = doc.palette;
  const sorted = inDisplayOrder(palette, ids);
  if (sorted.length < 3) return false;
  const from = palette.color(sorted[0]!);
  const to = palette.color(sorted.at(-1)!);
  const middle = sorted.slice(1, -1);
  const after = middle.map((id, i) => ({
    ...palette.entry(id),
    color: blendColor(from, to, (i + 1) / (sorted.length - 1)),
  }));
  doc.history.execute(new PaletteEntriesCommand('Gradient', palette, middle, after));
  return true;
}

/**
 * Copies the entries `ids` into entries no voxel uses, placed right after the last of them in
 * the display order, so no colour of the model changes. Returns the new ids, or null when there
 * are not enough unused entries.
 */
export function duplicateEntries(doc: VoxelDocument, ids: readonly number[]): number[] | null {
  const palette = doc.palette;
  const sorted = inDisplayOrder(palette, ids);
  if (sorted.length === 0) return [];
  const used = usedIds(doc.scene);
  const taken = new Set(sorted);
  // Free entries after the selection come first: the copies stay close to the originals.
  const order = palette.displayOrder();
  const last = order.indexOf(sorted.at(-1)!);
  const free = [...order.slice(last + 1), ...order.slice(0, last)].filter(
    (id) => !used.has(id) && !taken.has(id),
  );
  if (free.length < sorted.length) return null;
  const targets = free.slice(0, sorted.length);
  const entries = new PaletteEntriesCommand(
    'Duplicate colors',
    palette,
    targets,
    sorted.map((id) => palette.entry(id)),
  );
  const reordered = new PaletteOrderCommand(
    'Duplicate colors',
    palette,
    movedOrder(order, targets, order[last + 1] ?? null),
  );
  doc.history.execute(new CompositeCommand('Duplicate colors', [entries, reordered]));
  return targets;
}

/**
 * A colour moved by the same HSV step as another colour went from `from` to `to`: hue turns
 * by the same angle, saturation and value shift by the same amount. Edits of several selected
 * entries keep their relations this way.
 */
export function shiftLike(color: number, from: number, to: number): number {
  const a = rgbToHsv(red(from), green(from), blue(from));
  const b = rgbToHsv(red(to), green(to), blue(to));
  const c = rgbToHsv(red(color), green(color), blue(color));
  // A grey source has no hue to turn by: only saturation and value move.
  const dh = a.s === 0 || b.s === 0 ? 0 : b.h - a.h;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const [r, g, bl] = hsvToRgb({
    h: (((c.h + dh) % 360) + 360) % 360,
    s: clamp(c.s + b.s - a.s),
    v: clamp(c.v + b.v - a.v),
  });
  return packRgba(r, g, bl, alpha(color));
}

/** Colours in a ramp: a row of eight in panel order, as MagicaVoxel lays its palette out. */
export const RAMP_LENGTH = 8;

/**
 * The colour `step` places along the ramp of `id` (wrapping inside the ramp), or with
 * `across` the colour at the same place in the ramp `step` rows away (wrapping around the
 * palette).
 */
export function stepInRamp(palette: Palette, id: number, step: number, across = false): number {
  const order = palette.displayOrder();
  const at = order.indexOf(id);
  if (at < 0) return id;
  const row = Math.floor(at / RAMP_LENGTH);
  const col = at % RAMP_LENGTH;
  if (across) {
    const rows = Math.ceil(order.length / RAMP_LENGTH);
    const next = (((row + step) % rows) + rows) % rows;
    return order[Math.min(order.length - 1, next * RAMP_LENGTH + col)]!;
  }
  const start = row * RAMP_LENGTH;
  const length = Math.min(RAMP_LENGTH, order.length - start);
  return order[start + ((((col + step) % length) + length) % length)]!;
}

/** The ramp a colour is in: its row of eight, in order. */
export function rampOf(palette: Palette, id: number): number[] {
  const order = palette.displayOrder();
  const at = order.indexOf(id);
  if (at < 0) return [id];
  const start = Math.floor(at / RAMP_LENGTH) * RAMP_LENGTH;
  return order.slice(start, start + RAMP_LENGTH);
}

/**
 * Takes a list of colours as the palette. «replace»: entries 1…n get the colours, voxels keep
 * their ids (the model recolours). «remap»: every voxel first moves to the nearest of the new
 * colours, so the model keeps its look as well as the new palette allows. One step.
 */
export function applyColors(
  doc: VoxelDocument,
  colors: readonly number[],
  mode: 'replace' | 'remap',
): void {
  const palette = doc.palette;
  const n = Math.min(colors.length, palette.size);
  if (n === 0) return;
  const parts: Command[] = [];
  if (mode === 'remap') {
    const map = new Uint16Array(palette.size + 1);
    for (let id = 1; id <= palette.size; id++) {
      const c = palette.color(id);
      let best = 1;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let k = 0; k < n; k++) {
        const d = colorDistance(c, colors[k]!);
        if (d < bestDistance) {
          bestDistance = d;
          best = k + 1;
        }
      }
      map[id] = best;
    }
    const tx = new VoxelTransaction();
    const dense = new Uint16Array(CHUNK_VOLUME);
    const seen = new Set<unknown>();
    for (const object of doc.scene.objects()) {
      if (seen.has(object.volume)) continue;
      seen.add(object.volume);
      for (const [key, chunk] of object.volume.chunks()) {
        chunk.decodeInto(dense);
        const ox = keyX(key) * CHUNK_SIZE;
        const oy = keyY(key) * CHUNK_SIZE;
        const oz = keyZ(key) * CHUNK_SIZE;
        for (let i = 0; i < CHUNK_VOLUME; i++) {
          const v = dense[i]!;
          if (v && map[v] !== v)
            tx.set(object, ox + indexX(i), oy + indexY(i), oz + indexZ(i), map[v]!);
        }
      }
    }
    const recolor = tx.commit('Fit to palette');
    if (recolor) parts.push(recolor);
  }
  const ids = Array.from({ length: n }, (_, i) => i + 1);
  const entries = ids.map((id, i) => ({ ...palette.entry(id), color: colors[i]! }));
  const set = new PaletteEntriesCommand('Palette', palette, ids, entries);
  set.apply(doc);
  parts.push(set);
  doc.history.push(
    new CompositeCommand(mode === 'remap' ? 'Palette with fitting' : 'Palette', parts),
  );
}

function colorDistance(a: number, b: number): number {
  return (red(a) - red(b)) ** 2 + (green(a) - green(b)) ** 2 + (blue(a) - blue(b)) ** 2;
}
