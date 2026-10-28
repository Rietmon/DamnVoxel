import { describe, expect, it } from 'vitest';
import { type CameraView, SetCameraSlotCommand } from '../core/cameras';
import { VoxelDocument } from '../core/document';
import { parseVoxFile } from '../formats/vox-chunks';
import { dictFromView, viewFromDict } from './vox-cameras';
import { readVox } from './vox-read';
import { writeVox } from './vox-write';

const dict = (...pairs: [string, string][]) => new Map(pairs);

const VIEW: CameraView = {
  target: [4, 2, -6],
  yaw: Math.PI / 4,
  pitch: Math.PI / 6,
  distance: 80,
  projection: 'perspective',
  fov: 40,
};

function cameraChunks(bytes: Uint8Array) {
  return parseVoxFile(bytes).chunks.filter((c) => c.id === 'rCAM');
}

describe('vox cameras', () => {
  it('reads a MagicaVoxel camera dictionary into a view and back', () => {
    const view = viewFromDict(
      dict(
        ['_mode', 'pers'],
        ['_focus', '1 2 3'],
        ['_angle', '30 45 0'],
        ['_radius', '120'],
        ['_fov', '45'],
      ),
    )!;
    // File (x, y, z) is editor (x, z, −y).
    expect(view.target).toEqual([1, 3, -2]);
    expect(view.pitch).toBeCloseTo(Math.PI / 6);
    expect(view.yaw).toBeCloseTo(Math.PI / 4);
    expect(view.distance).toBe(120);
    const back = dictFromView(view, dict(['_extra', 'x']));
    expect(back.get('_focus')).toBe('1 2 3');
    expect(back.get('_angle')).toBe('30 45 0');
    expect(back.get('_extra')).toBe('x');
    expect(viewFromDict(dict(['_mode', 'pers']))).toBeNull();
    expect(
      viewFromDict(
        dict(['_mode', 'orth'], ['_focus', '0 0 0'], ['_angle', '0 0'], ['_radius', '5']),
      )!.projection,
    ).toBe('orthographic');
  });

  it('saves slots in the file and reads them back', () => {
    const doc = VoxelDocument.createEmpty();
    doc.history.execute(new SetCameraSlotCommand(3, VIEW));
    const read = readVox(writeVox(doc));
    const slot = read.cameras[3]!;
    expect(slot.target).toEqual([4, 2, -6]);
    expect(slot.yaw).toBeCloseTo(VIEW.yaw);
    expect(slot.fov).toBe(40);
    expect(read.cameras.filter(Boolean)).toHaveLength(1);
  });

  it('writes an untouched camera back as it was, and an edited or cleared one anew', () => {
    const doc = VoxelDocument.createEmpty();
    doc.history.execute(new SetCameraSlotCommand(0, VIEW));
    doc.history.execute(new SetCameraSlotCommand(1, VIEW));
    const first = writeVox(doc);
    const reread = readVox(first);
    expect(cameraChunks(writeVox(reread))).toEqual(cameraChunks(first));
    reread.history.execute(new SetCameraSlotCommand(0, { ...VIEW, distance: 10 }));
    reread.history.execute(new SetCameraSlotCommand(1, null));
    const chunks = cameraChunks(writeVox(reread));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ cameraId: 0 });
    reread.history.undo();
    reread.history.undo();
    expect(cameraChunks(writeVox(reread))).toEqual(cameraChunks(first));
  });
});
