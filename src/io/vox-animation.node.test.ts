import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AnimationSettingsCommand,
  BakeCommand,
  KeyCommand,
  keyAt,
  keyFrames,
  placementAt,
  showFrame,
} from '../core/animation';
import { VoxelDocument } from '../core/document';
import { transformNodes } from '../core/scene-edit';
import { readVox } from './vox-read';
import { writeVox } from './vox-write';

describe('animation', () => {
  it('holds a key until the next one', () => {
    const keys = new Map([
      [0, 'a'],
      [4, 'b'],
      [8, 'c'],
    ]);
    expect(keyAt(keys, 3)).toBe('a');
    expect(keyAt(keys, 4)).toBe('b');
    expect(keyAt(keys, 99)).toBe('c');
    expect(keyAt(new Map([[5, 'x']]), 0)).toBe('x');
    expect(keyAt(new Map(), 0)).toBeUndefined();
  });

  it('keys models and placements, shows them by frame, and moving an animated object keys it', () => {
    const doc = VoxelDocument.createEmpty();
    const object = doc.scene.objects()[0]!;
    object.volume.set(0, 0, 0, 1);
    showFrame(doc, 5);
    doc.history.execute(new KeyCommand(object, 5, 'model', true, 0));
    expect(keyFrames(object)).toEqual([0, 5]);
    object.volume.set(1, 0, 0, 2);
    showFrame(doc, 0);
    expect(object.volume.get(1, 0, 0)).toBe(0);
    showFrame(doc, 6);
    expect(object.volume.get(1, 0, 0)).toBe(2);
    doc.history.execute(new KeyCommand(object, 6, 'place', true, 0));
    transformNodes(doc, [object], { x: 3, y: 0, z: 0, orientation: 0 }, 'Move');
    expect(object.keys!.transforms.get(6)!.x).toBe(3);
    showFrame(doc, 0);
    expect(object.transform.x).toBe(0);
    doc.history.undo();
    showFrame(doc, 6);
    expect(object.transform.x).toBe(0);
  });

  it('writes keys to .vox frames and reads them back', () => {
    const doc = VoxelDocument.createEmpty();
    const object = doc.scene.objects()[0]!;
    object.volume.set(0, 0, 0, 1);
    showFrame(doc, 4);
    doc.history.execute(new KeyCommand(object, 4, 'model', true, 0));
    object.volume.set(0, 3, 0, 2);
    doc.history.execute(new KeyCommand(object, 4, 'place', true, 0));
    transformNodes(doc, [object], { x: 0, y: 0, z: 7, orientation: 0 }, 'Move');
    doc.history.execute(new AnimationSettingsCommand(doc, { end: 10 }));
    const read = readVox(writeVox(doc));
    const back = read.scene.objects()[0]!;
    expect(keyFrames(back)).toEqual([0, 4]);
    showFrame(read, 0);
    expect(back.volume.voxelCount).toBe(1);
    const at0 = back.transform.z;
    showFrame(read, 4);
    expect(back.volume.voxelCount).toBe(2);
    expect(back.transform.z - at0).toBe(7);
  });

  it('reads the frames of an animated file', () => {
    const bytes = new Uint8Array(
      readFileSync(join(__dirname, '../../tests/fixtures/vox/animation.vox')),
    );
    const doc = readVox(bytes);
    const animated = doc.scene.objects().find((o) => o.keys);
    expect(animated).toBeDefined();
    expect(keyFrames(animated!)).toEqual([0, 4, 8]);
  });
});

describe('placement keys', () => {
  it('glide between keys when smooth, and bake into a key per frame', () => {
    const doc = VoxelDocument.createEmpty();
    const object = doc.scene.objects()[0]!;
    object.volume.set(0, 0, 0, 1);
    doc.history.execute(new KeyCommand(object, 0, 'place', true, 0));
    showFrame(doc, 10);
    doc.history.execute(new KeyCommand(object, 10, 'place', true, 0));
    transformNodes(doc, [object], { x: 10, y: 0, z: 0, orientation: 0 }, 'Move');
    showFrame(doc, 4);
    expect(object.transform.x).toBe(0);
    doc.history.execute(new AnimationSettingsCommand(doc, { smooth: true }));
    showFrame(doc, 4);
    expect(object.transform.x).toBe(4);
    expect(placementAt(object.keys!.transforms, 7, true)!.x).toBe(7);
    doc.history.execute(new BakeCommand(doc));
    expect(object.keys!.transforms.size).toBe(11);
    doc.history.undo();
    expect(object.keys!.transforms.size).toBe(2);
  });
});
