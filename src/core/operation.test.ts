import { describe, expect, it } from 'vitest';
import { cellsOperation, executeOperation, resultValue } from './operation';
import { VoxelVolume } from './volume';

function writer(v: VoxelVolume) {
  return {
    get: v.get.bind(v),
    set: (x: number, y: number, z: number, value: number) => void v.set(x, y, z, value),
  };
}

describe('operations', () => {
  it('adds into empty cells only, paints filled ones only, erases filled ones', () => {
    expect(resultValue('add', 5, 0)).toBe(5);
    expect(resultValue('add', 5, 3)).toBe(3);
    expect(resultValue('paint', 5, 0)).toBe(0);
    expect(resultValue('paint', 5, 3)).toBe(5);
    expect(resultValue('erase', 5, 3)).toBe(0);
    expect(resultValue('erase', 5, 0)).toBe(0);
  });

  it('executes over a list of cells and counts real changes', () => {
    const v = new VoxelVolume();
    v.set(1, 0, 0, 7);
    const cells = [0, 0, 0, 1, 0, 0, 2, 0, 0, 0, 0, 0];
    expect(executeOperation(cellsOperation('add', 4, cells), writer(v))).toBe(2);
    expect([v.get(0, 0, 0), v.get(1, 0, 0), v.get(2, 0, 0)]).toEqual([4, 7, 4]);
    expect(executeOperation(cellsOperation('paint', 9, cells), writer(v))).toBe(3);
    expect(executeOperation(cellsOperation('erase', 0, cells), writer(v))).toBe(3);
    expect(v.isEmpty).toBe(true);
  });
});
