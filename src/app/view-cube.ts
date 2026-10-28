/**
 * Geometry of the view cube: 26 clickable regions (6 faces, 12 edges, 8 corners) projected with
 * the camera rotation. Each face is split 3 × 3: the centre picks the face direction, the strips
 * the edge directions, the corners the corner directions.
 */

export type Dir = [number, number, number];

export interface CubeRegion {
  /** View direction from the target towards the eye, components −1, 0 or 1. */
  dir: Dir;
  /** Screen polygon in widget pixels. */
  polygon: [number, number][];
  /** Face the region lies on, index into FACE_LABELS order: +X, −X, +Y, −Y, +Z, −Z. */
  face: number;
  /** How much the face looks at the viewer, 0…1. */
  facing: number;
}

/** Inner part of a face edge: 0.6 of the half-size leaves strips for edges and corners. */
const INNER = 0.6;
const RANGES: Record<number, [number, number]> = {
  [-1]: [-1, -INNER],
  0: [-INNER, INNER],
  1: [INNER, 1],
};

/** Camera basis: right, up and back (target → eye) for a yaw and pitch. */
export function cameraBasis(yaw: number, pitch: number): [Dir, Dir, Dir] {
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  return [
    [Math.cos(yaw), 0, -Math.sin(yaw)],
    [-sp * Math.sin(yaw), cp, -sp * Math.cos(yaw)],
    [cp * Math.sin(yaw), sp, cp * Math.cos(yaw)],
  ];
}

const dot = (a: readonly number[], b: readonly number[]) =>
  a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

/** Visible regions of the cube for a camera orientation, centred in a widget of `size` px. */
export function cubeRegions(yaw: number, pitch: number, size: number): CubeRegion[] {
  const [right, up, back] = cameraBasis(yaw, pitch);
  const scale = size * 0.3;
  const half = size / 2;
  const project = (p: number[]): [number, number] => [
    half + dot(p, right) * scale,
    half - dot(p, up) * scale,
  ];
  const regions: CubeRegion[] = [];
  for (let face = 0; face < 6; face++) {
    const axis = face >> 1;
    const sign = face & 1 ? -1 : 1;
    const normal = [0, 0, 0];
    normal[axis] = sign;
    const facing = dot(normal, back);
    if (facing <= 1e-3) continue;
    const ua = (axis + 1) % 3;
    const va = (axis + 2) % 3;
    for (const iu of [-1, 0, 1])
      for (const iv of [-1, 0, 1]) {
        const [u0, u1] = RANGES[iu]!;
        const [v0, v1] = RANGES[iv]!;
        const corner = (u: number, v: number) => {
          const p = [0, 0, 0];
          p[axis] = sign;
          p[ua] = u;
          p[va] = v;
          return project(p);
        };
        const dir: Dir = [0, 0, 0];
        dir[axis] = sign;
        dir[ua] = iu;
        dir[va] = iv;
        regions.push({
          dir,
          polygon: [corner(u0, v0), corner(u1, v0), corner(u1, v1), corner(u0, v1)],
          face,
          facing,
        });
      }
  }
  return regions;
}

function inside(polygon: [number, number][], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

export function regionAt(regions: CubeRegion[], x: number, y: number): CubeRegion | null {
  for (const r of regions) if (inside(r.polygon, x, y)) return r;
  return null;
}

export function sameDir(a: Dir, b: Dir): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/**
 * Yaw and pitch that look along a direction. Straight up or down keeps the current yaw turned to
 * the nearest quarter, so the top view stays aligned with the grid.
 */
export function anglesFor(dir: Dir, currentYaw: number): { yaw: number; pitch: number } {
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  const pitch = Math.asin(dir[1] / len);
  const yaw =
    dir[0] === 0 && dir[2] === 0
      ? Math.round(currentYaw / (Math.PI / 2)) * (Math.PI / 2)
      : Math.atan2(dir[0], dir[2]);
  return { yaw, pitch };
}

/** True isometric angles: 45° around Y, elevation atan(1/√2) ≈ 35.26°. */
export const ISOMETRIC = { yaw: Math.PI / 4, pitch: Math.atan(1 / Math.SQRT2) };

/** Face labels in the face order +X, −X, +Y, −Y, +Z, −Z. Front looks from +Z. */
export const FACE_LABELS = ['RIGHT', 'LEFT', 'TOP', 'BOTTOM', 'FRONT', 'BACK'] as const;
