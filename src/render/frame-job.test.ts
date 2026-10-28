import { describe, expect, it } from 'vitest';
import { frameTiles, placeTile } from './frame-job';

describe('frame tiles', () => {
  it('cover the frame once, with margins clipped to it', () => {
    const tiles = frameTiles(1100, 600, 512, 32);
    expect(tiles).toHaveLength(6);
    const covered = new Uint8Array(1100 * 600);
    for (const t of tiles) {
      for (let y = t.y; y < t.y + t.height; y++)
        for (let x = t.x; x < t.x + t.width; x++) covered[y * 1100 + x]!++;
      expect(t.px).toBe(Math.max(0, t.x - 32));
      expect(t.px + t.pw).toBe(Math.min(1100, t.x + t.width + 32));
    }
    expect(covered.every((c) => c === 1)).toBe(true);
    const last = tiles.at(-1)!;
    expect([last.x, last.y, last.width, last.height]).toEqual([1024, 512, 76, 88]);
    expect([last.px, last.py, last.pw, last.ph]).toEqual([992, 480, 108, 120]);
  });

  it('are placed upright: the bottom row of a tile is lower in the frame', () => {
    const w = 4;
    const h = 4;
    const frame = new Uint8ClampedArray(w * h * 4);
    // One tile: the top-right 2×2 of the frame, traced with a 1-pixel margin.
    const [tile] = frameTiles(w, h, 2, 1).filter((t) => t.x === 2 && t.y === 2);
    expect(tile).toBeDefined();
    const t = tile!;
    const pixels = new Uint8Array(t.pw * t.ph * 4);
    for (let y = 0; y < t.ph; y++)
      for (let x = 0; x < t.pw; x++) pixels[(y * t.pw + x) * 4] = (t.py + y) * 10 + (t.px + x);
    placeTile(frame, w, h, t, pixels);
    // Frame row 0 (top) is y = 3 from the bottom.
    expect(frame[(0 * w + 2) * 4]).toBe(32);
    expect(frame[(0 * w + 3) * 4]).toBe(33);
    expect(frame[(1 * w + 2) * 4]).toBe(22);
    expect(frame[(2 * w + 2) * 4]).toBe(0);
  });
});
