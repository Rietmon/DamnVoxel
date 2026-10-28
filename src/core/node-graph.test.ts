import { describe, expect, it } from 'vitest';
import { runProgram } from '../kernels/program';
import {
  canLink,
  compileGraph,
  link,
  NODE_DEFS,
  type NodeGraph,
  newNode,
  startingGraph,
} from './node-graph';

const PALETTE = new Uint32Array(255).map((_, i) => (0xff000000 | (i * 0x010101)) >>> 0);

function build(graph: NodeGraph, params: Record<string, number> = {}) {
  const { source, errors } = compileGraph(graph);
  expect(errors).toEqual([]);
  const r = runProgram({ source, params, palette: PALETTE });
  expect(r.error).toBeNull();
  return r;
}

const ys = (r: ReturnType<typeof build>) => {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < r.colors.length; i++) {
    lo = Math.min(lo, r.positions[i * 3 + 1]!);
    hi = Math.max(hi, r.positions[i * 3 + 1]!);
  }
  return [lo, hi];
};

describe('node graphs', () => {
  it('build the starting ball', () => {
    const r = build(startingGraph());
    // A ball of radius 8 at y = 8: from the floor to 16.
    expect(r.colors.length).toBeGreaterThan(1800);
    expect(ys(r)).toEqual([0, 15]);
  });

  it('compile every node, wired into a chain', () => {
    // Each kind of node in turn, fed by a ball where it takes solids.
    for (const def of NODE_DEFS) {
      if (def.type === 'output' || def.output !== 'shape') continue;
      let g: NodeGraph = {
        nodes: [
          newNode(def.type, 1, 0, 0),
          newNode('sphere', 2, 0, 0),
          newNode('sphere', 3, 0, 0),
          newNode('output', 9, 0, 0),
        ],
        links: [],
      };
      if (def.type === 'subtract' || def.type === 'smoothSubtract' || def.type === 'intersect')
        g.nodes[2] = { ...g.nodes[2]!, values: { ...g.nodes[2]!.values, x: 6 } };
      for (const p of def.inputs) g = link(g, p.id === 'b' ? 3 : 2, 1, p.id);
      g = link(g, 1, 9, 'in');
      const r = build(g);
      expect(r.colors.length, def.type).toBeGreaterThan(10);
    }
  });

  it('combine solids and keep their colours', () => {
    let g: NodeGraph = {
      nodes: [
        { ...newNode('sphere', 1, 0, 0), values: { x: -6, y: 6, z: 0, r: 5, color: '#ffffff' } },
        { ...newNode('sphere', 2, 0, 0), values: { x: 6, y: 6, z: 0, r: 5, color: '#000000' } },
        newNode('union', 3, 0, 0),
        newNode('output', 4, 0, 0),
      ],
      links: [],
    };
    g = link(link(link(g, 1, 3, 'a'), 2, 3, 'b'), 3, 4, 'in');
    const r = build(g);
    const left = new Set<number>();
    const right = new Set<number>();
    for (let i = 0; i < r.colors.length; i++)
      (r.positions[i * 3]! < 0 ? left : right).add(r.colors[i]!);
    expect([...left]).toEqual([255]);
    expect([...right]).toEqual([1]);
  });

  it('take numbers from parameter nodes', () => {
    let g = startingGraph();
    g = {
      ...g,
      nodes: [
        ...g.nodes,
        {
          ...newNode('param', 5, 0, 0),
          values: { name: 'Radius', value: 4, min: 1, max: 20, step: 1 },
        },
      ],
    };
    g = link(g, 5, 1, 'r');
    const small = build(g);
    expect(small.params.map((p) => [p.name, p.value])).toEqual([['Radius', 4]]);
    const big = build(g, { Radius: 10 });
    expect(big.colors.length).toBeGreaterThan(small.colors.length * 8);
  });

  it('repeat and move along an axis', () => {
    let g: NodeGraph = {
      nodes: [
        {
          ...newNode('box', 1, 0, 0),
          values: { ...newNode('box', 1, 0, 0).values, w: 2, h: 2, d: 2, y: 1 },
        },
        { ...newNode('repeat', 2, 0, 0), values: { axis: 'y', count: 3, step: 4 } },
        { ...newNode('move', 3, 0, 0), values: { dx: 0, dy: 10, dz: 0 } },
        newNode('output', 4, 0, 0),
      ],
      links: [],
    };
    g = link(link(link(g, 1, 2, 'in'), 2, 3, 'in'), 3, 4, 'in');
    const r = build(g);
    expect(r.colors.length).toBe(3 * 8);
    expect(ys(r)).toEqual([10, 19]);
  });

  it('say what is missing, and refuse loops and wrong wires', () => {
    expect(compileGraph({ nodes: [newNode('sphere', 1, 0, 0)], links: [] }).errors).toEqual([
      'No “Result” node',
    ]);
    const open = compileGraph({
      nodes: [newNode('union', 1, 0, 0), newNode('output', 2, 0, 0)],
      links: [{ from: 1, to: 2, port: 'in' }],
    });
    expect(open.errors.join()).toMatch(/input “A” is not connected/);
    let g: NodeGraph = {
      nodes: [
        newNode('move', 1, 0, 0),
        newNode('move', 2, 0, 0),
        newNode('param', 3, 0, 0),
        newNode('sphere', 4, 0, 0),
      ],
      links: [],
    };
    g = link(g, 1, 2, 'in');
    expect(canLink(g, 2, 1, 'in')).toBe(false);
    expect(canLink(g, 3, 2, 'in')).toBe(false);
    expect(canLink(g, 3, 4, 'r')).toBe(true);
    expect(canLink(g, 4, 1, 'in')).toBe(true);
  });
});
