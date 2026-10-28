import { describe, expect, it } from 'vitest';
import { distance, SDF_CELL_LIMIT, smoothMin, voxelizeSdf } from './sdf';
import { SdfTool } from './sdf-tool';
import { RecordingSink, TestContext } from './test-context';

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

  it('puts a rounded box as large as the drag, never below the floor it began on', () => {
    const ctx = new TestContext();
    ctx.settings = { ...ctx.settings, sdfShape: 'box', sdfBlend: 2 };
    const tool = new SdfTool();
    tool.handle(ctx.event('down', 10, 10), ctx);
    tool.handle(ctx.event('move', 13, 10), ctx);
    expect(ctx.ghostMode).toBe('add');
    // A new blend redraws the preview during the drag.
    ctx.settings = { ...ctx.settings, sdfBlend: 0 };
    tool.settingsChanged(ctx);
    tool.handle(ctx.event('up', 13, 10), ctx);
    const b = ctx.object.volume.getBounds()!;
    expect(b.minY).toBe(0);
    expect(b.maxX - b.minX).toBeGreaterThanOrEqual(4);
    expect(ctx.doc.history.undoLabel).toBe('SDF');
  });

  it('lays a tube along the stroke as thick as the brush', () => {
    const ctx = new TestContext();
    ctx.settings = { ...ctx.settings, sdfShape: 'stroke', brushSize: 2, sdfBlend: 0 };
    const tool = new SdfTool();
    tool.handle(ctx.event('down', 0, 0), ctx);
    for (let x = 1; x <= 10; x++) tool.handle(ctx.event('move', x, 0), ctx);
    tool.handle(ctx.event('move', Number.NaN, Number.NaN), ctx);
    tool.handle(ctx.event('up', 10, 0), ctx);
    const b = ctx.object.volume.getBounds()!;
    expect(b.maxX).toBeGreaterThanOrEqual(10);
    expect(b.maxZ - b.minZ).toBeLessThanOrEqual(3);
  });

  it('carves a ball out of the model with Shift', () => {
    const ctx = new TestContext();
    for (let x = 0; x < 9; x++)
      for (let y = 0; y < 3; y++) for (let z = 0; z < 9; z++) ctx.object.volume.set(x, y, z, 2);
    const full = ctx.object.volume.voxelCount;
    const tool = new SdfTool();
    tool.handle(ctx.event('hover', 4, 4, { shift: true }), ctx);
    expect(ctx.lastHint).toContain('drag from the model');
    tool.handle(ctx.event('down', 4, 4, { shift: true }), ctx);
    tool.handle(ctx.event('move', 6, 4, { shift: true }), ctx);
    expect(ctx.ghostMode).toBe('erase');
    tool.handle(ctx.event('up', 6, 4, { shift: true }), ctx);
    expect(ctx.object.volume.voxelCount).toBeLessThan(full);
    expect(ctx.object.volume.get(4, 2, 4)).toBe(0);
    // Erasing cannot start on the floor.
    const empty = new TestContext();
    tool.handle(empty.event('down', 4, 4, { shift: true }), empty);
    tool.handle(empty.event('up', 4, 4, { shift: true }), empty);
    expect(empty.doc.history.undoDepth).toBe(0);
  });

  it('starts a new blend after another step, Escape or a cancel', () => {
    const ctx = new TestContext();
    const tool = new SdfTool();
    const drag = (x: number) => {
      tool.handle(ctx.event('down', x, 0), ctx);
      tool.handle(ctx.event('move', x + 2, 0), ctx);
      tool.handle(ctx.event('up', x + 2, 0), ctx);
    };
    drag(0);
    tool.handle(ctx.event('hover', 0, 0), ctx);
    expect(ctx.lastHint).toContain('melt into the previous');
    // Another edit lands in history: the next shape is a step of its own.
    ctx.object.volume.set(30, 0, 30, 2);
    ctx.doc.history.undo();
    drag(10);
    expect(ctx.doc.history.undoDepth).toBe(1);
    expect(tool.key('Escape', ctx)).toBe(true);
    expect(ctx.lastHint).toBe('SDF: shapes finished');
    expect(tool.key('Enter', ctx)).toBe(false);
    tool.handle(ctx.event('down', 20, 0), ctx);
    tool.handle(ctx.event('move', 22, 0), ctx);
    tool.handle(ctx.event('cancel', 22, 0), ctx);
    expect(ctx.ghostMode).toBeNull();
    tool.handle(ctx.event('up', 22, 0), ctx);
    expect(ctx.doc.history.undoDepth).toBe(1);
  });

  it('refuses a hidden object and a shape too large to make', () => {
    const ctx = new TestContext();
    const tool = new SdfTool();
    ctx.object.hidden = true;
    tool.handle(ctx.event('down', 0, 0), ctx);
    expect(ctx.lastHint).toBe('The object is locked or hidden');
    ctx.object.hidden = false;
    tool.handle(ctx.event('down', 0, 0), ctx);
    tool.handle(ctx.event('move', 400, 0), ctx);
    expect(ctx.lastHint).toBe('SDF: the shape is too large');
    tool.handle(ctx.event('up', 400, 0), ctx);
    expect(ctx.object.volume.isEmpty).toBe(true);
  });

  it('outlines the hovered face only between drags', () => {
    const ctx = new TestContext();
    const tool = new SdfTool();
    tool.handle(ctx.event('hover', 0, 0), ctx);
    const sink = new RecordingSink();
    tool.overlay(sink, ctx);
    expect(sink.calls.faceOutline).toBe(1);
    tool.handle(ctx.event('down', 0, 0), ctx);
    const dragging = new RecordingSink();
    tool.overlay(dragging, ctx);
    expect(dragging.calls.faceOutline).toBeUndefined();
    tool.deactivate(ctx);
    expect(ctx.ghostMode).toBeNull();
  });
});
