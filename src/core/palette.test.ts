import { describe, expect, it } from 'vitest';
import { blue, fromHex, green, packRgba, red, toHex } from './color';
import { MAGICAVOXEL_DEFAULT_PALETTE } from './default-palette';
import { Palette } from './palette';

describe('colours', () => {
  it('packs RGBA with red in the low byte, like .vox 0xAABBGGRR', () => {
    const c = packRgba(0x11, 0x22, 0x33, 0x44);
    expect(c).toBe(0x44332211);
    expect([red(c), green(c), blue(c)]).toEqual([0x11, 0x22, 0x33]);
  });

  it('converts hex both ways', () => {
    expect(toHex(packRgba(255, 128, 0))).toBe('#ff8000');
    expect(fromHex('#FF8000')).toBe(packRgba(255, 128, 0));
    expect(fromHex('f80')).toBe(packRgba(255, 136, 0));
    expect(fromHex('#12345')).toBeNull();
    expect(fromHex('zzzzzz')).toBeNull();
  });
});

describe('Palette', () => {
  it('builds the MagicaVoxel default palette with ids 1…255', () => {
    const p = Palette.createDefault();
    expect(p.size).toBe(255);
    expect(p.color(1)).toBe(0xffffffff);
    expect(p.color(255)).toBe(MAGICAVOXEL_DEFAULT_PALETTE[255]);
    expect(toHex(p.color(255))).toBe('#111111');
    // 0xff0000ee is a red: R = 0xee sits in the low byte.
    expect(toHex(p.color(MAGICAVOXEL_DEFAULT_PALETTE.indexOf(0xff0000ee)))).toBe('#ee0000');
    expect(p.displayOrder()).toEqual(Array.from({ length: 255 }, (_, i) => i + 1));
    expect(p.has(0)).toBe(false);
    expect(p.has(256)).toBe(false);
  });

  it('keeps display order separate from ids', () => {
    const p = Palette.createDefault();
    p.setDisplayOrder([...p.displayOrder()].reverse());
    expect(p.displayOrder()[0]).toBe(255);
    expect(p.color(1)).toBe(0xffffffff);
    expect(() => p.setDisplayOrder([1, 1])).toThrow();
  });

  it('replaces entries and keeps unknown material keys', () => {
    const p = Palette.createDefault();
    const material = new Map([
      ['_type', '_metal'],
      ['_future_key', '42'],
    ]);
    p.setEntry(3, { color: packRgba(1, 2, 3), material, name: 'steel' });
    expect(p.entry(3).material.get('_future_key')).toBe('42');
    expect(p.entry(3).name).toBe('steel');
    expect(() => p.entry(0)).toThrow();
  });

  it('adds and removes entries beyond 255', () => {
    const p = Palette.createDefault();
    const id = p.add({ color: packRgba(9, 9, 9), material: new Map(), name: '' });
    expect(id).toBe(256);
    expect(p.displayOrder().at(-1)).toBe(256);
    p.removeLast();
    expect(p.size).toBe(255);
    expect(p.displayOrder()).not.toContain(256);
  });

  it('clones independently', () => {
    const a = Palette.createDefault();
    const b = a.clone();
    b.setEntry(1, { color: 0, material: new Map(), name: 'renamed' });
    expect(a.entry(1).name).toBe('');
  });

  it('rejects invalid construction and unknown ids', () => {
    expect(() => new Palette([{ color: 0, material: new Map(), name: '' }], [2])).toThrow();
    const p = Palette.createDefault();
    expect(() => p.setEntry(0, p.entry(1))).toThrow();
    expect(p.color(9999)).toBe(0);
    const empty = new Palette([]);
    empty.removeLast();
    expect(empty.size).toBe(0);
  });
});
