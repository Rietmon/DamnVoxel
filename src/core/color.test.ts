import { describe, expect, it } from 'vitest';
import { alpha, blue, fromHex, green, hsvToRgb, packRgba, red, rgbToHsv, toHex } from './color';

describe('colour', () => {
  it('packs RGBA and reads it back', () => {
    const c = packRgba(1, 2, 3, 4);
    expect([red(c), green(c), blue(c), alpha(c)]).toEqual([1, 2, 3, 4]);
  });

  it('writes and parses hex', () => {
    expect(toHex(packRgba(255, 128, 0))).toBe('#ff8000');
    expect(fromHex('#ff8000')).toBe(packRgba(255, 128, 0));
    expect(fromHex('f80')).toBe(packRgba(255, 136, 0));
    expect(fromHex('#12345')).toBeNull();
    expect(fromHex('zzz')).toBeNull();
  });

  it('converts HSV both ways for every corner and back for many colours', () => {
    expect(rgbToHsv(255, 0, 0)).toEqual({ h: 0, s: 1, v: 1 });
    expect(rgbToHsv(0, 255, 0).h).toBe(120);
    expect(rgbToHsv(0, 0, 255).h).toBe(240);
    expect(rgbToHsv(0, 0, 0)).toEqual({ h: 0, s: 0, v: 0 });
    expect(hsvToRgb({ h: 300, s: 1, v: 1 })).toEqual([255, 0, 255]);
    expect(hsvToRgb({ h: 360, s: 1, v: 1 })).toEqual([255, 0, 0]);
    for (let r = 0; r < 256; r += 17) {
      for (let g = 0; g < 256; g += 51) {
        for (let b = 0; b < 256; b += 85) {
          expect(hsvToRgb(rgbToHsv(r, g, b))).toEqual([r, g, b]);
        }
      }
    }
  });
});
