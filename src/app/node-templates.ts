import { link, type NodeGraph, newNode, startingGraph } from '../core/node-graph';

/**
 * Node graphs to start from (docs/programs.md, “Nodes”): small, laid out left to right, each
 * showing a kind of node. Loaded with the program window.
 */

export interface NodeTemplate {
  id: string;
  title: string;
  description: string;
  graph(): NodeGraph;
}

/** A node with some fields set. */
const node = (
  type: string,
  id: number,
  x: number,
  y: number,
  values: Record<string, number | string> = {},
) => {
  const n = newNode(type, id, x, y);
  return { ...n, values: { ...n.values, ...values } };
};

/** Wires as [from, to, port] triples. */
const wired = (nodes: NodeGraph['nodes'], wires: [number, number, string][]): NodeGraph =>
  wires.reduce<NodeGraph>((g, [from, to, port]) => link(g, from, to, port), { nodes, links: [] });

export const NODE_TEMPLATES: readonly NodeTemplate[] = [
  {
    id: 'ball',
    title: 'Ball',
    description: 'One shape into “Result” — start from a clean sheet.',
    graph: startingGraph,
  },
  {
    id: 'snowman',
    title: 'Snowman',
    description: 'Three balls grow together, the carrot is a turned cone.',
    graph: () =>
      wired(
        [
          node('sphere', 1, 0, 0, { y: 7, r: 7, color: '#f2f2f2' }),
          node('sphere', 2, 240, 0, { y: 17, r: 5, color: '#f2f2f2' }),
          node('sphere', 3, 720, 0, { y: 25, r: 3.5, color: '#f2f2f2' }),
          node('smoothUnion', 4, 480, 0, { k: 2 }),
          node('smoothUnion', 5, 960, 0, { k: 1.5 }),
          node('cone', 6, 480, 140, { y: 0, r: 1.2, h: 5, color: '#f08a24' }),
          node('rotate', 7, 720, 200, { axis: 'x', angle: 90 }),
          node('move', 8, 960, 140, { dx: 0, dy: 25, dz: 3 }),
          node('union', 9, 1200, 0),
          node('output', 10, 1440, 0),
        ],
        [
          [1, 4, 'a'],
          [2, 4, 'b'],
          [4, 5, 'a'],
          [3, 5, 'b'],
          [6, 7, 'in'],
          [7, 8, 'in'],
          [5, 9, 'a'],
          [8, 9, 'b'],
          [9, 10, 'in'],
        ],
      ),
  },
  {
    id: 'crystals',
    title: 'Crystals',
    description: 'A tilted box repeats and twists, colored by height.',
    graph: () =>
      wired(
        [
          node('box', 1, 0, 0, { y: 8, w: 4, h: 16, d: 4, round: 0.5, color: '#7fd1e8' }),
          node('rotate', 2, 240, 0, { axis: 'z', angle: 15 }),
          node('repeat', 3, 480, 0, { axis: 'x', count: 4, step: 7 }),
          node('twist', 4, 720, 0, { turns: 3 }),
          node('heightColor', 5, 960, 0, {
            from: 0,
            to: 18,
            low: '#2a5aa8',
            mid: '#7fd1e8',
            high: '#ffffff',
          }),
          node('output', 6, 1200, 0),
        ],
        [
          [1, 2, 'in'],
          [2, 3, 'in'],
          [3, 4, 'in'],
          [4, 5, 'in'],
          [5, 6, 'in'],
        ],
      ),
  },
  {
    id: 'island',
    title: 'Island',
    description: 'Terrain from noise, colored by height, and a tree from a stick and a ball.',
    graph: () =>
      wired(
        [
          node('terrain', 1, 0, 0, { size: 48, base: 2, height: 12, scale: 16, seed: 3 }),
          node('heightColor', 2, 240, 0, {
            from: 2,
            to: 14,
            low: '#e0cf8a',
            mid: '#4f9a3a',
            high: '#7c7c7c',
          }),
          node('capsule', 3, 480, 0, {
            x: 0,
            y: 8,
            z: 0,
            x2: 0,
            y2: 20,
            z2: 0,
            r: 1,
            color: '#6b4423',
          }),
          node('sphere', 4, 720, 0, { x: 0, y: 22, z: 0, r: 5, color: '#2e6b1f' }),
          node('union', 5, 960, 140),
          node('union', 6, 1200, 0),
          node('output', 7, 1440, 0),
        ],
        [
          [1, 2, 'in'],
          [3, 5, 'a'],
          [4, 5, 'b'],
          [2, 6, 'a'],
          [5, 6, 'b'],
          [6, 7, 'in'],
        ],
      ),
  },
  {
    id: 'params',
    title: 'Tower with parameters',
    description: '“Parameter” nodes give sliders: height and radius through wires.',
    graph: () =>
      wired(
        [
          node('param', 1, 0, 0, { name: 'Height', value: 20, min: 4, max: 60, step: 1 }),
          node('param', 2, 240, 0, { name: 'Radius', value: 5, min: 2, max: 16, step: 0.5 }),
          node('math', 3, 480, 0, { op: '/', a: 20, b: 2 }),
          node('cylinder', 4, 720, 0, { y: 10, color: '#8a8a8a' }),
          node('cone', 5, 960, 0, { color: '#b03a2e' }),
          node('move', 6, 1200, 0),
          node('union', 7, 1440, 0),
          node('output', 8, 1680, 0),
        ],
        [
          [1, 3, 'a'],
          [3, 4, 'y'],
          [1, 4, 'h'],
          [2, 4, 'r'],
          [2, 5, 'r'],
          [1, 6, 'dy'],
          [5, 6, 'in'],
          [4, 7, 'a'],
          [6, 7, 'b'],
          [7, 8, 'in'],
        ],
      ),
  },
];
