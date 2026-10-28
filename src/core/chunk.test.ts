import { describe, expect, it } from 'vitest';
import { Chunk } from './chunk';
import { CHUNK_VOLUME } from './coords';

/** Small deterministic PRNG so failures reproduce. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function decode(chunk: Chunk): Uint16Array {
  const dense = new Uint16Array(CHUNK_VOLUME);
  chunk.decodeInto(dense);
  return dense;
}

function countNonEmpty(dense: Uint16Array): number {
  let n = 0;
  for (const v of dense) if (v !== 0) n++;
  return n;
}

describe('Chunk', () => {
  it('starts empty and uniform', () => {
    const chunk = new Chunk();
    expect(chunk.storageBits).toBe(0);
    expect(chunk.uniform).toBe(0);
    expect(chunk.isEmpty).toBe(true);
    expect(chunk.get(123)).toBe(0);
  });

  it('keeps a full one-colour chunk without arrays', () => {
    const chunk = Chunk.uniform(7);
    expect(chunk.isFull).toBe(true);
    expect(chunk.storageBits).toBe(0);
    expect(chunk.memoryBytes()).toBeLessThan(100);
  });

  it('unpacks a uniform chunk on the first different value', () => {
    const empty = new Chunk();
    expect(empty.set(5, 3)).toBe(0);
    expect(empty.storageBits).toBe(1);
    expect(empty.count).toBe(1);
    expect(empty.get(5)).toBe(3);
    expect(empty.get(6)).toBe(0);

    const full = Chunk.uniform(4);
    expect(full.set(10, 0)).toBe(4);
    expect(full.storageBits).toBe(1);
    expect(full.count).toBe(CHUNK_VOLUME - 1);
    expect(full.get(10)).toBe(0);
    expect(full.get(11)).toBe(4);

    const recolored = Chunk.uniform(4);
    recolored.set(0, 9);
    expect(recolored.storageBits).toBe(2);
    expect(recolored.count).toBe(CHUNK_VOLUME);
    expect(recolored.get(0)).toBe(9);
    expect(recolored.get(1)).toBe(4);
  });

  it('chooses the narrowest width for the number of distinct values', () => {
    const cases: [number, number][] = [
      [1, 1],
      [3, 2],
      [15, 4],
      [255, 8],
      [256, 16],
      [1000, 16],
    ];
    for (const [colors, bits] of cases) {
      const dense = new Uint16Array(CHUNK_VOLUME);
      for (let i = 0; i < colors; i++) dense[i * 7] = i + 1;
      const chunk = Chunk.fromDense(dense);
      expect(chunk.storageBits, `${colors} colours`).toBe(bits);
      expect(decode(chunk)).toEqual(dense);
      expect(chunk.count).toBe(colors);
    }
  });

  it('round-trips dense buffers with and without empty voxels', () => {
    const random = rng(1);
    for (const colors of [2, 4, 16, 200, 3000]) {
      for (const withEmpty of [true, false]) {
        const dense = new Uint16Array(CHUNK_VOLUME);
        for (let i = 0; i < CHUNK_VOLUME; i++) {
          const v = Math.floor(random() * colors) + (withEmpty ? 0 : 1);
          dense[i] = v;
        }
        const chunk = Chunk.fromDense(dense);
        expect(decode(chunk)).toEqual(dense);
        expect(chunk.count).toBe(countNonEmpty(dense));
      }
    }
  });

  it('matches a reference array under random edits, growing through every width', () => {
    const random = rng(2);
    const chunk = new Chunk();
    const reference = new Uint16Array(CHUNK_VOLUME);
    const widths = new Set<number>([chunk.storageBits]);
    for (let step = 0; step < 60000; step++) {
      const i = Math.floor(random() * CHUNK_VOLUME);
      // Slowly widen the set of colours so every storage width is visited.
      const colors = 1 + Math.floor((step / 60000) * 600);
      const v = random() < 0.2 ? 0 : 1 + Math.floor(random() * colors);
      expect(chunk.set(i, v)).toBe(reference[i]);
      reference[i] = v;
      widths.add(chunk.storageBits);
    }
    expect(decode(chunk)).toEqual(reference);
    expect(chunk.count).toBe(countNonEmpty(reference));
    expect([...widths].sort((a, b) => a - b)).toEqual([0, 1, 2, 4, 8, 16]);
  });

  it('drops stale palette entries instead of widening', () => {
    const chunk = new Chunk();
    // Paint many colours into one voxel: only two values are ever in use.
    for (let v = 1; v <= 1000; v++) chunk.set(0, v);
    expect(chunk.storageBits).toBe(1);
    expect(chunk.get(0)).toBe(1000);
    expect(chunk.count).toBe(1);
  });

  it('compacts to uniform when one value is left', () => {
    const chunk = Chunk.uniform(2);
    chunk.set(0, 3);
    chunk.set(0, 2);
    expect(chunk.storageBits).toBe(2);
    chunk.compact();
    expect(chunk.storageBits).toBe(0);
    expect(chunk.uniform).toBe(2);
    expect(chunk.count).toBe(CHUNK_VOLUME);
  });

  it('counts voxels when filling and erasing', () => {
    const chunk = new Chunk();
    chunk.set(1, 1);
    chunk.set(2, 1);
    chunk.set(2, 5);
    expect(chunk.count).toBe(2);
    chunk.set(1, 0);
    expect(chunk.count).toBe(1);
    chunk.fill(0);
    expect(chunk.isEmpty).toBe(true);
    chunk.fill(8);
    expect(chunk.isFull).toBe(true);
  });

  it('clones independently', () => {
    const a = new Chunk();
    a.set(3, 4);
    const b = a.clone();
    b.set(3, 5);
    b.set(4, 6);
    expect(a.get(3)).toBe(4);
    expect(a.get(4)).toBe(0);
    expect(a.count).toBe(1);
    expect(b.get(3)).toBe(5);
    expect(b.count).toBe(2);
  });
});
