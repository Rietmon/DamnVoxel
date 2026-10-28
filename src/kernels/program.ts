/**
 * Programs that build shapes (docs/programs.md): JavaScript with a small API — parameters,
 * colours, solids, fields, signed distances and noise — run where it cannot hang the editor (a
 * worker the editor stops after a time limit). Pure: no DOM, no core; the worker and the tests
 * call it the same way. Node graphs compile to the same API (core/node-graph.ts).
 */

export interface ProgramInput {
  source: string;
  /** Values of the parameters the program declares, by name; missing ones take their defaults. */
  params: Readonly<Record<string, number>>;
  /** The palette: 255 packed RGBA (r in the low byte), id 1 first. */
  palette: Uint32Array;
  /** Most voxels a program may make. */
  maxVoxels?: number;
}

export interface ProgramParam {
  name: string;
  value: number;
  min: number;
  max: number;
  step: number;
}

export interface ProgramError {
  message: string;
  /** Line in the source, 1-based, when the engine tells it. */
  line: number | null;
}

export interface ProgramResult {
  /** x, y, z per voxel. */
  positions: Int32Array;
  /** Palette id per voxel. */
  colors: Uint8Array;
  /** The parameters the program declared, in order, with the values it ran with. */
  params: ProgramParam[];
  log: string[];
  error: ProgramError | null;
  ms: number;
}

export const DEFAULT_MAX_VOXELS = 8_000_000;
/** Coordinates a program may use: ±LIMIT on each axis. */
const LIMIT = 1 << 16;
const SPAN = 1 << 17;

/** The names a program sees, in the order of the values runProgram passes. */
export const PROGRAM_API = [
  'param',
  'color',
  'palette',
  'set',
  'get',
  'erase',
  'box',
  'sphere',
  'ellipsoid',
  'cylinder',
  'cone',
  'torus',
  'line',
  'fill',
  'shape',
  'sd',
  'noise',
  'fbm',
  'rand',
  'seed',
  'lerp',
  'clamp',
  'smoothstep',
  'ramp',
  'log',
] as const;

// ---- Noise: gradient noise from a seeded permutation ----

function permutation(seed: number): Uint8Array {
  const p = new Uint8Array(512);
  const base = Array.from({ length: 256 }, (_, i) => i);
  let s = seed >>> 0 || 1;
  for (let i = 255; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [base[i], base[j]] = [base[j]!, base[i]!];
  }
  for (let i = 0; i < 512; i++) p[i] = base[i & 255]!;
  return p;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function grad(h: number, x: number, y: number, z: number): number {
  const k = h & 15;
  const u = k < 8 ? x : y;
  const v = k < 4 ? y : k === 12 || k === 14 ? x : z;
  return ((k & 1) === 0 ? u : -u) + ((k & 2) === 0 ? v : -v);
}

/** Perlin's improved noise, about −1…1. */
function perlin(p: Uint8Array, x: number, y: number, z: number): number {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const Z = Math.floor(z) & 255;
  x -= Math.floor(x);
  y -= Math.floor(y);
  z -= Math.floor(z);
  const u = fade(x);
  const v = fade(y);
  const w = fade(z);
  const A = p[X]! + Y;
  const AA = p[A]! + Z;
  const AB = p[A + 1]! + Z;
  const B = p[X + 1]! + Y;
  const BA = p[B]! + Z;
  const BB = p[B + 1]! + Z;
  return lerp(
    lerp(
      lerp(grad(p[AA]!, x, y, z), grad(p[BA]!, x - 1, y, z), u),
      lerp(grad(p[AB]!, x, y - 1, z), grad(p[BB]!, x - 1, y - 1, z), u),
      v,
    ),
    lerp(
      lerp(grad(p[AA + 1]!, x, y, z - 1), grad(p[BA + 1]!, x - 1, y, z - 1), u),
      lerp(grad(p[AB + 1]!, x, y - 1, z - 1), grad(p[BB + 1]!, x - 1, y - 1, z - 1), u),
      v,
    ),
    w,
  );
}

// ---- Signed distances: negative inside ----

const length3 = (x: number, y: number, z: number) => Math.hypot(x, y, z);

export const SD = {
  sphere: (x: number, y: number, z: number, r: number) => length3(x, y, z) - r,
  box: (x: number, y: number, z: number, bx: number, by: number, bz: number) => {
    const qx = Math.abs(x) - bx;
    const qy = Math.abs(y) - by;
    const qz = Math.abs(z) - bz;
    return (
      length3(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0)
    );
  },
  /** Vertical, centred on y = 0, `h` tall. */
  cylinder: (x: number, y: number, z: number, r: number, h: number) => {
    const dx = Math.hypot(x, z) - r;
    const dy = Math.abs(y) - h / 2;
    return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  },
  /** Ring lying flat (in XZ). */
  torus: (x: number, y: number, z: number, R: number, r: number) =>
    Math.hypot(Math.hypot(x, z) - R, y) - r,
  /** From a to b, radius r. */
  capsule: (
    x: number,
    y: number,
    z: number,
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    r: number,
  ) => {
    const px = x - ax;
    const py = y - ay;
    const pz = z - az;
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const h = Math.max(
      0,
      Math.min(1, (px * dx + py * dy + pz * dz) / (dx * dx + dy * dy + dz * dz || 1)),
    );
    return length3(px - dx * h, py - dy * h, pz - dz * h) - r;
  },
  union: (a: number, b: number) => Math.min(a, b),
  subtract: (a: number, b: number) => Math.max(a, -b),
  intersect: (a: number, b: number) => Math.max(a, b),
  /** Blends the shapes over about k voxels. */
  smoothUnion: (a: number, b: number, k: number) => {
    if (k <= 0) return Math.min(a, b);
    const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k));
    return lerp(b, a, h) - k * h * (1 - h);
  },
  smoothSubtract: (a: number, b: number, k: number) => {
    if (k <= 0) return Math.max(a, -b);
    const h = Math.max(0, Math.min(1, 0.5 - (0.5 * (a + b)) / k));
    return lerp(a, -b, h) + k * h * (1 - h);
  },
};

/** The nearest palette id to an sRGB colour (weighted, as the eye sees it). */
function nearestId(palette: Uint32Array, r: number, g: number, b: number): number {
  let best = 1;
  let bestD = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const c = palette[i]!;
    const d =
      2 * ((c & 255) - r) ** 2 +
      4 * (((c >>> 8) & 255) - g) ** 2 +
      3 * (((c >>> 16) & 255) - b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i + 1;
      if (d === 0) break;
    }
  }
  return best;
}

/** The source line of an error thrown inside the program, if the engine says. */
function errorLine(e: unknown, offset: number): number | null {
  const stack = e instanceof Error ? (e.stack ?? '') : '';
  const m = /(?:<anonymous>|anonymous|Function)[^\n]*?:(\d+):\d+/.exec(stack);
  if (!m) return null;
  const line = Number(m[1]) - offset;
  return line >= 1 ? line : null;
}

/** How many lines the engine puts before a new Function's body. */
let lineOffset: number | null = null;
function bodyOffset(): number {
  if (lineOffset !== null) return lineOffset;
  try {
    new Function('throw new Error("probe")')();
  } catch (e) {
    lineOffset = (errorLine(e, 0) ?? 1) - 1;
  }
  return lineOffset ?? 0;
}

export function runProgram(input: ProgramInput): ProgramResult {
  const start = Date.now();
  const maxVoxels = input.maxVoxels ?? DEFAULT_MAX_VOXELS;
  const voxels = new Map<number, number>();
  const params: ProgramParam[] = [];
  const log: string[] = [];
  const colourCache = new Map<number, number>();
  let noisePerm = permutation(1);
  let randState = 1;

  const key = (x: number, y: number, z: number) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    if (Math.abs(ix) >= LIMIT || Math.abs(iy) >= LIMIT || Math.abs(iz) >= LIMIT)
      throw new RangeError(`Coordinate outside ±${LIMIT}: ${ix}, ${iy}, ${iz}`);
    return ix + LIMIT + (iy + LIMIT) * SPAN + (iz + LIMIT) * SPAN * SPAN;
  };
  const id = (c: unknown): number => {
    const n = Math.round(Number(c));
    return Number.isFinite(n) ? Math.max(0, Math.min(255, n)) : 0;
  };
  const set = (x: number, y: number, z: number, c: number) => {
    const v = id(c);
    const k = key(x, y, z);
    if (v === 0) {
      voxels.delete(k);
      return;
    }
    if (!voxels.has(k) && voxels.size >= maxVoxels)
      throw new RangeError(`More than ${maxVoxels.toLocaleString('en-US')} voxels`);
    voxels.set(k, v);
  };
  const get = (x: number, y: number, z: number) => voxels.get(key(x, y, z)) ?? 0;
  /** Every cell of a box, inclusive and in either order. */
  const each = (
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    f: (x: number, y: number, z: number) => void,
  ) => {
    const [ax, bx] = [Math.floor(Math.min(x0, x1)), Math.floor(Math.max(x0, x1))];
    const [ay, by] = [Math.floor(Math.min(y0, y1)), Math.floor(Math.max(y0, y1))];
    const [az, bz] = [Math.floor(Math.min(z0, z1)), Math.floor(Math.max(z0, z1))];
    for (let z = az; z <= bz; z++)
      for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) f(x, y, z);
  };
  /** Cells whose centre is inside a distance field, within a box around it. */
  const solid = (
    d: (x: number, y: number, z: number) => number,
    c: number | ((x: number, y: number, z: number) => number),
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
  ) =>
    each(x0, y0, z0, x1, y1, z1, (x, y, z) => {
      if (d(x + 0.5, y + 0.5, z + 0.5) <= 0) set(x, y, z, typeof c === 'function' ? c(x, y, z) : c);
    });

  const api = {
    param(name: string, value: number, min = 0, max = 100, step = 1): number {
      const given = input.params[name];
      const v = Number.isFinite(given) ? Math.max(min, Math.min(max, given!)) : value;
      if (!params.some((p) => p.name === name)) params.push({ name, value: v, min, max, step });
      return v;
    },
    color(r: number | string, g?: number, b?: number): number {
      let rgb: [number, number, number];
      if (typeof r === 'string') {
        const m = /^#?([0-9a-f]{6})$/i.exec(r.trim());
        if (!m) throw new TypeError(`Color “${r}”: needs the #rrggbb form`);
        const n = Number.parseInt(m[1]!, 16);
        rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      } else
        rgb = [r, g ?? r, b ?? r].map((v) => Math.max(0, Math.min(255, Math.round(v)))) as [
          number,
          number,
          number,
        ];
      const k = (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
      let found = colourCache.get(k);
      if (found === undefined) {
        found = nearestId(input.palette, ...rgb);
        colourCache.set(k, found);
      }
      return found;
    },
    palette: (n: number) => Math.max(1, Math.min(255, Math.round(n))),
    set,
    get,
    erase: (x: number, y: number, z: number) => set(x, y, z, 0),
    box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number) {
      each(x0, y0, z0, x1, y1, z1, (x, y, z) => set(x, y, z, c));
    },
    sphere(cx: number, cy: number, cz: number, r: number, c: number) {
      solid(
        (x, y, z) => SD.sphere(x - cx, y - cy, z - cz, r),
        c,
        cx - r,
        cy - r,
        cz - r,
        cx + r,
        cy + r,
        cz + r,
      );
    },
    ellipsoid(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, c: number) {
      solid(
        (x, y, z) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2 - 1,
        c,
        cx - rx,
        cy - ry,
        cz - rz,
        cx + rx,
        cy + ry,
        cz + rz,
      );
    },
    /** Standing on (cx, cy, cz), h tall. */
    cylinder(cx: number, cy: number, cz: number, r: number, h: number, c: number) {
      solid(
        (x, y, z) => SD.cylinder(x - cx, y - cy - h / 2, z - cz, r, h),
        c,
        cx - r,
        cy,
        cz - r,
        cx + r,
        cy + h - 1,
        cz + r,
      );
    },
    cone(cx: number, cy: number, cz: number, r: number, h: number, c: number) {
      solid(
        (x, y, z) => Math.hypot(x - cx, z - cz) - r * (1 - (y - cy) / h),
        c,
        cx - r,
        cy,
        cz - r,
        cx + r,
        cy + h - 1,
        cz + r,
      );
    },
    torus(cx: number, cy: number, cz: number, R: number, r: number, c: number) {
      solid(
        (x, y, z) => SD.torus(x - cx, y - cy, z - cz, R, r),
        c,
        cx - R - r,
        cy - r,
        cz - R - r,
        cx + R + r,
        cy + r,
        cz + R + r,
      );
    },
    line(
      x0: number,
      y0: number,
      z0: number,
      x1: number,
      y1: number,
      z1: number,
      c: number,
      radius = 0,
    ) {
      if (radius <= 0) {
        const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), 1);
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          set(
            Math.round(lerp(x0, x1, t)),
            Math.round(lerp(y0, y1, t)),
            Math.round(lerp(z0, z1, t)),
            c,
          );
        }
        return;
      }
      const r = radius;
      solid(
        (x, y, z) =>
          SD.capsule(x, y, z, x0 + 0.5, y0 + 0.5, z0 + 0.5, x1 + 0.5, y1 + 0.5, z1 + 0.5, r),
        c,
        Math.min(x0, x1) - r,
        Math.min(y0, y1) - r,
        Math.min(z0, z1) - r,
        Math.max(x0, x1) + r,
        Math.max(y0, y1) + r,
        Math.max(z0, z1) + r,
      );
    },
    /** Each cell of the box gets what `f(x, y, z)` returns (0 leaves it as it is). */
    fill(
      x0: number,
      y0: number,
      z0: number,
      x1: number,
      y1: number,
      z1: number,
      f: (x: number, y: number, z: number) => number,
    ) {
      each(x0, y0, z0, x1, y1, z1, (x, y, z) => {
        const c = id(f(x, y, z));
        if (c) set(x, y, z, c);
      });
    },
    /** Cells where the distance `d(x, y, z)` is ≤ 0, coloured `c` (a number or a function). */
    shape: solid,
    sd: SD,
    noise: (x: number, y = 0, z = 0) => perlin(noisePerm, x, y, z),
    fbm(x: number, y = 0, z = 0, octaves = 4) {
      let sum = 0;
      let amp = 0.5;
      let f = 1;
      for (let i = 0; i < octaves; i++) {
        sum += amp * perlin(noisePerm, x * f, y * f, z * f);
        f *= 2;
        amp *= 0.5;
      }
      return sum;
    },
    rand() {
      randState = (Math.imul(randState, 1664525) + 1013904223) >>> 0;
      return randState / 4294967296;
    },
    seed(n: number) {
      randState = n >>> 0 || 1;
      noisePerm = permutation(n);
    },
    lerp,
    clamp: (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v)),
    smoothstep(a: number, b: number, v: number) {
      const t = Math.max(0, Math.min(1, (v - a) / (b - a || 1)));
      return t * t * (3 - 2 * t);
    },
    /** One of the colours by t in 0…1. */
    ramp: (t: number, ids: readonly number[]) =>
      ids[Math.max(0, Math.min(ids.length - 1, Math.floor(t * ids.length)))] ?? 0,
    log: (...args: unknown[]) => {
      if (log.length < 200)
        log.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    },
  };

  let error: ProgramError | null = null;
  try {
    const body = `"use strict";${input.source}`;
    const run = new Function(...PROGRAM_API, body);
    run(...PROGRAM_API.map((n) => api[n]));
  } catch (e) {
    error = {
      message:
        e instanceof Error ? `${e.name === 'Error' ? '' : `${e.name}: `}${e.message}` : String(e),
      line: e instanceof SyntaxError ? null : errorLine(e, bodyOffset()),
    };
  }
  const positions = new Int32Array(voxels.size * 3);
  const colors = new Uint8Array(voxels.size);
  let i = 0;
  for (const [k, c] of voxels) {
    positions[i * 3] = (k % SPAN) - LIMIT;
    positions[i * 3 + 1] = (Math.floor(k / SPAN) % SPAN) - LIMIT;
    positions[i * 3 + 2] = Math.floor(k / (SPAN * SPAN)) - LIMIT;
    colors[i] = c;
    i++;
  }
  return { positions, colors, params, log, error, ms: Date.now() - start };
}
