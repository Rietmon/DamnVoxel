import { describe, expect, it } from 'vitest';
import { FillTool } from './fill-tool';
import { RecordingSink, TestContext } from './test-context';

/** Hovers and clicks a screen point (screen x, y is world column x, z). */
function click(tool: FillTool, ctx: TestContext, x: number, y: number, shift = false) {
  tool.handle(ctx.event('hover', x, y, { shift }), ctx);
  tool.handle(ctx.event('down', x, y, { shift }), ctx);
  tool.handle(ctx.event('up', x, y, { shift }), ctx);
}

/** A 3 × 3 floor of colour 2 with one voxel of colour 3 in a corner. */
function floor(ctx: TestContext) {
  for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) ctx.object.volume.set(x, 0, z, 2);
  ctx.object.volume.set(2, 0, 2, 3);
}

/** A closed square ring of colour 2 on the floor, with the cell (2, 0, 2) inside. */
function ring(ctx: TestContext) {
  for (let x = 0; x < 5; x++)
    for (let z = 0; z < 5; z++)
      if (x === 0 || x === 4 || z === 0 || z === 4) ctx.object.volume.set(x, 0, z, 2);
}

describe('FillTool', () => {
  it('previews and recolours the voxels of the clicked colour, as one step', () => {
    const ctx = new TestContext();
    floor(ctx);
    const tool = new FillTool();
    tool.handle(ctx.event('hover', 0, 0), ctx);
    expect(ctx.ghostMode).toBe('paint');
    expect(ctx.ghost.voxelCount).toBe(8);
    expect(ctx.lastHint).toContain('Connected by color');
    tool.handle(ctx.event('up', 0, 0), ctx);
    expect(ctx.object.volume.get(0, 0, 0)).toBe(5);
    expect(ctx.object.volume.get(1, 0, 2)).toBe(5);
    // The other colour stays.
    expect(ctx.object.volume.get(2, 0, 2)).toBe(3);
    expect(ctx.doc.history.undoLabel).toBe('Fill');
    expect(ctx.ghostMode).toBeNull();
  });

  it('erases the region with Shift', () => {
    const ctx = new TestContext();
    floor(ctx);
    const tool = new FillTool();
    tool.handle(ctx.event('move', 0, 0, { shift: true }), ctx);
    expect(ctx.ghostMode).toBe('erase');
    tool.handle(ctx.event('up', 0, 0, { shift: true }), ctx);
    expect(ctx.cells()).toEqual(['2,0,2']);
    expect(ctx.doc.history.undoLabel).toBe('Erase by fill');
  });

  it('keeps to the clicked layer on the plane', () => {
    const ctx = new TestContext();
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) ctx.object.volume.set(x, y, 0, 2);
    ctx.settings = { ...ctx.settings, fillMode: 'layer' };
    click(new FillTool(), ctx, 0, 0);
    expect(ctx.object.volume.get(0, 1, 0)).toBe(5);
    expect(ctx.object.volume.get(1, 1, 0)).toBe(5);
    expect(ctx.object.volume.get(0, 0, 0)).toBe(2);
  });

  it('fills the inside of a closed outline and refuses an open one', () => {
    const ctx = new TestContext();
    ctx.settings = { ...ctx.settings, fillMode: 'outline' };
    const tool = new FillTool();
    // Nothing drawn yet.
    tool.handle(ctx.event('hover', 2, 2), ctx);
    expect(ctx.lastHint).toBe('Draw a closed outline and click inside');
    ring(ctx);
    click(tool, ctx, 2, 2);
    expect(ctx.object.volume.voxelCount).toBe(16 + 9);
    expect(ctx.object.volume.get(2, 0, 2)).toBe(5);
    ctx.doc.history.undo();
    ctx.object.volume.set(4, 0, 2, 0);
    click(tool, ctx, 2, 2);
    expect(ctx.lastHint).toBe('The outline is not closed: the fill would leak out');
    expect(ctx.object.volume.get(2, 0, 2)).toBe(0);
  });

  it('asks for a voxel when the click lands on the floor', () => {
    const ctx = new TestContext();
    click(new FillTool(), ctx, 0, 0);
    expect(ctx.lastHint).toBe('Click a voxel');
    expect(ctx.doc.history.undoDepth).toBe(0);
  });

  it('leaves a locked object alone', () => {
    const ctx = new TestContext();
    floor(ctx);
    ctx.object.locked = true;
    click(new FillTool(), ctx, 0, 0);
    expect(ctx.lastHint).toBe('The object is locked or hidden');
    expect(ctx.object.volume.get(0, 0, 0)).toBe(2);
  });

  it('outlines the hovered face and clears everything when put away', () => {
    const ctx = new TestContext();
    floor(ctx);
    const tool = new FillTool();
    // A click with nothing hovered does nothing.
    tool.handle(ctx.event('up', 0, 0), ctx);
    expect(ctx.doc.history.undoDepth).toBe(0);
    tool.handle(ctx.event('hover', 0, 0), ctx);
    const sink = new RecordingSink();
    tool.overlay(sink, ctx);
    expect(sink.calls.faceOutline).toBe(1);
    // Another fill mode updates the preview.
    ctx.settings = { ...ctx.settings, fillMode: 'layer' };
    tool.settingsChanged(ctx);
    expect(ctx.lastHint).toContain('On the plane');
    // Leaving the viewport drops the preview and the hint.
    tool.handle(ctx.event('hover', Number.NaN, Number.NaN), ctx);
    expect(ctx.ghostMode).toBeNull();
    expect(ctx.lastHint).toBeNull();
    tool.handle(ctx.event('hover', 0, 0), ctx);
    tool.deactivate(ctx);
    expect(ctx.ghostMode).toBeNull();
    const after = new RecordingSink();
    tool.overlay(after, ctx);
    expect(after.calls.faceOutline).toBeUndefined();
  });
});
