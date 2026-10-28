import { describe, expect, it } from 'vitest';
import { VoxelTransaction } from '../voxel-edit';
import { PipetteTool, ReplaceTool, replaceColor } from './color-tools';
import { RecordingSink, TestContext } from './test-context';

function scene(ctx: TestContext) {
  for (let x = 0; x < 40; x++) ctx.object.volume.set(x, 0, 0, x % 2 ? 3 : 4);
  ctx.object.volume.set(100, 0, 0, 3);
}

describe('PipetteTool', () => {
  it('takes the colour of the voxel under the pointer and ignores empty space', () => {
    const ctx = new TestContext();
    scene(ctx);
    const tool = new PipetteTool();
    tool.handle(ctx.event('down', 1, 0), ctx);
    expect(ctx.settings.color).toBe(3);
    tool.handle(ctx.event('down', 50, 50), ctx);
    expect(ctx.settings.color).toBe(3);
    expect(ctx.doc.history.canUndo).toBe(false);
  });

  it('hints and outlines the voxel under the pointer', () => {
    const ctx = new TestContext();
    scene(ctx);
    const tool = new PipetteTool();
    tool.handle(ctx.event('hover', 1, 0), ctx);
    expect(ctx.lastHint).toBe('Pick color 3');
    const sink = new RecordingSink();
    tool.overlay(sink, ctx);
    expect(sink.calls.faceOutline).toBe(1);
    tool.handle(ctx.event('move', Number.NaN, 0), ctx);
    expect(ctx.lastHint).toContain('hover');
    tool.deactivate();
    const after = new RecordingSink();
    tool.overlay(after, ctx);
    expect(after.calls.faceOutline).toBeUndefined();
  });
});

describe('ReplaceTool', () => {
  it('replaces a colour across the whole object in one step, with a preview', () => {
    const ctx = new TestContext();
    scene(ctx);
    ctx.settings = { ...ctx.settings, color: 9 };
    const tool = new ReplaceTool();
    tool.handle(ctx.event('hover', 1, 0), ctx);
    expect(ctx.ghostMode).toBe('paint');
    expect(ctx.ghost.voxelCount).toBe(21);
    tool.handle(ctx.event('down', 1, 0), ctx);
    expect(ctx.object.volume.get(1, 0, 0)).toBe(9);
    expect(ctx.object.volume.get(100, 0, 0)).toBe(9);
    expect(ctx.object.volume.get(0, 0, 0)).toBe(4);
    expect(ctx.doc.history.undoLabel).toBe('Replace color');
    ctx.doc.history.undo();
    expect(ctx.object.volume.get(100, 0, 0)).toBe(3);
  });

  it('outlines the hovered voxel, hints, and clears its preview when put away', () => {
    const ctx = new TestContext();
    scene(ctx);
    ctx.settings = { ...ctx.settings, color: 9 };
    const tool = new ReplaceTool();
    tool.handle(ctx.event('hover', 60, 60), ctx);
    expect(ctx.lastHint).toContain('hover');
    expect(ctx.ghostMode).toBeNull();
    tool.handle(ctx.event('move', 1, 0), ctx);
    expect(ctx.lastHint).toContain('Replace color 3 with 9');
    const sink = new RecordingSink();
    tool.overlay(sink, ctx);
    expect(sink.calls.faceOutline).toBe(1);
    tool.settingsChanged(ctx);
    expect(ctx.ghostMode).toBeNull();
    tool.handle(ctx.event('hover', 1, 0), ctx);
    tool.deactivate(ctx);
    expect(ctx.ghostMode).toBeNull();
    // Over air or on a locked object a click changes nothing.
    tool.handle(ctx.event('down', 60, 60), ctx);
    ctx.object.locked = true;
    tool.handle(ctx.event('down', 1, 0), ctx);
    expect(ctx.doc.history.canUndo).toBe(false);
  });

  it('does nothing when replacing a colour by itself or replacing empty', () => {
    const ctx = new TestContext();
    scene(ctx);
    const tx = new VoxelTransaction();
    expect(replaceColor(ctx.object, 3, 3, tx)).toBe(0);
    expect(replaceColor(ctx.object, 0, 3, tx)).toBe(0);
    expect(replaceColor(ctx.object, 7, 3, tx)).toBe(0);
    expect(replaceColor(ctx.object, 4, 3, tx)).toBe(20);
  });
});
