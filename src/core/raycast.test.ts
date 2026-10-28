import { describe, expect, it } from 'vitest';
import { FACE_NEG_X, FACE_NEG_Y, FACE_POS_Y, FACE_POS_Z, faceAxis } from './coords';
import { raycastVolume, rayPlane } from './raycast';
import { VoxelVolume } from './volume';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Reference: march along the ray in tiny steps. */
function march(v: VoxelVolume, o: number[], d: number[], maxT: number) {
  const len = Math.hypot(d[0]!, d[1]!, d[2]!);
  const stepT = 0.002 / len;
  for (let t = 0; t < maxT; t += stepT) {
    const x = Math.floor(o[0]! + d[0]! * t);
    const y = Math.floor(o[1]! + d[1]! * t);
    const z = Math.floor(o[2]! + d[2]! * t);
    if (v.get(x, y, z) !== 0) return { x, y, z };
  }
  return null;
}

describe('raycastVolume', () => {
  it('hits the first voxel and reports the face it entered through', () => {
    const v = new VoxelVolume();
    v.set(5, 0, 0, 3);
    v.set(9, 0, 0, 4);
    const hit = raycastVolume(v, v.getBounds()!, [0.5, 0.5, 0.5], [1, 0, 0])!;
    expect([hit.x, hit.y, hit.z, hit.value]).toEqual([5, 0, 0, 3]);
    expect(hit.face).toBe(FACE_NEG_X);
    expect(hit.t).toBeCloseTo(4.5);
    const fromAbove = raycastVolume(v, v.getBounds()!, [5.5, 10, 0.5], [0, -1, 0])!;
    expect(fromAbove.face).toBe(FACE_POS_Y);
    const fromBelow = raycastVolume(v, v.getBounds()!, [9.5, -10, 0.5], [0, 1, 0])!;
    expect([fromBelow.x, fromBelow.face]).toEqual([9, FACE_NEG_Y]);
  });

  it('misses empty space and respects maxT', () => {
    const v = new VoxelVolume();
    v.set(5, 0, 0, 1);
    expect(raycastVolume(v, v.getBounds()!, [0.5, 1.5, 0.5], [1, 0, 0])).toBeNull();
    expect(raycastVolume(v, v.getBounds()!, [0.5, 0.5, 0.5], [1, 0, 0], 3)).toBeNull();
    expect(raycastVolume(v, v.getBounds()!, [0.5, 0.5, 0.5], [-1, 0, 0])).toBeNull();
  });

  it('crosses long stretches of empty chunks', () => {
    const v = new VoxelVolume();
    v.set(-5000, 17, 3000, 7);
    v.set(4000, -20, -300, 1);
    // Start just above the far voxel, which only stretches the bounds.
    const o = [4000.5, -18.5, -299.5];
    const target = [-5000.5, 17.5, 3000.5];
    const d = [target[0]! - o[0]!, target[1]! - o[1]!, target[2]! - o[2]!];
    const hit = raycastVolume(v, v.getBounds()!, o, d)!;
    expect([hit.x, hit.y, hit.z]).toEqual([-5000, 17, 3000]);
  });

  it('returns the voxel the ray starts in, facing the ray', () => {
    const v = new VoxelVolume();
    v.set(0, 0, 0, 2);
    const hit = raycastVolume(v, v.getBounds()!, [0.5, 0.5, 0.5], [0, 0, -1])!;
    expect([hit.x, hit.t, hit.face]).toEqual([0, 0, FACE_POS_Z]);
  });

  it('matches a fine ray march on random sparse volumes', () => {
    const random = rng(11);
    let hits = 0;
    for (let round = 0; round < 6; round++) {
      const v = new VoxelVolume();
      const filled: number[][] = [];
      for (let i = 0; i < 400; i++) {
        const p = [0, 0, 0].map(() => Math.floor(random() * 160) - 80);
        v.set(p[0]!, p[1]!, p[2]!, 1);
        filled.push(p);
      }
      const bounds = v.getBounds()!;
      for (let k = 0; k < 60; k++) {
        const o = [random() * 240 - 120, random() * 240 - 120, random() * 240 - 120];
        // Aim at a point inside a random filled voxel: every ray hits something.
        const aim = filled[Math.floor(random() * filled.length)]!;
        const d = aim.map((c, i) => c + 0.1 + random() * 0.8 - o[i]!);
        const hit = raycastVolume(v, bounds, o, d, 400);
        const ref = march(v, o, d, 400);
        if (!ref) {
          expect(hit).toBeNull();
          continue;
        }
        hits++;
        expect(hit, `round ${round} ray ${k}`).not.toBeNull();
        expect([hit!.x, hit!.y, hit!.z]).toEqual([ref.x, ref.y, ref.z]);
        // The entry face points back against the ray along its axis.
        const a = faceAxis(hit!.face);
        expect(Math.sign(d[a]!)).toBe(hit!.face & 1 ? 1 : -1);
      }
    }
    // Enough rays must actually hit something for the comparison to mean anything.
    expect(hits).toBeGreaterThan(40);
    // Slow under coverage instrumentation: thousands of rays against a fine march.
  }, 30_000);
});

describe('rayPlane', () => {
  it('intersects in front of the origin only', () => {
    expect(rayPlane([0, 10, 0], [0, -1, 0], 1, 0)).toBeCloseTo(10);
    expect(rayPlane([0, 10, 0], [0, 1, 0], 1, 0)).toBeNull();
    expect(rayPlane([0, 10, 0], [1, 0, 0], 1, 0)).toBeNull();
  });
});
