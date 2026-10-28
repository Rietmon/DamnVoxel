import { FACE_NEG_Y, FACE_POS_Y } from './coords';
import { raycastVolume, rayPlane } from './raycast';
import { isHidden, type VoxelObject, worldTransform } from './scene';
import { cellToLocal, dirToLocal, faceToLocal, worldToLocal } from './transform';
import type { Box, VolumeReader } from './volume';

export interface VoxelPick {
  object: VoxelObject;
  /** Voxel in object-local coordinates. */
  x: number;
  y: number;
  z: number;
  /** Local face the ray entered through. */
  face: number;
  /** World ray parameter of the hit. */
  t: number;
  value: number;
}

/** What to pick against instead of an object's live volume (a stroke picks its base state). */
export interface PickSource {
  volume: VolumeReader;
  bounds: Box | null;
}

/**
 * The nearest voxel any of the objects has under a world ray. Objects are tested in their own
 * space: the ray goes through the inverse transform, which keeps `t` (orientations are
 * orthonormal, translations integer).
 */
export function pickVoxel(
  objects: Iterable<VoxelObject>,
  origin: readonly number[],
  dir: readonly number[],
  source: (object: VoxelObject) => PickSource = (o) => ({
    volume: o.volume,
    bounds: o.volume.getBounds(),
  }),
  maxT = Number.POSITIVE_INFINITY,
): VoxelPick | null {
  let best: VoxelPick | null = null;
  for (const object of objects) {
    if (isHidden(object)) continue;
    const { volume, bounds } = source(object);
    if (!bounds) continue;
    const t = worldTransform(object);
    const o = worldToLocal(t, origin[0]!, origin[1]!, origin[2]!);
    const d = dirToLocal(t, dir[0]!, dir[1]!, dir[2]!);
    const hit = raycastVolume(volume, bounds, o, d, best ? best.t : maxT);
    if (hit && (!best || hit.t < best.t)) {
      best = { object, x: hit.x, y: hit.y, z: hit.z, face: hit.face, t: hit.t, value: hit.value };
    }
  }
  return best;
}

/**
 * Where a ray meets the construction plane, the world plane y = `height`, in the coordinates of
 * `object`. The plane acts like a solid floor: the result is the cell just behind the plane and
 * the face pointing back at the ray, exactly like a voxel hit, so tools treat both the same and
 * building on an empty object starts on the floor. The cell itself is not filled.
 */
export function pickConstructionPlane(
  object: VoxelObject,
  origin: readonly number[],
  dir: readonly number[],
  height = 0,
): Omit<VoxelPick, 'value'> | null {
  const t = rayPlane(origin, dir, 1, height);
  if (t === null) return null;
  const fromAbove = dir[1]! < 0;
  const wx = Math.floor(origin[0]! + dir[0]! * t);
  const wz = Math.floor(origin[2]! + dir[2]! * t);
  const wy = fromAbove ? height - 1 : height;
  const [x, y, z] = cellToLocal(worldTransform(object), wx, wy, wz);
  const face = faceToLocal(worldTransform(object), fromAbove ? FACE_POS_Y : FACE_NEG_Y);
  return { object, x, y, z, face, t };
}
