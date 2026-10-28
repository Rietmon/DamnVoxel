import { describe, expect, it } from 'vitest';
import { type Reference, referenceCorners } from './references';

const ref = (facing: Reference['facing']): Reference => ({
  id: 1,
  name: 'r',
  image: { width: 200, height: 100 } as ImageBitmap,
  thumb: '',
  mode: 'plane',
  opacity: 0.5,
  visible: true,
  locked: false,
  facing,
  center: [10, 5, 0],
  size: 20,
});

describe('reference planes', () => {
  it('spans the size across and keeps the picture’s proportions', () => {
    const [tl, tr, br, bl] = referenceCorners(ref('front'));
    expect(tl).toEqual([0, 10, 0]);
    expect(tr).toEqual([20, 10, 0]);
    expect(br).toEqual([20, 0, 0]);
    expect(bl).toEqual([0, 0, 0]);
  });

  it('faces the side and the top views the right way round', () => {
    const side = referenceCorners(ref('side'));
    // From +X looking back, the picture's right runs towards −Z.
    expect(side[1][2]).toBeLessThan(side[0][2]);
    expect(side[0][1]).toBeGreaterThan(side[3][1]);
    const top = referenceCorners(ref('top'));
    expect(top.every((c) => c[1] === 5)).toBe(true);
    // Seen from above with the front below, the picture's top is towards −Z.
    expect(top[0][2]).toBeLessThan(top[3][2]);
  });
});
