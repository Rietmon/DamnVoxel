import { describe, expect, it } from 'vitest';
import { VoxelDocument } from '../core/document';
import { linkedCopies, linkedCopiesOf, UnlinkCommand } from '../core/scene-edit';
import { parseVoxFile } from '../formats/vox-chunks';
import { readVox } from './vox-read';
import { writeVox } from './vox-write';

const models = (bytes: Uint8Array) => parseVoxFile(bytes).chunks.filter((c) => c.id === 'XYZI');

describe('linked copies', () => {
  it('share voxels until unlinked, undoably', () => {
    const doc = VoxelDocument.createEmpty();
    const object = doc.scene.objects()[0]!;
    object.volume.set(0, 0, 0, 2);
    const [copy] = linkedCopiesOf(doc, [object]);
    expect(copy!.volume).toBe(object.volume);
    expect(linkedCopies(doc.scene, object)).toEqual([copy]);
    object.volume.set(1, 0, 0, 3);
    expect(copy!.volume.get(1, 0, 0)).toBe(3);
    doc.history.execute(new UnlinkCommand(copy!));
    expect(copy!.volume).not.toBe(object.volume);
    expect(copy!.volume.get(1, 0, 0)).toBe(3);
    doc.history.undo();
    expect(copy!.volume).toBe(object.volume);
    doc.history.undo();
    expect(doc.scene.objects()).toHaveLength(1);
  });

  it('are one model in .vox, and come back linked', () => {
    const doc = VoxelDocument.createEmpty();
    const object = doc.scene.objects()[0]!;
    object.volume.set(0, 0, 0, 2);
    const [copy] = linkedCopiesOf(doc, [object]);
    copy!.transform = { x: 10, y: 0, z: 0, orientation: 0 };
    const bytes = writeVox(doc);
    expect(models(bytes)).toHaveLength(1);
    const read = readVox(bytes);
    const [a, b] = read.scene.objects();
    expect(a!.volume).toBe(b!.volume);
  });
});
