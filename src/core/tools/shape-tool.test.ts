import { describe, expect, it } from 'vitest';
import { ShapeTool } from './shape-tool';
import { RecordingSink, TestContext } from './test-context';

/** 20 pixels per voxel: pixel (20k + 10) is the middle of column k. */
function setup(kind: ConstructorParameters<typeof ShapeTool>[0]) {
  const ctx = new TestContext();
  ctx.pixelsPerVoxel = 20;
  return { ctx, tool: new ShapeTool(kind) };
}

const px = (cell: number) => cell * 20 + 10;

function lay(tool: ShapeTool, ctx: TestContext, from: [number, number], to: [number, number]) {
  tool.handle(ctx.event('down', px(from[0]), px(from[1])), ctx);
  tool.handle(ctx.event('move', px(to[0]), px(to[1])), ctx);
  tool.handle(ctx.event('up', px(to[0]), px(to[1])), ctx);
}

describe('ShapeTool', () => {
  it('previews while dragging and applies on release, leaving no preview behind', () => {
    const { ctx, tool } = setup('box');
    tool.handle(ctx.event('down', px(0), px(0)), ctx);
    tool.handle(ctx.event('move', px(3), px(2)), ctx);
    // Still dragging: only a preview.
    expect(ctx.object.volume.isEmpty).toBe(true);
    expect(ctx.ghost.voxelCount).toBe(12);
    tool.handle(ctx.event('up', px(3), px(2)), ctx);
    expect(ctx.object.volume.voxelCount).toBe(12);
    expect(ctx.ghost.isEmpty).toBe(true);
    expect(ctx.ghostMode).toBeNull();
    expect(ctx.object.volume.getBounds()).toEqual({
      minX: 0,
      minY: 0,
      minZ: 0,
      maxX: 3,
      maxY: 0,
      maxZ: 2,
    });
    expect(ctx.doc.history.undoLabel).toBe('Box');
    // Nothing waits for Enter.
    expect(tool.key('Enter', ctx)).toBe(false);
    expect(ctx.doc.history.undoDepth).toBe(1);
  });

  it('pulls the height of a box with Ctrl during the same drag', () => {
    const { ctx, tool } = setup('box');
    tool.handle(ctx.event('down', px(0), px(0)), ctx);
    tool.handle(ctx.event('move', px(3), px(3)), ctx);
    // One voxel up is 20 px up the screen in the test projection.
    tool.handle(ctx.event('move', px(3), px(3) - 40, { ctrl: true }), ctx);
    expect(ctx.lastHint).toContain('4 × 3 × 4');
    tool.handle(ctx.event('up', px(3), px(3) - 40, { ctrl: true }), ctx);
    expect(ctx.object.volume.voxelCount).toBe(4 * 4 * 3);
  });

  it('starts spheres and cylinders as tall as their base unless Ctrl set the height', () => {
    const sphere = setup('sphere');
    lay(sphere.tool, sphere.ctx, [0, 0], [6, 6]);
    const b = sphere.ctx.object.volume.getBounds()!;
    expect([b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ]).toEqual([6, 6, 6]);
    const cylinder = setup('cylinder');
    lay(cylinder.tool, cylinder.ctx, [0, 0], [3, 3]);
    expect(cylinder.ctx.object.volume.getBounds()!.maxY).toBe(3);
    const flat = setup('cylinder');
    flat.tool.handle(flat.ctx.event('down', px(0), px(0)), flat.ctx);
    flat.tool.handle(flat.ctx.event('move', px(3), px(3)), flat.ctx);
    flat.tool.handle(flat.ctx.event('move', px(3), px(3) - 60, { ctrl: true }), flat.ctx);
    flat.tool.handle(flat.ctx.event('move', px(3), px(3) + 200, { ctrl: true }), flat.ctx);
    flat.tool.handle(flat.ctx.event('up', px(3), px(3) + 200, { ctrl: true }), flat.ctx);
    expect(flat.ctx.object.volume.getBounds()!.maxY).toBe(0);
  });

  it('drops the shape with Escape during the drag', () => {
    const { ctx, tool } = setup('ellipse');
    tool.handle(ctx.event('down', px(0), px(0)), ctx);
    tool.handle(ctx.event('move', px(4), px(4)), ctx);
    expect(tool.key('Escape', ctx)).toBe(true);
    expect(ctx.ghost.isEmpty).toBe(true);
    tool.handle(ctx.event('up', px(4), px(4)), ctx);
    expect(ctx.doc.history.undoDepth).toBe(0);
    expect(tool.key('Escape', ctx)).toBe(false);
    lay(tool, ctx, [0, 0], [4, 4]);
    lay(tool, ctx, [10, 10], [12, 12]);
    expect(ctx.doc.history.undoDepth).toBe(2);
  });

  it('erases a box into the model', () => {
    const { ctx, tool } = setup('box');
    for (let x = 0; x < 6; x++)
      for (let y = -3; y <= 0; y++) for (let z = 0; z < 6; z++) ctx.object.volume.set(x, y, z, 2);
    ctx.settings = { ...ctx.settings, action: 'erase' };
    lay(tool, ctx, [1, 1], [2, 2]);
    expect(ctx.object.volume.get(1, 0, 1)).toBe(0);
    expect(ctx.object.volume.get(2, 0, 2)).toBe(0);
    expect(ctx.object.volume.get(1, -1, 1)).toBe(2);
    expect(ctx.object.volume.voxelCount).toBe(6 * 6 * 4 - 4);
  });

  it('draws a line between two surface points, thick with the brush size', () => {
    const { ctx, tool } = setup('line');
    lay(tool, ctx, [0, 0], [7, 3]);
    expect(ctx.object.volume.voxelCount).toBe(7 + 3 + 1);
    expect(ctx.object.volume.get(0, 0, 0)).toBe(5);
    expect(ctx.object.volume.get(7, 0, 3)).toBe(5);
    const thick = setup('line');
    thick.ctx.settings = { ...thick.ctx.settings, brushSize: 3, brushShape: 'cube' };
    lay(thick.tool, thick.ctx, [0, 0], [6, 0]);
    expect(thick.ctx.object.volume.voxelCount).toBeGreaterThan(7);
    expect(thick.ctx.object.volume.get(3, 0, 1)).toBe(5);
  });

  it('lays a base out symmetrically with Alt (odd) and Alt+Ctrl (even)', () => {
    const { ctx, tool } = setup('rect');
    tool.handle(ctx.event('down', px(5), px(5)), ctx);
    tool.handle(ctx.event('move', px(7), px(6), { alt: true }), ctx);
    tool.handle(ctx.event('up', px(7), px(6), { alt: true }), ctx);
    expect(ctx.object.volume.getBounds()).toEqual({
      minX: 3,
      minY: 0,
      minZ: 4,
      maxX: 7,
      maxY: 0,
      maxZ: 6,
    });
    ctx.doc.history.undo();
    tool.handle(ctx.event('down', px(5), px(5)), ctx);
    tool.handle(ctx.event('move', px(7), px(6), { alt: true, ctrl: true }), ctx);
    tool.handle(ctx.event('up', px(7), px(6), { alt: true, ctrl: true }), ctx);
    expect(ctx.object.volume.getBounds()).toEqual({
      minX: 2,
      minY: 0,
      minZ: 3,
      maxX: 7,
      maxY: 0,
      maxZ: 6,
    });
  });

  it('hints and outlines before a shape and draws its frame while dragging', () => {
    const { ctx, tool } = setup('box');
    tool.handle(ctx.event('hover', px(1), px(1)), ctx);
    expect(ctx.lastHint).toContain('with Ctrl — height');
    const before = new RecordingSink();
    tool.overlay(before, ctx);
    expect(before.calls.faceOutline).toBe(1);
    tool.handle(ctx.event('hover', Number.NaN, 0), ctx);
    expect(ctx.lastHint).toBeNull();
    tool.handle(ctx.event('down', px(0), px(0)), ctx);
    tool.handle(ctx.event('move', px(2), px(2)), ctx);
    // A hover while dragging (another pointer) changes nothing.
    tool.handle(ctx.event('hover', px(9), px(9)), ctx);
    expect(ctx.lastHint).toContain('Esc');
    const sink = new RecordingSink();
    tool.overlay(sink, ctx);
    expect(sink.calls.cellBox).toBe(1);
    expect(tool.key('KeyA', ctx)).toBe(false);
    const rect = setup('rect');
    rect.tool.handle(rect.ctx.event('hover', px(1), px(1)), rect.ctx);
    expect(rect.ctx.lastHint).toContain('drag to draw');
  });

  it('drops a shape in progress when put away or cancelled', () => {
    const { ctx, tool } = setup('rect');
    tool.handle(ctx.event('down', px(5), px(5)), ctx);
    tool.handle(ctx.event('move', px(6), px(6)), ctx);
    tool.deactivate(ctx);
    expect(ctx.object.volume.isEmpty).toBe(true);
    expect(ctx.ghostMode).toBeNull();
    tool.handle(ctx.event('down', px(5), px(5)), ctx);
    tool.handle(ctx.event('cancel', px(5), px(5)), ctx);
    expect(ctx.ghostMode).toBeNull();
    tool.handle(ctx.event('up', px(5), px(5)), ctx);
    expect(ctx.object.volume.isEmpty).toBe(true);
  });

  it('follows the settings while dragging and ignores locked objects', () => {
    const { ctx, tool } = setup('box');
    tool.handle(ctx.event('down', px(0), px(0)), ctx);
    tool.handle(ctx.event('move', px(1), px(1)), ctx);
    ctx.settings = { ...ctx.settings, color: 9 };
    tool.settingsChanged(ctx);
    tool.handle(ctx.event('up', px(1), px(1)), ctx);
    expect(ctx.object.volume.get(0, 0, 0)).toBe(9);
    tool.settingsChanged(ctx);
    ctx.object.locked = true;
    lay(tool, ctx, [4, 4], [5, 5]);
    expect(ctx.ghostMode).toBeNull();
    expect(ctx.doc.history.undoDepth).toBe(1);
    // A move without a press is a hover.
    tool.handle(ctx.event('move', px(1), px(1)), ctx);
    expect(ctx.lastHint).toContain('drag');
  });

  it('offers the box corner, size and colour to redo it with', () => {
    const { ctx, tool } = setup('box');
    lay(tool, ctx, [0, 0], [3, 2]);
    const a = ctx.adjustment!;
    expect(a.title).toBe('Box');
    expect(a.values).toMatchObject({ x: 0, y: 0, z: 0, w: 4, h: 1, d: 3, color: 5 });
    ctx.adjust({ ...a.values, h: 2, x: 10, color: 7 });
    expect(ctx.object.volume.voxelCount).toBe(24);
    expect(ctx.object.volume.get(10, 1, 0)).toBe(7);
    expect(ctx.object.volume.get(0, 0, 0)).toBe(0);
    expect(ctx.doc.history.undoDepth).toBe(1);
  });

  it('offers a line its two ends', () => {
    const { ctx, tool } = setup('line');
    lay(tool, ctx, [0, 0], [4, 0]);
    const a = ctx.adjustment!;
    expect(a.values).toMatchObject({ x1: 0, z1: 0, x2: 4, z2: 0 });
    ctx.adjust({ ...a.values, x2: 9 });
    expect(ctx.object.volume.voxelCount).toBe(10);
  });
});
