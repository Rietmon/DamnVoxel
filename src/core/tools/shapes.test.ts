import { describe, expect, it } from 'vitest';
import { boxCells, type CellBox, ellipsoidCells, lineCells, shapeCells } from './shapes';

const count = (cells: number[]) => cells.length / 3;

function set(cells: number[]): Set<string> {
  const s = new Set<string>();
  for (let i = 0; i < cells.length; i += 3) s.add(`${cells[i]},${cells[i + 1]},${cells[i + 2]}`);
  return s;
}

describe('shapes', () => {
  it('fills boxes exactly', () => {
    expect(count(boxCells({ min: [0, 0, 0], max: [2, 3, 4] }))).toBe(3 * 4 * 5);
    expect(count(shapeCells('rect', { min: [0, 0, 0], max: [4, 0, 2] }, 1))).toBe(15);
  });

  it('inscribes ellipses and spheres that touch every side of their box', () => {
    for (const [w, h] of [
      [1, 1],
      [2, 2],
      [5, 3],
      [8, 8],
      [9, 4],
    ] as const) {
      const cells = ellipsoidCells({ min: [0, 0, 0], max: [w - 1, 0, h - 1] }, 1);
      const xs = cells.filter((_, i) => i % 3 === 0);
      const zs = cells.filter((_, i) => i % 3 === 2);
      expect(
        [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)],
        `${w}×${h}`,
      ).toEqual([0, w - 1, 0, h - 1]);
      // Symmetric about the centre of the box: odd and even sizes alike.
      const s = set(cells);
      for (const c of s) {
        const [x, y, z] = c.split(',').map(Number) as [number, number, number];
        expect(s.has(`${w - 1 - x},${y},${h - 1 - z}`)).toBe(true);
      }
    }
    const ball = ellipsoidCells({ min: [0, 0, 0], max: [9, 9, 9] });
    // Roughly 4/3·π·5³ ≈ 524.
    expect(count(ball)).toBeGreaterThan(480);
    expect(count(ball)).toBeLessThan(600);
  });

  it('makes cylinders: the same ellipse in every layer', () => {
    const cells = shapeCells('cylinder', { min: [0, 0, 0], max: [6, 4, 6] }, 1);
    const perLayer = count(cells) / 5;
    expect(Number.isInteger(perLayer)).toBe(true);
    expect(perLayer).toBe(count(ellipsoidCells({ min: [0, 0, 0], max: [6, 0, 6] }, 1)));
  });

  it('draws 6-connected lines that start and end on the given cells', () => {
    for (const [a, b] of [
      [
        [0, 0, 0],
        [7, 3, 0],
      ],
      [
        [2, -1, 4],
        [-3, 5, -2],
      ],
      [
        [1, 1, 1],
        [1, 1, 1],
      ],
    ] as [[number, number, number], [number, number, number]][]) {
      const cells = lineCells(a, b);
      expect(cells.slice(0, 3)).toEqual(a);
      expect(cells.slice(-3)).toEqual(b);
      for (let i = 3; i < cells.length; i += 3) {
        const step =
          Math.abs(cells[i]! - cells[i - 3]!) +
          Math.abs(cells[i + 1]! - cells[i - 2]!) +
          Math.abs(cells[i + 2]! - cells[i - 1]!);
        expect(step).toBe(1);
      }
    }
  });
});

describe('more primitives', () => {
  const box = (n: number, h: number): CellBox => ({ min: [0, 0, 0], max: [n - 1, h - 1, n - 1] });
  const at = (cells: number[]) => {
    const set = new Set<string>();
    for (let i = 0; i < cells.length; i += 3)
      set.add(`${cells[i]},${cells[i + 1]},${cells[i + 2]}`);
    return set;
  };
  const layer = (cells: number[], y: number) => {
    let n = 0;
    for (let i = 0; i < cells.length; i += 3) if (cells[i + 1] === y) n++;
    return n;
  };

  it('narrows a pyramid and a cone towards the top, the other way when upside down', () => {
    const pyramid = shapeCells('pyramid', box(9, 5), 1);
    expect(layer(pyramid, 0)).toBe(81);
    expect(layer(pyramid, 4)).toBeLessThan(layer(pyramid, 2));
    const cone = shapeCells('cone', box(9, 9), 1);
    expect(layer(cone, 8)).toBeLessThanOrEqual(5);
    expect(layer(cone, 0)).toBeGreaterThan(50);
    const down = shapeCells('cone', box(9, 9), 1, { axis: 1, baseAtMin: false });
    expect(layer(down, 8)).toBe(layer(cone, 0));
  });

  it('leaves a hole in the middle of a torus', () => {
    const torus = at(shapeCells('torus', box(13, 3), 1));
    expect(torus.has('6,1,6')).toBe(false);
    expect(torus.has('0,1,6')).toBe(true);
  });

  it('climbs stairs the way they were dragged, one step per layer', () => {
    const up = shapeCells('stairs', { min: [0, 0, 0], max: [3, 3, 0] }, 1, {
      axis: 1,
      baseAtMin: true,
      rise: { axis: 0, sign: 1 },
    });
    const s = at(up);
    expect(s.has('0,0,0')).toBe(true);
    expect(s.has('0,1,0')).toBe(false);
    expect(s.has('3,3,0')).toBe(true);
    const back = at(
      shapeCells('stairs', { min: [0, 0, 0], max: [3, 3, 0] }, 1, {
        axis: 1,
        baseAtMin: true,
        rise: { axis: 0, sign: -1 },
      }),
    );
    expect(back.has('0,3,0')).toBe(true);
    expect(back.has('3,1,0')).toBe(false);
  });

  it('opens an arch at the bottom middle under a solid top', () => {
    const arch = at(shapeCells('arch', { min: [0, 0, 0], max: [8, 7, 1] }, 1));
    expect(arch.has('4,0,0')).toBe(false);
    expect(arch.has('0,0,0')).toBe(true);
    expect(arch.has('4,7,0')).toBe(true);
  });
});
