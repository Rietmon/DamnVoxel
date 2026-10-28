import { describe, expect, it } from 'vitest';
import { meshForExport } from './export-mesh';
import { VoxelVolume } from './volume';

/** Area of each quad and the sum, and the faces seen from every side add up. */
function area(m: ReturnType<typeof meshForExport>): number {
  let s = 0;
  for (let q = 0; q < m.count; q++) {
    const p = (c: number, k: number) => m.positions[(q * 4 + c) * 3 + k]!;
    const e1 = [0, 1, 2].map((k) => p(1, k) - p(0, k));
    const e2 = [0, 1, 2].map((k) => p(3, k) - p(0, k));
    const cross = [
      e1[1]! * e2[2]! - e1[2]! * e2[1]!,
      e1[2]! * e2[0]! - e1[0]! * e2[2]!,
      e1[0]! * e2[1]! - e1[1]! * e2[0]!,
    ];
    s += Math.hypot(...cross);
  }
  return s;
}

describe('export mesher', () => {
  it('gives a cube six quads, wound outwards', () => {
    const v = new VoxelVolume();
    v.set(3, 4, 5, 7);
    const m = meshForExport(v);
    expect(m.count).toBe(6);
    expect([...m.colors]).toEqual([7, 7, 7, 7, 7, 7]);
    for (let q = 0; q < 6; q++) {
      const p = (c: number, k: number) => m.positions[(q * 4 + c) * 3 + k]!;
      const e1 = [0, 1, 2].map((k) => p(1, k) - p(0, k));
      const e2 = [0, 1, 2].map((k) => p(2, k) - p(0, k));
      const n = [
        e1[1]! * e2[2]! - e1[2]! * e2[1]!,
        e1[2]! * e2[0]! - e1[0]! * e2[2]!,
        e1[0]! * e2[1]! - e1[1]! * e2[0]!,
      ];
      const face = m.faces[q]!;
      const axis = face >> 1;
      const sign = face & 1 ? -1 : 1;
      expect(Math.sign(n[axis]!)).toBe(sign);
    }
  });

  it('merges faces of one colour and keeps colours apart', () => {
    const v = new VoxelVolume();
    for (let x = 0; x < 4; x++) for (let z = 0; z < 3; z++) v.set(x, 0, z, 1);
    const one = meshForExport(v);
    expect(one.count).toBe(6);
    expect(area(one)).toBe(2 * (4 * 3 + 4 * 1 + 3 * 1));
    v.set(0, 0, 0, 2);
    const two = meshForExport(v);
    expect(two.count).toBeGreaterThan(6);
    expect(area(two)).toBe(area(one));
  });

  it('hides faces between voxels across chunks', () => {
    const v = new VoxelVolume();
    v.set(31, 0, 0, 1);
    v.set(32, 0, 0, 1);
    const m = meshForExport(v);
    // A 2 × 1 × 1 bar split by the chunk border: 2 ends + 4 sides per half.
    expect(m.count).toBe(10);
    expect(area(m)).toBe(10);
  });
});
