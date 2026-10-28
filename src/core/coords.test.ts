import { describe, expect, it } from 'vitest';
import {
  CHUNK_COORD_MAX,
  CHUNK_COORD_MIN,
  CHUNK_SIZE,
  CHUNK_VOLUME,
  chunkKey,
  chunkKeyOfVoxel,
  FACE_NORMALS,
  faceAxis,
  faceOf,
  faceSign,
  indexX,
  indexY,
  indexZ,
  keyX,
  keyY,
  keyZ,
  toChunk,
  toLocal,
  VOXEL_COORD_MAX,
  VOXEL_COORD_MIN,
  voxelIndex,
} from './coords';

describe('chunk keys', () => {
  it('round-trips coordinates at the limits and around zero', () => {
    const values = [
      CHUNK_COORD_MIN,
      CHUNK_COORD_MIN + 1,
      -2,
      -1,
      0,
      1,
      2,
      CHUNK_COORD_MAX - 1,
      CHUNK_COORD_MAX,
    ];
    for (const x of values)
      for (const y of values)
        for (const z of values) {
          const key = chunkKey(x, y, z);
          expect(Number.isSafeInteger(key)).toBe(true);
          expect([keyX(key), keyY(key), keyZ(key)]).toEqual([x, y, z]);
        }
  });

  it('gives distinct keys to neighbours', () => {
    const keys = new Set<number>();
    for (let x = -2; x <= 2; x++)
      for (let y = -2; y <= 2; y++) for (let z = -2; z <= 2; z++) keys.add(chunkKey(x, y, z));
    expect(keys.size).toBe(125);
  });
});

describe('voxel coordinates', () => {
  it('splits negative coordinates into floor chunk and positive local', () => {
    expect(toChunk(-1)).toBe(-1);
    expect(toLocal(-1)).toBe(CHUNK_SIZE - 1);
    expect(toChunk(-CHUNK_SIZE)).toBe(-1);
    expect(toLocal(-CHUNK_SIZE)).toBe(0);
    expect(toChunk(-CHUNK_SIZE - 1)).toBe(-2);
    expect(toChunk(CHUNK_SIZE)).toBe(1);
    expect(toLocal(CHUNK_SIZE + 3)).toBe(3);
  });

  it('works at the voxel limits', () => {
    expect(toChunk(VOXEL_COORD_MIN)).toBe(CHUNK_COORD_MIN);
    expect(toChunk(VOXEL_COORD_MAX)).toBe(CHUNK_COORD_MAX);
    expect(chunkKeyOfVoxel(VOXEL_COORD_MAX, 0, VOXEL_COORD_MIN)).toBe(
      chunkKey(CHUNK_COORD_MAX, 0, CHUNK_COORD_MIN),
    );
  });

  it('indexes voxels with X fastest and round-trips', () => {
    expect(voxelIndex(1, 0, 0)).toBe(1);
    expect(voxelIndex(0, 1, 0)).toBe(CHUNK_SIZE);
    expect(voxelIndex(0, 0, 1)).toBe(CHUNK_SIZE * CHUNK_SIZE);
    expect(voxelIndex(31, 31, 31)).toBe(CHUNK_VOLUME - 1);
    for (let i = 0; i < CHUNK_VOLUME; i += 97) {
      expect(voxelIndex(indexX(i), indexY(i), indexZ(i))).toBe(i);
    }
  });
});

describe('faces', () => {
  it('maps face index to axis and sign consistently with the normals', () => {
    for (let f = 0; f < 6; f++) {
      const n = FACE_NORMALS[f]!;
      expect(n[faceAxis(f)]).toBe(faceSign(f));
      expect(faceOf(faceAxis(f), faceSign(f))).toBe(f);
    }
  });
});
