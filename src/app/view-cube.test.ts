import { describe, expect, it } from 'vitest';
import { anglesFor, cameraBasis, cubeRegions, ISOMETRIC, regionAt, sameDir } from './view-cube';

describe('view cube', () => {
  it('shows three faces and all 26 directions are reachable from some view', () => {
    const seen = new Set<string>();
    for (const yaw of [0.3, 2, 3.5, 5])
      for (const pitch of [-0.5, 0.4, 1.2]) {
        const regions = cubeRegions(yaw, pitch, 100);
        expect(new Set(regions.map((r) => r.face)).size).toBe(3);
        for (const r of regions) seen.add(r.dir.join());
      }
    expect(seen.size).toBe(26);
  });

  it('hits the front face centre in the middle of a front view', () => {
    const regions = cubeRegions(0, 0, 100);
    const r = regionAt(regions, 50, 50)!;
    expect(sameDir(r.dir, [0, 0, 1])).toBe(true);
    // Near the top edge of the front face: the front-top edge direction.
    const edge = regionAt(regions, 50, 50 - 100 * 0.3 * 0.8)!;
    expect(sameDir(edge.dir, [0, 1, 1])).toBe(true);
    expect(regionAt(regions, 2, 2)).toBeNull();
  });

  it('turns a direction into angles that look along it', () => {
    for (const dir of [
      [1, 0, 0],
      [0, 0, -1],
      [1, 1, 1],
      [-1, -1, 0],
    ] as [number, number, number][]) {
      const { yaw, pitch } = anglesFor(dir, 0);
      const back = cameraBasis(yaw, pitch)[2];
      const len = Math.hypot(...dir);
      for (let i = 0; i < 3; i++) expect(back[i]).toBeCloseTo(dir[i]! / len);
    }
    // Top view keeps the yaw snapped to a quarter turn.
    expect(anglesFor([0, 1, 0], 1.4).yaw).toBeCloseTo(Math.PI / 2);
    expect(anglesFor([0, 1, 0], 1.4).pitch).toBeCloseTo(Math.PI / 2);
  });

  it('defines true isometric angles', () => {
    const back = cameraBasis(ISOMETRIC.yaw, ISOMETRIC.pitch)[2];
    expect(back[0]).toBeCloseTo(back[1]);
    expect(back[1]).toBeCloseTo(back[2]);
  });
});
