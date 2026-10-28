import { describe, expect, it } from 'vitest';
import { chunkKey } from './coords';
import { MASK_WORDS, popcount, SelectionMask, selectionToVolume } from './selection';
import { VoxelVolume } from './volume';

describe('SelectionMask', () => {
  it('sets, clears and counts bits across chunks and negative coordinates', () => {
    const s = new SelectionMask();
    expect(s.set(1, 2, 3, true)).toBe(true);
    expect(s.set(1, 2, 3, true)).toBe(false);
    s.set(-1, -40, 70, true);
    expect(s.has(1, 2, 3)).toBe(true);
    expect(s.has(-1, -40, 70)).toBe(true);
    expect(s.has(0, 0, 0)).toBe(false);
    expect(s.count).toBe(2);
    expect(s.set(1, 2, 3, false)).toBe(true);
    s.set(-1, -40, 70, false);
    expect(s.isEmpty).toBe(true);
    expect([...s.chunkKeys()]).toEqual([]);
  });

  it('visits every bit once and knows its bounds', () => {
    const s = new SelectionMask();
    const cells = [
      [0, 0, 0],
      [31, 31, 31],
      [32, 0, -1],
      [-100, 5, 7],
    ];
    for (const [x, y, z] of cells) s.set(x!, y!, z!, true);
    const seen: string[] = [];
    s.forEach((x, y, z) => {
      seen.push(`${x},${y},${z}`);
    });
    expect(seen.sort()).toEqual(cells.map((c) => c.join()).sort());
    expect(s.getBounds()).toEqual({ minX: -100, minY: 0, minZ: -1, maxX: 32, maxY: 31, maxZ: 31 });
  });

  it('replaces whole chunks, clones independently and bumps its revision', () => {
    const s = new SelectionMask();
    const full = new Uint32Array(MASK_WORDS).fill(0xffffffff);
    const r0 = s.revision;
    s.putChunk(chunkKey(0, 0, 0), full);
    expect(s.count).toBe(32768);
    expect(s.revision).toBeGreaterThan(r0);
    const copy = s.clone();
    copy.set(0, 0, 0, false);
    expect(s.has(0, 0, 0)).toBe(true);
    s.putChunk(chunkKey(0, 0, 0), new Uint32Array(MASK_WORDS));
    expect(s.isEmpty).toBe(true);
    expect(popcount(0xf0f0)).toBe(8);
    expect(popcount(0xffffffff)).toBe(32);
  });

  it('turns into a volume for the overlay', () => {
    const s = new SelectionMask();
    s.set(3, 4, 5, true);
    s.set(40, 4, 5, true);
    const v = new VoxelVolume();
    v.set(100, 100, 100, 7);
    selectionToVolume(s, v);
    expect(v.voxelCount).toBe(2);
    expect(v.get(40, 4, 5)).toBe(1);
  });
});
