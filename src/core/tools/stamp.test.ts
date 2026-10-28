import { describe, expect, it } from 'vitest';
import { FACE_NEG_Y, FACE_POS_X, FACE_POS_Y } from '../coords';
import { VoxelVolume } from '../volume';
import { stampCells } from './stamp';

const empty = new VoxelVolume();

function cells(list: number[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < list.length; i += 3) out.push(`${list[i]},${list[i + 1]},${list[i + 2]}`);
  return out.sort();
}

describe('stampCells', () => {
  it('makes N³ cubes and N² plane stamps centred on odd sizes', () => {
    for (const size of [1, 3, 5]) {
      const cube = stampCells(
        [0, 0, 0],
        FACE_POS_Y,
        [0.5, 0, 0.5],
        { shape: 'cube', mode: 'volume', size, action: 'add' },
        empty,
      );
      expect(cube.length / 3).toBe(size ** 3);
      const plane = stampCells(
        [0, 0, 0],
        FACE_POS_Y,
        [0.5, 0, 0.5],
        { shape: 'cube', mode: 'plane', size, action: 'add' },
        empty,
      );
      expect(plane.length / 3).toBe(size ** 2);
      // Plane stamps stay in the layer of the hit face: y = 0 for a hit on a +Y face.
      expect(cells(plane).every((c) => c.split(',')[1] === '0')).toBe(true);
    }
    const three = cells(
      stampCells(
        [4, 4, 4],
        FACE_POS_Y,
        [4.5, 4, 4.5],
        { shape: 'cube', mode: 'volume', size: 3, action: 'add' },
        empty,
      ),
    );
    expect(three[0]).toBe('3,3,3');
    expect(three.at(-1)).toBe('5,5,5');
  });

  it('rounds spheres: size 3 keeps edges and drops corners', () => {
    const s3 = stampCells(
      [0, 0, 0],
      FACE_POS_Y,
      [0.5, 1, 0.5],
      { shape: 'sphere', mode: 'volume', size: 3, action: 'add' },
      empty,
    );
    expect(s3.length / 3).toBe(19);
    const s1 = stampCells(
      [0, 0, 0],
      FACE_POS_Y,
      [0.5, 1, 0.5],
      { shape: 'sphere', mode: 'volume', size: 1, action: 'add' },
      empty,
    );
    expect(s1).toEqual([0, 0, 0]);
    const s8 = stampCells(
      [0, 0, 0],
      FACE_POS_Y,
      [0.5, 1, 0.5],
      { shape: 'sphere', mode: 'volume', size: 8, action: 'add' },
      empty,
    );
    // Close to the volume of a ball of radius 4.
    expect(s8.length / 3).toBeGreaterThan(250);
    expect(s8.length / 3).toBeLessThan(330);
  });

  it('shifts even stamps towards the pointer side and away from the surface for add', () => {
    const left = cells(
      stampCells(
        [0, 0, 0],
        FACE_POS_Y,
        [0.2, 0, 0.2],
        { shape: 'cube', mode: 'volume', size: 2, action: 'add' },
        empty,
      ),
    );
    expect(left).toContain('-1,0,-1');
    expect(left).toContain('0,1,0');
    expect(left).not.toContain('0,-1,0');
    const right = cells(
      stampCells(
        [0, 0, 0],
        FACE_POS_Y,
        [0.8, 0, 0.8],
        { shape: 'cube', mode: 'volume', size: 2, action: 'add' },
        empty,
      ),
    );
    expect(right).toContain('1,0,1');
    // Erasing from below grows up into the model.
    const erase = cells(
      stampCells(
        [0, 0, 0],
        FACE_NEG_Y,
        [0.8, 0, 0.8],
        { shape: 'cube', mode: 'volume', size: 2, action: 'erase' },
        empty,
      ),
    );
    expect(erase).toContain('0,1,0');
    expect(erase).not.toContain('0,-1,0');
  });

  it('keeps only the surface layer in surface mode', () => {
    const v = new VoxelVolume();
    for (let x = -3; x <= 3; x++)
      for (let y = -3; y <= 0; y++) for (let z = -3; z <= 3; z++) v.set(x, y, z, 1);
    const erase = cells(
      stampCells(
        [0, 0, 0],
        FACE_POS_Y,
        [0.5, 1, 0.5],
        { shape: 'cube', mode: 'surface', size: 3, action: 'erase' },
        v,
      ),
    );
    // Only the top layer (y = 0) is exposed.
    expect(erase).toHaveLength(9);
    expect(erase.every((c) => c.split(',')[1] === '0')).toBe(true);
    const add = cells(
      stampCells(
        [0, 1, 0],
        FACE_POS_Y,
        [0.5, 1, 0.5],
        { shape: 'cube', mode: 'surface', size: 3, action: 'add' },
        v,
      ),
    );
    expect(add).toHaveLength(9);
    expect(add.every((c) => c.split(',')[1] === '1')).toBe(true);
  });

  it('lays plane stamps across side faces too', () => {
    const plane = cells(
      stampCells(
        [5, 0, 0],
        FACE_POS_X,
        [5, 0.5, 0.5],
        { shape: 'cube', mode: 'plane', size: 3, action: 'add' },
        empty,
      ),
    );
    expect(plane).toHaveLength(9);
    expect(plane.every((c) => c.startsWith('5,'))).toBe(true);
  });
});
