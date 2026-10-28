import { describe, expect, it } from 'vitest';
import { BoxSelectTool, RegionSelectTool, ScreenSelectTool } from './select-tools';
import { RecordingSink, TestContext } from './test-context';

/** A 10 × 10 floor at y = 0 and a separate 2-voxel post at (20, 0..1, 20); 20 px per voxel. */
function setup() {
  const ctx = new TestContext();
  ctx.pixelsPerVoxel = 20;
  for (let x = 0; x < 10; x++)
    for (let z = 0; z < 10; z++) ctx.object.volume.set(x, 0, z, x < 5 ? 2 : 3);
  ctx.object.volume.set(20, 0, 20, 2);
  ctx.object.volume.set(20, 1, 20, 2);
  return ctx;
}

function drag(
  tool: { handle: ScreenSelectTool['handle'] },
  ctx: TestContext,
  points: [number, number][],
  mods = {},
) {
  tool.handle(ctx.event('down', points[0]![0], points[0]![1], mods), ctx);
  for (const [x, y] of points.slice(1)) tool.handle(ctx.event('move', x, y, mods), ctx);
  const last = points.at(-1)!;
  tool.handle(ctx.event('up', last[0], last[1], mods), ctx);
}

describe('selection tools', () => {
  it('selects through the depth inside a screen rectangle, as one undoable step', () => {
    const ctx = setup();
    const tool = new ScreenSelectTool('rect');
    // Voxel centres project to (20x + 9.5, 20(z − y) + 9.5): x, z in 0…4.
    drag(tool, ctx, [
      [0, 0],
      [100, 100],
    ]);
    expect(ctx.object.selection.count).toBe(25);
    expect(ctx.doc.history.undoLabel).toBe('Select');
    ctx.doc.history.undo();
    expect(ctx.object.selection.isEmpty).toBe(true);
  });

  it('adds with Shift, subtracts with Alt and intersects with both', () => {
    const ctx = setup();
    const tool = new ScreenSelectTool('rect');
    drag(tool, ctx, [
      [0, 0],
      [100, 100],
    ]);
    drag(
      tool,
      ctx,
      [
        [100, 0],
        [200, 100],
      ],
      { shift: true },
    );
    expect(ctx.object.selection.count).toBe(50);
    drag(
      tool,
      ctx,
      [
        [0, 0],
        [200, 40],
      ],
      { alt: true },
    );
    expect(ctx.object.selection.count).toBe(30);
    drag(
      tool,
      ctx,
      [
        [0, 0],
        [100, 200],
      ],
      { shift: true, alt: true },
    );
    expect(ctx.object.selection.count).toBe(15);
  });

  it('selects inside a lasso and clears with a click on empty space', () => {
    const ctx = setup();
    const tool = new ScreenSelectTool('lasso');
    drag(tool, ctx, [
      [0, 0],
      [200, 0],
      [0, 200],
      [0, 1],
    ]);
    // Centres below the diagonal x + z < 10 − 0.95: a triangle of the floor.
    expect(ctx.object.selection.count).toBe(45);
    const rect = new ScreenSelectTool('rect');
    rect.handle(ctx.event('down', 900, 900), ctx);
    rect.handle(ctx.event('up', 900, 900), ctx);
    expect(ctx.object.selection.isEmpty).toBe(true);
  });

  it('selects a 3D box between two picked voxels', () => {
    const ctx = setup();
    const tool = new BoxSelectTool();
    drag(tool, ctx, [
      [30, 30],
      [70, 70],
    ]);
    expect(ctx.object.selection.count).toBe(9);
    expect(ctx.ghost.isEmpty).toBe(true);
  });

  it('selects connected regions by volume, colour and face', () => {
    const ctx = setup();
    const tool = new RegionSelectTool();
    tool.handle(ctx.event('down', 50, 50), ctx);
    expect(ctx.object.selection.count).toBe(100);
    ctx.settings = { ...ctx.settings, regionMode: 'color' };
    tool.handle(ctx.event('down', 50, 50), ctx);
    expect(ctx.object.selection.count).toBe(50);
    ctx.settings = { ...ctx.settings, regionMode: 'volume' };
    tool.handle(ctx.event('down', 410, 410), ctx);
    expect(ctx.object.selection.count).toBe(2);
    tool.handle(ctx.event('hover', 50, 50), ctx);
    expect(ctx.ghostMode).toBe('select');
    expect(ctx.ghost.voxelCount).toBe(100);
  });

  it('draws the screen path while dragging and drops it on Escape or cancel', () => {
    const ctx = setup();
    const rect = new ScreenSelectTool('rect');
    rect.handle(ctx.event('hover', 5, 5), ctx);
    expect(ctx.lastHint).toContain('Rectangle');
    expect(rect.key('Escape', ctx)).toBe(false);
    rect.handle(ctx.event('down', 0, 0), ctx);
    rect.handle(ctx.event('move', 60, 40), ctx);
    const sink = new RecordingSink();
    rect.overlay(sink);
    expect(sink.paths[0]?.points).toHaveLength(4);
    expect(rect.key('Escape', ctx)).toBe(true);
    // Releasing after Escape selects nothing.
    rect.handle(ctx.event('up', 60, 40), ctx);
    expect(ctx.doc.history.canUndo).toBe(false);
    const lasso = new ScreenSelectTool('lasso');
    lasso.handle(ctx.event('hover', 5, 5), ctx);
    expect(ctx.lastHint).toContain('Lasso');
    lasso.handle(ctx.event('move', 5, 5), ctx);
    lasso.handle(ctx.event('down', 0, 0), ctx);
    lasso.handle(ctx.event('move', 1, 0), ctx);
    lasso.handle(ctx.event('move', 40, 0), ctx);
    const lassoSink = new RecordingSink();
    lasso.overlay(lassoSink);
    // A move shorter than 2 px adds no point.
    expect(lassoSink.paths[0]?.points).toHaveLength(2);
    lasso.handle(ctx.event('cancel', 40, 0), ctx);
    const after = new RecordingSink();
    lasso.overlay(after);
    expect(after.calls.screenPath).toBeUndefined();
  });

  it('selects one voxel with a click and clears the selection with a click on air', () => {
    const ctx = setup();
    const rect = new ScreenSelectTool('rect');
    rect.handle(ctx.event('down', 50, 50), ctx);
    rect.handle(ctx.event('up', 51, 50), ctx);
    expect(ctx.object.selection.count).toBe(1);
    rect.handle(ctx.event('down', 50, 90, { shift: true }), ctx);
    rect.handle(ctx.event('up', 50, 90, { shift: true }), ctx);
    expect(ctx.object.selection.count).toBe(2);
    rect.handle(ctx.event('down', 900, 900), ctx);
    rect.handle(ctx.event('up', 900, 900), ctx);
    expect(ctx.object.selection.count).toBe(0);
  });

  it('previews the box, subtracts with Alt and lets go on Escape or cancel', () => {
    const ctx = setup();
    const box = new BoxSelectTool();
    box.handle(ctx.event('hover', 5, 5), ctx);
    expect(ctx.lastHint).toContain('Box');
    // No box yet: moves do nothing and Escape is not used.
    box.handle(ctx.event('move', 10, 10), ctx);
    expect(box.key('Escape', ctx)).toBe(false);
    drag(box, ctx, [
      [10, 10],
      [190, 190],
    ]);
    expect(ctx.object.selection.count).toBe(100);
    box.handle(ctx.event('down', 10, 10, { alt: true }), ctx);
    box.handle(ctx.event('move', 30, 30, { alt: true }), ctx);
    expect(ctx.ghostMode).toBe('erase');
    const sink = new RecordingSink();
    box.overlay(sink, ctx);
    expect(sink.calls.cellBox).toBe(1);
    box.handle(ctx.event('up', 30, 30, { alt: true }), ctx);
    expect(ctx.object.selection.count).toBe(96);
    box.handle(ctx.event('down', 10, 10), ctx);
    expect(box.key('Escape', ctx)).toBe(true);
    expect(ctx.ghostMode).toBeNull();
    box.handle(ctx.event('down', 10, 10), ctx);
    box.handle(ctx.event('cancel', 10, 10), ctx);
    box.handle(ctx.event('up', 10, 10), ctx);
    expect(ctx.object.selection.count).toBe(96);
  });

  it('starts a box on the construction plane above the floor', () => {
    const ctx = setup();
    const box = new BoxSelectTool();
    // Off the model the ray meets the construction plane: the corner sits on top of it.
    drag(box, ctx, [
      [610, 610],
      [700, 700],
    ]);
    expect(ctx.object.selection.isEmpty).toBe(true);
  });

  it('clears its preview on settings change and deactivation, and deselects on air', () => {
    const ctx = setup();
    const tool = new RegionSelectTool();
    tool.handle(ctx.event('hover', 50, 50), ctx);
    expect(ctx.lastHint).toContain('connected volume');
    ctx.settings = { ...ctx.settings, regionMode: 'face' };
    tool.settingsChanged(ctx);
    expect(ctx.ghostMode).toBeNull();
    tool.handle(ctx.event('hover', 50, 50), ctx);
    expect(ctx.lastHint).toContain('face');
    expect(ctx.ghost.voxelCount).toBe(100);
    tool.deactivate(ctx);
    expect(ctx.ghostMode).toBeNull();
    ctx.settings = { ...ctx.settings, regionMode: 'color' };
    tool.handle(ctx.event('move', Number.NaN, Number.NaN), ctx);
    expect(ctx.lastHint).toContain('color');
    tool.handle(ctx.event('down', 50, 50), ctx);
    expect(ctx.object.selection.count).toBe(50);
    tool.handle(ctx.event('up', 50, 50), ctx);
    tool.handle(ctx.event('down', 900, 900), ctx);
    expect(ctx.object.selection.isEmpty).toBe(true);
  });
});
