import { describe, expect, it } from 'vitest';
import { RopeTool } from './rope-tool';
import { TestContext } from './test-context';

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
});
