/**
 * Mesher benchmark in Node: typical and worst-case chunks, median over several batches.
 * Compares typical chunks with the budget from docs/stack.md, the only place budgets live.
 * Run: node scripts/bench-mesher.ts
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { meshChunk, meshScratch, PADDED_VOLUME, paddedIndex } from '../src/kernels/mesher.ts';

const ROOT = resolve(import.meta.dirname, '..');

function readBudgetMs(): number {
  const stack = readFileSync(join(ROOT, 'docs', 'stack.md'), 'utf8');
  const match = stack.match(/Re-meshing one 32³ chunk on a mid-range phone \| ≤ (\d+) ms/);
  if (!match) throw new Error('Mesh budget row not found in docs/stack.md');
  return Number(match[1]);
}

function make(fill: (x: number, y: number, z: number) => number): Uint16Array {
  const p = new Uint16Array(PADDED_VOLUME);
  for (let z = -1; z <= 32; z++)
    for (let y = -1; y <= 32; y++)
      for (let x = -1; x <= 32; x++) p[paddedIndex(x, y, z)] = fill(x, y, z);
  return p;
}

let seed = 1;
const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;

const cases: { name: string; typical: boolean; padded: Uint16Array }[] = [
  {
    name: 'terrain surface',
    typical: true,
    padded: make((x, y, z) =>
      y < 12 + 6 * Math.sin(x / 5) * Math.cos(z / 7) ? 1 + ((x >> 3) & 3) : 0,
    ),
  },
  {
    name: 'sphere',
    typical: true,
    padded: make((x, y, z) => ((x - 16) ** 2 + (y - 16) ** 2 + (z - 16) ** 2 < 225 ? 2 : 0)),
  },
  {
    name: 'painted half-fill',
    typical: true,
    padded: make((_x, y) => (y < 16 ? 1 + Math.floor(random() * 8) : 0)),
  },
  { name: 'random 30% (worst-ish)', typical: false, padded: make(() => (random() < 0.3 ? 1 : 0)) },
  {
    name: 'checkerboard (worst)',
    typical: false,
    padded: make((x, y, z) => ((x + y + z) & 1 ? 1 : 0)),
  },
];

const out = meshScratch();
const budget = readBudgetMs();
let worstTypical = 0;
console.log('median ms  quads   case');
for (const c of cases) {
  for (let i = 0; i < 30; i++) meshChunk(c.padded, out);
  const batches: number[] = [];
  let quads = 0;
  for (let b = 0; b < 15; b++) {
    const t = performance.now();
    for (let i = 0; i < 20; i++) quads = meshChunk(c.padded, out);
    batches.push((performance.now() - t) / 20);
  }
  batches.sort((a, b) => a - b);
  const median = batches[Math.floor(batches.length / 2)]!;
  if (c.typical) worstTypical = Math.max(worstTypical, median);
  console.log(`${median.toFixed(3).padStart(9)}  ${String(quads).padStart(6)}   ${c.name}`);
}
console.log(
  `typical chunks: up to ${worstTypical.toFixed(2)} ms on this machine; budget ${budget} ms on a mid-range phone`,
);
