import { FACE_NORMALS } from './coords';
import type { Box, VolumeReader } from './volume';

/**
 * Fills and cavities: flood fills over voxels of one
 * colour (through the model or within one layer), filling an outline drawn in a layer, and the
 * model's inside — what cannot be seen from outside, the empty pockets in it, a hollow shell.
 * All of it is breadth-first search over a small box, so it stays bounded and exact.
 */

/** A search never visits more cells than this: a fill that would is refused. */
export const FILL_LIMIT = 4_000_000;

type Cell = readonly [number, number, number];

/**
 * Voxels connected to `start` (6-connectivity) that have its colour — or any colour with
 * `anyColor` — optionally kept to the layer `start` lies in across `layerAxis`. Flat x, y, z
 * triples; null when the region is larger than FILL_LIMIT.
 */
export function floodVoxels(
  v: VolumeReader,
  start: Cell,
  options: { anyColor?: boolean; layerAxis?: number | null } = {},
): number[] | null {
  const color = v.get(start[0], start[1], start[2]);
  if (!color) return [];
  const axis = options.layerAxis ?? null;
  const seen = new Set<string>();
  const out: number[] = [];
  const queue: number[] = [start[0], start[1], start[2]];
  seen.add(`${start[0]},${start[1]},${start[2]}`);
  for (let i = 0; i < queue.length; i += 3) {
    const x = queue[i]!;
    const y = queue[i + 1]!;
    const z = queue[i + 2]!;
    out.push(x, y, z);
    if (out.length / 3 > FILL_LIMIT) return null;
    for (const n of FACE_NORMALS) {
      if (axis !== null && n[axis] !== 0) continue;
      const nx = x + n[0];
      const ny = y + n[1];
      const nz = z + n[2];
      const key = `${nx},${ny},${nz}`;
      if (seen.has(key)) continue;
      const c = v.get(nx, ny, nz);
      if (!c || (!options.anyColor && c !== color)) continue;
      seen.add(key);
      queue.push(nx, ny, nz);
    }
  }
  return out;
}

/**
 * The empty cells enclosed by voxels within one layer, around `start`: drawing an outline and
 * filling it. Null when the empty area runs out past the model's box (the outline is not
 * closed), or `start` is not empty.
 */
export function enclosedCells(
  v: VolumeReader,
  start: Cell,
  axis: number,
  box: Box,
): number[] | null {
  if (v.get(start[0], start[1], start[2])) return null;
  const lo = [box.minX, box.minY, box.minZ];
  const hi = [box.maxX, box.maxY, box.maxZ];
  const seen = new Set<string>([`${start[0]},${start[1]},${start[2]}`]);
  const out: number[] = [];
  const queue: number[] = [start[0], start[1], start[2]];
  for (let i = 0; i < queue.length; i += 3) {
    const c = [queue[i]!, queue[i + 1]!, queue[i + 2]!];
    for (let a = 0; a < 3; a++) if (a !== axis && (c[a]! < lo[a]! || c[a]! > hi[a]!)) return null;
    out.push(c[0]!, c[1]!, c[2]!);
    if (out.length / 3 > FILL_LIMIT) return null;
    for (const n of FACE_NORMALS) {
      if (n[axis] !== 0) continue;
      const nx = c[0]! + n[0];
      const ny = c[1]! + n[1];
      const nz = c[2]! + n[2];
      const key = `${nx},${ny},${nz}`;
      if (seen.has(key) || v.get(nx, ny, nz)) continue;
      seen.add(key);
      queue.push(nx, ny, nz);
    }
  }
  return out;
}

/** A grid over the model's box with one cell of air around it. */
class Grid {
  readonly ox: number;
  readonly oy: number;
  readonly oz: number;
  readonly sx: number;
  readonly sy: number;
  readonly sz: number;

  constructor(box: Box) {
    this.ox = box.minX - 1;
    this.oy = box.minY - 1;
    this.oz = box.minZ - 1;
    this.sx = box.maxX - box.minX + 3;
    this.sy = box.maxY - box.minY + 3;
    this.sz = box.maxZ - box.minZ + 3;
  }

  get size(): number {
    return this.sx * this.sy * this.sz;
  }

  index(x: number, y: number, z: number): number {
    return x - this.ox + this.sx * (y - this.oy + this.sy * (z - this.oz));
  }

  cell(i: number): [number, number, number] {
    const x = i % this.sx;
    const y = Math.floor(i / this.sx) % this.sy;
    const z = Math.floor(i / (this.sx * this.sy));
    return [x + this.ox, y + this.oy, z + this.oz];
  }
}

/**
 * Distance of every cell from the air outside the model, walking in 6-connected steps: 0 for
 * outside air, 1 for the voxels it touches, and so on inward; −1 for cells outside cannot reach
 * (empty pockets inside, or voxels deeper than `maxDepth`). Null for a box over FILL_LIMIT·4.
 */
export function depthFromOutside(
  v: VolumeReader,
  box: Box,
  maxDepth = Number.POSITIVE_INFINITY,
): { grid: Grid; depth: Int32Array; filled: Uint8Array } | null {
  const grid = new Grid(box);
  if (grid.size > FILL_LIMIT * 4) return null;
  const depth = new Int32Array(grid.size).fill(-1);
  const filled = new Uint8Array(grid.size);
  for (let i = 0; i < grid.size; i++) {
    const [x, y, z] = grid.cell(i);
    filled[i] = v.get(x, y, z) ? 1 : 0;
  }
  // Outside air: flood from the box corner (the border is all air).
  const frontier: number[] = [0];
  depth[0] = 0;
  const step = [1, -1, grid.sx, -grid.sx, grid.sx * grid.sy, -grid.sx * grid.sy];
  /** Whether a step in direction d (+x, −x, +y, −y, +z, −z) stays inside the grid. */
  const canMove = (i: number, d: number) => {
    const x = i % grid.sx;
    const y = Math.floor(i / grid.sx) % grid.sy;
    const z = Math.floor(i / (grid.sx * grid.sy));
    if (d === 0) return x < grid.sx - 1;
    if (d === 1) return x > 0;
    if (d === 2) return y < grid.sy - 1;
    if (d === 3) return y > 0;
    if (d === 4) return z < grid.sz - 1;
    return z > 0;
  };

  for (let i = 0; i < frontier.length; i++) {
    const c = frontier[i]!;
    for (let d = 0; d < 6; d++) {
      if (!canMove(c, d)) continue;
      const n = c + step[d]!;
      if (depth[n] !== -1 || filled[n]) continue;
      depth[n] = 0;
      frontier.push(n);
    }
  }
  // Then into the voxels, layer by layer.
  let layer = frontier;
  for (let level = 1; level <= maxDepth && layer.length > 0; level++) {
    const next: number[] = [];
    for (const c of layer) {
      for (let d = 0; d < 6; d++) {
        if (!canMove(c, d)) continue;
        const n = c + step[d]!;
        if (depth[n] !== -1 || !filled[n]) continue;
        depth[n] = level;
        next.push(n);
      }
    }
    layer = next;
  }
  return { grid, depth, filled };
}

/** Voxels no outside air touches: they never show. */
export function hiddenVoxels(v: VolumeReader, box: Box): number[] | null {
  const r = depthFromOutside(v, box, 1);
  if (!r) return null;
  const out: number[] = [];
  for (let i = 0; i < r.depth.length; i++)
    if (r.filled[i] && r.depth[i] === -1) out.push(...r.grid.cell(i));
  return out;
}

/** Voxels deeper than `wall` from the outside: what goes when the model is made hollow. */
export function hollowVoxels(v: VolumeReader, box: Box, wall: number): number[] | null {
  const r = depthFromOutside(v, box, wall);
  if (!r) return null;
  const out: number[] = [];
  for (let i = 0; i < r.depth.length; i++)
    if (r.filled[i] && r.depth[i] === -1) out.push(...r.grid.cell(i));
  return out;
}

/** Empty pockets inside the model that outside air cannot reach. */
export function interiorCells(v: VolumeReader, box: Box): number[] | null {
  const r = depthFromOutside(v, box, 0);
  if (!r) return null;
  const out: number[] = [];
  for (let i = 0; i < r.depth.length; i++)
    if (!r.filled[i] && r.depth[i] === -1) out.push(...r.grid.cell(i));
  return out;
}
