import { describe, expect, it } from 'vitest';
import { RopeTool } from './rope-tool';
import { RecordingSink, TestContext } from './test-context';

describe('RopeTool', () => {
  it('asks for a rope from where the press began to where it ended', () => {
    const ctx = new TestContext();
    const tool = new RopeTool();
    tool.handle(ctx.event('down', 0, 0), ctx);
    tool.handle(ctx.event('move', 10, 0), ctx);
    tool.handle(ctx.event('up', 10, 0), ctx);
    expect(ctx.ropes).toHaveLength(1);
    const [a, b] = ctx.ropes[0]!;
    expect(b[0] - a[0]).toBe(10);
    // A click without a drag asks for nothing.
    tool.handle(ctx.event('down', 3, 3), ctx);
    tool.handle(ctx.event('up', 3, 3), ctx);
    expect(ctx.ropes).toHaveLength(1);
  });

  it('outlines the hovered face, then draws the rope line while dragging', () => {
    const ctx = new TestContext();
    const tool = new RopeTool();
    tool.handle(ctx.event('hover', 0, 0), ctx);
    expect(ctx.lastHint).toContain('Rope');
    tool.handle(ctx.event('move', 1, 0), ctx);
    const hover = new RecordingSink();
    tool.overlay(hover, ctx);
    expect(hover.calls).toEqual({ faceOutline: 1 });
    tool.handle(ctx.event('down', 0, 0), ctx);
    tool.handle(ctx.event('move', 5, 0), ctx);
    // Off the model the end stays where it was.
    tool.handle(ctx.event('move', Number.NaN, Number.NaN), ctx);
    const drag = new RecordingSink();
    tool.overlay(drag, ctx);
    expect(drag.calls).toEqual({ line: 1 });
    tool.handle(ctx.event('up', Number.NaN, Number.NaN), ctx);
    expect(ctx.ropes[0]![1][0] - ctx.ropes[0]![0][0]).toBe(5);
  });

  it('drops the rope with Escape, a cancel or when put away', () => {
    const ctx = new TestContext();
    const tool = new RopeTool();
    expect(tool.key('Escape', ctx)).toBe(false);
    tool.handle(ctx.event('down', 0, 0), ctx);
    tool.handle(ctx.event('move', 5, 0), ctx);
    expect(tool.key('Enter', ctx)).toBe(false);
    expect(tool.key('Escape', ctx)).toBe(true);
    tool.handle(ctx.event('up', 5, 0), ctx);
    tool.handle(ctx.event('down', 0, 0), ctx);
    tool.handle(ctx.event('move', 5, 0), ctx);
    tool.handle(ctx.event('cancel', 5, 0), ctx);
    tool.handle(ctx.event('up', 5, 0), ctx);
    tool.handle(ctx.event('down', 0, 0), ctx);
    tool.handle(ctx.event('move', 5, 0), ctx);
    tool.deactivate();
    tool.handle(ctx.event('up', 5, 0), ctx);
    expect(ctx.ropes).toHaveLength(0);
    const sink = new RecordingSink();
    tool.overlay(sink, ctx);
    expect(sink.calls).toEqual({});
  });
});
