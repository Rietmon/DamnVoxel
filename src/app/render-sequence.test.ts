import { describe, expect, it } from 'vitest';
import type { CameraView } from '../core/cameras';
import {
  cameraOf,
  DEFAULT_SEQUENCE,
  SPRITE_TILT,
  spriteSheet,
  spriteViews,
  turntableViews,
  vetSequence,
} from './render-sequence';

const VIEW: CameraView = {
  target: [1, 2, 3],
  yaw: 0.3,
  pitch: 0.4,
  distance: 50,
  projection: 'perspective',
  fov: 45,
};

describe('render series', () => {
  it('turns the camera once around the target', () => {
    const views = turntableViews(VIEW, 8);
    expect(views).toHaveLength(8);
    expect(views[0]).toEqual(VIEW);
    expect(views[4]!.yaw - VIEW.yaw).toBeCloseTo(Math.PI);
    for (const v of views) expect([v.target, v.pitch, v.distance]).toEqual([VIEW.target, 0.4, 50]);
  });

  it('frames sprites the same from every side', () => {
    // A flat 20 × 2 × 20 tile: wide from every side, low.
    const views = spriteViews([-10, 0, -10], [10, 2, 10], 4, 'pixel');
    expect(views.map((v) => Math.round((v.yaw * 180) / Math.PI))).toEqual([45, 135, 225, 315]);
    for (const v of views) {
      expect(v.projection).toBe('orthographic');
      expect(v.pitch).toBeCloseTo(Math.PI / 6);
      expect(v.target).toEqual([0, 1, 0]);
      // Seen corner-on, the tile is its diagonal wide: half of it is 10√2, plus a margin.
      const c = cameraOf(v, 64, 64);
      expect(c.halfHeightAtTarget()).toBeCloseTo(10 * Math.SQRT2 * 1.04);
    }
    // 2:1 pixel art: a world axis runs one pixel up per two across.
    expect(Math.sin(SPRITE_TILT.pixel)).toBeCloseTo(0.5);
    expect(spriteViews([0, 0, 0], [1, 1, 1], 8, 'iso')[0]!.pitch).toBeCloseTo(0.6155, 3);
  });

  it('lays sprites out in rows', () => {
    const cell = (v: number) => new Uint8ClampedArray(2 * 2 * 4).fill(v);
    const sheet = spriteSheet([cell(1), cell(2), cell(3)], 2, 2, 2);
    expect([sheet.width, sheet.height]).toEqual([4, 4]);
    const at = (x: number, y: number) => sheet.pixels[(y * 4 + x) * 4];
    expect([at(0, 0), at(3, 1), at(1, 2), at(3, 3)]).toEqual([1, 2, 3, 0]);
  });

  it('keeps stored settings within bounds', () => {
    const odd = vetSequence({
      ...DEFAULT_SEQUENCE,
      frames: 100000,
      fps: 0,
      directions: 6 as 8,
      kind: 'x' as 'turntable',
    });
    expect([odd.frames, odd.fps, odd.directions, odd.kind]).toEqual([720, 1, 8, 'turntable']);
  });
});
