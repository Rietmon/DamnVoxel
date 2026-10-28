import { describe, expect, it } from 'vitest';
import { DEFAULT_MIRROR } from '../core/mirror';
import { mirrorPlanes } from './mirror-handles';

describe('mirrorPlanes', () => {
  it('has one plane per enabled axis, at center2 / 2, around the bounds', () => {
    expect(mirrorPlanes(DEFAULT_MIRROR, null)).toEqual([]);
    const bounds = { minX: -4, minY: 0, minZ: -2, maxX: 4, maxY: 9, maxZ: 2 };
    const planes = mirrorPlanes({ x: true, y: false, z: true, center2: [1, 0, 3] }, bounds);
    expect(planes.map((p) => p.axis)).toEqual([0, 2]);
    const [px, pz] = planes;
    expect(px!.corners.every((c) => c[0] === 0.5)).toBe(true);
    expect(pz!.corners.every((c) => c[2] === 1.5)).toBe(true);
    // The handle sits on the plane, on its top edge above the model.
    expect(px!.centre[0]).toBe(0.5);
    expect(px!.centre[1]).toBe(13);
    expect(pz!.centre[1]).toBe(13);
  });
});
