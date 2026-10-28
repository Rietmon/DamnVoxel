/**
 * Triangles to voxels (docs/formats.md, “Voxelization”). Every cell a triangle passes through
 * (an exact triangle–box test) becomes a voxel, coloured at the point of the nearest such
 * triangle closest to the cell's centre. A solid model also fills the cells no path from outside
 * reaches, coloured like the surface above them.
 */

export interface VoxelizeOptions {
  /** Cells along the longest side of the model. */
  size: number;
  /** Fill the inside of closed shapes. */
  solid: boolean;
}

/** The colour (packed RGBA) of a point on a triangle by its barycentric weights; 0 for a hole. */
export type TriangleColor = (triangle: number, w0: number, w1: number, w2: number) => number;

export interface VoxelCells {
  size: [number, number, number];
  /** Cell index x + y·sx + z·sx·sy → packed RGBA. */
  cells: Map<number, number>;
}

/** Fill the inside only up to this many cells (a byte per cell). */
export const SOLID_CELL_LIMIT = 64 * 1024 * 1024;

/**
 * Whether a triangle (corners relative to the box centre) overlaps a box of half size `h`:
 * no separating axis among the box's three, the triangle's normal and the nine edge crosses.
 */
export function triangleBoxOverlap(
  v: readonly number[],
  half: number | readonly [number, number, number],
): boolean {
  const h = typeof half === 'number' ? [half, half, half] : half;
  for (let a = 0; a < 3; a++) {
    const lo = Math.min(v[a]!, v[3 + a]!, v[6 + a]!);
    const hi = Math.max(v[a]!, v[3 + a]!, v[6 + a]!);
    if (lo > h[a]! || hi < -h[a]!) return false;
  }
  const e = [
    [v[3]! - v[0]!, v[4]! - v[1]!, v[5]! - v[2]!],
    [v[6]! - v[3]!, v[7]! - v[4]!, v[8]! - v[5]!],
    [v[0]! - v[6]!, v[1]! - v[7]!, v[2]! - v[8]!],
  ];
  const test = (ax: number, ay: number, az: number) => {
    const r = h[0]! * Math.abs(ax) + h[1]! * Math.abs(ay) + h[2]! * Math.abs(az);
    const p0 = ax * v[0]! + ay * v[1]! + az * v[2]!;
    const p1 = ax * v[3]! + ay * v[4]! + az * v[5]!;
    const p2 = ax * v[6]! + ay * v[7]! + az * v[8]!;
    return !(Math.min(p0, p1, p2) > r || Math.max(p0, p1, p2) < -r);
  };
  for (const [x, y, z] of e) {
    // Unit axes crossed with the edge.
    if (!test(0, -z!, y!)) return false;
    if (!test(z!, 0, -x!)) return false;
    if (!test(-y!, x!, 0)) return false;
  }
  const [a, b] = e;
  const n = [
    a![1]! * b![2]! - a![2]! * b![1]!,
    a![2]! * b![0]! - a![0]! * b![2]!,
    a![0]! * b![1]! - a![1]! * b![0]!,
  ];
  return test(n[0]!, n[1]!, n[2]!);
}

/**
 * The point of triangle abc closest to p, as barycentric weights, and its squared distance
 * (Ericson, «Real-Time Collision Detection», 5.1.5).
 */
export function closestOnTriangle(
  t: readonly number[],
  p: readonly number[],
): [number, number, number, number] {
  const sub = (i: number, j: number) => [
    t[i]! - t[j]!,
    t[i + 1]! - t[j + 1]!,
    t[i + 2]! - t[j + 2]!,
  ];
  const dot = (x: number[], y: number[]) => x[0]! * y[0]! + x[1]! * y[1]! + x[2]! * y[2]!;
  const ab = sub(3, 0);
  const ac = sub(6, 0);
  const ap = [p[0]! - t[0]!, p[1]! - t[1]!, p[2]! - t[2]!];
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  let w: [number, number, number];
  if (d1 <= 0 && d2 <= 0) w = [1, 0, 0];
  else {
    const bp = [p[0]! - t[3]!, p[1]! - t[4]!, p[2]! - t[5]!];
    const d3 = dot(ab, bp);
    const d4 = dot(ac, bp);
    const cp = [p[0]! - t[6]!, p[1]! - t[7]!, p[2]! - t[8]!];
    const d5 = dot(ab, cp);
    const d6 = dot(ac, cp);
    const vc = d1 * d4 - d3 * d2;
    const vb = d5 * d2 - d1 * d6;
    const va = d3 * d6 - d5 * d4;
    if (d3 >= 0 && d4 <= d3) w = [0, 1, 0];
    else if (d6 >= 0 && d5 <= d6) w = [0, 0, 1];
    else if (vc <= 0 && d1 >= 0 && d3 <= 0) {
      const s = d1 / (d1 - d3 || 1);
      w = [1 - s, s, 0];
    } else if (vb <= 0 && d2 >= 0 && d6 <= 0) {
      const s = d2 / (d2 - d6 || 1);
      w = [1 - s, 0, s];
    } else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      const s = (d4 - d3) / (d4 - d3 + (d5 - d6) || 1);
      w = [0, 1 - s, s];
    } else {
      const k = 1 / (va + vb + vc || 1);
      w = [va * k, vb * k, vc * k];
    }
  }
  let d = 0;
  for (let a = 0; a < 3; a++) {
    const q = w[0] * t[a]! + w[1] * t[3 + a]! + w[2] * t[6 + a]!;
    d += (q - p[a]!) ** 2;
  }
  return [w[0], w[1], w[2], d];
}

export function voxelize(
  positions: Float32Array,
  count: number,
  options: VoxelizeOptions,
  colorAt: TriangleColor,
): VoxelCells {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count * 9; i++) {
    const a = i % 3;
    const v = positions[i]!;
    if (!Number.isFinite(v)) continue;
    if (v < min[a]!) min[a] = v;
    if (v > max[a]!) max[a] = v;
  }
  const extent = Math.max(max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!) || 1;
  const k = options.size / extent;
  const size = [0, 1, 2].map((a) => Math.max(1, Math.ceil((max[a]! - min[a]!) * k - 1e-6))) as [
    number,
    number,
    number,
  ];
  const [sx, sy, sz] = size;
  const best = new Map<number, number>();
  const hit = new Map<number, [number, number, number, number]>();
  const tri = new Array<number>(9);
  const rel = new Array<number>(9);
  const centre = [0, 0, 0];
  for (let t = 0; t < count; t++) {
    let ok = true;
    for (let i = 0; i < 9; i++) {
      tri[i] = (positions[t * 9 + i]! - min[i % 3]!) * k;
      if (!Number.isFinite(tri[i]!)) ok = false;
    }
    if (!ok) continue;
    // The unit normal: a face lying on a cell border goes to the cell behind it only.
    const ux = [tri[3]! - tri[0]!, tri[4]! - tri[1]!, tri[5]! - tri[2]!];
    const uy = [tri[6]! - tri[0]!, tri[7]! - tri[1]!, tri[8]! - tri[2]!];
    const nrm = [
      ux[1]! * uy[2]! - ux[2]! * uy[1]!,
      ux[2]! * uy[0]! - ux[0]! * uy[2]!,
      ux[0]! * uy[1]! - ux[1]! * uy[0]!,
    ];
    const len = Math.hypot(nrm[0]!, nrm[1]!, nrm[2]!) || 1;
    for (let a = 0; a < 3; a++) nrm[a]! /= len;
    const axis = [0, 1, 2].reduce((m, a) => (Math.abs(nrm[a]!) > Math.abs(nrm[m]!) ? a : m), 0);
    const flat = Math.abs(nrm[axis]!) > 0.9999;
    // A face along the grid: reaching a cell's border across it counts, touching its edge does not.
    const half: [number, number, number] = flat
      ? [0.4999, 0.4999, 0.4999]
      : [0.5001, 0.5001, 0.5001];
    if (flat) half[axis] = 0.5001;
    // The cells around the triangle, a hair wider: a face on a cell border reaches the cells on
    // both sides of it. Clamped into the grid.
    const lo = [0, 1, 2].map((a) =>
      Math.min(
        size[a]! - 1,
        Math.max(0, Math.floor(Math.min(tri[a]!, tri[3 + a]!, tri[6 + a]!) - 1e-4)),
      ),
    );
    const hi = [0, 1, 2].map((a) =>
      Math.min(size[a]! - 1, Math.floor(Math.max(tri[a]!, tri[3 + a]!, tri[6 + a]!) + 1e-4)),
    );
    for (let z = lo[2]!; z <= hi[2]!; z++)
      for (let y = lo[1]!; y <= hi[1]!; y++)
        for (let x = lo[0]!; x <= hi[0]!; x++) {
          centre[0] = x + 0.5;
          centre[1] = y + 0.5;
          centre[2] = z + 0.5;
          for (let i = 0; i < 9; i++) rel[i] = tri[i]! - centre[i % 3]!;
          if (!triangleBoxOverlap(rel, half)) continue;
          if (flat) {
            const side = nrm[0]! * rel[0]! + nrm[1]! * rel[1]! + nrm[2]! * rel[2]!;
            // On the border, in front of the face (rel is corner − centre): the cell outside.
            if (side < -0.4999) continue;
          }
          const [w0, w1, w2, d] = closestOnTriangle(tri, centre);
          const index = x + y * sx + z * sx * sy;
          const known = best.get(index);
          if (known !== undefined && known <= d) continue;
          best.set(index, d);
          hit.set(index, [t, w0, w1, w2]);
        }
  }
  const cells = new Map<number, number>();
  for (const [index, [t, w0, w1, w2]] of hit) {
    const c = colorAt(t, w0, w1, w2);
    if (c !== 0) cells.set(index, c);
  }
  if (options.solid && sx * sy * sz <= SOLID_CELL_LIMIT) fillInside(cells, size);
  return { size, cells };
}

/**
 * Cells no path from outside reaches (through faces) become voxels, coloured like the nearest
 * surface above them.
 */
function fillInside(cells: Map<number, number>, size: [number, number, number]): void {
  const [sx, sy, sz] = size;
  const state = new Uint8Array(sx * sy * sz);
  for (const index of cells.keys()) state[index] = 1;
  const queue = new Int32Array(sx * sy * sz);
  let head = 0;
  let tail = 0;
  const seed = (x: number, y: number, z: number) => {
    const i = x + y * sx + z * sx * sy;
    if (state[i] === 0) {
      state[i] = 2;
      queue[tail++] = i;
    }
  };
  for (let z = 0; z < sz; z++)
    for (let y = 0; y < sy; y++) {
      seed(0, y, z);
      seed(sx - 1, y, z);
    }
  for (let z = 0; z < sz; z++)
    for (let x = 0; x < sx; x++) {
      seed(x, 0, z);
      seed(x, sy - 1, z);
    }
  for (let y = 0; y < sy; y++)
    for (let x = 0; x < sx; x++) {
      seed(x, y, 0);
      seed(x, y, sz - 1);
    }
  while (head < tail) {
    const i = queue[head++]!;
    const x = i % sx;
    const y = Math.floor(i / sx) % sy;
    const z = Math.floor(i / (sx * sy));
    if (x > 0) seed(x - 1, y, z);
    if (x < sx - 1) seed(x + 1, y, z);
    if (y > 0) seed(x, y - 1, z);
    if (y < sy - 1) seed(x, y + 1, z);
    if (z > 0) seed(x, y, z - 1);
    if (z < sz - 1) seed(x, y, z + 1);
  }
  for (let z = 0; z < sz; z++)
    for (let x = 0; x < sx; x++) {
      let above = 0;
      for (let y = sy - 1; y >= 0; y--) {
        const i = x + y * sx + z * sx * sy;
        if (state[i] === 1) above = cells.get(i) ?? above;
        else if (state[i] === 0 && above) cells.set(i, above);
      }
    }
}
