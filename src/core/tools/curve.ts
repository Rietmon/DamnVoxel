/**
 * Curves into voxels (Bézier curve / spline): a quadratic Bézier arc between
 * two points, or a freehand stroke simplified and smoothed into a Catmull–Rom spline; either is
 * sampled densely and turned into a line of voxels or a round tube of a given thickness. Points
 * are object-local, in voxel units (cell centres are at .5).
 */

export type P3 = [number, number, number];

const lerp = (a: P3, b: P3, t: number): P3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

const dist = (a: P3, b: P3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Points along the quadratic Bézier a → b pulled towards `control`, about four per voxel. */
export function bezierPoints(a: P3, control: P3, b: P3): P3[] {
  const n = Math.max(2, Math.ceil((dist(a, control) + dist(control, b)) * 4));
  const out: P3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push(lerp(lerp(a, control, t), lerp(control, b, t), t));
  }
  return out;
}

/** Ramer–Douglas–Peucker: drops points closer than `tolerance` to the line they lie on. */
export function simplify(points: readonly P3[], tolerance: number): P3[] {
  if (points.length < 3 || tolerance <= 0) return [...points];
  const a = points[0]!;
  const b = points.at(-1)!;
  let worst = 0;
  let at = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = distanceToSegment(points[i]!, a, b);
    if (d > worst) {
      worst = d;
      at = i;
    }
  }
  if (worst <= tolerance) return [a, b];
  const left = simplify(points.slice(0, at + 1), tolerance);
  return [...left.slice(0, -1), ...simplify(points.slice(at), tolerance)];
}

function distanceToSegment(p: P3, a: P3, b: P3): number {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len2 = ab[0]! ** 2 + ab[1]! ** 2 + ab[2]! ** 2;
  const t =
    len2 > 0
      ? Math.max(
          0,
          Math.min(
            1,
            ((p[0] - a[0]) * ab[0]! + (p[1] - a[1]) * ab[1]! + (p[2] - a[2]) * ab[2]!) / len2,
          ),
        )
      : 0;
  return dist(p, [a[0] + ab[0]! * t, a[1] + ab[1]! * t, a[2] + ab[2]! * t]);
}

/** A Catmull–Rom spline through every point (ends held), about four points per voxel. */
export function splinePoints(points: readonly P3[]): P3[] {
  if (points.length < 3)
    return points.length === 2
      ? bezierPoints(points[0]!, lerp(points[0]!, points[1]!, 0.5), points[1]!)
      : [...points];
  const out: P3[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(points.length - 1, i + 2)]!;
    const n = Math.max(2, Math.ceil(dist(p1, p2) * 4));
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push(
        [0, 1, 2].map(
          (j) =>
            0.5 *
            (2 * p1[j]! +
              (-p0[j]! + p2[j]!) * t +
              (2 * p0[j]! - 5 * p1[j]! + 4 * p2[j]! - p3[j]!) * t2 +
              (-p0[j]! + 3 * p1[j]! - 3 * p2[j]! + p3[j]!) * t3),
        ) as P3,
      );
    }
  }
  return out;
}

/**
 * The voxels of a curve: for thickness 1 the cells its points pass through; thicker, every cell
 * whose centre lies within half the thickness of the curve — a round tube.
 */
export function curveCells(points: readonly P3[], thickness: number): number[] {
  const seen = new Set<string>();
  const out: number[] = [];
  const take = (x: number, y: number, z: number) => {
    const key = `${x},${y},${z}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(x, y, z);
  };
  if (thickness <= 1) {
    for (const p of points) take(Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2]));
    return out;
  }
  const r = thickness / 2;
  const reach = Math.ceil(r);
  for (const p of points) {
    const cx = Math.floor(p[0]);
    const cy = Math.floor(p[1]);
    const cz = Math.floor(p[2]);
    for (let z = cz - reach; z <= cz + reach; z++)
      for (let y = cy - reach; y <= cy + reach; y++)
        for (let x = cx - reach; x <= cx + reach; x++)
          if ((x + 0.5 - p[0]) ** 2 + (y + 0.5 - p[1]) ** 2 + (z + 0.5 - p[2]) ** 2 <= r * r)
            take(x, y, z);
  }
  return out;
}
