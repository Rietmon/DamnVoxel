import { describe, expect, it } from 'vitest';
import { runProgram } from './program';

/** A palette of 255 greys, plus pure red at id 10. */
const PALETTE = new Uint32Array(255).map((_, i) =>
  i === 9 ? 0xff0000ff : (0xff000000 | (i * 0x010101)) >>> 0,
);

const run = (source: string, params: Record<string, number> = {}, maxVoxels?: number) =>
  runProgram({ source, params, palette: PALETTE, maxVoxels });

const cells = (r: ReturnType<typeof run>) => {
  const out: string[] = [];
  for (let i = 0; i < r.colors.length; i++)
    out.push(
      `${r.positions[i * 3]},${r.positions[i * 3 + 1]},${r.positions[i * 3 + 2]}:${r.colors[i]}`,
    );
  return out.sort();
};

describe('programs', () => {
  it('places voxels, boxes and lines', () => {
    const r = run('set(0, 0, 0, 5); box(1, 0, 0, 2, 1, 0, 7); line(-3, 0, 0, -1, 0, 0, 9);');
    expect(r.error).toBeNull();
    expect(cells(r)).toEqual([
      '-1,0,0:9',
      '-2,0,0:9',
      '-3,0,0:9',
      '0,0,0:5',
      '1,0,0:7',
      '1,1,0:7',
      '2,0,0:7',
      '2,1,0:7',
    ]);
  });

  it('declares parameters, takes their values and keeps them in range', () => {
    const src = 'const h = param("Height", 3, 1, 10); box(0, 0, 0, 0, h - 1, 0, 1);';
    expect(run(src).colors.length).toBe(3);
    const r = run(src, { Height: 50 });
    expect(r.colors.length).toBe(10);
    expect(r.params).toEqual([{ name: 'Height', value: 10, min: 1, max: 10, step: 1 }]);
  });

  it('finds palette colours', () => {
    const r = run('set(0, 0, 0, color("#ff0000")); set(1, 0, 0, color(3, 3, 3));');
    expect(cells(r)).toEqual(['0,0,0:10', '1,0,0:4']);
  });

  it('builds solids from distances', () => {
    const ball = run('sphere(0, 0, 0, 4, 1)');
    // A voxel sphere of radius 4: close to 4/3 π r³.
    expect(ball.colors.length).toBeGreaterThan(200);
    expect(ball.colors.length).toBeLessThan(300);
    const cyl = run('cylinder(0, 0, 0, 2, 5, 1)');
    const ys = new Set(
      Array.from({ length: cyl.colors.length }, (_, i) => cyl.positions[i * 3 + 1]),
    );
    expect([...ys].sort()).toEqual([0, 1, 2, 3, 4]);
    const blend = run(
      'shape((x, y, z) => sd.smoothUnion(sd.sphere(x + 3, y, z, 3), sd.sphere(x - 3, y, z, 3), 3), 2, -8, -6, -6, 8, 6, 6)',
    );
    expect(blend.colors.length).toBeGreaterThan(2 * ball.colors.length * (27 / 64));
  });

  it('fills a box by a function, with seeded noise', () => {
    const src = 'seed(7); fill(0, 0, 0, 15, 15, 0, (x, y) => noise(x / 5, y / 5) > 0 ? 3 : 0);';
    const a = run(src);
    const b = run(src);
    expect(cells(a)).toEqual(cells(b));
    expect(a.colors.length).toBeGreaterThan(20);
    expect(a.colors.length).toBeLessThan(236);
  });

  it('reports errors with their line, keeping what was made before', () => {
    const r = run('set(0, 0, 0, 1);\nlog("ok", 2);\nundefinedThing();');
    expect(r.error?.message).toMatch(/undefinedThing/);
    expect(r.error?.line).toBe(3);
    expect(r.log).toEqual(['ok 2']);
    expect(r.colors.length).toBe(1);
    expect(run('box(').error?.message).toMatch(/SyntaxError/);
  });

  it('stops at the voxel limit and far coordinates', () => {
    expect(run('box(0, 0, 0, 9, 9, 9, 1)', {}, 100).error?.message).toMatch(/More than/);
    expect(run('set(100000, 0, 0, 1)').error?.message).toMatch(/outside/);
  });
});
