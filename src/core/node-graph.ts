/**
 * Shapes as node graphs (docs/programs.md, “Nodes”). A node is a solid (a signed distance with a
 * colour), a way to combine or bend solids, a colouring, or a number; wires carry solids and
 * numbers; the “Result” node takes the final solid. The graph compiles to a program for the
 * same engine as hand-written code, so it runs, stops and reports the same way — and “Show
 * code” hands that program over to edit by hand.
 *
 * In the compiled program a solid is a function (x, y, z) → distance that also leaves its colour
 * in C, and a box b = [x0, y0, z0, x1, y1, z1] that holds it; no objects are made per cell.
 */

export type PortType = 'shape' | 'number';

export interface PortDef {
  id: string;
  title: string;
  type: PortType;
}

export type FieldKind = 'number' | 'color' | 'text' | 'axis';

export interface FieldDef {
  id: string;
  title: string;
  kind: FieldKind;
  default: number | string;
  min?: number;
  max?: number;
  step?: number;
}

export type NodeGroup = 'Shapes' | 'Combine' | 'Transform' | 'Color' | 'Numbers' | 'Output';

/** Values of a node's fields, and refs to what its inputs are wired to. */
interface Emit {
  /** A number field: its wire's variable, or the literal. */
  n(id: string): string;
  /** A colour field: a palette id expression. */
  c(id: string): string;
  /** A text or axis field. */
  t(id: string): string;
  /** A solid input: its function and box variables. */
  s(id: string): { f: string; b: string };
  /** This node's own names. */
  f: string;
  b: string;
  v: string;
}

export interface NodeDef {
  type: string;
  title: string;
  group: NodeGroup;
  inputs: readonly PortDef[];
  output: PortType | null;
  fields: readonly FieldDef[];
  /** Code that defines this node's solid (f, b) or number (v). */
  emit(e: Emit): string;
}

const num = (id: string, title: string, d: number, min = -256, max = 256, step = 1): FieldDef => ({
  id,
  title,
  kind: 'number',
  default: d,
  min,
  max,
  step,
});
const col = (id: string, title: string, d: string): FieldDef => ({
  id,
  title,
  kind: 'color',
  default: d,
});
const shapeIn = (id: string, title: string): PortDef => ({ id, title, type: 'shape' });
const XYZ = (y = 0) => [num('x', 'X', 0), num('y', 'Y', y), num('z', 'Z', 0)];

/** A solid from a distance expression over local p = (X, Y, Z) relative to its centre. */
const solid = (dist: string, box: string) => (e: Emit) =>
  `const ${e.f} = (x, y, z) => { const X = x - ${e.n('x')}, Y = y - ${e.n('y')}, Z = z - ${e.n('z')}; C = ${e.c('color')}; return ${dist}; };
const ${e.b} = ${box};`;

export const NODE_DEFS: readonly NodeDef[] = [
  {
    type: 'sphere',
    title: 'Ball',
    group: 'Shapes',
    inputs: [],
    output: 'shape',
    fields: [...XYZ(8), num('r', 'Radius', 8, 0.5, 256, 0.5), col('color', 'Color', '#d9a441')],
    emit: (e) =>
      solid(
        `sd.sphere(X, Y, Z, ${e.n('r')})`,
        `__box(${e.n('x')}, ${e.n('y')}, ${e.n('z')}, ${e.n('r')}, ${e.n('r')}, ${e.n('r')})`,
      )(e),
  },
  {
    type: 'box',
    title: 'Box',
    group: 'Shapes',
    inputs: [],
    output: 'shape',
    fields: [
      ...XYZ(5),
      num('w', 'Width', 16, 1, 512),
      num('h', 'Height', 10, 1, 512),
      num('d', 'Depth', 12, 1, 512),
      num('round', 'Rounding', 0, 0, 64, 0.5),
      col('color', 'Color', '#8a8a8a'),
    ],
    emit: (e) =>
      solid(
        `sd.box(X, Y, Z, ${e.n('w')} / 2 - ${e.n('round')}, ${e.n('h')} / 2 - ${e.n('round')}, ${e.n('d')} / 2 - ${e.n('round')}) - ${e.n('round')}`,
        `__box(${e.n('x')}, ${e.n('y')}, ${e.n('z')}, ${e.n('w')} / 2, ${e.n('h')} / 2, ${e.n('d')} / 2)`,
      )(e),
  },
  {
    type: 'cylinder',
    title: 'Cylinder',
    group: 'Shapes',
    inputs: [],
    output: 'shape',
    fields: [
      ...XYZ(8),
      num('r', 'Radius', 6, 0.5, 256, 0.5),
      num('h', 'Height', 16, 1, 512),
      col('color', 'Color', '#5b8bd0'),
    ],
    emit: (e) =>
      solid(
        `sd.cylinder(X, Y, Z, ${e.n('r')}, ${e.n('h')})`,
        `__box(${e.n('x')}, ${e.n('y')}, ${e.n('z')}, ${e.n('r')}, ${e.n('h')} / 2, ${e.n('r')})`,
      )(e),
  },
  {
    type: 'torus',
    title: 'Torus',
    group: 'Shapes',
    inputs: [],
    output: 'shape',
    fields: [
      ...XYZ(4),
      num('R', 'Ring radius', 10, 1, 256, 0.5),
      num('r', 'Thickness', 3, 0.5, 64, 0.5),
      col('color', 'Color', '#c0504d'),
    ],
    emit: (e) =>
      solid(
        `sd.torus(X, Y, Z, ${e.n('R')}, ${e.n('r')})`,
        `__box(${e.n('x')}, ${e.n('y')}, ${e.n('z')}, ${e.n('R')} + ${e.n('r')}, ${e.n('r')}, ${e.n('R')} + ${e.n('r')})`,
      )(e),
  },
  {
    type: 'cone',
    title: 'Cone',
    group: 'Shapes',
    inputs: [],
    output: 'shape',
    fields: [
      ...XYZ(0),
      num('r', 'Radius', 8, 0.5, 256, 0.5),
      num('h', 'Height', 16, 1, 512),
      col('color', 'Color', '#3f8f2a'),
    ],
    // Standing on its centre point; an approximate distance, exact enough to fill.
    emit: (e) =>
      solid(
        `Math.max(Math.hypot(X, Z) - ${e.n('r')} * (1 - Y / ${e.n('h')}), -Y, Y - ${e.n('h')})`,
        `__box(${e.n('x')}, ${e.n('y')} + ${e.n('h')} / 2, ${e.n('z')}, ${e.n('r')}, ${e.n('h')} / 2, ${e.n('r')})`,
      )(e),
  },
  {
    type: 'capsule',
    title: 'Stick',
    group: 'Shapes',
    inputs: [],
    output: 'shape',
    fields: [
      num('x', 'Start X', 0),
      num('y', 'Start Y', 0),
      num('z', 'Start Z', 0),
      num('x2', 'End X', 0),
      num('y2', 'End Y', 16),
      num('z2', 'End Z', 0),
      num('r', 'Radius', 2, 0.5, 64, 0.5),
      col('color', 'Color', '#6b4423'),
    ],
    emit: (e) =>
      `const ${e.f} = (x, y, z) => { C = ${e.c('color')}; return sd.capsule(x, y, z, ${e.n('x')}, ${e.n('y')}, ${e.n('z')}, ${e.n('x2')}, ${e.n('y2')}, ${e.n('z2')}, ${e.n('r')}); };
const ${e.b} = __grow([Math.min(${e.n('x')}, ${e.n('x2')}), Math.min(${e.n('y')}, ${e.n('y2')}), Math.min(${e.n('z')}, ${e.n('z2')}), Math.max(${e.n('x')}, ${e.n('x2')}), Math.max(${e.n('y')}, ${e.n('y2')}), Math.max(${e.n('z')}, ${e.n('z2')})], ${e.n('r')});`,
  },
  {
    type: 'terrain',
    title: 'Terrain',
    group: 'Shapes',
    inputs: [],
    output: 'shape',
    fields: [
      num('size', 'Size', 48, 4, 512),
      num('base', 'Base', 2, 0, 256),
      num('height', 'Hills', 14, 0, 256),
      num('scale', 'Noise scale', 20, 1, 256),
      num('seed', 'Seed', 1, 0, 9999),
      col('color', 'Color', '#4f9a3a'),
    ],
    emit: (e) =>
      // Each noise node has its own seed: an offset into the noise, not the global seed().
      `const ${e.f} = (x, y, z) => { C = ${e.c('color')}; return y - (${e.n('base')} + (fbm(x / ${e.n('scale')} + ${e.n('seed')} * 31.17, 0, z / ${e.n('scale')} + ${e.n('seed')} * 17.31, 5) + 0.5) * ${e.n('height')}); };
const ${e.b} = [-${e.n('size')} / 2, 0, -${e.n('size')} / 2, ${e.n('size')} / 2 - 1, ${e.n('base')} + ${e.n('height')} * 1.2, ${e.n('size')} / 2 - 1];`,
  },
  // ---- Combining ----
  ...(
    [
      ['union', 'Union', 'Math.min(da, db)', 'da < db ? ca : cb', '__union(A, B)'],
      ['subtract', 'Subtract', 'Math.max(da, -db)', 'ca', 'A'],
      ['intersect', 'Intersect', 'Math.max(da, db)', 'da > db ? ca : cb', '__inter(A, B)'],
    ] as const
  ).map(
    ([type, title, d, c, box]): NodeDef => ({
      type,
      title,
      group: 'Combine',
      inputs: [shapeIn('a', 'A'), shapeIn('b', 'B')],
      output: 'shape',
      fields: [],
      emit: (e) => {
        const a = e.s('a');
        const b = e.s('b');
        return `const ${e.f} = (x, y, z) => { const da = ${a.f}(x, y, z), ca = C; const db = ${b.f}(x, y, z), cb = C; C = ${c}; return ${d}; };
const ${e.b} = ${box.replace('A', a.b).replace('B', b.b)};`;
      },
    }),
  ),
  {
    type: 'smoothUnion',
    title: 'Blend',
    group: 'Combine',
    inputs: [shapeIn('a', 'A'), shapeIn('b', 'B')],
    output: 'shape',
    fields: [num('k', 'Softness', 4, 0, 64, 0.5)],
    emit: (e) => {
      const a = e.s('a');
      const b = e.s('b');
      return `const ${e.f} = (x, y, z) => { const da = ${a.f}(x, y, z), ca = C; const db = ${b.f}(x, y, z), cb = C; C = da < db ? ca : cb; return sd.smoothUnion(da, db, ${e.n('k')}); };
const ${e.b} = __grow(__union(${a.b}, ${b.b}), ${e.n('k')} / 2);`;
    },
  },
  {
    type: 'smoothSubtract',
    title: 'Carve',
    group: 'Combine',
    inputs: [shapeIn('a', 'From'), shapeIn('b', 'With')],
    output: 'shape',
    fields: [num('k', 'Softness', 2, 0, 64, 0.5)],
    emit: (e) => {
      const a = e.s('a');
      const b = e.s('b');
      return `const ${e.f} = (x, y, z) => { const da = ${a.f}(x, y, z), ca = C; const db = ${b.f}(x, y, z); C = ca; return sd.smoothSubtract(da, db, ${e.n('k')}); };
const ${e.b} = ${a.b};`;
    },
  },
  // ---- Transforms: the input is evaluated at the point moved back ----
  {
    type: 'move',
    title: 'Move',
    group: 'Transform',
    inputs: [shapeIn('in', 'Shape')],
    output: 'shape',
    fields: [num('dx', 'X', 0), num('dy', 'Y', 0), num('dz', 'Z', 0)],
    emit: (e) => {
      const s = e.s('in');
      return `const ${e.f} = (x, y, z) => ${s.f}(x - ${e.n('dx')}, y - ${e.n('dy')}, z - ${e.n('dz')});
const ${e.b} = __shift(${s.b}, ${e.n('dx')}, ${e.n('dy')}, ${e.n('dz')});`;
    },
  },
  {
    type: 'rotate',
    title: 'Rotate',
    group: 'Transform',
    inputs: [shapeIn('in', 'Shape')],
    output: 'shape',
    fields: [
      { id: 'axis', title: 'Axis', kind: 'axis', default: 'y' },
      num('angle', 'Angle', 45, -360, 360, 1),
    ],
    emit: (e) => {
      const s = e.s('in');
      const axis = e.t('axis');
      // The point turns back by the angle, in the plane across the axis.
      const [u, v] = axis === 'x' ? ['y', 'z'] : axis === 'z' ? ['x', 'y'] : ['z', 'x'];
      const call =
        axis === 'x'
          ? `${s.f}(x, cu, cv)`
          : axis === 'z'
            ? `${s.f}(cu, cv, z)`
            : `${s.f}(cv, y, cu)`;
      return `const ${e.v}a = (${e.n('angle')}) * Math.PI / 180, ${e.v}c = Math.cos(${e.v}a), ${e.v}s = Math.sin(${e.v}a);
const ${e.f} = (x, y, z) => { const cu = ${e.v}c * ${u} + ${e.v}s * ${v}, cv = -${e.v}s * ${u} + ${e.v}c * ${v}; return ${call}; };
const ${e.b} = __turn(${s.b}, '${axis}', ${e.v}a);`;
    },
  },
  {
    type: 'scale',
    title: 'Scale',
    group: 'Transform',
    inputs: [shapeIn('in', 'Shape')],
    output: 'shape',
    fields: [num('k', 'Factor', 2, 0.05, 32, 0.05)],
    emit: (e) => {
      const s = e.s('in');
      return `const ${e.f} = (x, y, z) => ${s.f}(x / ${e.n('k')}, y / ${e.n('k')}, z / ${e.n('k')}) * ${e.n('k')};
const ${e.b} = ${s.b}.map((v) => v * ${e.n('k')});`;
    },
  },
  {
    type: 'mirror',
    title: 'Mirror',
    group: 'Transform',
    inputs: [shapeIn('in', 'Shape')],
    output: 'shape',
    fields: [{ id: 'axis', title: 'Axis', kind: 'axis', default: 'x' }],
    emit: (e) => {
      const s = e.s('in');
      const a = e.t('axis');
      const call =
        a === 'x'
          ? `${s.f}(Math.abs(x), y, z)`
          : a === 'y'
            ? `${s.f}(x, Math.abs(y), z)`
            : `${s.f}(x, y, Math.abs(z))`;
      const i = a === 'x' ? 0 : a === 'y' ? 1 : 2;
      return `const ${e.f} = (x, y, z) => ${call};
const ${e.b} = __mirror(${s.b}, ${i});`;
    },
  },
  {
    type: 'repeat',
    title: 'Repeat',
    group: 'Transform',
    inputs: [shapeIn('in', 'Shape')],
    output: 'shape',
    fields: [
      { id: 'axis', title: 'Axis', kind: 'axis', default: 'x' },
      num('count', 'Count', 4, 1, 256),
      num('step', 'Step', 12, -256, 256, 0.5),
    ],
    emit: (e) => {
      const s = e.s('in');
      const a = e.t('axis');
      const at =
        a === 'x'
          ? `${s.f}(x - i * st, y, z)`
          : a === 'y'
            ? `${s.f}(x, y - i * st, z)`
            : `${s.f}(x, y, z - i * st)`;
      const i = a === 'x' ? 0 : a === 'y' ? 1 : 2;
      return `const ${e.f} = (x, y, z) => { const st = ${e.n('step')}; let best = Infinity, bc = 0; for (let i = 0; i < ${e.n('count')}; i++) { const d = ${at}; if (d < best) { best = d; bc = C; } } C = bc; return best; };
const ${e.b} = __repeat(${s.b}, ${i}, ${e.n('count')}, ${e.n('step')});`;
    },
  },
  {
    type: 'twist',
    title: 'Twist',
    group: 'Transform',
    inputs: [shapeIn('in', 'Shape')],
    output: 'shape',
    fields: [num('turns', 'Degrees per voxel', 6, -90, 90, 0.5)],
    emit: (e) => {
      const s = e.s('in');
      return `const ${e.f} = (x, y, z) => { const a = -y * (${e.n('turns')}) * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a); return ${s.f}(c * x - sn * z, y, sn * x + c * z) * 0.8; };
const ${e.b} = __spin(${s.b});`;
    },
  },
  {
    type: 'displace',
    title: 'Bumps',
    group: 'Transform',
    inputs: [shapeIn('in', 'Shape')],
    output: 'shape',
    fields: [
      num('amp', 'Strength', 2, 0, 32, 0.25),
      num('scale', 'Scale', 6, 0.5, 128, 0.5),
      num('seed', 'Seed', 1, 0, 9999),
    ],
    emit: (e) => {
      const s = e.s('in');
      return `const ${e.f} = (x, y, z) => ${s.f}(x, y, z) + ${e.n('amp')} * noise(x / ${e.n('scale')} + ${e.n('seed')} * 31.17, y / ${e.n('scale')}, z / ${e.n('scale')} + ${e.n('seed')} * 17.31);
const ${e.b} = __grow(${s.b}, ${e.n('amp')});`;
    },
  },
  // ---- Colour ----
  {
    type: 'paint',
    title: 'Recolor',
    group: 'Color',
    inputs: [shapeIn('in', 'Shape')],
    output: 'shape',
    fields: [col('color', 'Color', '#e86f4f')],
    emit: (e) => {
      const s = e.s('in');
      return `const ${e.f} = (x, y, z) => { const d = ${s.f}(x, y, z); C = ${e.c('color')}; return d; };
const ${e.b} = ${s.b};`;
    },
  },
  {
    type: 'heightColor',
    title: 'Color by height',
    group: 'Color',
    inputs: [shapeIn('in', 'Shape')],
    output: 'shape',
    fields: [
      num('from', 'From Y', 0),
      num('to', 'To Y', 16),
      col('low', 'Bottom', '#7c7c7c'),
      col('mid', 'Middle', '#4f9a3a'),
      col('high', 'Top', '#f2f2f2'),
    ],
    emit: (e) => {
      const s = e.s('in');
      return `const ${e.v}r = [${e.c('low')}, ${e.c('mid')}, ${e.c('high')}];
const ${e.f} = (x, y, z) => { const d = ${s.f}(x, y, z); C = ramp(clamp((y - ${e.n('from')}) / ((${e.n('to')}) - (${e.n('from')}) || 1), 0, 0.999), ${e.v}r); return d; };
const ${e.b} = ${s.b};`;
    },
  },
  {
    type: 'noiseColor',
    title: 'Spots',
    group: 'Color',
    inputs: [shapeIn('in', 'Shape')],
    output: 'shape',
    fields: [
      col('color', 'Spot color', '#3f6f2a'),
      num('scale', 'Size', 5, 0.5, 128, 0.5),
      num('amount', 'Amount', 0.4, 0, 1, 0.05),
    ],
    emit: (e) => {
      const s = e.s('in');
      return `const ${e.f} = (x, y, z) => { const d = ${s.f}(x, y, z); if (noise(x / ${e.n('scale')} + 31.7, y / ${e.n('scale')}, z / ${e.n('scale')}) > 0.5 - ${e.n('amount')}) C = ${e.c('color')}; return d; };
const ${e.b} = ${s.b};`;
    },
  },
  // ---- Numbers ----
  {
    type: 'param',
    title: 'Parameter',
    group: 'Numbers',
    inputs: [],
    output: 'number',
    fields: [
      { id: 'name', title: 'Name', kind: 'text', default: 'Size' },
      num('value', 'Value', 8, -1e6, 1e6, 0.5),
      num('min', 'Min', 1, -1e6, 1e6),
      num('max', 'Max', 32, -1e6, 1e6),
      num('step', 'Step', 1, 0.001, 1000, 0.5),
    ],
    emit: (e) =>
      `const ${e.v} = param(${JSON.stringify(e.t('name'))}, ${e.n('value')}, ${e.n('min')}, ${e.n('max')}, ${e.n('step')});`,
  },
  {
    type: 'math',
    title: 'Compute',
    group: 'Numbers',
    inputs: [
      { id: 'a', title: 'A', type: 'number' },
      { id: 'b', title: 'B', type: 'number' },
    ],
    output: 'number',
    fields: [
      { id: 'op', title: 'Operation', kind: 'text', default: '*' },
      num('a', 'A', 1, -1e6, 1e6, 0.5),
      num('b', 'B', 2, -1e6, 1e6, 0.5),
    ],
    emit: (e) => {
      const op = e.t('op');
      const a = e.n('a');
      const b = e.n('b');
      const expr =
        op === 'min' || op === 'max'
          ? `Math.${op}(${a}, ${b})`
          : ['+', '-', '*', '/'].includes(op)
            ? `(${a}) ${op} (${b})`
            : `(${a}) * (${b})`;
      return `const ${e.v} = ${expr};`;
    },
  },
  // ---- Output ----
  {
    type: 'output',
    title: 'Result',
    group: 'Output',
    inputs: [shapeIn('in', 'Shape')],
    output: null,
    fields: [],
    emit: (e) => {
      const s = e.s('in');
      return `shape(${s.f}, () => C, ...__cells(${s.b}));`;
    },
  },
];

export const NODE_TYPES = new Map(NODE_DEFS.map((d) => [d.type, d]));

export interface GraphNode {
  id: number;
  type: string;
  /** Place on the canvas. */
  x: number;
  y: number;
  /** Field values by id; missing ones take the default. */
  values: Record<string, number | string>;
}

export interface GraphLink {
  from: number;
  to: number;
  /** The input of `to` it feeds. */
  port: string;
}

export interface NodeGraph {
  nodes: GraphNode[];
  links: GraphLink[];
}

/** Helpers every compiled graph starts with: boxes of solids. */
const PRELUDE = `// Built from nodes. Editing here unlinks the program from the nodes.
let C = 0;
const __box = (x, y, z, rx, ry, rz) => [x - rx, y - ry, z - rz, x + rx, y + ry, z + rz];
const __grow = (b, k) => [b[0] - k, b[1] - k, b[2] - k, b[3] + k, b[4] + k, b[5] + k];
const __union = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[3], b[3]), Math.max(a[4], b[4]), Math.max(a[5], b[5])];
const __inter = (a, b) => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2]), Math.min(a[3], b[3]), Math.min(a[4], b[4]), Math.min(a[5], b[5])];
const __shift = (b, x, y, z) => [b[0] + x, b[1] + y, b[2] + z, b[3] + x, b[4] + y, b[5] + z];
const __mirror = (b, i) => { const m = Math.max(Math.abs(b[i]), Math.abs(b[i + 3])); const o = b.slice(); o[i] = -m; o[i + 3] = m; return o; };
const __repeat = (b, i, n, s) => { const o = b.slice(); const span = (n - 1) * s; if (span > 0) o[i + 3] += span; else o[i] += span; return o; };
const __spin = (b) => { const r = Math.max(Math.hypot(b[0], b[2]), Math.hypot(b[3], b[2]), Math.hypot(b[0], b[5]), Math.hypot(b[3], b[5])); return [-r, b[1], -r, r, b[4], r]; };
const __turn = (b, axis, a) => { const r = Math.max(...[0, 1, 2].flatMap((i) => [Math.abs(b[i]), Math.abs(b[i + 3])])) * Math.SQRT2; const o = b.slice(); for (const i of axis === 'x' ? [1, 2] : axis === 'y' ? [0, 2] : [0, 1]) { o[i] = -r; o[i + 3] = r; } return o; };
const __cells = (b) => [Math.floor(b[0]) - 1, Math.floor(b[1]) - 1, Math.floor(b[2]) - 1, Math.ceil(b[3]) + 1, Math.ceil(b[4]) + 1, Math.ceil(b[5]) + 1];
`;

export interface CompiledGraph {
  source: string;
  /** What keeps the graph from building, in words. */
  errors: string[];
}

/**
 * The program of a graph: the nodes the “Result” depends on, in order, each emitting its
 * code. Problems — no result, an empty input, a loop — come back as errors, not exceptions.
 */
export function compileGraph(graph: NodeGraph): CompiledGraph {
  const errors: string[] = [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const output = graph.nodes.find((n) => n.type === 'output');
  if (!output) return { source: '', errors: ['No “Result” node'] };
  const order: GraphNode[] = [];
  const state = new Map<number, 'visiting' | 'done'>();
  const visit = (node: GraphNode): void => {
    const s = state.get(node.id);
    if (s === 'done') return;
    if (s === 'visiting') {
      errors.push(`Loop through “${NODE_TYPES.get(node.type)?.title ?? node.type}”`);
      return;
    }
    state.set(node.id, 'visiting');
    for (const l of graph.links)
      if (l.to === node.id) {
        const from = byId.get(l.from);
        if (from) visit(from);
      }
    state.set(node.id, 'done');
    order.push(node);
  };
  visit(output);
  if (errors.length > 0) return { source: '', errors };

  const name = (n: GraphNode, kind: 's' | 'b' | 'v') => `${kind}${n.id}`;
  const lines: string[] = [PRELUDE];
  for (const node of order) {
    const def = NODE_TYPES.get(node.type);
    if (!def) {
      errors.push(`Unknown node “${node.type}”`);
      continue;
    }
    const field = (id: string) => def.fields.find((f) => f.id === id);
    const value = (id: string) => node.values[id] ?? field(id)?.default ?? 0;
    const wire = (id: string) => {
      const l = graph.links.find((x) => x.to === node.id && x.port === id);
      return l ? byId.get(l.from) : undefined;
    };
    const e: Emit = {
      f: name(node, 's'),
      b: name(node, 'b'),
      v: name(node, 'v'),
      n: (id) => {
        const from = wire(id);
        if (from && NODE_TYPES.get(from.type)?.output === 'number') return name(from, 'v');
        const v = Number(value(id));
        return Number.isFinite(v) ? String(v) : '0';
      },
      c: (id) => `color(${JSON.stringify(String(value(id)))})`,
      t: (id) => String(value(id)),
      s: (id) => {
        const from = wire(id);
        if (!from || NODE_TYPES.get(from.type)?.output !== 'shape') {
          errors.push(
            `“${def.title}”: input “${def.inputs.find((p) => p.id === id)?.title ?? id}” is not connected`,
          );
          return { f: '(() => Infinity)', b: '[0, 0, 0, 0, 0, 0]' };
        }
        return { f: name(from, 's'), b: name(from, 'b') };
      },
    };
    lines.push(`// ${def.title}`, def.emit(e));
  }
  return { source: lines.join('\n'), errors };
}

/** Field values of a new node: the defaults. */
export function newNode(type: string, id: number, x: number, y: number): GraphNode {
  const def = NODE_TYPES.get(type);
  const values: Record<string, number | string> = {};
  for (const f of def?.fields ?? []) values[f.id] = f.default;
  return { id, type, x, y, values };
}

/** The graph a new node program starts with: a ball into the result. */
export function startingGraph(): NodeGraph {
  return {
    nodes: [newNode('sphere', 1, 40, 60), newNode('output', 2, 320, 80)],
    links: [{ from: 1, to: 2, port: 'in' }],
  };
}

/** Whether a wire from `from` may go into `port` of `to`: types match and no loop forms. */
export function canLink(graph: NodeGraph, from: number, to: number, port: string): boolean {
  if (from === to) return false;
  const a = graph.nodes.find((n) => n.id === from);
  const b = graph.nodes.find((n) => n.id === to);
  const out = a && NODE_TYPES.get(a.type)?.output;
  const input = b && NODE_TYPES.get(b.type)?.inputs.find((p) => p.id === port);
  const field =
    b && NODE_TYPES.get(b.type)?.fields.find((f) => f.id === port && f.kind === 'number');
  if (!out) return false;
  if (!(input?.type === out || (out === 'number' && field))) return false;
  // `to` must not already feed `from`.
  const feeds = (node: number, seen = new Set<number>()): boolean => {
    if (node === to) return true;
    if (seen.has(node)) return false;
    seen.add(node);
    return graph.links.some((l) => l.to === node && feeds(l.from, seen));
  };
  return !feeds(from);
}

/** A graph with a wire into a port: one wire per input, the new one replaces the old. */
export function link(graph: NodeGraph, from: number, to: number, port: string): NodeGraph {
  return {
    ...graph,
    links: [...graph.links.filter((l) => !(l.to === to && l.port === port)), { from, to, port }],
  };
}
