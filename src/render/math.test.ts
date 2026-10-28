import { describe, expect, it } from 'vitest';
import { bucketSize } from './gl';
import {
  invert,
  lookAt,
  mat4,
  multiply,
  ortho,
  perspective,
  transformDirection,
  transformPoint,
} from './math';

function close(a: ArrayLike<number>, b: ArrayLike<number>, eps = 1e-5): void {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) expect(a[i]!).toBeCloseTo(b[i]!, -Math.log10(eps));
}

describe('mat4', () => {
  it('inverts so that m × m⁻¹ is identity', () => {
    const view = lookAt(mat4(), [3, 4, 5], [0, 1, 0], [0, 1, 0]);
    const proj = perspective(mat4(), 1, 1.5, 0.1, 100);
    const m = multiply(mat4(), proj, view);
    const inv = invert(mat4(), m)!;
    close(multiply(mat4(), m, inv), mat4(), 1e-4);
  });

  it('looks from the eye towards the target along −Z in view space', () => {
    const view = lookAt(mat4(), [0, 0, 10], [0, 0, 0], [0, 1, 0]);
    close(transformPoint(view, 0, 0, 0), [0, 0, -10]);
    close(transformPoint(view, 1, 0, 0), [1, 0, -10]);
    close(transformDirection(view, 0, 1, 0), [0, 1, 0]);
  });

  it('maps near and far planes to −1 and 1', () => {
    const proj = perspective(mat4(), Math.PI / 2, 1, 1, 100);
    expect(transformPoint(proj, 0, 0, -1)[2]).toBeCloseTo(-1);
    expect(transformPoint(proj, 0, 0, -100)[2]).toBeCloseTo(1);
    const o = ortho(mat4(), -2, 2, -1, 1, 0, 10);
    close(transformPoint(o, 2, 1, 0), [1, 1, -1]);
    close(transformPoint(o, -2, -1, -10), [-1, -1, 1]);
  });

  it('returns null for a singular matrix', () => {
    expect(invert(mat4(), new Float32Array(16))).toBeNull();
  });
});

describe('bucketSize', () => {
  it('rounds up to powers of two with a 1 KB floor', () => {
    expect(bucketSize(1)).toBe(1024);
    expect(bucketSize(1024)).toBe(1024);
    expect(bucketSize(1025)).toBe(2048);
    expect(bucketSize(100_000)).toBe(131072);
  });
});
