/**
 * The 48 axis-aligned orientations: 3×3 signed permutation matrices (rotations by 90° and
 * reflections). They map the voxel grid onto itself exactly, which is why an object transform
 * is an orientation plus an integer translation. See docs/data-model.md, "Scene".
 *
 * Index = permutation (0…5) × 8 + sign bits (bit i set: row i is negative). Index 0 is identity.
 * Row i of the matrix has its non-zero entry in column `perm[i]`.
 */

const PERMUTATIONS = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
] as const;

export const ORIENTATION_COUNT = 48;
export const IDENTITY_ORIENTATION = 0;

export interface OrientationRows {
  /** Column of the non-zero entry of each row. */
  readonly perm: readonly [number, number, number];
  /** Sign of each row, ±1. */
  readonly signs: readonly [number, number, number];
}

const ROWS: OrientationRows[] = [];
for (let p = 0; p < 6; p++)
  for (let s = 0; s < 8; s++) {
    ROWS.push({
      perm: PERMUTATIONS[p]!,
      signs: [s & 1 ? -1 : 1, s & 2 ? -1 : 1, s & 4 ? -1 : 1],
    });
  }

function indexOf(perm: readonly number[], signs: readonly number[]): number {
  const p = PERMUTATIONS.findIndex((q) => q[0] === perm[0] && q[1] === perm[1] && q[2] === perm[2]);
  if (p < 0) throw new Error(`Not a permutation: ${perm.join()}`);
  return p * 8 + (signs[0]! < 0 ? 1 : 0) + (signs[1]! < 0 ? 2 : 0) + (signs[2]! < 0 ? 4 : 0);
}

export function orientationRows(index: number): OrientationRows {
  const rows = ROWS[index];
  if (!rows) throw new RangeError(`No orientation ${index}`);
  return rows;
}

/** Row-major 3×3 matrix of an orientation. */
export function orientationMatrix(index: number): number[] {
  const { perm, signs } = orientationRows(index);
  const m = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let r = 0; r < 3; r++) m[r * 3 + perm[r]!] = signs[r]!;
  return m;
}

/** M · v for a point or direction. */
export function applyOrientation(
  index: number,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  const { perm, signs } = orientationRows(index);
  const v = [x, y, z];
  // `|| 0` turns −0 into 0: equal cells compare equal.
  return [signs[0] * v[perm[0]]! || 0, signs[1] * v[perm[1]]! || 0, signs[2] * v[perm[2]]! || 0];
}

/** Index of A · B (apply B first). */
export function composeOrientation(a: number, b: number): number {
  const A = orientationRows(a);
  const B = orientationRows(b);
  const perm: number[] = [];
  const signs: number[] = [];
  for (let r = 0; r < 3; r++) {
    // Row r of A picks row perm_A[r] of B.
    const k = A.perm[r]!;
    perm.push(B.perm[k]!);
    signs.push(A.signs[r]! * B.signs[k]!);
  }
  return indexOf(perm, signs);
}

export function invertOrientation(index: number): number {
  const { perm, signs } = orientationRows(index);
  // The inverse of an orthogonal matrix is its transpose.
  const invPerm = [0, 0, 0];
  const invSigns = [1, 1, 1];
  for (let r = 0; r < 3; r++) {
    invPerm[perm[r]!] = r;
    invSigns[perm[r]!] = signs[r]!;
  }
  return indexOf(invPerm, invSigns);
}

/** +1 for rotations, −1 for orientations that include a reflection. */
export function orientationDeterminant(index: number): number {
  const { perm, signs } = orientationRows(index);
  // Parity of the permutation: even permutations are 0, 3, 4 in the table above.
  const p = (PERMUTATIONS as readonly (readonly number[])[]).indexOf(perm);
  const parity = p === 0 || p === 3 || p === 4 ? 1 : -1;
  return parity * signs[0] * signs[1] * signs[2];
}

/**
 * Maps a voxel cell through the orientation. A cell is the unit cube at its min corner, so a
 * negative row moves the min corner by one: cell' = M · cell + n, with n_i = −1 where row i is
 * negative. Together with an integer translation this is exact on the grid.
 */
export function orientCell(
  index: number,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  const { perm, signs } = orientationRows(index);
  const v = [x, y, z];
  return [
    signs[0] * v[perm[0]]! - (signs[0] < 0 ? 1 : 0),
    signs[1] * v[perm[1]]! - (signs[1] < 0 ? 1 : 0),
    signs[2] * v[perm[2]]! - (signs[2] < 0 ? 1 : 0),
  ];
}

/**
 * The orientation as the .vox `_r` byte (in the axes the matrix is written in): bits 0–1 the
 * column of row 0, bits 2–3 the column of row 1, bits 4–6 the signs of rows 0–2.
 */
export function toRotationByte(index: number): number {
  const { perm, signs } = orientationRows(index);
  return (
    perm[0] |
    (perm[1] << 2) |
    (signs[0] < 0 ? 1 << 4 : 0) |
    (signs[1] < 0 ? 1 << 5 : 0) |
    (signs[2] < 0 ? 1 << 6 : 0)
  );
}

/** Inverse of {@link toRotationByte}; null for bytes that describe no orientation. */
export function fromRotationByte(byte: number): number | null {
  const c0 = byte & 3;
  const c1 = (byte >> 2) & 3;
  if (c0 > 2 || c1 > 2 || c0 === c1) return null;
  const c2 = 3 - c0 - c1;
  return indexOf([c0, c1, c2], [byte & 16 ? -1 : 1, byte & 32 ? -1 : 1, byte & 64 ? -1 : 1]);
}

/** The orientation with a given row-major matrix, or null when it is not one of the 48. */
export function findOrientation(matrix: readonly number[]): number | null {
  for (let i = 0; i < ORIENTATION_COUNT; i++) {
    const m = orientationMatrix(i);
    if (m.every((v, k) => v === matrix[k])) return i;
  }
  return null;
}

/** Quarter turn about an axis (0 X, 1 Y, 2 Z), counter-clockwise looking from + towards −. */
export function quarterTurn(axis: number, clockwise = false): number {
  const s = clockwise ? -1 : 1;
  const m = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const u = (axis + 1) % 3;
  const v = (axis + 2) % 3;
  // Rotation by +90° about the axis: u → v, v → −u.
  m[u * 3 + u] = 0;
  m[v * 3 + v] = 0;
  m[v * 3 + u] = s;
  m[u * 3 + v] = -s;
  return findOrientation(m)!;
}

/** Reflection across the plane normal to an axis. */
export function reflection(axis: number): number {
  const m = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  m[axis * 3 + axis] = -1;
  return findOrientation(m)!;
}
