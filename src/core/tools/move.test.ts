import { describe, expect, it } from 'vitest';
import { copyVoxels, remapClip } from '../clipboard';
import { VoxelDocument } from '../document';
import { quarterTurn, reflection } from '../orientation';
import { floatingPiece, liftSelection, MoveTool, orientPiece } from './move';
import { RecordingSink, TestContext } from './test-context';

function setup() {
  const ctx = new TestContext();
  ctx.object.volume.set(0, 0, 0, 2);
  ctx.object.volume.set(1, 0, 0, 2);
  ctx.object.volume.set(5, 0, 5, 3);
  ctx.object.selection.set(0, 0, 0, true);
  ctx.object.selection.set(1, 0, 0, true);
  return { ctx, tool: new MoveTool() };
}

describe('MoveTool', () => {
  it('lifts the selection, drags it on the plane and lands it on release as one step', () => {
    const { ctx, tool } = setup();
    tool.handle(ctx.event('down', 0, 0), ctx);
    // Lifted: the source is empty and the piece floats while the drag lasts.
    expect(ctx.object.volume.get(0, 0, 0)).toBe(0);
    expect(ctx.floating).not.toBeNull();
    tool.handle(ctx.event('move', 3, 2), ctx);
    expect(ctx.floating!.offset).toEqual([3, 0, 2]);
    tool.handle(ctx.event('up', 3, 2), ctx);
    // Released: nothing floats, nothing waits for Enter.
    expect(ctx.floating).toBeNull();
    expect(tool.key('Enter', ctx)).toBe(false);
    expect(ctx.object.volume.get(3, 0, 2)).toBe(2);
    expect(ctx.object.volume.get(4, 0, 2)).toBe(2);
    expect(ctx.object.volume.get(0, 0, 0)).toBe(0);
    expect(ctx.object.volume.get(5, 0, 5)).toBe(3);
    expect(ctx.object.selection.has(3, 0, 2)).toBe(true);
    expect(ctx.object.selection.count).toBe(2);
    expect(ctx.doc.history.undoDepth).toBe(1);
    expect(ctx.doc.history.undoLabel).toBe('Move');
    ctx.doc.history.undo();
    expect(ctx.object.volume.get(0, 0, 0)).toBe(2);
    expect(ctx.object.volume.get(3, 0, 2)).toBe(0);
    expect(ctx.object.selection.has(0, 0, 0)).toBe(true);
    expect(ctx.object.selection.has(3, 0, 2)).toBe(false);
  });

  it('copies with Alt, leaving the source in place', () => {
    const { ctx, tool } = setup();
    tool.handle(ctx.event('down', 0, 0, { alt: true }), ctx);
    tool.handle(ctx.event('move', 0, 4, { alt: true }), ctx);
    tool.handle(ctx.event('up', 0, 4), ctx);
    expect(ctx.object.volume.get(0, 0, 0)).toBe(2);
    expect(ctx.object.volume.get(0, 0, 4)).toBe(2);
    expect(ctx.doc.history.undoLabel).toBe('Copy');
  });

  it('nudges the selection with arrows and PageUp, each nudge a step', () => {
    const { ctx, tool } = setup();
    expect(tool.key('ArrowRight', ctx)).toBe(true);
    expect(ctx.floating).toBeNull();
    tool.key('ArrowRight', ctx);
    tool.key('PageUp', ctx);
    expect(ctx.object.volume.get(2, 1, 0)).toBe(2);
    expect(ctx.object.volume.get(3, 1, 0)).toBe(2);
    expect(ctx.object.selection.has(2, 1, 0)).toBe(true);
    expect(ctx.doc.history.undoDepth).toBe(3);
    ctx.doc.history.undo();
    expect(ctx.object.volume.get(2, 0, 0)).toBe(2);
    expect(tool.key('KeyZ', ctx)).toBe(false);
  });

  it('puts the piece back when the drag is cancelled', () => {
    const { ctx, tool } = setup();
    tool.handle(ctx.event('down', 0, 0), ctx);
    tool.handle(ctx.event('move', 3, 0), ctx);
    tool.handle(ctx.event('cancel', 3, 0), ctx);
    expect(ctx.floating).toBeNull();
    expect(ctx.object.volume.get(0, 0, 0)).toBe(2);
    expect(ctx.doc.history.canUndo).toBe(false);
    // Undo during a drag puts the piece back instead of undoing the step before.
    tool.handle(ctx.event('down', 0, 0), ctx);
    expect(tool.cancelPending(ctx)).toBe(true);
    expect(ctx.object.volume.get(0, 0, 0)).toBe(2);
    expect(tool.cancelPending(ctx)).toBe(false);
  });

  it('moves the whole object when nothing is selected, along one axis with Ctrl', () => {
    const { ctx, tool } = setup();
    ctx.object.selection.clear();
    tool.handle(ctx.event('down', 0, 0, { ctrl: true }), ctx);
    tool.handle(ctx.event('move', 4, 1, { ctrl: true }), ctx);
    tool.handle(ctx.event('up', 4, 1), ctx);
    expect(ctx.object.volume.get(9, 0, 5)).toBe(3);
    expect(ctx.object.volume.voxelCount).toBe(3);
  });

  it('turns a piece about the centre of its bounds and back after four turns', () => {
    const { ctx } = setup();
    // A 3 × 1 × 2 block (odd and even sides) of distinct colours.
    ctx.object.volume.clear();
    ctx.object.selection.clear();
    let c = 1;
    for (let x = 0; x < 3; x++) for (let z = 0; z < 2; z++) ctx.object.volume.set(x, 0, z, c++);
    const f = liftSelection(ctx.object, false);
    const snapshot = () => {
      const out: string[] = [];
      for (const [key, chunk] of f.object.volume.chunks()) out.push(`${key}:${chunk.count}`);
      const b = f.object.volume.getBounds()!;
      for (let x = b.minX; x <= b.maxX; x++)
        for (let z = b.minZ; z <= b.maxZ; z++)
          out.push(`${x},${z}=${f.object.volume.get(x, 0, z)}`);
      return out.join(' ');
    };
    const before = snapshot();
    orientPiece(f, quarterTurn(1));
    const b = f.object.volume.getBounds()!;
    expect([b.maxX - b.minX + 1, b.maxZ - b.minZ + 1]).toEqual([2, 3]);
    expect(f.object.volume.voxelCount).toBe(6);
    for (let k = 0; k < 3; k++) orientPiece(f, quarterTurn(1));
    expect(snapshot()).toBe(before);
    orientPiece(f, reflection(0));
    orientPiece(f, reflection(0));
    expect(snapshot()).toBe(before);
  });

  it('turns in place at once, a row of turns being one step from the start', () => {
    const { ctx, tool } = setup();
    // Two colours, so a half turn shows.
    ctx.object.volume.set(1, 0, 0, 4);
    const bar = () => {
      const b = ctx.object.selection.getBounds()!;
      return [b.maxX - b.minX + 1, b.maxZ - b.minZ + 1];
    };
    expect(tool.key('KeyQ', ctx)).toBe(true);
    expect(ctx.floating).toBeNull();
    // The 2 × 1 bar now runs along Z, as one step.
    expect(bar()).toEqual([1, 2]);
    expect(ctx.object.volume.voxelCount).toBe(3);
    expect(ctx.doc.history.undoDepth).toBe(1);
    // E turns it back to exactly where it started: the row adds up to nothing.
    expect(tool.key('KeyE', ctx)).toBe(true);
    expect(ctx.object.volume.get(0, 0, 0)).toBe(2);
    expect(ctx.object.volume.get(1, 0, 0)).toBe(4);
    expect(ctx.doc.history.undoDepth).toBe(0);
    // Two Q in a row: half a turn, still one step.
    tool.key('KeyQ', ctx);
    tool.key('KeyQ', ctx);
    expect(bar()).toEqual([2, 1]);
    expect(ctx.object.volume.get(0, 0, 0)).toBe(4);
    expect(ctx.object.volume.get(1, 0, 0)).toBe(2);
    expect(ctx.doc.history.undoDepth).toBe(1);
    // Mirroring a flat bar upside down changes nothing visible.
    expect(tool.key('KeyH', ctx, true)).toBe(true);
    expect(ctx.object.selection.count).toBe(2);
    // An edit in between starts a new row.
    ctx.object.volume.set(20, 0, 20, 4);
    tool.key('KeyQ', ctx);
    expect(ctx.doc.history.undoDepth).toBe(2);
    ctx.doc.history.undo();
    expect(bar()).toEqual([2, 1]);
  });

  it('carries a pasted piece until it is placed by a drag', () => {
    const { ctx, tool } = setup();
    const other = VoxelDocument.createEmpty();
    const source = other.scene.objects()[0]!;
    source.volume.set(10, 0, 10, 9);
    const clip = copyVoxels(source, other.palette)!;
    const piece = floatingPiece(ctx.object, remapClip(clip, ctx.doc.palette), true, 'Paste');
    tool.carry(ctx, piece);
    expect(ctx.floating).toBe(piece);
    tool.handle(ctx.event('hover', 0, 0), ctx);
    expect(ctx.lastHint).toContain('Pasting');
    // The target's selection moved onto the piece; the target itself is untouched until drop.
    expect(ctx.object.selection.count).toBe(0);
    expect(ctx.object.volume.get(0, 0, 0)).toBe(2);
    // Arrows move the piece in hand without putting it down.
    tool.key('ArrowLeft', ctx);
    expect(ctx.floating).toBe(piece);
    tool.handle(ctx.event('down', 30, 30), ctx);
    tool.handle(ctx.event('move', 30, 31), ctx);
    tool.handle(ctx.event('up', 30, 31), ctx);
    expect(ctx.floating).toBeNull();
    expect(ctx.object.volume.get(9, 0, 11)).toBe(9);
    expect(ctx.object.selection.has(9, 0, 11)).toBe(true);
    expect(ctx.doc.history.undoLabel).toBe('Paste');
    ctx.doc.history.undo();
    expect(ctx.object.volume.get(9, 0, 11)).toBe(0);
    expect(ctx.object.selection.count).toBe(2);
  });

  it('places a piece in hand with Enter, drops it with Escape, and on a new carry', () => {
    const { ctx, tool } = setup();
    tool.carry(ctx, liftSelection(ctx.object, true));
    tool.key('ArrowUp', ctx);
    tool.carry(ctx, liftSelection(ctx.object, true));
    expect(ctx.doc.history.undoDepth).toBe(1);
    expect(ctx.doc.history.undoLabel).toBe('Copy');
    expect(tool.key('Enter', ctx)).toBe(true);
    expect(ctx.doc.history.undoDepth).toBe(2);
    tool.carry(ctx, liftSelection(ctx.object, true));
    expect(tool.key('Escape', ctx)).toBe(true);
    expect(ctx.floating).toBeNull();
    expect(ctx.doc.history.undoDepth).toBe(2);
  });

  it('hints, outlines the floating piece, and lands it when put away', () => {
    const { ctx, tool } = setup();
    tool.handle(ctx.event('hover', 0, 0), ctx);
    expect(ctx.lastHint).toContain('Drag the selection');
    expect(tool.key('Enter', ctx)).toBe(false);
    expect(tool.cancelPending(ctx)).toBe(false);
    tool.handle(ctx.event('down', 0, 0), ctx);
    const sink = new RecordingSink();
    tool.overlay(sink);
    expect(sink.calls.cellBox).toBe(1);
    tool.handle(ctx.event('move', 2, 0), ctx);
    tool.deactivate(ctx);
    expect(ctx.floating).toBeNull();
    expect(ctx.doc.history.undoLabel).toBe('Move');
    tool.deactivate(ctx);
  });

  it('moves along the face normal with Shift', () => {
    const { ctx, tool } = setup();
    // The test camera shows one voxel of height as one pixel up the screen.
    tool.handle(ctx.event('down', 0, 0, { shift: true }), ctx);
    tool.handle(ctx.event('move', 0, -3, { shift: true }), ctx);
    tool.handle(ctx.event('up', 0, -3, { shift: true }), ctx);
    expect(ctx.object.volume.get(0, 3, 0)).toBe(2);
  });

  it('leaves locked, hidden and empty objects alone', () => {
    const { ctx, tool } = setup();
    ctx.object.hidden = true;
    tool.handle(ctx.event('down', 0, 0), ctx);
    expect(ctx.floating).toBeNull();
    ctx.object.hidden = false;
    ctx.object.locked = true;
    tool.handle(ctx.event('down', 0, 0), ctx);
    // Q and arrows are still the move tool's keys, they just move nothing.
    tool.key('KeyQ', ctx);
    expect(tool.key('ArrowLeft', ctx)).toBe(false);
    expect(ctx.floating).toBeNull();
    expect(ctx.doc.history.canUndo).toBe(false);
    const empty = new TestContext();
    tool.handle(empty.event('down', 0, 0), empty);
    expect(empty.floating).toBeNull();
    // A drag without a press does nothing.
    tool.handle(empty.event('move', 4, 4), empty);
  });

  it('grabs on the floor plane when the press misses the model', () => {
    const { ctx, tool } = setup();
    tool.handle(ctx.event('down', 30, 30), ctx);
    tool.handle(ctx.event('move', 32, 31), ctx);
    expect(ctx.floating!.offset).toEqual([2, 0, 1]);
    tool.handle(ctx.event('up', 32, 31), ctx);
    expect(ctx.object.volume.get(2, 0, 1)).toBe(2);
  });
});
