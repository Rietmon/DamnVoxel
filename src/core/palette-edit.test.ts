import { describe, expect, it } from 'vitest';
import { blue, green, packRgba, red } from './color';
import { VoxelDocument } from './document';
import {
  blendColor,
  duplicateEntries,
  inDisplayOrder,
  movedOrder,
  PaletteEntriesCommand,
  PaletteOrderCommand,
  paletteGradient,
  shiftLike,
  usedIds,
} from './palette-edit';

describe('palette edits', () => {
  it('moves ids as one block before another id', () => {
    const order = [1, 2, 3, 4, 5, 6];
    expect(movedOrder(order, [5, 2], 4)).toEqual([1, 3, 2, 5, 4, 6]);
    expect(movedOrder(order, [1, 2], null)).toEqual([3, 4, 5, 6, 1, 2]);
    // Dropped on itself: stays put.
    expect(movedOrder(order, [3], 3)).toEqual(order);
    expect(movedOrder(order, [3, 4], 4)).toEqual(order);
  });

  it('reorders the panel without touching voxels, undoably', () => {
    const doc = VoxelDocument.createEmpty();
    const object = doc.scene.objects()[0]!;
    object.volume.set(0, 0, 0, 7);
    const palette = doc.palette;
    const colour = palette.color(7);
    doc.history.execute(
      new PaletteOrderCommand('Order', palette, movedOrder(palette.displayOrder(), [7], 1)),
    );
    expect(palette.displayOrder().slice(0, 3)).toEqual([7, 1, 2]);
    expect(object.volume.get(0, 0, 0)).toBe(7);
    expect(palette.color(7)).toBe(colour);
    expect(inDisplayOrder(palette, [2, 7, 1])).toEqual([7, 1, 2]);
    doc.history.undo();
    expect(palette.displayOrder().slice(0, 3)).toEqual([1, 2, 3]);
  });

  it('merges colour edits of the same entries', () => {
    const doc = VoxelDocument.createEmpty();
    const p = doc.palette;
    const edit = (c: number) =>
      new PaletteEntriesCommand('Color', p, [3], [{ ...p.entry(3), color: c }]);
    const original = p.color(3);
    doc.history.execute(edit(packRgba(10, 0, 0)), { merge: true });
    doc.history.execute(edit(packRgba(20, 0, 0)), { merge: true });
    expect(doc.history.undoDepth).toBe(1);
    expect(p.color(3)).toBe(packRgba(20, 0, 0));
    doc.history.undo();
    expect(p.color(3)).toBe(original);
  });

  it('blends gradients evenly between the end colours', () => {
    const black = packRgba(0, 0, 0);
    const white = packRgba(255, 255, 255);
    expect(blendColor(black, white, 0)).toBe(black);
    expect(blendColor(black, white, 1)).toBe(white);
    const mid = blendColor(black, white, 0.5);
    // OKLab mid-grey is perceptually half way: lighter than the RGB average 128 in sRGB terms.
    expect(red(mid)).toBe(green(mid));
    expect(red(mid)).toBe(blue(mid));
    expect(red(mid)).toBeGreaterThan(90);
    expect(red(mid)).toBeLessThan(140);

    const doc = VoxelDocument.createEmpty();
    const p = doc.palette;
    p.setEntry(1, { ...p.entry(1), color: black });
    p.setEntry(5, { ...p.entry(5), color: white });
    expect(paletteGradient(doc, [5, 1, 3])).toBe(true);
    // Only the entry between the ends changed.
    expect(p.color(1)).toBe(black);
    expect(p.color(5)).toBe(white);
    expect(p.color(3)).toBe(mid);
    expect(paletteGradient(doc, [1, 5])).toBe(false);
  });

  it('duplicates colours into unused entries right after the selection', () => {
    const doc = VoxelDocument.createEmpty();
    const object = doc.scene.objects()[0]!;
    object.volume.set(0, 0, 0, 2);
    object.volume.set(1, 0, 0, 3);
    object.volume.set(40, 0, 0, 4);
    expect([...usedIds(doc.scene)].sort()).toEqual([2, 3, 4]);
    const p = doc.palette;
    const targets = duplicateEntries(doc, [2])!;
    // 3 and 4 are used, so the copy lands in 5 and moves next to 2 in the panel.
    expect(targets).toEqual([5]);
    expect(p.color(5)).toBe(p.color(2));
    expect(p.displayOrder().slice(0, 4)).toEqual([1, 2, 5, 3]);
    expect(doc.history.undoDepth).toBe(1);
    doc.history.undo();
    expect(p.displayOrder().slice(0, 4)).toEqual([1, 2, 3, 4]);
    expect(p.color(5)).not.toBe(p.color(2));
  });

  it('refuses to duplicate when no entries are free', () => {
    const doc = VoxelDocument.createEmpty();
    const object = doc.scene.objects()[0]!;
    for (let id = 1; id <= 255; id++) object.volume.set(id, 0, 0, id);
    expect(duplicateEntries(doc, [1])).toBeNull();
    expect(doc.history.undoDepth).toBe(0);
  });

  it('moves other colours by the same HSV step as the edited one', () => {
    const red0 = packRgba(200, 40, 40);
    const redLight = packRgba(240, 120, 120);
    // The edited colour turns from red to green (hue +120°): the others turn the same way.
    const green0 = packRgba(40, 200, 40);
    const shifted = shiftLike(redLight, red0, green0);
    expect(green(shifted)).toBeGreaterThan(red(shifted));
    expect(green(shifted)).toBeGreaterThan(blue(shifted));
    // Darkening by value darkens the others too, and greys only move in value.
    const darker = shiftLike(packRgba(128, 128, 128), red0, packRgba(100, 20, 20));
    expect(red(darker)).toBe(green(darker));
    expect(red(darker)).toBeLessThan(128);
    expect(shiftLike(redLight, red0, red0)).toBe(redLight);
  });

  it('undoes every kind of palette change back to the exact starting palette', () => {
    const doc = VoxelDocument.createEmpty();
    doc.scene.objects()[0]!.volume.set(0, 0, 0, 9);
    const p = doc.palette;
    const snapshot = () => ({
      order: [...p.displayOrder()],
      colours: p.displayOrder().map((id) => p.color(id)),
    });
    const start = snapshot();
    doc.history.execute(
      new PaletteOrderCommand('Order', p, movedOrder(p.displayOrder(), [9, 10], 1)),
    );
    paletteGradient(doc, [1, 2, 3, 4, 5]);
    duplicateEntries(doc, [9]);
    doc.history.execute(
      new PaletteEntriesCommand(
        'Color',
        p,
        [9, 30],
        [
          { ...p.entry(9), color: packRgba(1, 2, 3) },
          { ...p.entry(30), color: shiftLike(p.color(30), p.color(9), packRgba(1, 2, 3)) },
        ],
      ),
    );
    expect(snapshot()).not.toEqual(start);
    while (doc.history.undo());
    expect(snapshot()).toEqual(start);
    // The voxel never changed its id along the way.
    expect(doc.scene.objects()[0]!.volume.get(0, 0, 0)).toBe(9);
  });
});
