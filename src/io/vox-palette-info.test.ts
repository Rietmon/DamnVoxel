import { describe, expect, it } from 'vitest';
import { packRgba } from '../core/color';
import { VoxelDocument } from '../core/document';
import {
  applyColors,
  colorCounts,
  namedEntry,
  PaletteEntriesCommand,
  PaletteNotesCommand,
  rampOf,
  stepInRamp,
} from '../core/palette-edit';
import { linkedCopiesOf } from '../core/scene-edit';
import { readVox } from './vox-read';
import { writeVox } from './vox-write';

describe('palette information', () => {
  it('counts voxels per colour, linked copies once', () => {
    const doc = VoxelDocument.createEmpty();
    const object = doc.scene.objects()[0]!;
    object.volume.set(0, 0, 0, 3);
    object.volume.set(1, 0, 0, 3);
    object.volume.set(2, 0, 0, 9);
    linkedCopiesOf(doc, [object]);
    const counts = colorCounts(doc.scene);
    expect(counts[3]).toBe(2);
    expect(counts[9]).toBe(1);
    expect(counts[4]).toBe(0);
  });

  it('keeps colour names and row notes through .vox', () => {
    const doc = VoxelDocument.createEmpty();
    doc.scene.objects()[0]!.volume.set(0, 0, 0, 1);
    const p = doc.palette;
    doc.history.execute(
      new PaletteEntriesCommand('Name', p, [5], [namedEntry(p.entry(5), 'bark')]),
    );
    doc.history.execute(new PaletteNotesCommand(p, ['trunks', '', 'leaves']));
    const read = readVox(writeVox(doc));
    expect(read.palette.entry(5).name).toBe('bark');
    expect(read.palette.notes).toEqual(['trunks', '', 'leaves']);
    doc.history.undo();
    expect(p.notes).toEqual([]);
    expect(namedEntry(p.entry(5), '').material.has('_name')).toBe(false);
  });
});

describe('ramps', () => {
  it('steps within a ramp of eight, wrapping, and across ramps at the same place', () => {
    const doc = VoxelDocument.createEmpty();
    const p = doc.palette;
    expect(stepInRamp(p, 3, 1)).toBe(4);
    expect(stepInRamp(p, 8, 1)).toBe(1);
    expect(stepInRamp(p, 1, -1)).toBe(8);
    expect(stepInRamp(p, 3, 1, true)).toBe(11);
    expect(stepInRamp(p, 3, -1, true)).toBe(251);
    expect(rampOf(p, 12)).toEqual([9, 10, 11, 12, 13, 14, 15, 16]);
  });
});

describe('applying a palette', () => {
  it('replaces colours by id, or moves voxels to the nearest new colour', () => {
    const doc = VoxelDocument.createEmpty();
    const object = doc.scene.objects()[0]!;
    const p = doc.palette;
    object.volume.set(0, 0, 0, 40);
    const before = p.color(40);
    const colors = [packRgba(0, 0, 0), before, packRgba(255, 255, 255)];
    applyColors(doc, colors, 'remap');
    expect(object.volume.get(0, 0, 0)).toBe(2);
    expect(p.color(2)).toBe(before);
    doc.history.undo();
    expect(object.volume.get(0, 0, 0)).toBe(40);
    applyColors(doc, colors, 'replace');
    expect(object.volume.get(0, 0, 0)).toBe(40);
    expect(p.color(1)).toBe(packRgba(0, 0, 0));
  });
});
