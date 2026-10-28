import { describe, expect, it } from 'vitest';
import { type SimInput, simulate } from './verlet';

/** A rope of n particles from (0, y, 0) to (len, y, 0), its ends pinned. */
function rope(n: number, len: number, y: number, slack = 1.2): SimInput {
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) positions.set([(len * i) / (n - 1), y, 0], i * 3);
  const pinned = new Uint8Array(n);
  pinned[0] = 1;
  pinned[n - 1] = 1;
  const links = new Uint32Array((n - 1) * 2);
  const rest = new Float32Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    links.set([i, i + 1], i * 2);
    rest[i] = (len * slack) / (n - 1);
  }
  return {
    positions,
    pinned,
    links,
    rest,
    solid: null,
    radius: 0.5,
    steps: 400,
    iterations: 20,
    gravity: 0.02,
    damping: 0.98,
  };
}

describe('verlet', () => {
  it('lets a slack rope sag between pinned ends and keeps its length', () => {
    const input = rope(21, 20, 10);
    const p = simulate(input);
    expect(p[0]).toBe(0);
    expect(p[20 * 3]).toBe(20);
    const middle = p[10 * 3 + 1]!;
    expect(middle).toBeLessThan(10 - 3);
    let length = 0;
    for (let i = 0; i < 20; i++)
      length += Math.hypot(p[(i + 1) * 3]! - p[i * 3]!, p[(i + 1) * 3 + 1]! - p[i * 3 + 1]!);
    expect(length).toBeCloseTo(24, 0);
  });

  it('rests on solid voxels instead of falling through', () => {
    const input = rope(21, 20, 10, 1.5);
    // A floor slab under the rope at y = 0…5.
    const size: [number, number, number] = [30, 6, 5];
    const cells = new Uint8Array(size[0] * size[1] * size[2]).fill(1);
    input.solid = { min: [-5, 0, -2], size, cells };
    const p = simulate(input);
    for (let i = 0; i < 21; i++) expect(p[i * 3 + 1]!).toBeGreaterThanOrEqual(6 + 0.5 - 0.05);
  });
});
