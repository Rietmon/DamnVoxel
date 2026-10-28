import { describe, expect, it } from 'vitest';
import { bezierPoints, curveCells, simplify, splinePoints } from './curve';
import { CurveTool } from './curve-tool';
import { RecordingSink, TestContext } from './test-context';

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

  it('smooths a drawn stroke into a spline whose smoothing can change', () => {
    const ctx = new TestContext();
    ctx.settings = { ...ctx.settings, curveMode: 'stroke' };
    const tool = new CurveTool();
    tool.handle(ctx.event('hover', 0, 0), ctx);
    expect(ctx.lastHint).toContain('Spline');
    tool.handle(ctx.event('down', 0, 0), ctx);
    for (let x = 1; x <= 8; x++) tool.handle(ctx.event('move', x, x % 2), ctx);
    // The same cell again adds nothing.
    tool.handle(ctx.event('move', 8, 0), ctx);
    expect(ctx.ghost.voxelCount).toBeGreaterThan(0);
    tool.handle(ctx.event('up', 8, 0), ctx);
    expect(ctx.doc.history.undoLabel).toBe('Spline');
    expect(ctx.adjustment!.fields.map((f) => f.key)).toContain('smooth');
    const smooth = ctx.object.volume.voxelCount;
    ctx.adjust({ ...ctx.adjustment!.values, thickness: 3 });
    expect(ctx.object.volume.voxelCount).toBeGreaterThan(smooth);
  });

  it('erases along an arc over the model with Shift', () => {
    const ctx = new TestContext();
    for (let x = 0; x <= 10; x++) ctx.object.volume.set(x, 0, 0, 2);
    const tool = new CurveTool();
    tool.handle(ctx.event('down', 0, 0, { shift: true }), ctx);
    tool.handle(ctx.event('move', 10, 0, { shift: true }), ctx);
    tool.handle(ctx.event('up', 10, 0, { shift: true }), ctx);
    expect(ctx.object.volume.get(0, 0, 0)).toBe(0);
    expect(ctx.object.volume.get(10, 0, 0)).toBe(0);
    // An erase cannot start in the air.
    const empty = new TestContext();
    tool.handle(empty.event('down', 0, 0, { shift: true }), empty);
    tool.handle(empty.event('up', 0, 0, { shift: true }), empty);
    expect(empty.doc.history.undoDepth).toBe(0);
  });

  it('drops the curve with Escape, a cancel or a click without a drag', () => {
    const ctx = new TestContext();
    const tool = new CurveTool();
    expect(tool.key('Escape', ctx)).toBe(false);
    tool.handle(ctx.event('down', 0, 0), ctx);
    tool.handle(ctx.event('move', 6, 0), ctx);
    expect(tool.key('Escape', ctx)).toBe(true);
    expect(ctx.ghostMode).toBeNull();
    tool.handle(ctx.event('up', 6, 0), ctx);
    tool.handle(ctx.event('down', 0, 0), ctx);
    tool.handle(ctx.event('move', 6, 0), ctx);
    tool.handle(ctx.event('cancel', 6, 0), ctx);
    tool.handle(ctx.event('up', 6, 0), ctx);
    tool.handle(ctx.event('down', 3, 3), ctx);
    tool.handle(ctx.event('up', 3, 3), ctx);
    expect(ctx.doc.history.undoDepth).toBe(0);
  });

  it('refuses a locked object and outlines the hovered face', () => {
    const ctx = new TestContext();
    ctx.object.locked = true;
    const tool = new CurveTool();
    // A move without a press is a hover.
    tool.handle(ctx.event('move', 0, 0), ctx);
    expect(ctx.lastHint).toContain('Arc');
    const sink = new RecordingSink();
    tool.overlay(sink, ctx);
    expect(sink.calls.faceOutline).toBe(1);
    tool.handle(ctx.event('down', 0, 0), ctx);
    tool.handle(ctx.event('move', 6, 0), ctx);
    tool.handle(ctx.event('move', Number.NaN, Number.NaN), ctx);
    tool.handle(ctx.event('up', 6, 0), ctx);
    expect(ctx.lastHint).toBe('The object is locked or hidden');
    expect(ctx.object.volume.isEmpty).toBe(true);
    tool.handle(ctx.event('hover', 0, 0), ctx);
    tool.deactivate(ctx);
    const after = new RecordingSink();
    tool.overlay(after, ctx);
    expect(after.calls.faceOutline).toBeUndefined();
  });
});
