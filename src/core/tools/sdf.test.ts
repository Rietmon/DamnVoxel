import { describe, expect, it } from 'vitest';
import { distance, SDF_CELL_LIMIT, smoothMin, voxelizeSdf } from './sdf';
import { SdfTool } from './sdf-tool';
import { TestContext } from './test-context';

describe('sdf', () => {
  it('measures distances to a ball, a rounded box and a tube', () => {
    expect(distance([3, 0, 0], { kind: 'sphere', c: [0, 0, 0], r: 2 })).toBeCloseTo(1);
    expect(distance([0, 0, 0], { kind: 'box', c: [0, 0, 0], h: [2, 2, 2], round: 0 })).toBeCloseTo(
      -2,
    );
    expect(distance([4, 0, 0], { kind: 'box', c: [0, 0, 0], h: [2, 2, 2], round: 0 })).toBeCloseTo(
      2,
    );
    expect(distance([5, 3, 0], { kind: 'capsule', a: [0, 0, 0], b: [10, 0, 0], r: 1 })).toBeCloseTo(
      2,
    );
  });

  it('melts shapes together with the smooth minimum', () => {
    expect(smoothMin(1, 5, 0)).toBe(1);
    expect(smoothMin(1, 1, 4)).toBeLessThan(1);
    expect(smoothMin(1, 9, 4)).toBe(1);
  });

  it('voxelizes a ball, and a blend fills the neck between two balls', () => {
    const ball = voxelizeSdf([{ kind: 'sphere', c: [0, 0, 0], r: 3 }], 0)!;
    // A ball of radius 3 holds about 4/3·π·27 ≈ 113 cells.
    expect(ball.length / 3).toBeGreaterThan(90);
    expect(ball.length / 3).toBeLessThan(140);
    const two = (k: number) =>
      voxelizeSdf(
        [
          { kind: 'sphere', c: [0, 0, 0], r: 3 },
          { kind: 'sphere', c: [7, 0, 0], r: 3 },
        ],
        k,
      )!.length / 3;
    expect(two(6)).toBeGreaterThan(two(0));
    expect(
      voxelizeSdf([{ kind: 'sphere', c: [0, 0, 0], r: Math.cbrt(SDF_CELL_LIMIT) }], 0),
    ).toBeNull();
  });
});

describe('SdfTool', () => {
  it('blends shapes made one after another into one step, until Enter', () => {
    const ctx = new TestContext();
    const tool = new SdfTool();
    ctx.settings = { ...ctx.settings, sdfShape: 'sphere', sdfBlend: 4 };
    const drag = (x: number, len: number) => {
      tool.handle(ctx.event('down', x, 0), ctx);
      tool.handle(ctx.event('move', x + len, 0), ctx);
      tool.handle(ctx.event('up', x + len, 0), ctx);
    };
    drag(0, 3);
    const one = ctx.object.volume.voxelCount;
    expect(one).toBeGreaterThan(0);
    drag(6, 3);
    expect(ctx.doc.history.undoDepth).toBe(1);
    expect(ctx.object.volume.voxelCount).toBeGreaterThan(one);
    tool.key('Enter', ctx);
    drag(20, 2);
    expect(ctx.doc.history.undoDepth).toBe(2);
  });
});
