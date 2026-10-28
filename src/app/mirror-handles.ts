import { type MirrorSettings, mirrorEnabled } from '../core/mirror';
import { type VoxelObject, worldTransform } from '../core/scene';
import { localToWorld } from '../core/transform';
import type { Box } from '../core/volume';
import type { Vec3 } from '../render/math';
import type { PlaneQuad } from '../render/planes';

/** Axis colours of mirror planes: X red, Y green, Z blue. */
export const MIRROR_COLORS: readonly (readonly number[])[] = [
  [0.95, 0.35, 0.35, 0.16],
  [0.4, 0.8, 0.45, 0.16],
  [0.35, 0.6, 1, 0.16],
];

/** How far planes reach past the model, voxels. */
const MARGIN = 3;

export interface MirrorPlane {
  axis: number;
  /** Local corners of the plane. */
  corners: [Vec3, Vec3, Vec3, Vec3];
  /**
   * Where the handle sits, in local space: the middle of the top edge of a vertical plane (above
   * the model, where it is never hidden), the middle of the +X edge of the horizontal one.
   */
  centre: Vec3;
}

/** Planes of the enabled mirror axes, sized to the object's bounds (or a small square). */
export function mirrorPlanes(m: MirrorSettings, bounds: Box | null): MirrorPlane[] {
  if (!mirrorEnabled(m)) return [];
  const flags = [m.x, m.y, m.z];
  const lo = bounds ? [bounds.minX, bounds.minY, bounds.minZ] : [-8, 0, -8];
  const hi = bounds ? [bounds.maxX + 1, bounds.maxY + 1, bounds.maxZ + 1] : [8, 16, 8];
  const planes: MirrorPlane[] = [];
  for (let axis = 0; axis < 3; axis++) {
    if (!flags[axis]) continue;
    const u = (axis + 1) % 3;
    const v = (axis + 2) % 3;
    const at = m.center2[axis]! / 2;
    const corner = (cu: number, cv: number): Vec3 => {
      const p: Vec3 = [0, 0, 0];
      p[axis] = at;
      p[u] = cu;
      p[v] = cv;
      return p;
    };
    const u0 = lo[u]! - MARGIN;
    const u1 = hi[u]! + MARGIN;
    const v0 = lo[v]! - MARGIN;
    const v1 = hi[v]! + MARGIN;
    planes.push({
      axis,
      corners: [corner(u0, v0), corner(u1, v0), corner(u1, v1), corner(u0, v1)],
      // X plane: u is Y, so its top edge is u1. Z plane: v is Y. Y plane: v is X.
      centre: axis === 0 ? corner(u1, (v0 + v1) / 2) : corner((u0 + u1) / 2, v1),
    });
  }
  return planes;
}

/** Plane quads in world space for the renderer. */
export function mirrorQuads(planes: readonly MirrorPlane[], object: VoxelObject): PlaneQuad[] {
  return planes.map((p) => ({
    corners: p.corners.map((c) =>
      localToWorld(worldTransform(object), ...c),
    ) as PlaneQuad['corners'],
    color: MIRROR_COLORS[p.axis]!,
  }));
}
