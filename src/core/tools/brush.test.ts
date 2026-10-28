import { describe, expect, it } from 'vitest';
import { mirrorModifier } from '../mirror';
import { BrushTool } from './brush';
import { TestContext } from './test-context';

function stroke(tool: BrushTool, ctx: TestContext, points: [number, number][], shift = false) {
  const [first, ...rest] = points;
  tool.handle(ctx.event('down', first![0], first![1], { shift }), ctx);
  for (const [x, y] of rest) tool.handle(ctx.event('move', x, y, { shift }), ctx);
  const last = points.at(-1)!;
  tool.handle(ctx.event('up', last[0], last[1], { shift }), ctx);
}

describe('BrushTool', () => {
  it('previews the future voxel on hover without touching the document', () => {
    const ctx = new TestContext();
    const tool = new BrushTool();
    tool.handle(ctx.event('hover', 3, 4), ctx);
    expect(ctx.ghost.get(3, 0, 4)).toBe(5);
    expect(ctx.ghost.voxelCount).toBe(1);
    expect(ctx.object.volume.isEmpty).toBe(true);
  });

  it('draws a gap-free line from a fast stroke as one history step', () => {
    const ctx = new TestContext();
    const tool = new BrushTool();
    stroke(tool, ctx, [
      [0, 0],
      [12, 0],
    ]);
    expect(ctx.cells()).toEqual(Array.from({ length: 13 }, (_, x) => `${x},0,0`));
    expect(ctx.doc.history.undoDepth).toBe(1);
    expect(ctx.live).toBe(false);
    ctx.doc.history.undo();
    expect(ctx.object.volume.isEmpty).toBe(true);
  });

  it('builds one layer per stroke instead of piling up towards the camera', () => {
    const ctx = new TestContext();
    const tool = new BrushTool();
    stroke(tool, ctx, [
      [0, 0],
      [5, 0],
    ]);
    // Going back and forth over the same cells adds exactly one layer on top.
    stroke(tool, ctx, [
      [0, 0],
      [5, 0],
      [0, 0],
      [5, 0],
    ]);
    const heights = new Set(ctx.cells().map((c) => c.split(',')[1]));
    expect([...heights].sort()).toEqual(['0', '1']);
    expect(ctx.cells()).toHaveLength(12);
  });

  it('erases with Shift held and leaves the plane alone', () => {
    const ctx = new TestContext();
    const tool = new BrushTool();
    stroke(tool, ctx, [
      [0, 0],
      [4, 0],
    ]);
    stroke(
      tool,
      ctx,
      [
        [1, 0],
        [3, 0],
        [3, 5],
      ],
      true,
    );
    expect(ctx.cells()).toEqual(['0,0,0', '4,0,0']);
    expect(ctx.doc.history.undoLabel).toBe('Erase');
  });

  it('reverts a cancelled stroke and one cancelled with Escape', () => {
    const ctx = new TestContext();
    const tool = new BrushTool();
    tool.handle(ctx.event('down', 0, 0), ctx);
    tool.handle(ctx.event('move', 6, 0), ctx);
    expect(ctx.object.volume.voxelCount).toBe(7);
    tool.handle(ctx.event('cancel', 6, 0), ctx);
    expect(ctx.object.volume.isEmpty).toBe(true);
    tool.handle(ctx.event('down', 0, 0), ctx);
    expect(tool.key('Escape', ctx)).toBe(true);
    expect(ctx.object.volume.isEmpty).toBe(true);
    expect(ctx.doc.history.canUndo).toBe(false);
  });

  it('refuses to edit a locked object', () => {
    const ctx = new TestContext();
    ctx.object.locked = true;
    const tool = new BrushTool();
    stroke(tool, ctx, [[0, 0]]);
    expect(ctx.object.volume.isEmpty).toBe(true);
    expect(ctx.lastHint).toMatch(/locked/);
  });

  it('paints existing voxels only and previews the new colour', () => {
    const ctx = new TestContext();
    const tool = new BrushTool();
    stroke(tool, ctx, [
      [0, 0],
      [3, 0],
    ]);
    ctx.settings = { ...ctx.settings, action: 'paint', color: 9 };
    tool.handle(ctx.event('hover', 2, 0), ctx);
    expect(ctx.ghostMode).toBe('paint');
    expect(ctx.ghost.get(2, 0, 0)).toBe(9);
    stroke(tool, ctx, [
      [2, 0],
      [6, 0],
    ]);
    expect([0, 1, 2, 3].map((x) => ctx.object.volume.get(x, 0, 0))).toEqual([5, 5, 9, 9]);
    // Painting over empty floor adds nothing.
    expect(ctx.object.volume.voxelCount).toBe(4);
    expect(ctx.doc.history.undoLabel).toBe('Paint');
  });

  it('stamps big brushes and keeps them above the construction plane', () => {
    const ctx = new TestContext();
    ctx.settings = { ...ctx.settings, brushSize: 3, brushShape: 'cube' };
    const tool = new BrushTool();
    stroke(tool, ctx, [[5, 5]]);
    // A 3×3×3 cube centred on the floor cell loses the layer below the floor.
    expect(ctx.cells()).toHaveLength(18);
    expect(ctx.cells().every((c) => Number(c.split(',')[1]) >= 0)).toBe(true);
  });

  it('paints a whole sphere of existing voxels', () => {
    const ctx = new TestContext();
    for (let x = 0; x < 9; x++) for (let z = 0; z < 9; z++) ctx.object.volume.set(x, 0, z, 2);
    ctx.settings = {
      ...ctx.settings,
      action: 'paint',
      color: 7,
      brushSize: 5,
      brushShape: 'sphere',
    };
    const tool = new BrushTool();
    stroke(tool, ctx, [[4, 4]]);
    const painted = ctx.cells().filter((c) => {
      const [x, y, z] = c.split(',').map(Number) as [number, number, number];
      return ctx.object.volume.get(x, y, z) === 7;
    });
    // A disc of radius 2.5 in the single layer.
    expect(painted.length).toBe(21);
  });

  it('previews exactly the cells a click changes, for every shape, mode and action', () => {
    for (const brushShape of ['cube', 'sphere'] as const)
      for (const brushMode of ['volume', 'plane', 'surface'] as const)
        for (const action of ['add', 'erase', 'paint'] as const)
          for (const brushSize of [1, 2, 4]) {
            const ctx = new TestContext();
            for (let x = 0; x < 8; x++)
              for (let y = 0; y < 3; y++)
                for (let z = 0; z < 8; z++) ctx.object.volume.set(x, y, z, 2);
            ctx.settings = { ...ctx.settings, action, brushShape, brushMode, brushSize, color: 9 };
            const tool = new BrushTool();
            tool.handle(ctx.event('hover', 3, 4), ctx);
            const ghost = new Map<string, number>();
            for (let x = -4; x < 12; x++)
              for (let y = -4; y < 8; y++)
                for (let z = -4; z < 12; z++) {
                  const v = ctx.ghost.get(x, y, z);
                  if (v) ghost.set(`${x},${y},${z}`, action === 'erase' ? 0 : v);
                }
            stroke(tool, ctx, [[3, 4]]);
            const label = `${brushShape} ${brushMode} ${action} ${brushSize}`;
            expect(ghost.size, label).toBeGreaterThan(0);
            for (const [key, value] of ghost) {
              const [x, y, z] = key.split(',').map(Number) as [number, number, number];
              expect(ctx.object.volume.get(x, y, z), `${label} at ${key}`).toBe(value);
            }
            // Nothing outside the preview changed.
            let changed = 0;
            for (let x = -4; x < 12; x++)
              for (let y = -4; y < 8; y++)
                for (let z = -4; z < 12; z++) {
                  const was = x >= 0 && x < 8 && y >= 0 && y < 3 && z >= 0 && z < 8 ? 2 : 0;
                  if (ctx.object.volume.get(x, y, z) !== was) changed++;
                }
            expect(changed, label).toBe(ghost.size);
          }
  });

  it('scales the brush with pen pressure, unless pressure is off', () => {
    // A 5³ cube on the floor keeps the 3 layers above it: 75 cells.
    const ctx = new TestContext();
    ctx.settings = { ...ctx.settings, brushSize: 5 };
    const tool = new BrushTool();
    tool.handle(ctx.event('down', 10, 10, { pressure: 0.2 }), ctx);
    tool.handle(ctx.event('up', 10, 10, { pressure: 0.2 }), ctx);
    expect(ctx.cells()).toEqual(['10,0,10']);
    ctx.doc.history.undo();
    tool.handle(ctx.event('down', 10, 10, { pressure: 1 }), ctx);
    tool.handle(ctx.event('up', 10, 10, { pressure: 1 }), ctx);
    expect(ctx.cells()).toHaveLength(75);
    ctx.doc.history.undo();
    ctx.settings = { ...ctx.settings, pressureSize: false };
    tool.handle(ctx.event('down', 10, 10, { pressure: 0.2 }), ctx);
    tool.handle(ctx.event('up', 10, 10, { pressure: 0.2 }), ctx);
    expect(ctx.cells()).toHaveLength(75);
  });

  it('grows the stamp when pressing harder over the same cell', () => {
    const ctx = new TestContext();
    ctx.settings = { ...ctx.settings, brushSize: 3 };
    const tool = new BrushTool();
    tool.handle(ctx.event('down', 10, 10, { pressure: 0.3 }), ctx);
    tool.handle(ctx.event('move', 10, 10, { pressure: 1 }), ctx);
    tool.handle(ctx.event('up', 10, 10, { pressure: 1 }), ctx);
    expect(ctx.cells()).toHaveLength(18);
    expect(ctx.doc.history.undoDepth).toBe(1);
  });

  it('turns erase into add with Shift', () => {
    const ctx = new TestContext();
    ctx.settings = { ...ctx.settings, action: 'erase' };
    const tool = new BrushTool();
    stroke(tool, ctx, [[1, 1]], true);
    expect(ctx.object.volume.get(1, 0, 1)).toBe(5);
  });

  it('keeps a plane-locked stroke on the first plane, even off the model', () => {
    const ctx = new TestContext();
    for (let x = 0; x < 3; x++) ctx.object.volume.set(x, 0, 0, 2);
    ctx.settings = { ...ctx.settings, lock: 'plane' };
    const tool = new BrushTool();
    stroke(tool, ctx, [
      [0, 0],
      [8, 0],
    ]);
    // Without the lock the stroke would drop to the floor past x = 2.
    for (let x = 0; x <= 8; x++) expect(ctx.object.volume.get(x, 1, 0), `x = ${x}`).toBe(5);
    expect(ctx.object.volume.get(5, 0, 0)).toBe(0);
  });

  it('keeps an axis-locked stroke on a line through the first cell', () => {
    const ctx = new TestContext();
    ctx.settings = { ...ctx.settings, lock: 'x' };
    const tool = new BrushTool();
    stroke(tool, ctx, [
      [0, 0],
      [3, 2],
      [6, 4],
    ]);
    expect(ctx.cells()).toEqual(Array.from({ length: 7 }, (_, x) => `${x},0,0`));
  });

  it('mirrors strokes live across a plane through a voxel', () => {
    const ctx = new TestContext();
    ctx.modifiers = [mirrorModifier({ x: true, y: false, z: false, center2: [1, 0, 0] })];
    const tool = new BrushTool();
    stroke(tool, ctx, [
      [2, 0],
      [4, 0],
    ]);
    // Voxel 0 is the keel: 2…4 come back as −4…−2.
    expect(ctx.cells()).toEqual(['-4,0,0', '-3,0,0', '-2,0,0', '2,0,0', '3,0,0', '4,0,0']);
    stroke(tool, ctx, [[0, 3]]);
    expect(ctx.object.volume.get(0, 0, 3)).toBe(5);
  });

  it('sends both the preview and the stroke through the modifier chain', () => {
    const ctx = new TestContext();
    // A modifier that also writes every cell 10 voxels further along X.
    ctx.modifiers = [
      (op) => ({
        action: op.action,
        forEachCell: (visit) =>
          op.forEachCell((x, y, z, c) => {
            visit(x, y, z, c);
            visit(x + 10, y, z, c);
          }),
      }),
    ];
    const tool = new BrushTool();
    tool.handle(ctx.event('hover', 1, 1), ctx);
    expect(ctx.ghost.get(11, 0, 1)).toBe(5);
    stroke(tool, ctx, [[1, 1]]);
    expect(ctx.cells()).toEqual(['1,0,1', '11,0,1']);
  });
});
