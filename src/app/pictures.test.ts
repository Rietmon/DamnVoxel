import { describe, expect, it } from 'vitest';
import { VoxelDocument } from '../core/document';
import { quarterTurn } from '../core/orientation';
import { DEFAULT_PICTURES, guessSlices, vetPictures, worldVolume } from './pictures';

describe('picture import and slices', () => {
  it('reads the slice size from the name the export gives, or guesses square slices', () => {
    expect(guessSlices('House slices 24x16x40.png', 96, 160)).toEqual({ width: 24, depth: 16 });
    expect(guessSlices('sheet.png', 160, 16)).toEqual({ width: 16, depth: 16 });
    expect(guessSlices('sheet.png', 16, 160)).toEqual({ width: 16, depth: 16 });
    expect(guessSlices('odd.png', 30, 20)).toEqual({ width: 20, depth: 20 });
  });

  it('puts objects together in world cells', () => {
    const doc = VoxelDocument.createEmpty();
    const a = doc.scene.objects()[0]!;
    a.volume.set(0, 0, 0, 1);
    const b = doc.scene.createObject('b');
    doc.scene.attach(b, doc.scene.root);
    b.volume.set(1, 0, 0, 2);
    b.transform = { x: 5, y: 2, z: 0, orientation: quarterTurn(1) };
    const v = worldVolume([a, b]);
    expect(v.voxelCount).toBe(2);
    expect(v.get(0, 0, 0)).toBe(1);
    const box = v.getBounds()!;
    expect(box.maxY).toBe(2);
  });

  it('keeps stored settings in range', () => {
    expect(vetPictures({ ...DEFAULT_PICTURES, maxHeight: 9999, mode: 'x' as 'plane' })).toEqual({
      ...DEFAULT_PICTURES,
      maxHeight: 256,
    });
  });
});
