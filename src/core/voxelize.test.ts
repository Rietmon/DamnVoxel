import { describe, expect, it } from 'vitest';
import { closestOnTriangle, triangleBoxOverlap, voxelize } from './voxelize';

/** The 12 triangles of a box from (0,0,0) to (w,h,d). */
function box(w: number, h: number, d: number): Float32Array {
  const c = (x: number, y: number, z: number) => [x * w, y * h, z * d];
  // Wound counter-clockwise from outside: −z, +z, −x, +x, −y, +y.
  const quads = [
    [c(0, 0, 0), c(0, 1, 0), c(1, 1, 0), c(1, 0, 0)],
    [c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1)],
    [c(0, 0, 0), c(0, 0, 1), c(0, 1, 1), c(0, 1, 0)],
    [c(1, 0, 0), c(1, 1, 0), c(1, 1, 1), c(1, 0, 1)],
    [c(0, 0, 0), c(1, 0, 0), c(1, 0, 1), c(0, 0, 1)],
    [c(0, 1, 0), c(0, 1, 1), c(1, 1, 1), c(1, 1, 0)],
  ];
  return new Float32Array(
    quads.flatMap(([a, b, cc, d]) => [...a!, ...b!, ...cc!, ...a!, ...cc!, ...d!]),
  );
}

describe('voxelize', () => {
  it('tests triangles against boxes', () => {
    // A triangle through the centre, one beside the box, one whose plane misses its corner.
    expect(triangleBoxOverlap([-1, -1, 0, 1, -1, 0, 0, 1, 0], 0.5)).toBe(true);
    expect(triangleBoxOverlap([2, 2, 2, 3, 2, 2, 2, 3, 2], 0.5)).toBe(false);
    expect(triangleBoxOverlap([1.6, 0, 0, 0, 1.6, 0, 0, 0, 1.6], 0.5)).toBe(false);
    expect(triangleBoxOverlap([1.4, 0, 0, 0, 1.4, 0, 0, 0, 1.4], 0.5)).toBe(true);
  });

  it('finds the closest point of a triangle', () => {
    const t = [0, 0, 0, 2, 0, 0, 0, 2, 0];
    const [w0, w1, w2, d] = closestOnTriangle(t, [0.5, 0.5, 3]);
    expect([w0, w1, w2].map((x) => +x.toFixed(3))).toEqual([0.5, 0.25, 0.25]);
    expect(d).toBeCloseTo(9);
    // Past a corner: the corner itself.
    expect(closestOnTriangle(t, [-1, -1, 0]).slice(0, 3)).toEqual([1, 0, 0]);
  });

  it('makes a hollow shell or a solid box of the right size', () => {
    const tris = box(8, 4, 6);
    const shell = voxelize(tris, 12, { size: 8, solid: false }, () => 0xff0000ff);
    expect(shell.size).toEqual([8, 4, 6]);
    // The shell: every cell on the outside of an 8 × 4 × 6 block.
    expect(shell.cells.size).toBe(8 * 4 * 6 - 6 * 2 * 4);
    const solid = voxelize(tris, 12, { size: 8, solid: true }, () => 0xff0000ff);
    expect(solid.cells.size).toBe(8 * 4 * 6);
  });

  it('colours each cell from the nearest triangle and leaves holes', () => {
    const tris = box(4, 4, 4);
    // Triangles 10 and 11 are the top: red; the rest blue; triangle 0 is see-through.
    const v = voxelize(tris, 12, { size: 4, solid: false }, (t) =>
      t === 0 ? 0 : t >= 10 ? 0xff0000ff : 0xffff0000,
    );
    const at = (x: number, y: number, z: number) => v.cells.get(x + y * 4 + z * 16);
    expect(at(1, 3, 1)).toBe(0xff0000ff);
    expect(at(1, 1, 3)).toBe(0xffff0000);
  });
});
