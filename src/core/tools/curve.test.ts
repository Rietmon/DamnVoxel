import { describe, expect, it } from 'vitest';
import { bezierPoints, curveCells, simplify, splinePoints } from './curve';
import { CurveTool } from './curve-tool';
import { TestContext } from './test-context';

describe('curves', () => {
  it('bows a Bézier arc half way to its control point', () => {
    const pts = bezierPoints([0, 0, 0], [5, 10, 0], [10, 0, 0]);
    const top = Math.max(...pts.map((p) => p[1]));
    expect(top).toBeCloseTo(5);
    expect(pts[0]).toEqual([0, 0, 0]);
    expect(pts.at(-1)).toEqual([10, 0, 0]);
  });

  it('simplifies a wobbly line and keeps a real corner', () => {
    const wobbly = Array.from(
      { length: 11 },
      (_, i) => [i, i % 2 ? 0.2 : 0, 0] as [number, number, number],
    );
    expect(simplify(wobbly, 0.5)).toHaveLength(2);
    const corner: [number, number, number][] = [
      [0, 0, 0],
      [5, 0, 0],
      [5, 5, 0],
    ];
    expect(simplify(corner, 0.5)).toHaveLength(3);
  });

  it('runs a spline through every point', () => {
    const pts = splinePoints([
      [0, 0, 0],
      [4, 4, 0],
      [8, 0, 0],
    ]);
    expect(pts.some((p) => Math.abs(p[0] - 4) < 1e-9 && Math.abs(p[1] - 4) < 1e-9)).toBe(true);
    expect(pts.at(-1)).toEqual([8, 0, 0]);
  });

  it('makes a gapless line of cells, and a tube for thickness', () => {
    const line = curveCells(bezierPoints([0.5, 0.5, 0.5], [5.5, 0.5, 0.5], [10.5, 0.5, 0.5]), 1);
    expect(line.length / 3).toBe(11);
    const tube = curveCells(bezierPoints([0.5, 0.5, 0.5], [5.5, 0.5, 0.5], [10.5, 0.5, 0.5]), 3);
    expect(tube.length / 3).toBeGreaterThan(11 * 5);
  });
});

describe('CurveTool', () => {
  it('lays an arc on release and lets the bend change afterwards', () => {
    const ctx = new TestContext();
    const tool = new CurveTool();
    tool.handle(ctx.event('down', 0, 0), ctx);
    tool.handle(ctx.event('move', 12, 0), ctx);
    tool.handle(ctx.event('up', 12, 0), ctx);
    expect(ctx.doc.history.undoLabel).toBe('Arc');
    const top = () => ctx.object.volume.getBounds()!.maxY;
    const raised = top();
    expect(raised).toBeGreaterThan(0);
    ctx.adjust({ ...ctx.adjustment!.values, bend: 0 });
    expect(top()).toBe(0);
    expect(ctx.doc.history.undoDepth).toBe(1);
  });
});
