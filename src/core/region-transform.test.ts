import { describe, expect, it } from 'vitest';
import { VoxelDocument } from './document';
import { applyRegionTransform } from './region-transform';

/** A 4 × 1 × 2 slab of colour 2 with a colour 3 voxel at its +x end. */
function setup() {
  const doc = VoxelDocument.createEmpty();
  const object = doc.scene.objects()[0]!;
  for (let x = 0; x < 4; x++) for (let z = 0; z < 2; z++) object.volume.set(x, 0, z, 2);
  object.volume.set(3, 0, 0, 3);
  return { doc, object };
}

describe('region transforms', () => {
  it('turns a quarter turn exactly and keeps every voxel', () => {
    const { doc, object } = setup();
    const cmd = applyRegionTransform(doc, object, 'rotate', { axis: 1, angle: 90 }, 'Rotate')!;
    doc.history.push(cmd);
    const b = object.volume.getBounds()!;
    expect(b.maxX - b.minX + 1).toBe(2);
    expect(b.maxZ - b.minZ + 1).toBe(4);
    expect(object.volume.voxelCount).toBe(8);
    doc.history.undo();
    expect(object.volume.get(3, 0, 0)).toBe(3);
  });

  it('scales up without holes', () => {
    const { doc, object } = setup();
    applyRegionTransform(doc, object, 'scale', { sx: 2, sy: 1, sz: 2 }, 'Scale');
    expect(object.volume.voxelCount).toBe(32);
  });

  it('loops within its box and repeats as an array', () => {
    const { doc, object } = setup();
    applyRegionTransform(doc, object, 'loop', { dx: 1, dy: 0, dz: 0 }, 'Loop');
    expect(object.volume.get(0, 0, 0)).toBe(3);
    expect(object.volume.voxelCount).toBe(8);
    applyRegionTransform(doc, object, 'array', { count: 3, dx: 5, dy: 0, dz: 0 }, 'Array');
    expect(object.volume.voxelCount).toBe(24);
    expect(object.volume.get(10, 0, 0)).toBe(3);
  });

  it('crops to a box anchored at a side', () => {
    const { doc, object } = setup();
    applyRegionTransform(doc, object, 'crop', { w: 2, h: 1, d: 2, ax: 2, ay: 1, az: 1 }, 'Crop');
    expect(object.volume.voxelCount).toBe(4);
    expect(object.volume.get(3, 0, 0)).toBe(3);
    expect(object.volume.get(0, 0, 0)).toBe(0);
  });

  it('works on the selection only, and the selection follows', () => {
    const { doc, object } = setup();
    object.selection.set(3, 0, 0, true);
    applyRegionTransform(doc, object, 'array', { count: 2, dx: 0, dy: 1, dz: 0 }, 'Array');
    expect(object.volume.voxelCount).toBe(9);
    expect(object.selection.count).toBe(2);
    expect(object.selection.has(3, 1, 0)).toBe(true);
  });
});
