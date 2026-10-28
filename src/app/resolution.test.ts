import { describe, expect, it } from 'vitest';
import { MIN_RENDER_SCALE, pixelRatio, ResolutionGovernor } from './resolution';

describe('ResolutionGovernor', () => {
  it('keeps full resolution while frames are on time', () => {
    const g = new ResolutionGovernor();
    for (let i = 0; i < 100; i++) g.sample(16.7);
    expect(g.scale).toBe(1);
  });

  it('drops resolution after a streak of slow frames, not after one hiccup', () => {
    const g = new ResolutionGovernor();
    g.sample(16.7);
    g.sample(40);
    g.sample(16.7);
    g.sample(40);
    expect(g.scale).toBe(1);
    g.sample(40);
    g.sample(40);
    g.sample(40);
    expect(g.scale).toBeLessThan(1);
  });

  it('never goes below the minimum and recovers on settle', () => {
    const g = new ResolutionGovernor();
    g.sample(16.7);
    for (let i = 0; i < 300; i++) g.sample(80);
    expect(g.scale).toBe(MIN_RENDER_SCALE);
    expect(g.settle()).toBe(true);
    expect(g.scale).toBe(1);
    expect(g.settle()).toBe(false);
  });

  it('climbs back up during long smooth motion', () => {
    const g = new ResolutionGovernor();
    g.sample(16.7);
    for (let i = 0; i < 6; i++) g.sample(40);
    const low = g.scale;
    for (let i = 0; i < 400; i++) g.sample(16.7);
    expect(g.scale).toBeGreaterThan(low);
  });

  it('adapts to a 120 Hz display', () => {
    const g = new ResolutionGovernor();
    for (let i = 0; i < 10; i++) g.sample(8.3);
    // 16.7 ms on a 120 Hz screen means every other frame is missed.
    for (let i = 0; i < 3; i++) g.sample(16.7);
    expect(g.scale).toBeLessThan(1);
  });
});

describe('pixelRatio', () => {
  it('caps the device ratio at 2 and applies the scale', () => {
    expect(pixelRatio(3, 1)).toBe(2);
    expect(pixelRatio(1.25, 1)).toBe(1.25);
    expect(pixelRatio(2, 0.5)).toBe(1);
    expect(pixelRatio(0, 1)).toBe(1);
  });
});
