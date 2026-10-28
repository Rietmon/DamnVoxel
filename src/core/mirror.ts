import type { Modifier } from './modifiers';
import type { Box } from './volume';

/**
 * Mirror planes in object-local space. The plane of an axis lies at coordinate `center2 / 2`:
 * an odd `center2` puts it through the middle of a voxel (a one-voxel keel that maps onto
 * itself), an even one between two voxels.
 */
export interface MirrorSettings {
  x: boolean;
  y: boolean;
  z: boolean;
  center2: [number, number, number];
}

export const DEFAULT_MIRROR: MirrorSettings = { x: false, y: false, z: false, center2: [0, 0, 0] };

export function mirrorEnabled(m: MirrorSettings): boolean {
  return m.x || m.y || m.z;
}

/** The cell a cell maps to across a mirror plane: [v, v+1) ↦ [c − v − 1, c − v), c = center2. */
export function mirrorCoord(v: number, center2: number): number {
  return center2 - v - 1;
}

/** Doubled centre of a box: mirroring there maps the box onto itself. */
export function mirrorCenterOf(box: Box): [number, number, number] {
  return [box.minX + box.maxX + 1, box.minY + box.maxY + 1, box.minZ + box.maxZ + 1];
}

/** Moves a plane half a voxel: through a voxel ↔ between voxels. Applying it twice is a no-op. */
export function toggleKeel(center2: number): number {
  return center2 % 2 !== 0 ? center2 + 1 : center2 - 1;
}

/** Copies an operation across every combination of the enabled mirror planes. */
export function mirrorModifier(m: MirrorSettings): Modifier {
  if (!mirrorEnabled(m)) return (op) => op;
  const axes = [m.x, m.y, m.z];
  // Every subset of the enabled axes: 2, 4 or 8 copies including the original.
  const flips: boolean[][] = [];
  for (let mask = 0; mask < 8; mask++) {
    const flip = [0, 1, 2].map((a) => (mask & (1 << a)) !== 0);
    if (flip.every((f, a) => !f || axes[a])) flips.push(flip);
  }
  const [cx, cy, cz] = m.center2;
  return (op) => ({
    action: op.action,
    forEachCell(visit) {
      op.forEachCell((x, y, z, color) => {
        for (const [fx, fy, fz] of flips) {
          visit(fx ? cx - x - 1 : x, fy ? cy - y - 1 : y, fz ? cz - z - 1 : z, color);
        }
      });
    },
  });
}
