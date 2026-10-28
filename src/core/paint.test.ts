import { describe, expect, it } from 'vitest';
import { packRgba } from './color';
import { cellsOperation, type Operation } from './operation';
import {
  colorLockModifier,
  hash01,
  patternModifier,
  patternValue,
  rampAround,
  shadeColor,
  shadeModifier,
} from './paint';
import { Palette } from './palette';
import { VoxelVolume } from './volume';

/** A grey ramp 1…5 from dark to light, then a red and a blue. */
function palette(): Palette {
  // Only these colours, so the nearest match is one of them.
  const base = Palette.createDefault().entry(1);
  const p = new Palette(Array.from({ length: 7 }, () => base));
  const greys = [40, 80, 120, 160, 200];
  for (const [i, g] of greys.entries())
    p.setEntry(i + 1, { ...p.entry(i + 1), color: packRgba(g, g, g) });
  p.setEntry(6, { ...p.entry(6), color: packRgba(200, 40, 30) });
  p.setEntry(7, { ...p.entry(7), color: packRgba(30, 60, 200) });
  return p;
}

function cells(op: Operation): number[][] {
  const out: number[][] = [];
  op.forEachCell((x, y, z, c) => {
    out.push([x, y, z, c]);
  });
  return out;
}

describe('colour lock', () => {
  it('lets paint and erase touch only voxels of the locked colours', () => {
    const v = new VoxelVolume();
    v.set(0, 0, 0, 2);
    v.set(1, 0, 0, 3);
    const op = cellsOperation('paint', 9, [0, 0, 0, 1, 0, 0, 2, 0, 0]);
    expect(cells(colorLockModifier(v, new Set([2]))(op))).toEqual([[0, 0, 0, 9]]);
    const add = cellsOperation('add', 9, [5, 0, 0]);
    expect(colorLockModifier(v, new Set([2]))(add)).toBe(add);
    expect(colorLockModifier(v, null)(op)).toBe(op);
  });
});

describe('shades', () => {
  it('steps along a ramp in the palette', () => {
    const p = palette();
    expect(shadeColor(p, 3, 'lighter', 'palette')).toBe(4);
    expect(shadeColor(p, 3, 'darker', 'palette')).toBe(2);
    expect(shadeColor(p, 1, 'darker', 'palette')).toBe(1);
  });

  it('finds the nearest lighter colour by HSL', () => {
    const p = palette();
    expect(shadeColor(p, 2, 'lighter', 'hsl')).toBe(3);
    expect(shadeColor(p, 4, 'darker', 'hsl')).toBe(3);
  });

  it('paints each voxel one step from its own colour', () => {
    const p = palette();
    const v = new VoxelVolume();
    v.set(0, 0, 0, 2);
    v.set(1, 0, 0, 4);
    const op = cellsOperation('paint', 9, [0, 0, 0, 1, 0, 0, 2, 0, 0]);
    expect(cells(shadeModifier(v, p, 'lighter', 'palette')(op))).toEqual([
      [0, 0, 0, 3],
      [1, 0, 0, 5],
    ]);
  });
});

describe('patterns', () => {
  const ramp = [11, 12, 13, 14];
  const opts = { colors: ramp, scale: 4, axis: 1 as const, from: 0, to: 9 };

  it('grades along an axis between the model’s ends', () => {
    expect(patternValue({ ...opts, pattern: 'gradient' }, 0, 0, 0)).toBe(0);
    expect(patternValue({ ...opts, pattern: 'gradient' }, 0, 9, 0)).toBe(1);
    const op = patternModifier({ ...opts, pattern: 'gradient' })(
      cellsOperation('add', 1, [0, 0, 0, 0, 9, 0]),
    );
    expect(cells(op).map((c) => c[3])).toEqual([11, 14]);
  });

  it('gives noise in range and the same value for the same cell', () => {
    for (const pattern of ['random', 'perlin', 'worley', 'voronoi', 'splatter'] as const) {
      for (let i = 0; i < 50; i++) {
        const t = patternValue({ ...opts, pattern }, i, i * 3, -i)!;
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThanOrEqual(1);
        expect(patternValue({ ...opts, pattern }, i, i * 3, -i)).toBe(t);
      }
    }
    expect(hash01(1, 2, 3)).not.toBe(hash01(3, 2, 1));
  });

  it('leaves erasing alone and solid colour untouched', () => {
    const erase = cellsOperation('erase', 0, [0, 0, 0]);
    expect(patternModifier({ ...opts, pattern: 'random' })(erase)).toBe(erase);
    const add = cellsOperation('add', 5, [0, 0, 0]);
    expect(patternModifier({ ...opts, pattern: 'solid' })(add)).toBe(add);
  });

  it('builds a ramp from the palette neighbours', () => {
    expect(rampAround(palette(), 3)).toEqual([1, 2, 3, 4, 5]);
    expect(rampAround(palette(), 1, 1)).toEqual([1, 2]);
  });
});
