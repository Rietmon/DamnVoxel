import type { Scene } from '../core/scene';
import type { P3 } from '../core/tools/curve';
import type { Box } from '../core/volume';
import { VoxelVolume } from '../core/volume';
import type { SimInput } from '../kernels/verlet';
import type { PhysicsWorker } from '../workers/physics-client';
import { solidGrid } from './ropes';

/**
 * Draping cloth: a square sheet of particles held
 * by links to its neighbours (and diagonals, so it does not shear) falls from above onto the
 * model, settles in the physics worker, and becomes a one-voxel-thick layer.
 */

export interface ClothSpec {
  /** World box the sheet covers from above (the target's box). */
  box: Box;
  /** How far the sheet reaches past the box on each side, voxels. */
  margin: number;
  color: number;
}

/** A settled sheet: particles row by row, the grid size, and the model cells it rested on. */
export interface Sheet {
  points: Float32Array;
  cols: number;
  rows: number;
  solid: SimInput['solid'];
}

/** Most particles a side: big sheets get coarser, not slower. */
const MAX_SIDE = 64;

/** The settled sheet: its particles row by row and the grid size. */
export async function settleCloth(
  spec: ClothSpec,
  scene: Scene,
  physics: PhysicsWorker,
): Promise<Sheet> {
  const { box, margin } = spec;
  const x0 = box.minX - margin;
  const z0 = box.minZ - margin;
  const w = box.maxX - box.minX + 1 + 2 * margin;
  const d = box.maxZ - box.minZ + 1 + 2 * margin;
  const step = Math.max(1, Math.max(w, d) / MAX_SIDE);
  const cols = Math.max(2, Math.round(w / step) + 1);
  const rows = Math.max(2, Math.round(d / step) + 1);
  const top = box.maxY + 3;
  const n = cols * rows;
  const positions = new Float32Array(n * 3);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      positions.set(
        [x0 + (c * w) / (cols - 1), top, z0 + (r * d) / (rows - 1)],
        (r * cols + c) * 3,
      );
  const links: number[] = [];
  const rest: number[] = [];
  const link = (a: number, b: number) => {
    links.push(a, b);
    rest.push(
      Math.hypot(
        positions[b * 3]! - positions[a * 3]!,
        positions[b * 3 + 2]! - positions[a * 3 + 2]!,
      ),
    );
  };
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (c + 1 < cols) link(i, i + 1);
      if (r + 1 < rows) link(i, i + cols);
      if (c + 1 < cols && r + 1 < rows) link(i, i + cols + 1);
      if (c > 0 && r + 1 < rows) link(i, i + cols - 1);
    }
  const reach = Math.max(w, d);
  const min: P3 = [x0 - 2, box.minY - reach, z0 - 2];
  const max: P3 = [x0 + w + 2, top + 1, z0 + d + 2];
  const solid = solidGrid(scene, min, max, null);
  const settled = await physics.run({
    positions,
    pinned: new Uint8Array(n),
    links: Uint32Array.from(links),
    rest: Float32Array.from(rest),
    solid,
    radius: 0.5,
    steps: 450,
    iterations: 12,
    gravity: 0.03,
    damping: 0.96,
  });
  return { points: settled, cols, rows, solid };
}

/**
 * The voxels of a settled sheet: every grid triangle filled densely, one voxel thick. Where a
 * fold cuts a model's corner the cells stay out of the model.
 */
export function clothVolume(sheet: Sheet, color: number): VoxelVolume {
  const { points: p, cols, rows, solid } = sheet;
  const blocked = (x: number, y: number, z: number) => {
    if (!solid) return false;
    const cx = x - solid.min[0];
    const cy = y - solid.min[1];
    const cz = z - solid.min[2];
    const [sx, sy, sz] = solid.size;
    if (cx < 0 || cy < 0 || cz < 0 || cx >= sx || cy >= sy || cz >= sz) return false;
    return solid.cells[cx + sx * (cy + sy * cz)] === 1;
  };
  const volume = new VoxelVolume();
  const at = (i: number): P3 => [p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!];
  const fill = (a: P3, b: P3, c: P3) => {
    const span = Math.max(
      Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]),
      Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]),
    );
    const n = Math.max(1, Math.ceil(span * 2));
    for (let i = 0; i <= n; i++)
      for (let j = 0; j <= n - i; j++) {
        const u = i / n;
        const v = j / n;
        const x = Math.floor(a[0] + (b[0] - a[0]) * u + (c[0] - a[0]) * v);
        const y = Math.floor(a[1] + (b[1] - a[1]) * u + (c[1] - a[1]) * v);
        const z = Math.floor(a[2] + (b[2] - a[2]) * u + (c[2] - a[2]) * v);
        if (!blocked(x, y, z)) volume.set(x, y, z, color);
      }
  };
  for (let r = 0; r + 1 < rows; r++)
    for (let c = 0; c + 1 < cols; c++) {
      const i = r * cols + c;
      fill(at(i), at(i + 1), at(i + cols));
      fill(at(i + 1), at(i + cols + 1), at(i + cols));
    }
  volume.takeMeshDirty();
  return volume;
}
