import { describe, expect, it } from 'vitest';
import { VoxelDocument } from '../core/document';
import { isHidden, isLocked } from '../core/scene';
import { LayerListCommand, LayerPropertyCommand, NodePropertyCommand } from '../core/scene-edit';
import { parseVoxFile } from '../formats/vox-chunks';
import { readVox } from './vox-read';
import { writeVox } from './vox-write';

const layrs = (bytes: Uint8Array) => parseVoxFile(bytes).chunks.filter((c) => c.id === 'LAYR');

describe('layers', () => {
  it('hide and lock the objects on them, undoably', () => {
    const doc = VoxelDocument.createEmpty();
    const object = doc.scene.objects()[0]!;
    const layer = doc.scene.layers[0]!;
    doc.history.execute(new LayerPropertyCommand('Hide layer', layer, 'hidden', true));
    expect(isHidden(object)).toBe(true);
    doc.history.undo();
    expect(isHidden(object)).toBe(false);
    doc.history.execute(new LayerPropertyCommand('Lock layer', layer, 'locked', true));
    expect(isLocked(object)).toBe(true);
  });

  it('moves nodes back to another layer when theirs is removed, and back on undo', () => {
    const doc = VoxelDocument.createEmpty();
    const object = doc.scene.objects()[0]!;
    const extra = doc.scene.createLayer();
    doc.history.execute(new LayerListCommand('New layer', extra, 1, true));
    doc.history.execute(new NodePropertyCommand('To layer', object, 'layer', extra));
    doc.history.execute(new LayerListCommand('Delete layer', extra, 1, false));
    expect(doc.scene.layers).toHaveLength(1);
    expect(object.layer).toBe(doc.scene.layers[0]);
    doc.history.undo();
    expect(object.layer).toBe(extra);
  });

  it('are written to .vox with the layer of each object, and read back', () => {
    const doc = VoxelDocument.createEmpty();
    const object = doc.scene.objects()[0]!;
    object.volume.set(0, 0, 0, 1);
    // A file without layer changes has no LAYR: open → save stays the same.
    expect(layrs(writeVox(doc))).toEqual([]);
    const extra = doc.scene.createLayer('Trees');
    doc.history.execute(new LayerListCommand('New layer', extra, 1, true));
    doc.history.execute(new NodePropertyCommand('To layer', object, 'layer', extra));
    doc.history.execute(new LayerPropertyCommand('Hide', extra, 'hidden', true));
    const bytes = writeVox(doc);
    expect(layrs(bytes)).toHaveLength(2);
    const read = readVox(bytes);
    const layer = read.scene.layers.find((l) => l.name === 'Trees')!;
    expect(layer.hidden).toBe(true);
    expect(read.scene.objects()[0]!.layer).toBe(layer);
    // Read and written again unchanged: the same chunks.
    expect(layrs(writeVox(read))).toEqual(layrs(bytes));
  });
});
