import { describe, expect, it } from 'vitest';
import { TouchGestures } from './touch-gestures';
import type { CameraGesture, InputSink, ToolPointerEvent } from './types';

function setup() {
  const tool: ToolPointerEvent[] = [];
  const camera: CameraGesture[] = [];
  const taps: number[] = [];
  const radial: [string, number, number][] = [];
  const sink: InputSink = {
    tool: (e) => tool.push(e),
    camera: (g) => camera.push(g),
    tap: (n) => taps.push(n),
    radial: (phase, x, y) => radial.push([phase, x, y]),
  };
  return { g: new TouchGestures(sink), tool, camera, taps, radial };
}

const at = (x: number, y: number) => ({ x, y, pressure: 0.5 });

describe('TouchGestures', () => {
  it('drives the tool with one finger', () => {
    const { g, tool, camera } = setup();
    g.down(1, at(10, 10), 0);
    g.move(1, [at(12, 10), at(15, 10)], 16);
    g.up(1, at(15, 10), 400);
    expect(tool.map((e) => e.phase)).toEqual(['down', 'move', 'up']);
    expect(tool[1]!.samples).toHaveLength(2);
    expect(tool.every((e) => e.pointerType === 'touch' && e.button === 'primary')).toBe(true);
    expect(camera).toEqual([]);
  });

  it('cancels the tool when a second finger lands and orbits with two', () => {
    const { g, tool, camera } = setup();
    g.down(1, at(100, 100), 0);
    g.down(2, at(200, 100), 40);
    expect(tool.map((e) => e.phase)).toEqual(['down', 'cancel']);
    expect(camera[0]).toMatchObject({ kind: 'start', mode: 'orbit', x: 150, y: 100 });
    g.move(1, [at(110, 100)], 60);
    g.move(2, [at(210, 100)], 60);
    const orbit = camera.filter((c) => c.kind === 'orbit');
    expect(orbit.reduce((s, c) => s + (c.kind === 'orbit' ? c.dx : 0), 0)).toBeCloseTo(10);
  });

  it('zooms by pinching around the centre', () => {
    const { g, camera } = setup();
    g.down(1, at(100, 100), 0);
    g.down(2, at(200, 100), 0);
    g.move(1, [at(50, 100)], 30);
    g.move(2, [at(250, 100)], 30);
    const zooms = camera.filter((c) => c.kind === 'zoom');
    const factor = zooms.reduce((f, c) => f * (c.kind === 'zoom' ? c.factor : 1), 1);
    // Fingers twice as far apart: half the distance.
    expect(factor).toBeCloseTo(0.5);
  });

  it('never draws with a finger once a pen is in use: one finger orbits', () => {
    const { g, tool, camera } = setup();
    g.penMode = true;
    g.down(1, at(10, 10), 0);
    g.move(1, [at(20, 10)], 16);
    g.up(1, at(20, 10), 400);
    expect(tool).toEqual([]);
    expect(camera.map((c) => c.kind)).toEqual(['start', 'orbit', 'end']);
  });

  it('turns a finger held while the pen lands into a modifier that moves nothing', () => {
    const { g, camera, taps } = setup();
    g.penMode = true;
    expect(g.hold()).toBe(false);
    g.down(1, at(10, 10), 0);
    expect(g.hold()).toBe(true);
    expect(camera.at(-1)).toEqual({ kind: 'end' });
    const before = camera.length;
    g.move(1, [at(60, 10)], 30);
    g.down(2, at(100, 100), 40);
    g.up(2, at(100, 100), 60);
    g.up(1, at(60, 10), 80);
    expect(camera.length).toBe(before);
    expect(taps).toEqual([]);
    // After lifting, fingers work again.
    g.down(3, at(0, 0), 500);
    expect(camera.at(-1)).toMatchObject({ kind: 'start', mode: 'orbit' });
  });

  it('opens the radial menu on a long press, dropping the stroke, and picks on release', () => {
    const { g, tool, radial, camera } = setup();
    g.down(1, at(50, 50), 0);
    g.move(1, [at(53, 50)], 100);
    expect(g.pressCandidate()).toEqual({ x: 53, y: 50 });
    g.longPress();
    expect(tool.map((e) => e.phase)).toEqual(['down', 'move', 'cancel']);
    g.down(2, at(200, 200), 600);
    g.move(1, [at(90, 50)], 700);
    g.up(1, at(90, 50), 800);
    expect(radial).toEqual([
      ['open', 53, 50],
      ['move', 90, 50],
      ['up', 90, 50],
    ]);
    // The second finger stays inert until lifted.
    g.move(2, [at(260, 200)], 850);
    g.up(2, at(260, 200), 900);
    expect(camera).toEqual([]);
    expect(tool).toHaveLength(3);
  });

  it('offers no long press once the finger moved, with two fingers or with a pen', () => {
    const { g } = setup();
    g.down(1, at(0, 0), 0);
    g.move(1, [at(30, 0)], 50);
    expect(g.pressCandidate()).toBeNull();
    g.up(1, at(30, 0), 100);
    g.down(2, at(0, 0), 200);
    g.down(3, at(50, 0), 210);
    expect(g.pressCandidate()).toBeNull();
    g.up(2, at(0, 0), 300);
    g.up(3, at(50, 0), 300);
    g.penMode = true;
    g.down(4, at(0, 0), 400);
    expect(g.pressCandidate()).toBeNull();
  });

  it('pans with three fingers', () => {
    const { g, camera } = setup();
    g.down(1, at(0, 0), 0);
    g.down(2, at(100, 0), 0);
    g.down(3, at(50, 100), 0);
    for (const id of [1, 2, 3])
      g.move(id, [at(id === 1 ? 0 : id === 2 ? 100 : 50, id === 3 ? 130 : 30)], 50);
    const pans = camera.filter((c) => c.kind === 'pan');
    expect(pans.reduce((s, c) => s + (c.kind === 'pan' ? c.dy : 0), 0)).toBeCloseTo(30);
  });

  it('turns quick two- and three-finger taps into undo and redo', () => {
    const { g, taps, camera } = setup();
    g.down(1, at(100, 100), 0);
    g.down(2, at(150, 100), 20);
    g.up(1, at(100, 100), 120);
    g.up(2, at(150, 100), 130);
    g.down(1, at(100, 100), 1000);
    g.down(2, at(150, 100), 1010);
    g.down(3, at(200, 100), 1020);
    for (const id of [3, 2, 1]) g.up(id, at(0, 0), 1150);
    expect(taps).toEqual([2, 3]);
    expect(camera.filter((c) => c.kind === 'end')).toHaveLength(2);
  });

  it('does not tap after a slow or moving gesture', () => {
    const { g, taps } = setup();
    g.down(1, at(100, 100), 0);
    g.down(2, at(150, 100), 10);
    g.up(1, at(100, 100), 600);
    g.up(2, at(150, 100), 600);
    g.down(1, at(100, 100), 1000);
    g.down(2, at(150, 100), 1000);
    g.move(2, [at(190, 100)], 1050);
    g.up(1, at(100, 100), 1100);
    g.up(2, at(190, 100), 1100);
    expect(taps).toEqual([]);
  });

  it('does not jump when a finger lifts in the middle of a gesture', () => {
    const { g, camera } = setup();
    g.down(1, at(0, 0), 0);
    g.down(2, at(100, 0), 0);
    g.down(3, at(50, 100), 0);
    g.up(3, at(50, 100), 50);
    camera.length = 0;
    g.move(1, [at(0, 0)], 60);
    expect(camera.filter((c) => c.kind !== 'zoom')).toEqual([]);
  });

  it('orbits with one finger in camera-only mode', () => {
    const { g, tool, camera } = setup();
    g.cameraOnly = true;
    g.down(1, at(0, 0), 0);
    g.move(1, [at(20, 5)], 30);
    g.up(1, at(20, 5), 500);
    expect(tool).toEqual([]);
    expect(camera.map((c) => c.kind)).toEqual(['start', 'orbit', 'end']);
  });

  it('sets the pivot on a one-finger double tap in camera-only mode', () => {
    const { g, camera } = setup();
    g.cameraOnly = true;
    g.down(1, at(100, 100), 0);
    g.up(1, at(100, 100), 80);
    g.down(1, at(104, 102), 200);
    g.up(1, at(104, 102), 260);
    expect(camera.filter((c) => c.kind === 'pivot')).toEqual([{ kind: 'pivot', x: 104, y: 102 }]);
  });
});
