import { FACE_NORMALS, faceOf, type Vec3i } from './coords';
import { applyOrientation, composeOrientation, invertOrientation, orientCell } from './orientation';
import type { Transform } from './scene';

/**
 * Conversions between object-local and world space for a transform (orientation + integer
 * translation). Points and directions are continuous; cells are voxel coordinates.
 */

export function localToWorld(
  t: Transform,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  const p = applyOrientation(t.orientation, x, y, z);
  return [p[0] + t.x, p[1] + t.y, p[2] + t.z];
}

export function worldToLocal(
  t: Transform,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  return applyOrientation(invertOrientation(t.orientation), x - t.x, y - t.y, z - t.z);
}

export function dirToWorld(
  t: Transform,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  return applyOrientation(t.orientation, x, y, z);
}

export function dirToLocal(
  t: Transform,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  return applyOrientation(invertOrientation(t.orientation), x, y, z);
}

export function cellToWorld(t: Transform, x: number, y: number, z: number): Vec3i {
  const c = orientCell(t.orientation, x, y, z);
  return [c[0] + t.x, c[1] + t.y, c[2] + t.z];
}

export function cellToLocal(t: Transform, x: number, y: number, z: number): Vec3i {
  return orientCell(invertOrientation(t.orientation), x - t.x, y - t.y, z - t.z);
}

/** The world face index of a local face. */
export function faceToWorld(t: Transform, face: number): number {
  const n = FACE_NORMALS[face]!;
  const w = applyOrientation(t.orientation, n[0], n[1], n[2]);
  const axis = w[0] !== 0 ? 0 : w[1] !== 0 ? 1 : 2;
  return faceOf(axis, w[axis]!);
}

/** The local face index of a world face. */
export function faceToLocal(t: Transform, face: number): number {
  const n = FACE_NORMALS[face]!;
  const l = applyOrientation(invertOrientation(t.orientation), n[0], n[1], n[2]);
  const axis = l[0] !== 0 ? 0 : l[1] !== 0 ? 1 : 2;
  return faceOf(axis, l[axis]!);
}

export function isIdentityTransform(t: Transform): boolean {
  return t.x === 0 && t.y === 0 && t.z === 0 && t.orientation === 0;
}

/** `outer ∘ inner`: a point goes through `inner` first (a child inside its parent). */
export function composeTransform(outer: Transform, inner: Transform): Transform {
  if (isIdentityTransform(outer)) return inner;
  const [x, y, z] = applyOrientation(outer.orientation, inner.x, inner.y, inner.z);
  return {
    x: x + outer.x,
    y: y + outer.y,
    z: z + outer.z,
    orientation: composeOrientation(outer.orientation, inner.orientation),
  };
}

export function invertTransform(t: Transform): Transform {
  const orientation = invertOrientation(t.orientation);
  const [x, y, z] = applyOrientation(orientation, -t.x, -t.y, -t.z);
  return { x, y, z, orientation };
}
