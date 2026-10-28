import { describe, expect, it } from 'vitest';
import { FACE_POS_Y } from '../coords';
import { executeOperation } from '../operation';
import { VoxelVolume } from '../volume';
import { type SculptOptions, sculpt } from './sculpt';
import { SculptTool } from './sculpt-tool';
import { RecordingSink, TestContext } from './test-context';

/** A 9 × 9 slab, 3 thick (y 0…2), colour 4, with one spike at (4, 3, 4) and a dent at (2, 2, 2). */
function slab(v = new VoxelVolume()): VoxelVolume {
  for (let x = 0; x < 9; x++)
    for (let z = 0; z < 9; z++) for (let y = 0; y < 3; y++) v.set(x, y, z, 4);
  v.set(4, 3, 4, 4);
  v.set(2, 2, 2, 0);
  return v;
}

const opts = (o: Partial<SculptOptions>): SculptOptions => ({
  mode: 'grow',
  size: 5,
  direction: 'normal',
  face: FACE_POS_Y,
  anchor: [4, 2, 4],
  color: null,
  ...o,
});

function run(v: VoxelVolume, center: [number, number, number], o: Partial<SculptOptions>) {
  const edit = sculpt(v, center, opts(o));
  const write = {
    get: (x: number, y: number, z: number) => v.get(x, y, z),
    set: (x: number, y: number, z: number, c: number) => v.set(x, y, z, c),
  };
  executeOperation(edit.erase, write);
  executeOperation(edit.add, write);
  return edit;
}

describe('sculpt', () => {
  it('grows one layer on the surface in the neighbours’ colour', () => {
    const v = slab();
    const before = v.voxelCount;
    run(v, [4, 2, 4], { mode: 'grow' });
    expect(v.get(4, 3, 3)).toBe(4);
    expect(v.get(4, 4, 4)).toBe(4);
    // Only along the normal: nothing grows sideways out of the slab's edge.
    expect(v.get(4, 3, 9)).toBe(0);
    expect(v.voxelCount).toBeGreaterThan(before);
  });

  it('erodes the open surface and takes the spike', () => {
    const v = slab();
    run(v, [4, 2, 4], { mode: 'erode' });
    expect(v.get(4, 3, 4)).toBe(0);
    expect(v.get(4, 2, 3)).toBe(0);
    expect(v.get(4, 1, 4)).toBe(4);
  });

  it('smooths a lonely spike away and fills a dent', () => {
    const v = slab();
    run(v, [3, 3, 3], { mode: 'smooth', size: 6 });
    expect(v.get(4, 3, 4)).toBe(0);
    expect(v.get(2, 2, 2)).toBe(4);
  });

  it('flattens to the anchor layer: cuts above, fills the dent below', () => {
    const v = slab();
    run(v, [3, 2, 3], { mode: 'flatten', size: 7, anchor: [3, 2, 3] });
    expect(v.get(4, 3, 4)).toBe(0);
    expect(v.get(2, 2, 2)).toBe(4);
  });

  it('puts bumps on some surface cells, the same ones every time', () => {
    const a = slab();
    const b = slab();
    const ea = run(a, [4, 2, 4], { mode: 'bumps' });
    const eb = run(b, [4, 2, 4], { mode: 'bumps' });
    expect(ea.count).toBe(eb.count);
    const full = sculpt(slab(), [4, 2, 4], opts({ mode: 'grow' }));
    expect(ea.count).toBeGreaterThan(0);
    expect(ea.count).toBeLessThan(full.count);
  });
});

describe('SculptTool', () => {
  it('adds one layer per stroke however long it lingers, and Shift erodes', () => {
    const ctx = new TestContext();
    const v = ctx.object.volume;
    for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) v.set(x, 0, z, 2);
    ctx.settings = { ...ctx.settings, brushSize: 3 };
    const tool = new SculptTool();
    tool.handle(ctx.event('down', 0, 0), ctx);
    tool.handle(ctx.event('move', 1, 0), ctx);
    tool.handle(ctx.event('move', 0, 0), ctx);
    tool.handle(ctx.event('up', 0, 0), ctx);
    expect(v.get(0, 1, 0)).toBe(2);
    expect(v.get(0, 2, 0)).toBe(0);
    expect(ctx.doc.history.undoLabel).toBe('Grow');
    tool.handle(ctx.event('down', 0, 0, { shift: true }), ctx);
    tool.handle(ctx.event('up', 0, 0, { shift: true }), ctx);
    expect(ctx.doc.history.undoLabel).toBe('Erode');
  });

  it('previews what a stroke would change and boxes the ball on the surface', () => {
    const ctx = new TestContext();
    slab(ctx.object.volume);
    const tool = new SculptTool();
    tool.handle(ctx.event('hover', 4, 4), ctx);
    expect(ctx.ghostMode).toBe('add');
    expect(ctx.lastHint).toContain('Grow');
    const sink = new RecordingSink();
    tool.overlay(sink, ctx);
    expect(sink.calls.cellBox).toBe(1);
    // Erosion and flattening show what goes away; Shift turns erode into grow.
    ctx.settings = { ...ctx.settings, sculptMode: 'flatten' };
    tool.handle(ctx.event('hover', 4, 4), ctx);
    expect(ctx.ghostMode).toBe('erase');
    ctx.settings = { ...ctx.settings, sculptMode: 'erode' };
    tool.handle(ctx.event('move', 4, 4, { shift: true }), ctx);
    expect(ctx.lastHint).toContain('Grow');
    ctx.settings = { ...ctx.settings, sculptMode: 'smooth' };
    tool.handle(ctx.event('hover', 4, 4, { shift: true }), ctx);
    expect(ctx.lastHint).toContain('Smooth');
    // Off the model: no preview, a hint to come back.
    tool.handle(ctx.event('hover', 40, 40), ctx);
    expect(ctx.ghostMode).toBeNull();
    expect(ctx.lastHint).toBe('Sculpt: hover over the model');
    const none = new RecordingSink();
    tool.overlay(none, ctx);
    expect(none.calls.cellBox).toBeUndefined();
  });

  it('takes the colour of the brush when asked to', () => {
    const ctx = new TestContext();
    slab(ctx.object.volume);
    ctx.settings = { ...ctx.settings, sculptUseColor: true, brushSize: 3 };
    const tool = new SculptTool();
    tool.handle(ctx.event('down', 6, 6), ctx);
    tool.handle(ctx.event('up', 6, 6), ctx);
    expect(ctx.object.volume.get(6, 3, 6)).toBe(5);
  });

  it('drops a stroke with Escape or a cancel, and keeps one when put away', () => {
    const ctx = new TestContext();
    slab(ctx.object.volume);
    ctx.settings = { ...ctx.settings, brushSize: 3 };
    const before = ctx.object.volume.voxelCount;
    const tool = new SculptTool();
    expect(tool.key('Escape', ctx)).toBe(false);
    tool.handle(ctx.event('down', 6, 6), ctx);
    expect(ctx.live).toBe(true);
    // Off the model a stroke changes nothing.
    tool.handle(ctx.event('move', 40, 40), ctx);
    expect(ctx.object.volume.voxelCount).toBeGreaterThan(before);
    expect(tool.key('Escape', ctx)).toBe(true);
    expect(ctx.object.volume.voxelCount).toBe(before);
    expect(ctx.live).toBe(false);
    tool.handle(ctx.event('down', 6, 6), ctx);
    tool.handle(ctx.event('cancel', 6, 6), ctx);
    expect(ctx.object.volume.voxelCount).toBe(before);
    expect(ctx.doc.history.undoDepth).toBe(0);
    tool.handle(ctx.event('down', 6, 6), ctx);
    tool.deactivate(ctx);
    expect(ctx.doc.history.undoDepth).toBe(1);
    expect(ctx.ghostMode).toBeNull();
  });

  it('leaves a locked object alone', () => {
    const ctx = new TestContext();
    slab(ctx.object.volume);
    ctx.object.locked = true;
    const tool = new SculptTool();
    tool.handle(ctx.event('down', 6, 6), ctx);
    expect(ctx.lastHint).toBe('The object is locked or hidden');
    tool.handle(ctx.event('up', 6, 6), ctx);
    expect(ctx.doc.history.undoDepth).toBe(0);
  });
});
