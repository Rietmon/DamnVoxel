import { describe, expect, it } from 'vitest';
import { cellsOperation } from './operation';
import { ORIENTATION_COUNT, reflection } from './orientation';
import { clipBox, isClipped, sliceClip, sliceModifier } from './slice';
import { cellToWorld } from './transform';

describe('slice', () => {
  it('hides exactly the cells past the cut, for every axis, side, orientation and offset', () => {
    const cells: [number, number, number][] = [];
    for (let x = -3; x <= 3; x++)
      for (let y = -3; y <= 3; y++) for (let z = -3; z <= 3; z++) cells.push([x, y, z]);
    for (let o = 0; o < ORIENTATION_COUNT; o++) {
      const t = { x: 4, y: -2, z: 7, orientation: o };
      for (const axis of [0, 1, 2] as const)
        for (const dir of [1, -1] as const)
          for (const at of [-4, -2, 0, 1, 6]) {
            const clip = sliceClip(t, { axis, at, dir });
            for (const c of cells) {
              const w = cellToWorld(t, ...c)[axis]!;
              expect(isClipped(clip, ...c)).toBe(dir * w > dir * at);
            }
          }
    }
  });

  it('shrinks a box to what stays visible', () => {
    const box = { minX: 0, minY: 0, minZ: 0, maxX: 9, maxY: 9, maxZ: 9 };
    const at = (a: number) => ({ axis: 1 as const, at: a, dir: 1 as const });
    const flat = sliceClip({ x: 0, y: 0, z: 0, orientation: 0 }, at(4));
    expect(clipBox(box, flat)).toEqual({ ...box, maxY: 4 });
    expect(clipBox(box, sliceClip({ x: 0, y: 0, z: 0, orientation: 0 }, at(-1)))).toBeNull();
    expect(
      clipBox(box, sliceClip({ x: 0, y: 0, z: 0, orientation: 0 }, { axis: 0, at: 3, dir: -1 })),
    ).toEqual({ ...box, minX: 3 });
    // Upside down: world height falls as local y grows, so the cut trims the low end.
    const flipped = sliceClip({ x: 0, y: 0, z: 0, orientation: reflection(1) }, at(-5));
    expect(flipped.sign).toBe(-1);
    expect(clipBox(box, flipped)).toEqual({ ...box, minY: 4 });
  });

  it('keeps tools away from the hidden part', () => {
    const op = cellsOperation('add', 3, [0, 0, 0, 0, 5, 0, 0, 9, 0]);
    const cut = sliceModifier(
      sliceClip({ x: 0, y: 0, z: 0, orientation: 0 }, { axis: 1, at: 5, dir: 1 }),
    )(op);
    const seen: number[] = [];
    cut.forEachCell((_x, y) => {
      seen.push(y);
    });
    expect(seen).toEqual([0, 5]);
    expect(sliceModifier(null)(op)).toBe(op);
  });
});
