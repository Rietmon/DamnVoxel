/**
 * Draws the app icon (an isometric cluster of voxels) and writes it as SVG and PNG.
 * PNG encoding is done by hand with node:zlib so the script needs no dependencies.
 * Run: node scripts/make-icons.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

type Vec2 = [number, number];
interface Poly {
  points: Vec2[];
  color: string;
}

const OUT = resolve(import.meta.dirname, '..', 'public');
const BACKGROUND = '#1b1d22';
/** Face shades: top, left (+z), right (+x). */
const SHADES = ['#ffc46b', '#f08a3c', '#c2582b'];

/** Voxels of the logo: a 2×2×2 cube without the top front corner. */
const VOXELS: [number, number, number][] = [];
for (let x = 0; x < 2; x++)
  for (let y = 0; y < 2; y++)
    for (let z = 0; z < 2; z++) if (!(x === 1 && y === 1 && z === 1)) VOXELS.push([x, y, z]);

const COS30 = Math.cos(Math.PI / 6);
const SIN30 = 0.5;

function project(x: number, y: number, z: number): Vec2 {
  return [(x - z) * COS30, (x + z) * SIN30 - y];
}

/** Visible faces of the voxel cluster, back to front, in unit iso space. */
function logoPolys(): Poly[] {
  const filled = new Set(VOXELS.map((v) => v.join()));
  const has = (x: number, y: number, z: number) => filled.has(`${x},${y},${z}`);
  const sorted = [...VOXELS].sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  const polys: Poly[] = [];
  for (const [x, y, z] of sorted) {
    if (!has(x, y + 1, z)) {
      polys.push({
        points: [
          project(x, y + 1, z),
          project(x + 1, y + 1, z),
          project(x + 1, y + 1, z + 1),
          project(x, y + 1, z + 1),
        ],
        color: SHADES[0]!,
      });
    }
    if (!has(x, y, z + 1)) {
      polys.push({
        points: [
          project(x, y, z + 1),
          project(x + 1, y, z + 1),
          project(x + 1, y + 1, z + 1),
          project(x, y + 1, z + 1),
        ],
        color: SHADES[1]!,
      });
    }
    if (!has(x + 1, y, z)) {
      polys.push({
        points: [
          project(x + 1, y, z),
          project(x + 1, y, z + 1),
          project(x + 1, y + 1, z + 1),
          project(x + 1, y + 1, z),
        ],
        color: SHADES[2]!,
      });
    }
  }
  return polys;
}

/** Fits the logo into a square of `size` with the given margin fraction. */
function layout(size: number, margin: number): Poly[] {
  const polys = logoPolys();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of polys)
    for (const [x, y] of p.points) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  const inner = size * (1 - 2 * margin);
  const scale = inner / Math.max(maxX - minX, maxY - minY);
  const ox = (size - (maxX - minX) * scale) / 2 - minX * scale;
  const oy = (size - (maxY - minY) * scale) / 2 - minY * scale;
  return polys.map((p) => ({
    color: p.color,
    points: p.points.map(([x, y]) => [ox + x * scale, oy + y * scale] as Vec2),
  }));
}

function svg(size: number): string {
  const polys = layout(size, 0.2);
  const body = polys
    .map(
      (p) =>
        `<path fill="${p.color}" d="M${p.points.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join('L')}Z"/>`,
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><title>DamnVoxel</title><rect width="${size}" height="${size}" rx="${size * 0.22}" fill="${BACKGROUND}"/>${body}</svg>\n`;
}

function parseHex(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function insideConvex(points: Vec2[], x: number, y: number): boolean {
  let sign = 0;
  for (let i = 0; i < points.length; i++) {
    const [ax, ay] = points[i]!;
    const [bx, by] = points[(i + 1) % points.length]!;
    const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (cross !== 0) {
      const s = Math.sign(cross);
      if (sign !== 0 && s !== sign) return false;
      sign = s;
    }
  }
  return true;
}

/** Rasterizes the icon with 4×4 supersampling. `radius` is the corner radius fraction, 0 = full bleed. */
function raster(size: number, margin: number, radius: number): Uint8Array {
  const SS = 4;
  const n = size * SS;
  const color = new Uint8Array(n * n * 3);
  const alpha = new Uint8Array(n * n);
  const bg = parseHex(BACKGROUND);
  const r = radius * n;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const dx = Math.max(r - px, px - (n - r), 0);
      const dy = Math.max(r - py, py - (n - r), 0);
      if (r > 0 && dx * dx + dy * dy > r * r) continue;
      const i = y * n + x;
      alpha[i] = 255;
      color.set(bg, i * 3);
    }
  for (const poly of layout(n, margin)) {
    const rgb = parseHex(poly.color);
    const xs = poly.points.map((p) => p[0]);
    const ys = poly.points.map((p) => p[1]);
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++)
      for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        if (insideConvex(poly.points, x + 0.5, y + 0.5)) color.set(rgb, (y * n + x) * 3);
      }
  }
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let r0 = 0;
      let g0 = 0;
      let b0 = 0;
      let a0 = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const i = (y * SS + sy) * n + x * SS + sx;
          const a = alpha[i]!;
          r0 += color[i * 3]! * a;
          g0 += color[i * 3 + 1]! * a;
          b0 += color[i * 3 + 2]! * a;
          a0 += a;
        }
      const o = (y * size + x) * 4;
      if (a0 > 0) {
        out[o] = Math.round(r0 / a0);
        out[o + 1] = Math.round(g0 / a0);
        out[o + 2] = Math.round(b0 / a0);
      }
      out[o + 3] = Math.round(a0 / (SS * SS));
    }
  return out;
}

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function png(size: number, rgba: Uint8Array): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, size);
  view.setUint32(4, size);
  header.set([8, 6, 0, 0, 0], 8);
  const raw = new Uint8Array(size * (size * 4 + 1));
  for (let y = 0; y < size; y++)
    raw.set(rgba.subarray(y * size * 4, (y + 1) * size * 4), y * (size * 4 + 1) + 1);
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

mkdirSync(join(OUT, 'icons'), { recursive: true });
writeFileSync(join(OUT, 'favicon.svg'), svg(64));
const icons: [string, number, number, number][] = [
  ['icons/icon-192.png', 192, 0.2, 0.22],
  ['icons/icon-512.png', 512, 0.2, 0.22],
  // Maskable: full-bleed background, logo inside the 80% safe zone.
  ['icons/maskable-512.png', 512, 0.3, 0],
  ['icons/apple-touch-icon.png', 180, 0.2, 0],
];
for (const [name, size, margin, radius] of icons) {
  writeFileSync(join(OUT, name), png(size, raster(size, margin, radius)));
}
console.log('Icons written to public/.');
