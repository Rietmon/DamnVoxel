import { CHUNK_VOLUME } from './coords';

/**
 * Storage width of a chunk: 0 — uniform (one value, no array); 1/2/4/8 — local palette plus
 * that many bits per voxel; 16 — direct `Uint16Array` of palette ids. See docs/data-model.md, "Chunk".
 */
export type StorageBits = 0 | 1 | 2 | 4 | 8 | 16;

const PACKED_BITS = [1, 2, 4, 8] as const;

function bitsForPaletteSize(size: number): 1 | 2 | 4 | 8 | 16 {
  for (const bits of PACKED_BITS) if (size <= 1 << bits) return bits;
  return 16;
}

/** log2(voxels per 32-bit word) for each packed width. */
function wordShift(bits: number): number {
  return 5 - Math.log2(bits);
}

// Scratch tables for encoding, shared by all chunks. `seen[v] === generation` marks values met
// in the current encode; `localOf[v]` is the local palette index assigned to value v.
const seen = new Uint32Array(65536);
let generation = 0;
const localOf = new Uint16Array(65536);
const distinctValues = new Uint16Array(65536);
const scratchDense = new Uint16Array(CHUNK_VOLUME);

/**
 * A 32³ block of voxels whose memory depends on its content. Values are document palette ids,
 * 0 is empty. Hot loops should not call `get`/`set` per voxel; they decode into a dense buffer.
 */
export class Chunk {
  /** Number of non-empty voxels. */
  count = 0;
  /** Content version; the owning volume bumps it on every change. */
  version = 0;

  private bits: StorageBits = 0;
  private uniformValue = 0;
  /** Local palette: local index → palette id. Index 0 is always empty. */
  private palette: Uint16Array = new Uint16Array(0);
  private paletteSize = 0;
  private lookup: Map<number, number> = new Map();
  private words: Uint32Array = new Uint32Array(0);
  private direct: Uint16Array = new Uint16Array(0);
  private shift = 0;
  private lowMask = 0;
  private valueMask = 0;

  static uniform(value: number): Chunk {
    const chunk = new Chunk();
    chunk.setUniform(value);
    return chunk;
  }

  static fromDense(dense: Uint16Array): Chunk {
    const chunk = new Chunk();
    chunk.load(dense);
    return chunk;
  }

  /** Current storage width, see {@link StorageBits}. */
  get storageBits(): StorageBits {
    return this.bits;
  }

  /** The single value of a uniform chunk, or -1 when the chunk is not uniform. */
  get uniform(): number {
    return this.bits === 0 ? this.uniformValue : -1;
  }

  get isEmpty(): boolean {
    return this.count === 0;
  }

  get isFull(): boolean {
    return this.count === CHUNK_VOLUME;
  }

  get(i: number): number {
    switch (this.bits) {
      case 0:
        return this.uniformValue;
      case 16:
        return this.direct[i]!;
      default:
        return this.palette[
          (this.words[i >>> this.shift]! >>> ((i & this.lowMask) * this.bits)) & this.valueMask
        ]!;
    }
  }

  /** Writes a value and returns the previous one. */
  set(i: number, value: number): number {
    const old = this.get(i);
    if (old === value) return old;
    if (this.bits === 0) this.unpackUniform(value);
    if (this.bits === 16) {
      this.direct[i] = value;
    } else {
      let local = this.lookup.get(value);
      if (local === undefined) {
        if (this.paletteSize < 1 << this.bits) {
          local = this.paletteSize++;
          this.palette[local] = value;
          this.lookup.set(value, local);
        } else {
          // Palette is full: re-encode, which drops stale entries and widens only if needed.
          this.decodeInto(scratchDense);
          scratchDense[i] = value;
          this.load(scratchDense);
          return old;
        }
      }
      this.writeLocal(i, local);
    }
    if (old === 0) this.count++;
    else if (value === 0) this.count--;
    return old;
  }

  /** Makes every voxel `value`. */
  fill(value: number): void {
    this.setUniform(value);
  }

  /** Expands into a dense buffer of CHUNK_VOLUME palette ids. */
  decodeInto(dense: Uint16Array): void {
    switch (this.bits) {
      case 0:
        dense.fill(this.uniformValue);
        return;
      case 16:
        dense.set(this.direct);
        return;
      default: {
        const { words, palette, bits, valueMask } = this;
        const perWord = 32 / bits;
        let i = 0;
        for (let w = 0; w < words.length; w++) {
          const word = words[w]!;
          for (let k = 0; k < perWord; k++)
            dense[i++] = palette[(word >>> (k * bits)) & valueMask]!;
        }
      }
    }
  }

  /** Replaces the content with a dense buffer, choosing the narrowest storage. */
  load(dense: Uint16Array): void {
    generation = (generation + 1) >>> 0;
    if (generation === 0) {
      seen.fill(0);
      generation = 1;
    }
    let distinct = 0;
    let count = 0;
    for (let i = 0; i < CHUNK_VOLUME; i++) {
      const v = dense[i]!;
      if (v !== 0) count++;
      if (seen[v] !== generation) {
        seen[v] = generation;
        distinctValues[distinct++] = v;
      }
    }
    if (distinct === 1) {
      this.setUniform(distinctValues[0]!);
      return;
    }
    const hasEmpty = seen[0] === generation;
    const size = distinct + (hasEmpty ? 0 : 1);
    const bits = bitsForPaletteSize(size);
    this.clearArrays();
    this.count = count;
    this.bits = bits;
    if (bits === 16) {
      this.direct = dense.slice(0, CHUNK_VOLUME);
      return;
    }
    this.configurePacked(bits);
    const palette = this.palette;
    localOf[0] = 0;
    let n = 1;
    for (let d = 0; d < distinct; d++) {
      const v = distinctValues[d]!;
      if (v === 0) continue;
      palette[n] = v;
      localOf[v] = n;
      this.lookup.set(v, n);
      n++;
    }
    this.paletteSize = n;
    const words = this.words;
    const perWord = 32 / bits;
    let i = 0;
    for (let w = 0; w < words.length; w++) {
      let word = 0;
      for (let k = 0; k < perWord; k++) word |= localOf[dense[i++]!]! << (k * bits);
      words[w] = word;
    }
  }

  /** Re-encodes to the narrowest storage, dropping palette entries no voxel uses any more. */
  compact(): void {
    if (this.bits === 0) return;
    this.decodeInto(scratchDense);
    this.load(scratchDense);
  }

  clone(): Chunk {
    const copy = new Chunk();
    copy.count = this.count;
    copy.version = this.version;
    copy.bits = this.bits;
    copy.uniformValue = this.uniformValue;
    copy.palette = this.palette.slice();
    copy.paletteSize = this.paletteSize;
    copy.lookup = new Map(this.lookup);
    copy.words = this.words.slice();
    copy.direct = this.direct.slice();
    copy.shift = this.shift;
    copy.lowMask = this.lowMask;
    copy.valueMask = this.valueMask;
    return copy;
  }

  /** Approximate heap size in bytes, used for the history memory limit. */
  memoryBytes(): number {
    return (
      64 +
      this.words.byteLength +
      this.direct.byteLength +
      this.palette.byteLength +
      this.lookup.size * 32
    );
  }

  private setUniform(value: number): void {
    this.clearArrays();
    this.bits = 0;
    this.uniformValue = value;
    this.count = value === 0 ? 0 : CHUNK_VOLUME;
  }

  private clearArrays(): void {
    this.palette = new Uint16Array(0);
    this.paletteSize = 0;
    this.lookup = new Map();
    this.words = new Uint32Array(0);
    this.direct = new Uint16Array(0);
  }

  private configurePacked(bits: 1 | 2 | 4 | 8): void {
    this.bits = bits;
    this.shift = wordShift(bits);
    this.lowMask = (1 << this.shift) - 1;
    this.valueMask = (1 << bits) - 1;
    this.palette = new Uint16Array(1 << bits);
    this.words = new Uint32Array((CHUNK_VOLUME * bits) / 32);
  }

  /** Turns a uniform chunk into a packed one that has room for `incoming`. */
  private unpackUniform(incoming: number): void {
    const u = this.uniformValue;
    const values = [0];
    if (u !== 0) values.push(u);
    if (incoming !== 0 && incoming !== u) values.push(incoming);
    const count = this.count;
    this.clearArrays();
    this.configurePacked(bitsForPaletteSize(values.length) as 1 | 2);
    this.count = count;
    for (let n = 0; n < values.length; n++) {
      this.palette[n] = values[n]!;
      this.lookup.set(values[n]!, n);
    }
    this.paletteSize = values.length;
    if (u !== 0) {
      // Every voxel holds local index 1.
      let word = 0;
      for (let k = 0; k < 32 / this.bits; k++) word |= 1 << (k * this.bits);
      this.words.fill(word);
    }
  }

  private writeLocal(i: number, local: number): void {
    const w = i >>> this.shift;
    const offset = (i & this.lowMask) * this.bits;
    this.words[w] = (this.words[w]! & ~(this.valueMask << offset)) | (local << offset);
  }
}
