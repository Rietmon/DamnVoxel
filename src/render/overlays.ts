import { applyOrientation } from '../core/orientation';
import type { Transform } from '../core/scene';
import type { Box } from '../core/volume';
import type { Camera } from './camera';
import type { LineBatch } from './lines';
import type { Vec3 } from './math';

/** Axis colours used everywhere: X red, Y green, Z blue. */
export const AXIS_COLORS: readonly (readonly number[])[] = [
  [0.9, 0.3, 0.32, 1],
  [0.36, 0.72, 0.42, 1],
  [0.27, 0.56, 0.96, 1],
];

/** World-space corners of an object-local voxel box under a transform. */
export function worldBox(box: Box, t: Transform): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const x of [box.minX, box.maxX + 1])
    for (const y of [box.minY, box.maxY + 1])
      for (const z of [box.minZ, box.maxZ + 1]) {
        const p = applyOrientation(t.orientation, x, y, z);
        for (let i = 0; i < 3; i++) {
          const v = p[i]! + (i === 0 ? t.x : i === 1 ? t.y : t.z);
          min[i] = Math.min(min[i]!, v);
          max[i] = Math.max(max[i]!, v);
        }
      }
  return { min, max };
}

/** X and Z axes along the floor and a short Y axis up from the origin. */
export function addAxes(batch: LineBatch, camera: Camera): void {
  const r = Math.max(64, camera.distance * 3);
  batch.add([-r, 0, 0], [r, 0, 0], AXIS_COLORS[0]!, 1.5);
  batch.add([0, 0, -r], [0, 0, r], AXIS_COLORS[2]!, 1.5);
  batch.add([0, 0, 0], [0, Math.max(8, camera.distance * 0.15), 0], AXIS_COLORS[1]!, 1.5);
}

export interface RulerLabel {
  /** CSS pixels from the top left of the viewport. */
  x: number;
  y: number;
  text: string;
  axis: 0 | 1 | 2;
}

const STEPS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024];
/** Ticks closer than this on screen are thinned out by doubling the step. */
const MIN_TICK_PX = 6;

function pixelsPerVoxel(camera: Camera, at: Vec3): number {
  const a = camera.project(at);
  const b = camera.project([at[0] + 1, at[1], at[2]]);
  const c = camera.project([at[0], at[1] + 1, at[2]]);
  return Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]), Math.hypot(c[0] - a[0], c[1] - a[1]));
}

/**
 * The measuring box: edges of the bounds, ticks every few voxels on the three edges nearest
 * to the camera, and the size of each side as a label. Returns the labels for the UI.
 */
export function addRuler(
  batch: LineBatch,
  camera: Camera,
  min: Vec3,
  max: Vec3,
  ink: readonly [number, number, number] = [1, 1, 1],
): RulerLabel[] {
  // The grid colour: white on a dark background, dark on a light one.
  const boxColor = [...ink, 0.55];
  const tickColor = [...ink, 0.45];
  batch.addBox(min, max, boxColor, 1.25);
  const mid: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const eye = camera.eye();
  const cx = eye[0] >= mid[0] ? max[0] : min[0];
  const cz = eye[2] >= mid[2] ? max[2] : min[2];
  const outX = cx === max[0] ? 1 : -1;
  const outZ = cz === max[2] ? 1 : -1;
  const px = pixelsPerVoxel(camera, mid);
  const step = STEPS.find((s) => s * px >= MIN_TICK_PX) ?? STEPS.at(-1)!;
  const tick = (k: number) => (k % (step * 4) === 0 ? 0.8 : 0.4) * Math.max(1, step / 2);

  for (let x = min[0]; x <= max[0]; x += step) {
    const l = tick(x - min[0]) * outZ;
    batch.add([x, min[1], cz], [x, min[1], cz + l], tickColor, 1);
  }
  for (let z = min[2]; z <= max[2]; z += step) {
    const l = tick(z - min[2]) * outX;
    batch.add([cx, min[1], z], [cx + l, min[1], z], tickColor, 1);
  }
  for (let y = min[1]; y <= max[1]; y += step) {
    const l = tick(y - min[1]);
    batch.add([cx, y, cz], [cx + l * outX, y, cz + l * outZ], tickColor, 1);
  }

  const labels: RulerLabel[] = [];
  const margin = 12 / Math.max(px, 1e-3);
  const place = (p: Vec3, axis: 0 | 1 | 2, size: number) => {
    const s = camera.project(p);
    if (s[2] < -1 || s[2] > 1) return;
    labels.push({ x: s[0], y: s[1], text: String(size), axis });
  };
  place([mid[0], min[1], cz + margin * outZ], 0, max[0] - min[0]);
  place([cx, mid[1], cz + margin * outZ * 0.7], 1, max[1] - min[1]);
  place([cx + margin * outX, min[1], mid[2]], 2, max[2] - min[2]);
  return labels;
}

/** Outline of one voxel face, nudged off the surface along its normal so it never flickers. */
export function addFaceOutline(
  batch: LineBatch,
  t: Transform,
  x: number,
  y: number,
  z: number,
  face: number,
  color: readonly number[],
  width = 2,
): void {
  const axis = face >> 1;
  const positive = (face & 1) === 0;
  const u = (axis + 1) % 3;
  const v = (axis + 2) % 3;
  const base = [x, y, z];
  const plane = base[axis]! + (positive ? 1.01 : -0.01);
  const corner = (du: number, dv: number): Vec3 => {
    const p = [0, 0, 0];
    p[axis] = plane;
    p[u] = base[u]! + du;
    p[v] = base[v]! + dv;
    const o = applyOrientation(t.orientation, p[0]!, p[1]!, p[2]!);
    return [o[0] + t.x, o[1] + t.y, o[2] + t.z];
  };
  const c = [corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1)];
  for (let i = 0; i < 4; i++) batch.add(c[i]!, c[(i + 1) % 4]!, color, width);
}
