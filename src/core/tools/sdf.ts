/**
 * Smooth shapes by signed distance (SDF brushes): spheres, rounded boxes and
 * tubes along a stroke, joined with a smooth minimum so they melt into each other like clay,
 * then turned into voxels. Coordinates are object-local voxel units; a cell is filled when the
 * distance at its centre is ≤ 0.
 */

export type Vec3 = [number, number, number];

export type SdfPrimitive =
  | { kind: 'sphere'; c: Vec3; r: number }
  /** A box with half sizes `h`, its edges rounded by `round`. */
  | { kind: 'box'; c: Vec3; h: Vec3; round: number }
  | { kind: 'capsule'; a: Vec3; b: Vec3; r: number };

export function distance(p: Vec3, s: SdfPrimitive): number {
  switch (s.kind) {
    case 'sphere':
      return Math.hypot(p[0] - s.c[0], p[1] - s.c[1], p[2] - s.c[2]) - s.r;
    case 'box': {
      const q = [0, 1, 2].map((i) => Math.abs(p[i]! - s.c[i]!) - s.h[i]! + s.round);
      const outside = Math.hypot(Math.max(q[0]!, 0), Math.max(q[1]!, 0), Math.max(q[2]!, 0));
      return outside + Math.min(Math.max(q[0]!, q[1]!, q[2]!), 0) - s.round;
    }
    case 'capsule': {
      const ab = [s.b[0] - s.a[0], s.b[1] - s.a[1], s.b[2] - s.a[2]];
      const ap = [p[0] - s.a[0], p[1] - s.a[1], p[2] - s.a[2]];
      const len2 = ab[0]! ** 2 + ab[1]! ** 2 + ab[2]! ** 2;
      const t =
        len2 > 0
          ? Math.max(0, Math.min(1, (ap[0]! * ab[0]! + ap[1]! * ab[1]! + ap[2]! * ab[2]!) / len2))
          : 0;
      return Math.hypot(ap[0]! - ab[0]! * t, ap[1]! - ab[1]! * t, ap[2]! - ab[2]! * t) - s.r;
    }
  }
}

/** Polynomial smooth minimum: the two surfaces melt together over about `k` voxels. */
export function smoothMin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - (h * h * k) / 4;
}

function bounds(s: SdfPrimitive): [Vec3, Vec3] {
  switch (s.kind) {
    case 'sphere':
      return [s.c.map((v) => v - s.r) as Vec3, s.c.map((v) => v + s.r) as Vec3];
    case 'box':
      return [s.c.map((v, i) => v - s.h[i]!) as Vec3, s.c.map((v, i) => v + s.h[i]!) as Vec3];
    case 'capsule':
      return [
        s.a.map((v, i) => Math.min(v, s.b[i]!) - s.r) as Vec3,
        s.a.map((v, i) => Math.max(v, s.b[i]!) + s.r) as Vec3,
      ];
  }
}

/** Most cells a blend may cover: bigger ones are refused rather than freezing the editor. */
export const SDF_CELL_LIMIT = 8_000_000;

/** The cells inside the smooth union of the shapes (flat x, y, z), or null when too large. */
export function voxelizeSdf(shapes: readonly SdfPrimitive[], blend: number): number[] | null {
  if (shapes.length === 0) return [];
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const s of shapes) {
    const [a, b] = bounds(s);
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i]!, a[i]!);
      hi[i] = Math.max(hi[i]!, b[i]!);
    }
  }
  // The blend can swell the surface between shapes by up to k / 4.
  const pad = blend / 4 + 1;
  const min = lo.map((v) => Math.floor(v - pad));
  const max = hi.map((v) => Math.ceil(v + pad));
  const cells = (max[0]! - min[0]! + 1) * (max[1]! - min[1]! + 1) * (max[2]! - min[2]! + 1);
  if (cells > SDF_CELL_LIMIT) return null;
  const out: number[] = [];
  const p: Vec3 = [0, 0, 0];
  for (let z = min[2]!; z <= max[2]!; z++)
    for (let y = min[1]!; y <= max[1]!; y++)
      for (let x = min[0]!; x <= max[0]!; x++) {
        p[0] = x + 0.5;
        p[1] = y + 0.5;
        p[2] = z + 0.5;
        let d = Infinity;
        for (const s of shapes) d = smoothMin(d, distance(p, s), blend);
        if (d <= 0) out.push(x, y, z);
      }
  return out;
}
