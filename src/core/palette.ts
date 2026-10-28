import { MAGICAVOXEL_DEFAULT_PALETTE } from './default-palette';

/**
 * Material of a palette entry as a dictionary, the way .vox MATL stores it (`_type`, `_rough`,
 * …). Keys the editor does not understand are kept and written back. Empty means plain diffuse.
 */
export type MaterialDict = ReadonlyMap<string, string>;

export interface PaletteEntry {
  /** Packed RGBA, see core/color.ts. */
  readonly color: number;
  readonly material: MaterialDict;
  /** Colour name, '' when unnamed. */
  readonly name: string;
}

/** Largest palette id: voxel values are uint16 and 0 is empty. */
export const MAX_PALETTE_ID = 65535;

export const EMPTY_MATERIAL: MaterialDict = new Map();

/**
 * Palette of a document. A voxel stores an entry id (1…65535); 0 is empty and has no entry.
 * The display order is separate from ids, like IMAP in .vox: reordering the panel never touches
 * voxels. Entries are immutable values; changes go through commands that swap whole entries.
 * See docs/data-model.md, "Document palette".
 */
export class Palette {
  /** Index = id; index 0 is a placeholder for empty. */
  private readonly entries: PaletteEntry[];
  private order: number[];
  /**
   * Notes on rows of eight colours in panel order, as MagicaVoxel's palette rows: “trunks”,
   * “leaves”. '' for a row without one.
   */
  notes: string[] = [];

  constructor(entries: readonly PaletteEntry[], order?: readonly number[]) {
    if (entries.length > MAX_PALETTE_ID) {
      throw new Error(`Palette is limited to ${MAX_PALETTE_ID} entries`);
    }
    this.entries = [{ color: 0, material: EMPTY_MATERIAL, name: '' }, ...entries];
    this.order = order ? [...order] : entries.map((_, i) => i + 1);
    if (!isPermutation(this.order, entries.length)) {
      throw new Error('Palette order must list every id once');
    }
  }

  /** 255 colours of the MagicaVoxel default palette with plain diffuse materials. */
  static createDefault(): Palette {
    const entries: PaletteEntry[] = [];
    for (let id = 1; id < 256; id++) {
      entries.push({ color: MAGICAVOXEL_DEFAULT_PALETTE[id]!, material: EMPTY_MATERIAL, name: '' });
    }
    return new Palette(entries);
  }

  /** Number of entries; ids are 1…size. */
  get size(): number {
    return this.entries.length - 1;
  }

  has(id: number): boolean {
    return Number.isInteger(id) && id >= 1 && id < this.entries.length;
  }

  entry(id: number): PaletteEntry {
    const e = this.entries[id];
    if (id < 1 || !e) throw new RangeError(`No palette entry ${id}`);
    return e;
  }

  color(id: number): number {
    return this.entries[id]?.color ?? 0;
  }

  /** Ids in display order. */
  displayOrder(): readonly number[] {
    return this.order;
  }

  /** Replaces one entry. Use through a command so the change can be undone. */
  setEntry(id: number, entry: PaletteEntry): void {
    this.entry(id);
    this.entries[id] = entry;
  }

  /** Replaces the display order. Use through a command so the change can be undone. */
  setDisplayOrder(order: readonly number[]): void {
    if (!isPermutation(order, this.size)) throw new Error('Palette order must list every id once');
    this.order = [...order];
  }

  /** Appends an entry at the end of the display order and returns its id. */
  add(entry: PaletteEntry): number {
    if (this.size >= MAX_PALETTE_ID) {
      throw new Error(`Palette is limited to ${MAX_PALETTE_ID} entries`);
    }
    this.entries.push(entry);
    const id = this.size;
    this.order.push(id);
    return id;
  }

  /** Removes the last entry; the inverse of {@link add}, used by undo. */
  removeLast(): void {
    const id = this.size;
    if (id < 1) return;
    this.entries.pop();
    this.order = this.order.filter((o) => o !== id);
  }

  clone(): Palette {
    const copy = new Palette(this.entries.slice(1), this.order);
    copy.notes = [...this.notes];
    return copy;
  }
}

function isPermutation(order: readonly number[], size: number): boolean {
  if (order.length !== size) return false;
  const seen = new Uint8Array(size + 1);
  for (const id of order) {
    if (!Number.isInteger(id) || id < 1 || id > size || seen[id]) return false;
    seen[id] = 1;
  }
  return true;
}
