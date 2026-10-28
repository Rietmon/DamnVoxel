import { describe, expect, it } from 'vitest';
import {
  formatOf,
  packRgba,
  parseAct,
  parseGpl,
  parseHex,
  parsePal,
  writeAct,
  writeGpl,
  writeHex,
  writePal,
} from './palette-formats';

const P = {
  name: 'Test',
  colors: [packRgba(255, 0, 77), packRgba(0, 135, 81), packRgba(29, 43, 83)],
};

describe('palette files', () => {
  it('round-trips every format', () => {
    expect(parseGpl(writeGpl(P))).toEqual(P);
    expect(parseHex(writeHex(P), P.name)).toEqual(P);
    expect(parsePal(writePal(P), P.name)).toEqual(P);
    expect(parseAct(writeAct(P), P.name)).toEqual(P);
  });

  it('reads what other programs write', () => {
    const gpl = 'GIMP Palette\nName: PICO\nColumns: 4\n#\n  0   0   0\tblack\n255 241 232 white\n';
    expect(parseGpl(gpl).colors).toEqual([packRgba(0, 0, 0), packRgba(255, 241, 232)]);
    expect(parseHex('#FF004D\nffa300\n\n').colors).toHaveLength(2);
    // An ACT without a count holds 256 colours.
    expect(parseAct(new Uint8Array(768)).colors).toHaveLength(256);
  });

  it('refuses files of another kind', () => {
    expect(() => parseGpl('hello')).toThrow();
    expect(() => parseHex('not a colour')).toThrow();
    expect(() => parsePal('PAL')).toThrow();
    expect(() => parseAct(new Uint8Array(10))).toThrow();
  });

  it('tells formats by extension', () => {
    expect(formatOf('sweetie-16.GPL')).toBe('gpl');
    expect(formatOf('pico-8.hex')).toBe('hex');
    expect(formatOf('lospec.txt')).toBe('hex');
    expect(formatOf('model.vox')).toBe('vox');
    expect(formatOf('image.jpg')).toBeNull();
  });
});
