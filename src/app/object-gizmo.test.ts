import { describe, expect, it } from 'vitest';
import { VoxelDocument } from '../core/document';
import type { SceneNode } from '../core/scene';
import { worldBounds } from '../core/scene-edit';
import type { ToolPhase, ToolPointerEvent } from '../input/types';
import { Camera } from '../render/camera';
import type { Vec3 } from '../render/math';
import { gizmoFrame, gizmoHandleAt, ObjectGizmo } from './object-gizmo';

function setup() {
  const doc = VoxelDocument.createEmpty();
  const object = doc.scene.objects()[0]!;
  for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) object.volume.set(x, y, 0, 1);
  const camera = new Camera();
  camera.width = 800;
  camera.height = 600;
  camera.target = [2, 2, 0.5];
  camera.update();
  const targets: SceneNode[] = [object];
  const gizmo = new ObjectGizmo(
    () => doc,
    camera,
    () => targets,
  );
  const frame = gizmoFrame(camera, targets)!;
  const at = (p: Vec3) => camera.project(p);
  const event = (phase: ToolPhase, p: Vec3): ToolPointerEvent => ({
    phase,
    x: p[0],
    y: p[1],
    pressure: 0.5,
    samples: [],
    button: 'primary',
    pointerType: 'mouse',
    time: 0,
    shift: false,
    ctrl: false,
    alt: false,
  });
  return { doc, object, camera, gizmo, frame, at, event };
}

describe('object gizmo', () => {
  it('finds arrows, rings and the centre on screen', () => {
    const { camera, frame, at } = setup();
    const o = frame.origin;
    expect(o).toEqual([2, 2, 0.5]);
    const tipX = at([o[0] + frame.length * 0.7, o[1], o[2]]);
    expect(gizmoHandleAt(camera, frame, tipX[0], tipX[1], 6)).toEqual({ kind: 'axis', axis: 0 });
    const centre = at(o);
    expect(gizmoHandleAt(camera, frame, centre[0], centre[1], 6)).toEqual({ kind: 'center' });
    // On the Y ring, half way between the Z and X arrows.
    const a = Math.PI / 4;
    const ring = at([o[0] + frame.radius * Math.sin(a), o[1], o[2] + frame.radius * Math.cos(a)]);
    expect(gizmoHandleAt(camera, frame, ring[0], ring[1], 6)).toEqual({ kind: 'ring', axis: 1 });
    expect(gizmoHandleAt(camera, frame, 5, 5, 6)).toBeNull();
  });

  it('moves along an arrow by whole voxels as one step', () => {
    const { doc, object, gizmo, frame, at, event } = setup();
    const o = frame.origin;
    const grab: Vec3 = [o[0] + frame.length * 0.7, o[1], o[2]];
    expect(gizmo.pointer(event('down', at(grab)))).toBe(true);
    gizmo.pointer(event('move', at([grab[0] + 2.2, grab[1], grab[2]])));
    gizmo.pointer(event('move', at([grab[0] + 5.1, grab[1], grab[2]])));
    gizmo.pointer(event('up', at([grab[0] + 5.1, grab[1], grab[2]])));
    expect(object.transform).toEqual({ x: 5, y: 0, z: 0, orientation: 0 });
    expect(doc.history.undoDepth).toBe(1);
    doc.history.undo();
    expect(object.transform.x).toBe(0);
  });

  it('turns by a quarter once a ring is dragged past 45°', () => {
    const { doc, object, gizmo, frame, at, event } = setup();
    const o = frame.origin;
    const onRing = (deg: number): Vec3 => {
      // The Y ring runs from Z (0°) towards X (90°).
      const a = (deg * Math.PI) / 180;
      return [o[0] + frame.radius * Math.sin(a), o[1], o[2] + frame.radius * Math.cos(a)];
    };
    expect(gizmo.pointer(event('down', at(onRing(30))))).toBe(true);
    gizmo.pointer(event('move', at(onRing(60))));
    expect(doc.history.undoDepth).toBe(0);
    gizmo.pointer(event('move', at(onRing(90))));
    gizmo.pointer(event('move', at(onRing(140))));
    gizmo.pointer(event('up', at(onRing(140))));
    expect(object.transform.orientation).not.toBe(0);
    // A 4 × 4 × 1 slab stood up along X now lies along Z, around the same centre.
    const box = worldBounds([object])!;
    expect([box.maxX - box.minX, box.maxZ - box.minZ]).toEqual([0, 3]);
    expect(doc.history.undoDepth).toBe(1);
  });

  it('leaves locked objects alone', () => {
    const { object, gizmo, frame, at, event } = setup();
    object.locked = true;
    expect(gizmo.pointer(event('down', at(frame.origin)))).toBe(false);
  });

  it('moves objects on the floor when grabbed anywhere on them', () => {
    const { doc, object, camera, gizmo, at, event } = setup();
    const point: Vec3 = [1.5, 1.5, 1];
    gizmo.grab(point, camera.rayAt(...(at(point).slice(0, 2) as [number, number])));
    expect(gizmo.dragging).toBe(true);
    gizmo.pointer(event('move', at([point[0] + 3, point[1], point[2] - 2])));
    gizmo.pointer(event('up', at([point[0] + 3, point[1], point[2] - 2])));
    expect(object.transform).toEqual({ x: 3, y: 0, z: -2, orientation: 0 });
    expect(doc.history.undoDepth).toBe(1);
  });
});
