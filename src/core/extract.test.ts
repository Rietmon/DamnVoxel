import { describe, expect, it } from 'vitest';
import { VoxelDocument } from './document';
import { extractSelection } from './extract';

describe('extractSelection', () => {
  it('moves the selected voxels into a new object in the same place, as one step', () => {
    const doc = VoxelDocument.createEmpty();
    const object = doc.scene.objects()[0]!;
    object.transform = { x: 5, y: 0, z: 0, orientation: 0 };
    for (let x = 0; x < 4; x++) object.volume.set(x, 0, 0, 2);
    object.selection.set(2, 0, 0, true);
    object.selection.set(3, 0, 0, true);
    const part = extractSelection(doc, object)!;
    expect(part.volume.voxelCount).toBe(2);
    expect(part.volume.get(3, 0, 0)).toBe(2);
    expect(part.transform.x).toBe(5);
    expect(object.volume.voxelCount).toBe(2);
    expect(object.selection.isEmpty).toBe(true);
    expect(doc.scene.objects()).toHaveLength(2);
    expect(doc.history.undoDepth).toBe(1);
    doc.history.undo();
    expect(doc.scene.objects()).toHaveLength(1);
    expect(object.volume.voxelCount).toBe(4);
    expect(object.selection.count).toBe(2);
    doc.history.redo();
    expect(doc.scene.objects()).toHaveLength(2);
  });

  it('does nothing without a selection', () => {
    const doc = VoxelDocument.createEmpty();
    expect(extractSelection(doc, doc.scene.objects()[0]!)).toBeNull();
    expect(doc.history.undoDepth).toBe(0);
  });
});
