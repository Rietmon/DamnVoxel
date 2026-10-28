import { describe, expect, it } from 'vitest';
import { booleanObjects, splitObject, splitParts } from './boolean';
import { VoxelDocument } from './document';
import { InsertNodeCommand } from './scene-edit';

/** Two objects: A a 4-long bar at x 0…3, B a 2-long bar placed so it covers A's x 2…3 and 4…5. */
function setup() {
  const doc = VoxelDocument.createEmpty();
  const a = doc.scene.objects()[0]!;
  for (let x = 0; x < 4; x++) a.volume.set(x, 0, 0, 2);
  const b = doc.scene.createObject('B');
  for (let x = 0; x < 4; x++) b.volume.set(x, 0, 0, 5);
  b.transform = { x: 2, y: 0, z: 0, orientation: 0 };
  doc.history.execute(new InsertNodeCommand('B', b, doc.scene.root, 1));
  return { doc, a, b };
}

describe('booleans', () => {
  it('unions another object into the target, removing it, as one step', () => {
    const { doc, a } = setup();
    doc.history.push(booleanObjects(doc, a, [doc.scene.objects()[1]!], 'union')!);
    expect(a.volume.voxelCount).toBe(6);
    expect(a.volume.get(5, 0, 0)).toBe(5);
    expect(a.volume.get(2, 0, 0)).toBe(2);
    expect(doc.scene.objects()).toHaveLength(1);
    doc.history.undo();
    expect(doc.scene.objects()).toHaveLength(2);
    expect(a.volume.voxelCount).toBe(4);
  });

  it('subtracts and intersects', () => {
    const { doc, a, b } = setup();
    booleanObjects(doc, a, [b], 'subtract');
    expect(a.volume.voxelCount).toBe(2);
    const s = setup();
    booleanObjects(s.doc, s.a, [s.b], 'intersect');
    expect(s.a.volume.voxelCount).toBe(2);
    expect(s.a.volume.get(3, 0, 0)).toBe(2);
    expect(s.doc.scene.objects()).toHaveLength(2);
  });
});

describe('splitting', () => {
  it('finds the joined parts, or the parts of one colour', () => {
    const { a } = setup();
    a.volume.set(10, 0, 0, 2);
    expect(splitParts(a.volume, false).map((p) => p.voxelCount)).toEqual([4, 1]);
    a.volume.set(1, 0, 0, 7);
    expect(splitParts(a.volume, true).map((p) => p.voxelCount)).toEqual([2, 1, 1, 1]);
  });

  it('turns every part but the largest into its own object, as one step', () => {
    const { doc, a } = setup();
    a.volume.set(10, 0, 0, 2);
    a.volume.set(20, 0, 0, 2);
    const made = splitObject(doc, a, false);
    expect(made).toHaveLength(2);
    expect(a.volume.voxelCount).toBe(4);
    expect(doc.scene.objects()).toHaveLength(4);
    doc.history.undo();
    expect(doc.scene.objects()).toHaveLength(2);
    expect(a.volume.voxelCount).toBe(6);
  });
});
