import { describe, expect, it } from 'vitest';
import { mirrorCenterOf, mirrorCoord, mirrorModifier, toggleKeel } from './mirror';
import { cellsOperation, type Operation } from './operation';

function cells(op: Operation): Set<string> {
  const out = new Set<string>();
  op.forEachCell((x, y, z) => out.add(`${x},${y},${z}`));
  return out;
}

describe('mirror', () => {
  it('maps cells across a plane between voxels and through a voxel', () => {
    // center2 = 0: plane at x = 0, between voxels −1 and 0.
    expect(mirrorCoord(0, 0)).toBe(-1);
    expect(mirrorCoord(3, 0)).toBe(-4);
    // center2 = 1: plane through the middle of voxel 0 — the keel maps onto itself.
    expect(mirrorCoord(0, 1)).toBe(0);
    expect(mirrorCoord(2, 1)).toBe(-2);
    for (const c of [-3, 0, 1, 8])
      for (const v of [-5, 0, 7]) expect(mirrorCoord(mirrorCoord(v, c), c)).toBe(v);
  });

  it('makes 2, 4 or 8 copies for one, two or three axes', () => {
    const op = cellsOperation('add', 1, [2, 3, 4]);
    expect(cells(mirrorModifier({ x: true, y: false, z: false, center2: [0, 0, 0] })(op))).toEqual(
      new Set(['2,3,4', '-3,3,4']),
    );
    expect(cells(mirrorModifier({ x: true, y: false, z: true, center2: [0, 0, 0] })(op)).size).toBe(
      4,
    );
    expect(cells(mirrorModifier({ x: true, y: true, z: true, center2: [0, 0, 0] })(op)).size).toBe(
      8,
    );
    expect(
      cells(mirrorModifier({ x: false, y: false, z: false, center2: [0, 0, 0] })(op)).size,
    ).toBe(1);
  });

  it('keeps the colour and action of the operation', () => {
    const op = cellsOperation('paint', 9, [1, 0, 0]);
    const mirrored = mirrorModifier({ x: true, y: false, z: false, center2: [0, 0, 0] })(op);
    const colours: number[] = [];
    mirrored.forEachCell((_x, _y, _z, c) => colours.push(c));
    expect(colours).toEqual([9, 9]);
    expect(mirrored.action).toBe('paint');
  });

  it('centres on a box and toggles between keel and gap', () => {
    // An odd-width box is symmetric about its middle voxel: odd centre.
    expect(mirrorCenterOf({ minX: -24, minY: 0, minZ: 0, maxX: 24, maxY: 9, maxZ: 3 })).toEqual([
      1, 10, 4,
    ]);
    expect(toggleKeel(1)).toBe(2);
    expect(toggleKeel(2)).toBe(1);
    expect(toggleKeel(toggleKeel(-3))).toBe(-3);
  });
});
