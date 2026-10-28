import { describe, expect, it } from 'vitest';
import { copyVoxels, nearestPaletteId, parseClip, remapClip, serializeClip } from './clipboard';
import { packRgba } from './color';
import { VoxelDocument } from './document';
import { Palette } from './palette';

function setup() {
  const doc = VoxelDocument.createEmpty();
  const object = doc.scene.objects()[0]!;
  object.volume.set(0, 0, 0, 3);
  object.volume.set(1, 0, 0, 7);
  object.volume.set(40, 0, 0, 7);
  return { doc, object };
}

describe('clipboard', () => {
  it('copies the selection with its colours, or everything without one', () => {
    const { doc, object } = setup();
    expect(copyVoxels(object, doc.palette)!.volume.voxelCount).toBe(3);
    object.selection.set(1, 0, 0, true);
    object.selection.set(5, 5, 5, true);
    const clip = copyVoxels(object, doc.palette)!;
    expect(clip.volume.voxelCount).toBe(1);
    expect(clip.volume.get(1, 0, 0)).toBe(7);
    expect([...clip.colors.keys()]).toEqual([7]);
  });

  it('keeps ids in the same palette and finds the nearest colours in another', () => {
    const { doc, object } = setup();
    const clip = copyVoxels(object, doc.palette)!;
    expect(remapClip(clip, doc.palette).get(1, 0, 0)).toBe(7);
    // A palette where colour 7 sits at id 2 and colour 3 is gone.
    const other = new Palette([
      { color: packRgba(0, 0, 0), material: new Map(), name: '' },
      { color: doc.palette.color(7), material: new Map(), name: '' },
      { color: doc.palette.color(3) - 1, material: new Map(), name: '' },
    ]);
    const mapped = remapClip(clip, other);
    expect(mapped.get(1, 0, 0)).toBe(2);
    expect(mapped.get(0, 0, 0)).toBe(3);
    expect(nearestPaletteId(other, packRgba(1, 1, 1))).toBe(1);
  });

  it('round-trips through clipboard text and ignores other text', () => {
    const { doc, object } = setup();
    const clip = copyVoxels(object, doc.palette)!;
    const back = parseClip(serializeClip(clip))!;
    expect(back.volume.voxelCount).toBe(3);
    expect(back.volume.get(40, 0, 0)).toBe(7);
    expect(back.colors.get(3)).toBe(doc.palette.color(3));
    expect(parseClip('hello')).toBeNull();
    expect(parseClip('voxels-clip/1 {broken')).toBeNull();
  });
});
