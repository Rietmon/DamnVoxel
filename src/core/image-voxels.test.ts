import { describe, expect, it } from 'vitest';
import { blue, green, red } from './color';
import {
  heightmapToVolume,
  type Picture,
  pictureToVolume,
  sheetColumns,
  slicesToVolume,
  volumeSlices,
} from './image-voxels';
import { Palette } from './palette';
import { VoxelVolume } from './volume';

const palette = () => Palette.createDefault();

/** A picture from rows of pixels: null is clear, numbers are grey levels. */
function picture(rows: (number | null)[][]): Picture {
  const height = rows.length;
  const width = rows[0]!.length;
  const data = new Uint8ClampedArray(width * height * 4);
  for (const [y, row] of rows.entries())
    for (const [x, v] of row.entries())
      if (v !== null) data.set([v, v, v, 255], (y * width + x) * 4);
  return { width, height, data };
}

describe('pictures and voxels', () => {
  it('stands a picture up, or lays it down, skipping clear pixels', () => {
    const pic = picture([
      [255, null],
      [0, 255],
    ]);
    const p = palette();
    const up = pictureToVolume(pic, p, 'upright');
    expect(up.voxelCount).toBe(3);
    // The top row is the highest.
    expect(up.get(0, 1, 0)).not.toBe(0);
    expect(up.get(1, 1, 0)).toBe(0);
    const white = up.get(0, 1, 0);
    expect([red(p.color(white)), green(p.color(white)), blue(p.color(white))]).toEqual([
      255, 255, 255,
    ]);
    const flat = pictureToVolume(pic, p, 'flat');
    expect(flat.get(1, 0, 1)).toBe(white);
    expect(flat.get(1, 0, 0)).toBe(0);
  });

  it('raises bright pixels of a height map', () => {
    const v = heightmapToVolume(picture([[0, 128, 255]]), palette(), 10, 5);
    expect(
      [0, 1, 2].map((x) => [...Array(11)].filter((_, y) => v.get(x, y, 0) !== 0).length),
    ).toEqual([1, 5, 10]);
    expect(v.get(2, 9, 0)).toBe(5);
  });

  it('turns a model into slices and back', () => {
    const p = palette();
    const v = new VoxelVolume();
    v.set(-2, 3, 1, 10);
    v.set(0, 3, 1, 20);
    v.set(-1, 5, 2, 30);
    const s = volumeSlices(v, p)!;
    expect([s.width, s.depth, s.layers.length]).toEqual([3, 2, 3]);
    // The middle layer (y 4) is empty.
    expect(s.layers[1]!.every((b) => b === 0)).toBe(true);
    const columns = sheetColumns(s.layers.length);
    expect(columns).toBe(2);
    // Lay them out in a grid, as the export does, and read them back.
    const sheet = new Uint8ClampedArray(columns * s.width * 2 * s.depth * 4);
    const sw = columns * s.width;
    s.layers.forEach((layer, k) => {
      for (let z = 0; z < s.depth; z++)
        sheet.set(
          layer.subarray(z * s.width * 4, (z + 1) * s.width * 4),
          ((Math.floor(k / columns) * s.depth + z) * sw + (k % columns) * s.width) * 4,
        );
    });
    const back = slicesToVolume(
      { width: sw, height: 2 * s.depth, data: sheet },
      s.width,
      s.depth,
      p,
    );
    expect(back.voxelCount).toBe(3);
    expect(back.get(0, 0, 0)).toBe(10);
    expect(back.get(2, 0, 0)).toBe(20);
    expect(back.get(1, 2, 1)).toBe(30);
  });
});
