import { describe, expect, it } from 'vitest';
import { FACE_POS_X, FACE_POS_Y } from '../coords';
import { VoxelVolume } from '../volume';
import { FaceTool, faceRegion } from './face';
import { RecordingSink, TestContext } from './test-context';

/** A 5 × 5 floor at y = 0 with a 2 × 2 patch of colour 3 and a bump at (4, 1, 4). */
function floor(v: VoxelVolume) {
  for (let x = 0; x < 5; x++) for (let z = 0; z < 5; z++) v.set(x, 0, z, x < 2 && z < 2 ? 3 : 2);
  v.set(4, 1, 4, 2);
}

describe('faceRegion', () => {
  it('collects the connected exposed faces in one plane', () => {
    const v = new VoxelVolume();
    floor(v);
    // The bump covers (4, 0, 4)'s top face.
    expect(faceRegion(v, 0, 0, 0, FACE_POS_Y, false).length / 4).toBe(24);
    expect(faceRegion(v, 0, 0, 0, FACE_POS_Y, true).length / 4).toBe(4);
    expect(faceRegion(v, 4, 1, 4, FACE_POS_Y, false).length / 4).toBe(1);
    expect(faceRegion(v, 4, 0, 4, FACE_POS_Y, false)).toEqual([]);
    // The side wall at x = 4, plus the bump above its corner, which lies in the same plane.
    expect(faceRegion(v, 4, 0, 0, FACE_POS_X, false).length / 4).toBe(6);
  });
});

describe('FaceTool', () => {
  it('extrudes a face by the drag along its normal, keeping colours', () => {
    const ctx = new TestContext();
    floor(ctx.object.volume);
    const tool = new FaceTool();
    tool.handle(ctx.event('down', 0, 0), ctx);
    // In the test projection one voxel up is one pixel up the screen: drag 3 px up = 3 layers.
    tool.handle(ctx.event('move', 0, -3), ctx);
    tool.handle(ctx.event('up', 0, -3), ctx);
    expect(ctx.object.volume.get(0, 3, 0)).toBe(3);
    expect(ctx.object.volume.get(3, 3, 3)).toBe(2);
    expect(ctx.object.volume.get(0, 4, 0)).toBe(0);
    expect(ctx.object.volume.voxelCount).toBe(26 + 24 * 3);
    expect(ctx.doc.history.undoLabel).toBe('Extrude face');
  });

  it('offers the depth and colour to redo the extrusion with', () => {
    const ctx = new TestContext();
    floor(ctx.object.volume);
    const tool = new FaceTool();
    tool.handle(ctx.event('down', 0, 0), ctx);
    tool.handle(ctx.event('up', 0, 0), ctx);
    const a = ctx.adjustment!;
    expect(a.values.depth).toBe(1);
    ctx.adjust({ ...a.values, depth: 4 });
    expect(ctx.object.volume.get(0, 4, 0)).toBe(3);
    expect(ctx.doc.history.undoDepth).toBe(1);
    ctx.adjust({ ...a.values, depth: -1 });
    expect(ctx.object.volume.get(0, 0, 0)).toBe(0);
    expect(ctx.doc.history.undoLabel).toBe('Push face');
  });

  it('extrudes one layer on a click and presses in when dragged inwards', () => {
    const ctx = new TestContext();
    floor(ctx.object.volume);
    const tool = new FaceTool();
    tool.handle(ctx.event('down', 1, 1), ctx);
    tool.handle(ctx.event('up', 1, 1), ctx);
    expect(ctx.object.volume.get(1, 1, 1)).toBe(3);
    ctx.doc.history.undo();
    ctx.settings = { ...ctx.settings, faceByColor: true };
    tool.handle(ctx.event('down', 1, 1), ctx);
    tool.handle(ctx.event('move', 1, 2), ctx);
    tool.handle(ctx.event('up', 1, 2), ctx);
    // Only the 2 × 2 patch of colour 3 was pressed in by one layer.
    expect(ctx.object.volume.get(0, 0, 0)).toBe(0);
    expect(ctx.object.volume.get(1, 0, 1)).toBe(0);
    expect(ctx.object.volume.get(2, 0, 2)).toBe(2);
    expect(ctx.doc.history.undoLabel).toBe('Push face');
  });

  it('previews on hover, paints the face, and ignores the construction plane', () => {
    const ctx = new TestContext();
    floor(ctx.object.volume);
    ctx.settings = { ...ctx.settings, action: 'paint', color: 8 };
    const tool = new FaceTool();
    tool.handle(ctx.event('hover', 2, 2), ctx);
    expect(ctx.ghost.voxelCount).toBe(24);
    tool.handle(ctx.event('down', 2, 2), ctx);
    tool.handle(ctx.event('up', 2, 2), ctx);
    expect(ctx.object.volume.get(0, 0, 0)).toBe(8);
    expect(ctx.object.volume.get(4, 0, 4)).toBe(2);
    tool.handle(ctx.event('hover', 20, 20), ctx);
    expect(ctx.ghost.isEmpty).toBe(true);
  });

  it('cancels with Escape', () => {
    const ctx = new TestContext();
    floor(ctx.object.volume);
    const tool = new FaceTool();
    tool.handle(ctx.event('down', 0, 0), ctx);
    tool.handle(ctx.event('move', 0, -4), ctx);
    expect(tool.key('Escape', ctx)).toBe(true);
    expect(ctx.object.volume.voxelCount).toBe(26);
    expect(ctx.ghost.isEmpty).toBe(true);
  });

  it('hints by action, outlines the face, and follows settings and Shift', () => {
    const ctx = new TestContext();
    floor(ctx.object.volume);
    const tool = new FaceTool();
    tool.handle(ctx.event('hover', 20, 20), ctx);
    expect(ctx.lastHint).toContain('hover');
    tool.handle(ctx.event('move', 2, 2), ctx);
    expect(ctx.lastHint).toContain('Drag');
    const sink = new RecordingSink();
    tool.overlay(sink, ctx);
    expect(sink.calls.faceOutline).toBe(1);
    // Shift turns adding into erasing: the preview presses in.
    tool.handle(ctx.event('hover', 2, 2, { shift: true }), ctx);
    expect(ctx.ghostMode).toBe('erase');
    ctx.settings = { ...ctx.settings, faceByColor: true };
    tool.settingsChanged(ctx);
    expect(ctx.ghost.voxelCount).toBe(20);
    tool.deactivate(ctx);
    expect(ctx.ghostMode).toBeNull();
    expect(tool.key('Escape', ctx)).toBe(false);
  });

  it('presses in with the erase action and drops the drag on cancel', () => {
    const ctx = new TestContext();
    floor(ctx.object.volume);
    ctx.settings = { ...ctx.settings, action: 'erase' };
    const tool = new FaceTool();
    tool.handle(ctx.event('down', 2, 2), ctx);
    expect(ctx.lastHint).toBe('Push by 1');
    tool.handle(ctx.event('cancel', 2, 2), ctx);
    expect(ctx.object.volume.voxelCount).toBe(26);
    tool.handle(ctx.event('down', 2, 2), ctx);
    tool.handle(ctx.event('up', 2, 2), ctx);
    expect(ctx.object.volume.get(2, 0, 2)).toBe(0);
    expect(ctx.doc.history.undoLabel).toBe('Push face');
  });

  it('leaves locked and hidden objects and empty faces alone', () => {
    const ctx = new TestContext();
    floor(ctx.object.volume);
    const tool = new FaceTool();
    ctx.object.locked = true;
    tool.handle(ctx.event('hover', 2, 2), ctx);
    expect(ctx.ghostMode).toBeNull();
    tool.handle(ctx.event('down', 2, 2), ctx);
    ctx.object.locked = false;
    ctx.object.hidden = true;
    tool.handle(ctx.event('down', 2, 2), ctx);
    ctx.object.hidden = false;
    // On the construction plane there is no face to pull.
    tool.handle(ctx.event('down', 20, 20), ctx);
    tool.handle(ctx.event('up', 20, 20), ctx);
    expect(ctx.doc.history.canUndo).toBe(false);
  });
});
