import { describe, expect, it } from 'vitest';
import { enclosedCells, floodVoxels, hiddenVoxels, hollowVoxels, interiorCells } from './fill';
import { VoxelVolume } from './volume';

/** A solid 5³ cube of colour 2 at 0…4 with a column of colour 3 through x = 2, z = 2. */
function cube(): VoxelVolume {
  const v = new VoxelVolume();
  for (let x = 0; x < 5; x++)
    for (let y = 0; y < 5; y++)
      for (let z = 0; z < 5; z++) v.set(x, y, z, x === 2 && z === 2 ? 3 : 2);
  return v;
}

const box = (v: VoxelVolume) => v.getBounds()!;

describe('fills', () => {
  it('floods one colour through the model, or only in one layer', () => {
    const v = cube();
    expect(floodVoxels(v, [2, 0, 2])!.length / 3).toBe(5);
    expect(floodVoxels(v, [0, 0, 0])!.length / 3).toBe(120);
    expect(floodVoxels(v, [0, 4, 0], { layerAxis: 1 })!.length / 3).toBe(24);
    expect(floodVoxels(v, [0, 4, 0], { anyColor: true, layerAxis: 1 })!.length / 3).toBe(25);
    expect(floodVoxels(v, [9, 9, 9])).toEqual([]);
  });

  it('fills a closed outline in a layer, and refuses an open one', () => {
    const v = new VoxelVolume();
    // A 5 × 5 square ring at y = 0.
    for (let i = 0; i < 5; i++) {
      v.set(i, 0, 0, 1);
      v.set(i, 0, 4, 1);
      v.set(0, 0, i, 1);
      v.set(4, 0, i, 1);
    }
    expect(enclosedCells(v, [2, 0, 2], 1, box(v))!.length / 3).toBe(9);
    v.set(0, 0, 2, 0);
    expect(enclosedCells(v, [2, 0, 2], 1, box(v))).toBeNull();
    expect(enclosedCells(v, [4, 0, 4], 1, box(v))).toBeNull();
  });
});

describe('cavities', () => {
  it('finds the voxels that never show, and a hollow shell of a given wall', () => {
    const v = cube();
    expect(hiddenVoxels(v, box(v))!.length / 3).toBe(27);
    expect(hollowVoxels(v, box(v), 1)!.length / 3).toBe(27);
    expect(hollowVoxels(v, box(v), 2)!.length / 3).toBe(1);
    expect(hollowVoxels(v, box(v), 3)).toEqual([]);
  });

  it('finds empty pockets inside and leaves open ones alone', () => {
    const v = cube();
    for (let x = 1; x < 4; x++)
      for (let y = 1; y < 4; y++) for (let z = 1; z < 4; z++) v.set(x, y, z, 0);
    expect(interiorCells(v, box(v))!.length / 3).toBe(27);
    // A hole in the wall lets the air out.
    v.set(2, 4, 2, 0);
    expect(interiorCells(v, box(v))).toEqual([]);
    // With the pocket open to the air, every remaining voxel shows.
    expect(hiddenVoxels(v, box(v))).toEqual([]);
  });
});
