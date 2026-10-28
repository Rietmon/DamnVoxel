import { describe, expect, it } from 'vitest';
import {
  applyOrientation,
  composeOrientation,
  findOrientation,
  fromRotationByte,
  IDENTITY_ORIENTATION,
  invertOrientation,
  ORIENTATION_COUNT,
  orientationDeterminant,
  orientationMatrix,
  orientCell,
  quarterTurn,
  reflection,
  toRotationByte,
} from './orientation';

const all = Array.from({ length: ORIENTATION_COUNT }, (_, i) => i);

function mul(a: number[], b: number[]): number[] {
  const r = new Array(9).fill(0);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k]! * b[k * 3 + j]!;
  return r;
}

function det(m: number[]): number {
  return (
    m[0]! * (m[4]! * m[8]! - m[5]! * m[7]!) -
    m[1]! * (m[3]! * m[8]! - m[5]! * m[6]!) +
    m[2]! * (m[3]! * m[7]! - m[4]! * m[6]!)
  );
}

describe('orientations', () => {
  it('has 48 distinct matrices with identity at 0', () => {
    expect(new Set(all.map((i) => orientationMatrix(i).join())).size).toBe(48);
    expect(orientationMatrix(IDENTITY_ORIENTATION)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it('composes like matrix multiplication and inverts', () => {
    for (const a of all)
      for (const b of all) {
        expect(orientationMatrix(composeOrientation(a, b))).toEqual(
          mul(orientationMatrix(a), orientationMatrix(b)),
        );
      }
    for (const a of all)
      expect(composeOrientation(a, invertOrientation(a))).toBe(IDENTITY_ORIENTATION);
  });

  it('applies the matrix to vectors', () => {
    for (const i of all) {
      const m = orientationMatrix(i);
      const [x, y, z] = [2, -3, 5];
      expect(applyOrientation(i, x, y, z)).toEqual([
        m[0]! * x + m[1]! * y + m[2]! * z,
        m[3]! * x + m[4]! * y + m[5]! * z,
        m[6]! * x + m[7]! * y + m[8]! * z,
      ]);
    }
  });

  it('knows rotations from reflections', () => {
    for (const i of all) expect(orientationDeterminant(i)).toBe(det(orientationMatrix(i)));
    expect(all.filter((i) => orientationDeterminant(i) === 1)).toHaveLength(24);
  });

  it('maps cells of a box onto a box of the same size, one to one', () => {
    for (const i of all) {
      const seen = new Set<string>();
      for (let x = 0; x < 3; x++)
        for (let y = 0; y < 2; y++)
          for (let z = 0; z < 4; z++) {
            const c = orientCell(i, x, y, z);
            // The cell centre must land where the matrix sends the original centre.
            const centre = applyOrientation(i, x + 0.5, y + 0.5, z + 0.5);
            expect(c.map((v, k) => v + 0.5 - centre[k]!)).toEqual([0, 0, 0]);
            seen.add(c.join());
          }
      expect(seen.size).toBe(24);
    }
  });

  it('round-trips the .vox rotation byte for all 48 and matches the spec example', () => {
    const bytes = new Set<number>();
    for (const i of all) {
      const b = toRotationByte(i);
      bytes.add(b);
      expect(fromRotationByte(b)).toBe(i);
    }
    expect(bytes.size).toBe(48);
    // Spec example: rows (0 1 0), (0 0 −1), (−1 0 0).
    const example = (1 << 0) | (2 << 2) | (0 << 4) | (1 << 5) | (1 << 6);
    expect(orientationMatrix(fromRotationByte(example)!)).toEqual([0, 1, 0, 0, 0, -1, -1, 0, 0]);
    expect(fromRotationByte(0b11)).toBeNull();
    expect(fromRotationByte(0)).toBeNull();
  });
});

describe('quarter turns and reflections', () => {
  it('turns a quarter about each axis and comes back after four', () => {
    for (const axis of [0, 1, 2]) {
      const q = quarterTurn(axis);
      expect(orientationDeterminant(q)).toBe(1);
      let o = IDENTITY_ORIENTATION;
      for (let i = 0; i < 4; i++) o = composeOrientation(q, o);
      expect(o).toBe(IDENTITY_ORIENTATION);
      expect(composeOrientation(q, quarterTurn(axis, true))).toBe(IDENTITY_ORIENTATION);
    }
    // About Y: X goes to −Z, Z goes to X.
    expect(applyOrientation(quarterTurn(1), 1, 0, 0)).toEqual([0, 0, -1]);
    expect(applyOrientation(quarterTurn(1), 0, 0, 1)).toEqual([1, 0, 0]);
  });

  it('reflects across one axis', () => {
    for (const axis of [0, 1, 2]) {
      const r = reflection(axis);
      expect(orientationDeterminant(r)).toBe(-1);
      expect(composeOrientation(r, r)).toBe(IDENTITY_ORIENTATION);
    }
    expect(applyOrientation(reflection(0), 2, 3, 4)).toEqual([-2, 3, 4]);
    expect(findOrientation([2, 0, 0, 0, 1, 0, 0, 0, 1])).toBeNull();
  });
});
