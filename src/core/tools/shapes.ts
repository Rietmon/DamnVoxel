/**
 * Cells of the shape tools, as flat x, y, z lists in object-local coordinates. Every shape is
 * inscribed in an inclusive box of cells, so its size is exactly the box size, odd or even.
 */

export type ShapeKind =
  | 'box'
  | 'line'
  | 'rect'
  | 'ellipse'
  | 'sphere'
  | 'cylinder'
  | 'cone'
  | 'pyramid'
  | 'torus'
  | 'stairs'
  | 'arch';

/** Where a solid stands and which way it rises (cones, pyramids, stairs and arches care). */
export interface ShapeFrame {
  /** Normal axis of the base plane. */
  axis: number;
  /** The base is at the low end of the box along the axis (else at the high end). */
  baseAtMin: boolean;
  /** Stairs: the footprint axis they climb along and towards which end. */
  rise?: { axis: number; sign: 1 | -1 };
}

export type Cell = [number, number, number];

/** Inclusive cell box. */
export interface CellBox {
  min: Cell;
  max: Cell;
}

export function boxCells({ min, max }: CellBox): number[] {
  const out: number[] = [];
  for (let z = min[2]; z <= max[2]; z++)
    for (let y = min[1]; y <= max[1]; y++) for (let x = min[0]; x <= max[0]; x++) out.push(x, y, z);
  return out;
}

/**
 * Cells whose centres lie inside the ellipsoid inscribed in the box; `flatAxis` (0–2) turns it
 * into an elliptic cylinder along that axis (an ellipse when the box is one cell thick).
 */
export function ellipsoidCells({ min, max }: CellBox, flatAxis = -1): number[] {
  const centre = [0, 1, 2].map((a) => (min[a]! + max[a]! + 1) / 2);
  const radius = [0, 1, 2].map((a) => (max[a]! - min[a]! + 1) / 2);
  const out: number[] = [];
  for (let z = min[2]; z <= max[2]; z++)
    for (let y = min[1]; y <= max[1]; y++)
      for (let x = min[0]; x <= max[0]; x++) {
        const p = [x, y, z];
        let d = 0;
        for (let a = 0; a < 3; a++) {
          if (a === flatAxis) continue;
          const t = (p[a]! + 0.5 - centre[a]!) / radius[a]!;
          d += t * t;
        }
        // A little slack keeps small shapes from losing their edge cells.
        const slack =
          1 / Math.max(4, Math.min(...radius.filter((_, a) => a !== flatAxis)) ** 2 * 4);
        if (d <= 1 + slack) out.push(x, y, z);
      }
  return out;
}

/**
 * A 6-connected 3D line from a to b: the cells the segment between their centres passes
 * through, stepping one axis at a time, so a line of voxels has no diagonal gaps.
 */
export function lineCells(a: Cell, b: Cell): number[] {
  const cell = [...a];
  const out = [cell[0]!, cell[1]!, cell[2]!];
  const step: number[] = [];
  const tMax: number[] = [];
  const tDelta: number[] = [];
  for (let k = 0; k < 3; k++) {
    const d = b[k]! - a[k]!;
    step.push(Math.sign(d));
    tDelta.push(d === 0 ? Number.POSITIVE_INFINITY : 1 / Math.abs(d));
    tMax.push(d === 0 ? Number.POSITIVE_INFINITY : 0.5 / Math.abs(d));
  }
  const steps = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]) + Math.abs(b[2] - a[2]);
  for (let i = 0; i < steps; i++) {
    let k = 0;
    if (tMax[1]! < tMax[k]!) k = 1;
    if (tMax[2]! < tMax[k]!) k = 2;
    cell[k] = cell[k]! + step[k]!;
    tMax[k] = tMax[k]! + tDelta[k]!;
    out.push(cell[0]!, cell[1]!, cell[2]!);
  }
  return out;
}

/** Cells of a shape in a box (all kinds but line). `axis` is the normal of the base plane. */
export function shapeCells(
  kind: Exclude<ShapeKind, 'line'>,
  box: CellBox,
  axis: number,
  frame: ShapeFrame = { axis, baseAtMin: true },
): number[] {
  switch (kind) {
    case 'box':
    case 'rect':
      return boxCells(box);
    case 'ellipse':
    case 'cylinder':
      return ellipsoidCells(box, axis);
    case 'sphere':
      return ellipsoidCells(box);
    default:
      return solidCells(kind, box, { ...frame, axis });
  }
}

/**
 * Cones, pyramids, tori, stairs and arches in a box. Each cell is tested at its centre in
 * coordinates of the box: `h` from the base (0…1 over the height), `u`, `v` across the
 * footprint (−1…1).
 */
function solidCells(
  kind: 'cone' | 'pyramid' | 'torus' | 'stairs' | 'arch',
  box: CellBox,
  f: ShapeFrame,
): number[] {
  const { min, max } = box;
  const a = f.axis;
  const [ua, va] = [0, 1, 2].filter((k) => k !== a) as [number, number];
  const size = [0, 1, 2].map((k) => max[k]! - min[k]! + 1);
  const H = size[a]!;
  const ru = size[ua]! / 2;
  const rv = size[va]! / 2;
  // The longer footprint axis: what stairs climb along and arches span.
  const long = size[ua]! >= size[va]! ? ua : va;
  const out: number[] = [];
  for (let z = min[2]; z <= max[2]; z++)
    for (let y = min[1]; y <= max[1]; y++)
      for (let x = min[0]; x <= max[0]; x++) {
        const p = [x, y, z];
        const fromBase = f.baseAtMin ? p[a]! - min[a]! : max[a]! - p[a]!;
        const h = (fromBase + 0.5) / H;
        const u = (p[ua]! + 0.5 - (min[ua]! + ru)) / ru;
        const v = (p[va]! + 0.5 - (min[va]! + rv)) / rv;
        if (inside(kind, h, u, v, p, f, box, long, size)) out.push(x, y, z);
      }
  return out;
}

function inside(
  kind: 'cone' | 'pyramid' | 'torus' | 'stairs' | 'arch',
  h: number,
  u: number,
  v: number,
  p: number[],
  f: ShapeFrame,
  { min }: CellBox,
  long: number,
  size: number[],
): boolean {
  const slack = 1e-9;
  switch (kind) {
    case 'cone': {
      const r = 1 - h + 0.5 / size[f.axis]!;
      return u * u + v * v <= r * r + slack;
    }
    case 'pyramid': {
      const r = 1 - h + 0.5 / size[f.axis]!;
      return Math.max(Math.abs(u), Math.abs(v)) <= r + slack;
    }
    case 'torus': {
      // A ring lying on the base: the tube is as thick as the height, the hole in the middle.
      const rho = Math.hypot(u, v);
      const smaller =
        Math.min(size.filter((_, k) => k !== f.axis)[0]!, size.filter((_, k) => k !== f.axis)[1]!) /
        2;
      const tube = Math.min(0.5, size[f.axis]! / 2 / smaller);
      const across = (rho - (1 - tube)) / tube;
      const up = (h - 0.5) * 2;
      return across * across + up * up <= 1 + 0.15;
    }
    case 'stairs': {
      // Steps as many as the height, climbing towards the end the drag went to.
      const rise = f.rise ?? { axis: long, sign: 1 };
      const run = size[rise.axis]!;
      const along = p[rise.axis]! - min[rise.axis]!;
      const t = rise.sign > 0 ? along : run - 1 - along;
      const steps = size[f.axis]!;
      const step = Math.floor(((t + 0.5) * steps) / run);
      return h * steps <= step + 1;
    }
    case 'arch': {
      // A block with a half-round opening through it, under a top a quarter of the height thick.
      const across = long === [0, 1, 2].filter((k) => k !== f.axis)[0] ? u : v;
      const top = Math.max(1, Math.round(size[f.axis]! / 4)) / size[f.axis]!;
      const open = 1 - top;
      const w = 0.6;
      return (across / w) ** 2 + (h / open) ** 2 > 1;
    }
  }
}
