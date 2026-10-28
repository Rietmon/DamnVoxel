import { describe, expect, it } from 'vitest';
import { Chunk } from './chunk';
import { CHUNK_VOLUME, chunkKey } from './coords';
import { VoxelVolume } from './volume';

describe('VoxelVolume', () => {
  it('reads and writes across chunk borders and negative coordinates', () => {
    const v = new VoxelVolume();
    const points = [
      [0, 0, 0],
      [-1, -1, -1],
      [31, 32, -33],
      [1000, -2000, 5],
    ] as const;
    points.forEach(([x, y, z], i) => {
      expect(v.set(x, y, z, i + 1)).toBe(0);
    });
    points.forEach(([x, y, z], i) => {
      expect(v.get(x, y, z)).toBe(i + 1);
    });
    expect(v.get(1, 0, 0)).toBe(0);
    expect(v.voxelCount).toBe(4);
    expect(v.chunkCount).toBe(4);
  });

  it('creates no chunk for erasing empty space and removes chunks that become empty', () => {
    const v = new VoxelVolume();
    v.set(5, 5, 5, 0);
    expect(v.chunkCount).toBe(0);
    v.set(5, 5, 5, 2);
    v.set(6, 5, 5, 2);
    expect(v.chunkCount).toBe(1);
    v.set(5, 5, 5, 0);
    v.set(6, 5, 5, 0);
    expect(v.chunkCount).toBe(0);
    expect(v.isEmpty).toBe(true);
    expect(v.get(5, 5, 5)).toBe(0);
  });

  it('bumps chunk versions on every change and never repeats them', () => {
    const v = new VoxelVolume();
    v.set(0, 0, 0, 1);
    const key = chunkKey(0, 0, 0);
    const first = v.getChunk(key)!.version;
    v.set(0, 0, 0, 1);
    expect(v.getChunk(key)!.version).toBe(first);
    v.set(0, 0, 0, 2);
    const second = v.getChunk(key)!.version;
    expect(second).toBeGreaterThan(first);
    v.set(0, 0, 0, 0);
    v.set(0, 0, 0, 3);
    expect(v.getChunk(key)!.version).toBeGreaterThan(second);
  });

  it('marks only its own chunk dirty for interior edits and colour changes', () => {
    const v = new VoxelVolume();
    v.set(10, 10, 10, 1);
    expect(v.takeMeshDirty()).toEqual([chunkKey(0, 0, 0)]);
    v.set(0, 0, 0, 1);
    v.takeMeshDirty();
    // Repainting a border voxel does not change occupancy: neighbours keep their meshes.
    v.set(0, 0, 0, 2);
    expect(v.takeMeshDirty()).toEqual([chunkKey(0, 0, 0)]);
    expect(v.hasMeshDirty).toBe(false);
  });

  it('marks face, edge and corner neighbours when border occupancy changes', () => {
    const v = new VoxelVolume();
    v.set(31, 10, 10, 1);
    expect(new Set(v.takeMeshDirty())).toEqual(new Set([chunkKey(0, 0, 0), chunkKey(1, 0, 0)]));
    v.set(0, 31, 10, 1);
    expect(new Set(v.takeMeshDirty())).toEqual(
      new Set([chunkKey(0, 0, 0), chunkKey(-1, 0, 0), chunkKey(0, 1, 0), chunkKey(-1, 1, 0)]),
    );
    v.set(-1, -1, -1, 1);
    expect(v.takeMeshDirty().length).toBe(8);
  });

  it('computes tight bounds lazily and updates them after edits', () => {
    const v = new VoxelVolume();
    expect(v.getBounds()).toBeNull();
    v.set(3, 4, 5, 1);
    expect(v.getBounds()).toEqual({ minX: 3, minY: 4, minZ: 5, maxX: 3, maxY: 4, maxZ: 5 });
    v.set(-40, 100, 5, 1);
    expect(v.getBounds()).toEqual({ minX: -40, minY: 4, minZ: 5, maxX: 3, maxY: 100, maxZ: 5 });
    v.set(-40, 100, 5, 0);
    expect(v.getBounds()).toEqual({ minX: 3, minY: 4, minZ: 5, maxX: 3, maxY: 4, maxZ: 5 });
  });

  it('replaces and removes whole chunks', () => {
    const v = new VoxelVolume();
    const key = chunkKey(1, 0, 0);
    v.putChunk(key, Chunk.uniform(4));
    expect(v.voxelCount).toBe(CHUNK_VOLUME);
    expect(v.get(32, 0, 0)).toBe(4);
    expect(v.getBounds()).toEqual({ minX: 32, minY: 0, minZ: 0, maxX: 63, maxY: 31, maxZ: 31 });
    expect(v.takeMeshDirty().length).toBe(27);
    v.putChunk(key, null);
    expect(v.voxelCount).toBe(0);
    expect(v.get(32, 0, 0)).toBe(0);
    expect(v.getBounds()).toBeNull();
    v.putChunk(key, new Chunk());
    expect(v.chunkCount).toBe(0);
  });

  it('does not serve a stale cached chunk after replacement', () => {
    const v = new VoxelVolume();
    v.set(0, 0, 0, 1);
    expect(v.get(0, 0, 0)).toBe(1);
    v.putChunk(chunkKey(0, 0, 0), Chunk.uniform(9));
    expect(v.get(0, 0, 0)).toBe(9);
    v.putChunk(chunkKey(0, 0, 0), null);
    expect(v.get(0, 0, 0)).toBe(0);
    v.set(0, 0, 0, 5);
    expect(v.get(0, 0, 0)).toBe(5);
  });

  it('clears every chunk and marks their meshes stale', () => {
    const v = new VoxelVolume();
    v.set(0, 0, 0, 1);
    v.set(100, 0, 0, 1);
    v.takeMeshDirty();
    v.clear();
    expect(v.isEmpty).toBe(true);
    expect(v.chunkCount).toBe(0);
    expect(v.getBounds()).toBeNull();
    expect(v.get(0, 0, 0)).toBe(0);
    expect(v.takeMeshDirty().length).toBe(54);
  });
});
