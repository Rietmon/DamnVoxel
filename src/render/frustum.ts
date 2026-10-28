import type { Mat4 } from './math';

/** Six planes (a, b, c, d) with a·x + b·y + c·z + d ≥ 0 inside, normals of unit length. */
export type Frustum = Float32Array;

export function createFrustum(): Frustum {
  return new Float32Array(24);
}

/** Extracts the view frustum planes from a view-projection matrix (Gribb–Hartmann). */
export function extractFrustum(m: Mat4, out: Frustum): Frustum {
  // Rows of the column-major matrix.
  const r = (i: number) => [m[i]!, m[4 + i]!, m[8 + i]!, m[12 + i]!];
  const r0 = r(0);
  const r1 = r(1);
  const r2 = r(2);
  const r3 = r(3);
  const planes = [
    r3.map((v, i) => v + r0[i]!), // left
    r3.map((v, i) => v - r0[i]!), // right
    r3.map((v, i) => v + r1[i]!), // bottom
    r3.map((v, i) => v - r1[i]!), // top
    r3.map((v, i) => v + r2[i]!), // near
    r3.map((v, i) => v - r2[i]!), // far
  ];
  planes.forEach((p, k) => {
    const len = Math.hypot(p[0]!, p[1]!, p[2]!) || 1;
    for (let i = 0; i < 4; i++) out[k * 4 + i] = p[i]! / len;
  });
  return out;
}

/** True when the box may be visible: it is not entirely behind any plane. */
export function boxInFrustum(
  f: Frustum,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): boolean {
  for (let k = 0; k < 24; k += 4) {
    const a = f[k]!;
    const b = f[k + 1]!;
    const c = f[k + 2]!;
    // The corner furthest along the plane normal.
    const x = a >= 0 ? maxX : minX;
    const y = b >= 0 ? maxY : minY;
    const z = c >= 0 ? maxZ : minZ;
    if (a * x + b * y + c * z + f[k + 3]! < 0) return false;
  }
  return true;
}
