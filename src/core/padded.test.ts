import { describe, expect, it } from 'vitest';
import { paddedIndex } from '../kernels/mesher';
import { Chunk } from './chunk';
import { chunkKey } from './coords';
import { buildPadded, createPaddedBuffer } from './padded';
import { sliceClip } from './slice';
import { VoxelVolume } from './volume';

describe('buildPadded', () => {
  it('returns false for a missing chunk', () => {
    expect(buildPadded(new VoxelVolume(), 0, 0, 0, createPaddedBuffer())).toBe(false);
  });

  it('copies the chunk and the shell from all 26 neighbours', () => {
    const v = new VoxelVolume();
    v.set(5, 6, 7, 1); // inside
    v.set(-1, 3, 3, 2); // −X face neighbour
    v.set(32, 32, 4, 3); // +X+Y edge neighbour
    v.set(-1, -1, -1, 4); // −X−Y−Z corner neighbour
    v.set(-2, 3, 3, 5); // too far: not in the shell
    v.putChunk(chunkKey(0, 0, 1), Chunk.uniform(6)); // +Z face neighbour, uniform
    const out = createPaddedBuffer();
    expect(buildPadded(v, 0, 0, 0, out)).toBe(true);
    expect(out[paddedIndex(5, 6, 7)]).toBe(1);
    expect(out[paddedIndex(-1, 3, 3)]).toBe(2);
    expect(out[paddedIndex(32, 32, 4)]).toBe(3);
    expect(out[paddedIndex(-1, -1, -1)]).toBe(4);
    expect(out[paddedIndex(10, 10, 32)]).toBe(6);
    expect(out[paddedIndex(10, 10, -1)]).toBe(0);
    let nonZero = 0;
    for (const value of out) if (value) nonZero++;
    expect(nonZero).toBe(4 + 32 * 32);
  });

  it('empties the layers a slice hides, so the cut gets faces', () => {
    const v = new VoxelVolume();
    for (let y = 0; y < 10; y++) v.set(3, y, 3, 1);
    const out = createPaddedBuffer();
    buildPadded(
      v,
      0,
      0,
      0,
      out,
      sliceClip({ x: 0, y: 0, z: 0, orientation: 0 }, { axis: 1, at: 4, dir: 1 }),
    );
    expect(out[paddedIndex(3, 4, 3)]).toBe(1);
    expect(out[paddedIndex(3, 5, 3)]).toBe(0);
    expect(out[paddedIndex(3, 9, 3)]).toBe(0);
    // A clip below the whole chunk leaves an empty block.
    buildPadded(
      v,
      0,
      0,
      0,
      out,
      sliceClip({ x: 0, y: 0, z: 0, orientation: 0 }, { axis: 1, at: -2, dir: 1 }),
    );
    expect(out.every((x) => x === 0)).toBe(true);
  });
});
