import { describe, expect, it } from 'vitest';
import { quarterTurn } from '../orientation';
import { VoxelVolume } from '../volume';
import { patternFromVolume, placePattern, StampTool } from './stamp-tool';
import { TestContext } from './test-context';

/** An L: a 3-tall post at x = 0 with a foot towards +x, colours 2 (post) and 3 (foot). */
function lShape() {
  const v = new VoxelVolume();
  for (let y = 0; y < 3; y++) v.set(10, 5 + y, 20, 2);
  v.set(11, 5, 20, 3);
  return patternFromVolume(v, 'L')!;
}

describe('stamp patterns', () => {
  it('anchors a piece at the middle of its bottom', () => {
    const p = lShape();
    expect(p.size).toEqual([2, 3, 1]);
    const cells = placePattern(p, [0, 0, 0], 0, null);
    const at = (i: number) => cells.slice(i * 4, i * 4 + 4);
    const all = [0, 1, 2, 3].map(at);
    expect(all).toContainEqual([0, 0, 0, 2]);
    expect(all).toContainEqual([0, 2, 0, 2]);
    expect(all).toContainEqual([1, 0, 0, 3]);
  });

  it('turns about the anchor and can take one colour', () => {
    const p = lShape();
    const cells = placePattern(p, [5, 5, 5], quarterTurn(1), 9);
    const all = [0, 1, 2, 3].map((i) => cells.slice(i * 4, i * 4 + 4));
    // The anchor stays put, the foot turns away from +x.
    expect(all).toContainEqual([5, 5, 5, 9]);
    expect(all.some((c) => c[0] === 6)).toBe(false);
    expect(all.every((c) => c[3] === 9)).toBe(true);
  });
});

describe('StampTool', () => {
  it('puts the piece on the floor with a click, as one step', () => {
    const ctx = new TestContext();
    const tool = new StampTool();
    tool.pattern = lShape();
    tool.handle(ctx.event('down', 4, 4), ctx);
    tool.handle(ctx.event('up', 4, 4), ctx);
    expect(ctx.object.volume.voxelCount).toBe(4);
    expect(ctx.object.volume.get(4, 2, 4)).toBe(2);
    expect(ctx.object.volume.get(5, 0, 4)).toBe(3);
    expect(ctx.doc.history.undoLabel).toBe('Stamp');
  });

  it('grows out of a wall along its normal', () => {
    const ctx = new TestContext();
    const tool = new StampTool();
    tool.pattern = lShape();
    // A wall facing +x at x = 0.
    const hit = {
      object: ctx.object,
      x: 0,
      y: 5,
      z: 0,
      face: 0,
      t: 1,
      value: 1,
      onPlane: false,
      point: [1, 5.5, 0.5] as [number, number, number],
    };
    const cells: number[][] = [];
    tool.operation(hit, 'add', ctx)!.forEachCell((x, y, z) => {
      cells.push([x, y, z]);
    });
    // The post now runs along +x from the cell in front of the wall.
    expect(cells).toContainEqual([1, 5, 0]);
    expect(cells).toContainEqual([3, 5, 0]);
  });

  it('lays pieces along a stroke, touching or a piece apart', () => {
    const ctx = new TestContext();
    const tool = new StampTool();
    tool.pattern = lShape();
    tool.handle(ctx.event('down', 0, 0), ctx);
    for (let x = 1; x <= 6; x++) tool.handle(ctx.event('move', x, 0), ctx);
    tool.handle(ctx.event('up', 6, 0), ctx);
    const dense = ctx.object.volume.voxelCount;
    ctx.doc.history.undo();
    ctx.settings = { ...ctx.settings, stampSpacing: 'apart' };
    tool.handle(ctx.event('down', 0, 0), ctx);
    for (let x = 1; x <= 6; x++) tool.handle(ctx.event('move', x, 0), ctx);
    tool.handle(ctx.event('up', 6, 0), ctx);
    expect(ctx.object.volume.voxelCount).toBeLessThan(dense);
    expect(ctx.object.volume.get(2, 2, 0)).toBe(2);
    expect(ctx.object.volume.get(1, 2, 0)).toBe(0);
  });
});
