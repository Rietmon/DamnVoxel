import { describe, expect, it } from 'vitest';
import { Camera } from './camera';
import { CameraController } from './camera-controller';
import type { Vec3 } from './math';

function setup(projection: 'perspective' | 'orthographic' = 'perspective') {
  const camera = new Camera();
  camera.width = 800;
  camera.height = 600;
  camera.target = [0, 0, 0];
  camera.distance = 50;
  camera.projection = projection;
  camera.update();
  return { camera, ctl: new CameraController(camera) };
}

function screen(camera: Camera, p: Vec3): [number, number] {
  camera.update();
  const s = camera.project(p);
  return [s[0], s[1]];
}

describe('CameraController', () => {
  it('orbits around the anchor, which stays under the same pixel', () => {
    for (const projection of ['perspective', 'orthographic'] as const) {
      const { camera, ctl } = setup(projection);
      const anchor: Vec3 = [6, 3, -4];
      const before = screen(camera, anchor);
      ctl.begin('orbit', anchor);
      ctl.orbit(40, -25, 16);
      ctl.orbit(-10, 60, 32);
      const after = screen(camera, anchor);
      expect(after[0]).toBeCloseTo(before[0], 3);
      expect(after[1]).toBeCloseTo(before[1], 3);
      expect(camera.yaw).not.toBeCloseTo(Math.PI / 4);
    }
  });

  it('orbits around the target when there is no anchor', () => {
    const { camera, ctl } = setup();
    ctl.begin('orbit', null);
    ctl.orbit(100, 0, 16);
    expect(camera.target).toEqual([0, 0, 0]);
  });

  it('never flips over the poles', () => {
    const { camera, ctl } = setup();
    ctl.begin('orbit', null);
    ctl.orbit(0, 10000, 16);
    expect(camera.pitch).toBeLessThan(Math.PI / 2);
    expect(camera.pitch).toBeGreaterThan(Math.PI / 2 - 0.01);
  });

  it('zooms towards the pointer, keeping that point in place', () => {
    for (const projection of ['perspective', 'orthographic'] as const) {
      const { camera, ctl } = setup(projection);
      const anchor: Vec3 = [-8, 2, 5];
      const before = screen(camera, anchor);
      ctl.zoom(0.5, anchor);
      expect(camera.distance).toBeCloseTo(25);
      const after = screen(camera, anchor);
      expect(after[0]).toBeCloseTo(before[0], 3);
      expect(after[1]).toBeCloseTo(before[1], 3);
    }
  });

  it('pans so the grabbed point follows the pointer', () => {
    const { camera, ctl } = setup();
    const grabbed: Vec3 = [3, 1, 2];
    const before = screen(camera, grabbed);
    ctl.begin('pan', grabbed);
    ctl.pan(30, -12, 16);
    const after = screen(camera, grabbed);
    expect(after[0] - before[0]).toBeCloseTo(30, 0);
    expect(after[1] - before[1]).toBeCloseTo(-12, 0);
  });

  it('keeps coasting after a fast drag and then stops', () => {
    const { camera, ctl } = setup();
    ctl.begin('orbit', null);
    for (let t = 16; t <= 96; t += 16) ctl.orbit(20, 0, t);
    ctl.end(100);
    expect(ctl.animating).toBe(true);
    const yaw = camera.yaw;
    let now = 100;
    while (ctl.update(now, 16) && now < 5000) now += 16;
    expect(camera.yaw).toBeLessThan(yaw);
    expect(ctl.animating).toBe(false);
  });

  it('does not coast after a slow drag or a pause before release', () => {
    const { ctl } = setup();
    ctl.begin('orbit', null);
    for (let t = 16; t <= 96; t += 16) ctl.orbit(20, 0, t);
    ctl.end(400);
    expect(ctl.animating).toBe(false);
  });

  it('animates to a state along the shortest turn', () => {
    const { camera, ctl } = setup();
    camera.yaw = 3;
    ctl.animateTo({ target: [10, 0, 0], yaw: -3, pitch: 0.2, distance: 100 }, 0);
    ctl.update(130, 16);
    // Halfway in time the yaw went past π, not back through 0.
    expect(Math.abs(camera.yaw)).toBeGreaterThan(3);
    ctl.update(1000, 16);
    expect(ctl.animating).toBe(false);
    expect(camera.target).toEqual([10, 0, 0]);
    expect(camera.distance).toBeCloseTo(100);
  });

  it('turns to a new pivot without moving the eye', () => {
    const { camera, ctl } = setup();
    const eye = camera.eye();
    ctl.setPivot([5, 0, 5], 0);
    ctl.update(1000, 16);
    const after = camera.eye();
    for (let i = 0; i < 3; i++) expect(after[i]).toBeCloseTo(eye[i]!, 6);
    expect(camera.target).toEqual([5, 0, 5]);
  });
});
