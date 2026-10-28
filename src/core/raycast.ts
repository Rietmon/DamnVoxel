import { CHUNK_BITS, CHUNK_MASK, CHUNK_SIZE, chunkKey, faceOf, voxelIndex } from './coords';
import type { Box, VolumeReader } from './volume';

export interface RayHit {
  /** The voxel hit. */
  x: number;
  y: number;
  z: number;
  /** Face of the voxel the ray entered through (its normal points back at the ray). */
  face: number;
  /** Ray parameter of the entry point: origin + dir × t. */
  t: number;
  value: number;
}

/** Hard stop for broken input (NaN, zero direction): never loop forever. */
const MAX_STEPS = 1 << 20;

/** Ray parameters where the ray enters and leaves the box [min, max), and the entry axis. */
function clipToBox(
  o: readonly number[],
  d: readonly number[],
  min: readonly number[],
  max: readonly number[],
): [number, number, number] | null {
  let tEnter = Number.NEGATIVE_INFINITY;
  let tExit = Number.POSITIVE_INFINITY;
  let enterAxis = 0;
  for (let a = 0; a < 3; a++) {
    if (d[a] === 0) {
      if (o[a]! < min[a]! || o[a]! >= max[a]!) return null;
      continue;
    }
    let t0 = (min[a]! - o[a]!) / d[a]!;
    let t1 = (max[a]! - o[a]!) / d[a]!;
    if (t0 > t1) [t0, t1] = [t1, t0];
    if (t0 > tEnter) {
      tEnter = t0;
      enterAxis = a;
    }
    tExit = Math.min(tExit, t1);
  }
  if (!(tEnter <= tExit) || tExit < 0) return null;
  return [tEnter, tExit, enterAxis];
}

function dominantAxis(d: readonly number[]): number {
  const ax = Math.abs(d[0]!);
  const ay = Math.abs(d[1]!);
  const az = Math.abs(d[2]!);
  return ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
}

/**
 * Casts a ray through a sparse volume and returns the first non-empty voxel (docs/rendering.md,
 * "Picking a voxel"). Coordinates are in the volume's own voxel space; `dir` need not be unit
 * length. Empty chunks are crossed in one jump; inside a chunk the walk goes voxel by voxel
 * (Amanatides–Woo).
 *
 * `bounds` limits the search: the bounds of the volume, or of the state being picked.
 */
export function raycastVolume(
  volume: VolumeReader,
  bounds: Box,
  origin: readonly number[],
  dir: readonly number[],
  maxT = Number.POSITIVE_INFINITY,
): RayHit | null {
  const min = [bounds.minX, bounds.minY, bounds.minZ];
  const max = [bounds.maxX + 1, bounds.maxY + 1, bounds.maxZ + 1];
  const clip = clipToBox(origin, dir, min, max);
  if (!clip) return null;
  const tEnd = Math.min(clip[1], maxT);
  let t = Math.max(0, clip[0]);
  if (t > tEnd) return null;
  // A ray entering from outside comes through a face on the axis that entered last; a ray that
  // starts inside has no entry face and gets the one facing it.
  let axis = clip[0] >= 0 ? clip[2] : -1;

  const step = [Math.sign(dir[0]!), Math.sign(dir[1]!), Math.sign(dir[2]!)];
  const tDelta = [Math.abs(1 / dir[0]!), Math.abs(1 / dir[1]!), Math.abs(1 / dir[2]!)];
  const cell = [0, 0, 0];
  const tMax = [0, 0, 0];
  const updateTMax = (a: number) => {
    tMax[a] =
      step[a] === 0
        ? Number.POSITIVE_INFINITY
        : ((step[a]! > 0 ? cell[a]! + 1 : cell[a]!) - origin[a]!) / dir[a]!;
  };
  const placeAt = (time: number, exactAxis: number, exactCell: number) => {
    for (let a = 0; a < 3; a++) {
      cell[a] =
        a === exactAxis
          ? exactCell
          : Math.min(Math.max(Math.floor(origin[a]! + dir[a]! * time), min[a]!), max[a]! - 1);
      updateTMax(a);
    }
  };

  placeAt(t, axis, axis >= 0 ? (step[axis]! > 0 ? min[axis]! : max[axis]! - 1) : 0);

  for (let i = 0; i < MAX_STEPS; i++) {
    const [x, y, z] = cell as [number, number, number];
    if (x < min[0]! || y < min[1]! || z < min[2]! || x >= max[0]! || y >= max[1]! || z >= max[2]!) {
      return null;
    }
    const chunk = volume.getChunk(chunkKey(x >> CHUNK_BITS, y >> CHUNK_BITS, z >> CHUNK_BITS));
    if (!chunk) {
      // Jump to the first voxel past this empty chunk.
      let tLeave = Number.POSITIVE_INFINITY;
      let leaveAxis = -1;
      for (let a = 0; a < 3; a++) {
        if (step[a] === 0) continue;
        const base = (cell[a]! >> CHUNK_BITS) * CHUNK_SIZE;
        const ta = ((step[a]! > 0 ? base + CHUNK_SIZE : base) - origin[a]!) / dir[a]!;
        if (ta < tLeave) {
          tLeave = ta;
          leaveAxis = a;
        }
      }
      if (leaveAxis < 0 || tLeave > tEnd) return null;
      const base = (cell[leaveAxis]! >> CHUNK_BITS) * CHUNK_SIZE;
      t = Math.max(t, tLeave);
      axis = leaveAxis;
      placeAt(t, leaveAxis, step[leaveAxis]! > 0 ? base + CHUNK_SIZE : base - 1);
      continue;
    }
    const value = chunk.get(voxelIndex(x & CHUNK_MASK, y & CHUNK_MASK, z & CHUNK_MASK));
    if (value !== 0) {
      const a = axis >= 0 ? axis : dominantAxis(dir);
      return { x, y, z, face: faceOf(a, step[a]! > 0 ? -1 : 1), t, value };
    }
    let a = 0;
    if (tMax[1]! < tMax[a]!) a = 1;
    if (tMax[2]! < tMax[a]!) a = 2;
    t = tMax[a]!;
    if (t > tEnd) return null;
    cell[a] = cell[a]! + step[a]!;
    tMax[a] = tMax[a]! + tDelta[a]!;
    axis = a;
  }
  return null;
}

/** Ray parameter where a ray crosses the plane `axis = value`; null when parallel or behind. */
export function rayPlane(
  origin: readonly number[],
  dir: readonly number[],
  axis: number,
  value: number,
): number | null {
  const d = dir[axis]!;
  if (Math.abs(d) < 1e-12) return null;
  const t = (value - origin[axis]!) / d;
  return t >= 0 ? t : null;
}
