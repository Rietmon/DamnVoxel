import { describe, expect, it } from 'vitest';
import { FACE_NORMALS, FACE_POS_Y } from './coords';
import { ORIENTATION_COUNT } from './orientation';
import { pickConstructionPlane, pickVoxel } from './picking';
import { Scene } from './scene';
import {
  cellToLocal,
  cellToWorld,
  faceToLocal,
  faceToWorld,
  localToWorld,
  worldToLocal,
} from './transform';

function sceneWith(...cells: [number, number, number][]) {
  const scene = new Scene();
  const object = scene.createObject('o');
  scene.attach(object, scene.root);
  for (const [x, y, z] of cells) object.volume.set(x, y, z, 1);
  return { scene, object };
}

describe('transforms', () => {
  it('round-trips points, cells and faces for all 48 orientations', () => {
    for (let o = 0; o < ORIENTATION_COUNT; o++) {
      const t = { x: 5, y: -3, z: 7, orientation: o };
      const p = localToWorld(t, 1.25, 2.5, -3.75);
      expect(worldToLocal(t, ...p).map((v) => +v.toFixed(9))).toEqual([1.25, 2.5, -3.75]);
      const c = cellToWorld(t, 4, -2, 9);
      expect(cellToLocal(t, ...c)).toEqual([4, -2, 9]);
      for (let f = 0; f < 6; f++) expect(faceToLocal(t, faceToWorld(t, f))).toBe(f);
      // The world cell contains the transformed centre of the local cell.
      const centre = localToWorld(t, 4.5, -1.5, 9.5);
      expect(c.map((v, i) => Math.floor(centre[i]!) === v)).toEqual([true, true, true]);
    }
  });
});

describe('pickVoxel', () => {
  it('picks through object transforms and keeps world t', () => {
    for (let o = 0; o < ORIENTATION_COUNT; o++) {
      const { scene, object } = sceneWith([0, 0, 0], [1, 0, 0]);
      object.transform = { x: 10, y: 3, z: -2, orientation: o };
      const [wx, wy, wz] = cellToWorld(object.transform, 1, 0, 0);
      const hit = pickVoxel(scene.objects(), [wx + 0.5, 50, wz + 0.5], [0, -1, 0]);
      expect(hit, `orientation ${o}`).not.toBeNull();
      // Something at or above the aimed cell is hit first, through a face pointing up.
      const world = cellToWorld(object.transform, hit!.x, hit!.y, hit!.z);
      expect([world[0], world[2]]).toEqual([wx, wz]);
      expect(world[1]).toBeGreaterThanOrEqual(wy);
      expect(FACE_NORMALS[faceToWorld(object.transform, hit!.face)]).toEqual([0, 1, 0]);
      expect(hit!.t).toBeCloseTo(50 - (world[1] + 1));
    }
  });

  it('takes the nearest of several objects and skips hidden ones', () => {
    const scene = new Scene();
    const near = scene.createObject('near');
    const far = scene.createObject('far');
    scene.attach(near, scene.root);
    scene.attach(far, scene.root);
    near.volume.set(0, 5, 0, 1);
    far.volume.set(0, 2, 0, 2);
    const ray = [
      [0.5, 20, 0.5],
      [0, -1, 0],
    ] as const;
    expect(pickVoxel(scene.objects(), ...ray)?.object).toBe(near);
    near.hidden = true;
    expect(pickVoxel(scene.objects(), ...ray)?.object).toBe(far);
  });
});

describe('pickConstructionPlane', () => {
  it('acts as a solid floor at y = 0', () => {
    const { object } = sceneWith();
    const hit = pickConstructionPlane(object, [3.2, 10, -4.7], [0, -1, 0])!;
    expect([hit.x, hit.y, hit.z, hit.face]).toEqual([3, -1, -5, FACE_POS_Y]);
    expect(pickConstructionPlane(object, [0, 10, 0], [0, 1, 0])).toBeNull();
  });

  it('answers in the object space', () => {
    const { object } = sceneWith();
    object.transform = { x: 2, y: 4, z: 0, orientation: 0 };
    const hit = pickConstructionPlane(object, [2.5, 10, 0.5], [0, -1, 0])!;
    expect([hit.x, hit.y, hit.z]).toEqual([0, -5, 0]);
  });
});
