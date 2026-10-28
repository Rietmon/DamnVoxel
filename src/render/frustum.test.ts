import { describe, expect, it } from 'vitest';
import { Camera } from './camera';
import { boxInFrustum, createFrustum, extractFrustum } from './frustum';

function camera(): Camera {
  const c = new Camera();
  c.width = 800;
  c.height = 600;
  c.target = [0, 0, 0];
  c.yaw = 0;
  c.pitch = 0;
  c.distance = 50;
  c.update();
  return c;
}

describe('frustum culling', () => {
  it('keeps boxes in front of the camera and drops boxes behind or aside', () => {
    const c = camera();
    const f = extractFrustum(c.viewProj, createFrustum());
    expect(boxInFrustum(f, -1, -1, -1, 1, 1, 1)).toBe(true);
    // Behind the camera (it sits at z = 50 looking towards −z).
    expect(boxInFrustum(f, -1, -1, 60, 1, 1, 62)).toBe(false);
    // Far to the side.
    expect(boxInFrustum(f, 500, -1, -1, 502, 1, 1)).toBe(false);
    expect(boxInFrustum(f, -1, 500, -1, 1, 502, 1)).toBe(false);
  });

  it('keeps a box that only straddles a plane', () => {
    const c = camera();
    const f = extractFrustum(c.viewProj, createFrustum());
    const half = Math.tan(c.fovY / 2) * 50;
    expect(boxInFrustum(f, -1, half - 1, -1, 1, half + 5, 1)).toBe(true);
    expect(boxInFrustum(f, -1, half + 1, -1, 1, half + 5, 1)).toBe(false);
  });

  it('works for an orthographic camera', () => {
    const c = camera();
    c.projection = 'orthographic';
    c.update();
    const f = extractFrustum(c.viewProj, createFrustum());
    expect(boxInFrustum(f, -2, -2, -2, 2, 2, 2)).toBe(true);
    expect(boxInFrustum(f, 300, 0, 0, 301, 1, 1)).toBe(false);
  });
});
