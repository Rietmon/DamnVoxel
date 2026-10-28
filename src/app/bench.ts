import { Chunk } from '../core/chunk';
import { blue, green, red } from '../core/color';
import { CHUNK_SIZE, CHUNK_VOLUME, chunkKey, keyX, keyY, keyZ, voxelIndex } from '../core/coords';
import { VoxelDocument } from '../core/document';
import { buildPadded, createPaddedBuffer } from '../core/padded';
import type { Palette } from '../core/palette';
import { meshChunk, meshScratch } from '../kernels/mesher';
import type { Editor } from './editor';
import { writable } from './store';

/** Edge of the benchmark scene in voxels: the 256³ model of the budgets in docs/stack.md. */
export const BENCH_SIZE = 256;
/** `?bench=large`: a terrain 1024 × 1024, sixteen times the area, far past MagicaVoxel's 256. */
export const LARGE_BENCH_SIZE = 1024;

function nearest(palette: Palette, r: number, g: number, b: number): number {
  let best = 1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let id = 1; id <= palette.size; id++) {
    const c = palette.color(id);
    const d = (red(c) - r) ** 2 + (green(c) - g) ** 2 + (blue(c) - b) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = id;
    }
  }
  return best;
}

/** Smooth pseudo-random hills from a few octaves of sines. Deterministic. */
function height(x: number, z: number): number {
  const h =
    40 * Math.sin(x * 0.021 + 1.3) * Math.cos(z * 0.017 + 0.4) +
    18 * Math.sin(x * 0.053 + z * 0.031) +
    9 * Math.cos(x * 0.11 - z * 0.093 + 2.1) +
    4 * Math.sin(x * 0.27 + 0.7) * Math.sin(z * 0.23 + 1.9);
  return Math.round(96 + h);
}

/**
 * A square terrain (256 × 256 by default) up to 256 high with layered colours and terraces: a
 * typical heavy model. Built chunk by chunk through dense buffers, so it takes a fraction of a
 * second per 256².
 */
export function createBenchDocument(size = BENCH_SIZE): VoxelDocument {
  const doc = VoxelDocument.createEmpty();
  const object = doc.scene.objects()[0]!;
  object.name = `Terrain ${size}`;
  const p = doc.palette;
  const sand = nearest(p, 221, 204, 153);
  const grass = nearest(p, 102, 153, 51);
  const darkGrass = nearest(p, 51, 102, 51);
  const dirt = nearest(p, 153, 102, 51);
  const rock = nearest(p, 119, 119, 119);
  const snow = nearest(p, 238, 238, 238);
  const heights = new Int32Array(size * size);
  for (let z = 0; z < size; z++)
    for (let x = 0; x < size; x++) heights[z * size + x] = height(x, z);

  const dense = new Uint16Array(CHUNK_VOLUME);
  const chunks = size / CHUNK_SIZE;
  // Heights stay under 256 whatever the area.
  const layers = BENCH_SIZE / CHUNK_SIZE;
  for (let cz = 0; cz < chunks; cz++)
    for (let cy = 0; cy < layers; cy++)
      for (let cx = 0; cx < chunks; cx++) {
        dense.fill(0);
        let any = false;
        for (let lz = 0; lz < CHUNK_SIZE; lz++)
          for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            const x = cx * CHUNK_SIZE + lx;
            const z = cz * CHUNK_SIZE + lz;
            const top = heights[z * size + x]!;
            for (let ly = 0; ly < CHUNK_SIZE; ly++) {
              const y = cy * CHUNK_SIZE + ly;
              if (y > top) break;
              const depth = top - y;
              let color: number;
              if (top > 150) color = depth < 2 ? snow : rock;
              else if (top > 125) color = rock;
              else if (top < 70) color = depth < 3 ? sand : rock;
              else
                color =
                  depth === 0
                    ? (x * 7 + z * 13) % 5 === 0
                      ? darkGrass
                      : grass
                    : depth < 4
                      ? dirt
                      : rock;
              dense[voxelIndex(lx, ly, lz)] = color;
              any = true;
            }
          }
        if (any) object.volume.putChunk(chunkKey(cx, cy, cz), Chunk.fromDense(dense));
      }
  object.volume.takeMeshDirty();
  return doc;
}

export interface BenchResult {
  stage: 'orbit' | 'done';
  /** What was measured: the terrain's name with its size. */
  scene: string;
  chunks: number;
  meshMedianMs: number;
  meshP95Ms: number;
  meshMaxMs: number;
  fps: number;
  frameP95Ms: number;
  slowFramePercent: number;
  voxelMB: number;
  meshMB: number;
}

function percentile(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
}

/**
 * Runs the viewport benchmark in the browser it is opened in (the point is to open it on a
 * phone): times the mesher on every chunk of the scene in the main thread, then orbits the
 * camera for a few seconds and records frame times.
 */
export function runBench(editor: Editor, orbitSeconds = 8) {
  const result = writable<BenchResult | null>(null);
  const doc = editor.doc;
  const object = doc.scene.objects()[0]!;
  const padded = createPaddedBuffer();
  const out = meshScratch();
  const times: number[] = [];
  for (const key of object.volume.chunkKeys()) {
    buildPadded(object.volume, keyX(key), keyY(key), keyZ(key), padded);
    const t = performance.now();
    meshChunk(padded, out);
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  let voxelBytes = 0;
  for (const [, chunk] of object.volume.chunks()) voxelBytes += chunk.memoryBytes();
  const base: BenchResult = {
    stage: 'orbit',
    scene: object.name,
    chunks: times.length,
    meshMedianMs: percentile(times, 0.5),
    meshP95Ms: percentile(times, 0.95),
    meshMaxMs: times.at(-1) ?? 0,
    fps: 0,
    frameP95Ms: 0,
    slowFramePercent: 0,
    voxelMB: voxelBytes / (1024 * 1024),
    meshMB: 0,
  };
  result.set(base);

  // Orbit once meshing in workers has finished.
  const intervals: number[] = [];
  let last = 0;
  let start = 0;
  const step = (now: number) => {
    const stats = editor.stats.get();
    if (stats.frames === 0 || stats.meshing) {
      requestAnimationFrame(step);
      return;
    }
    if (!start) start = now;
    if (last) intervals.push(now - last);
    last = now;
    editor.camera.yaw += 0.01;
    editor.markMotion();
    if (now - start < orbitSeconds * 1000) {
      requestAnimationFrame(step);
      return;
    }
    intervals.sort((a, b) => a - b);
    const avg = intervals.reduce((s, v) => s + v, 0) / Math.max(1, intervals.length);
    const refresh = intervals[0] ?? 16.7;
    const done: BenchResult = {
      ...base,
      stage: 'done',
      fps: Math.round(1000 / avg),
      frameP95Ms: percentile(intervals, 0.95),
      slowFramePercent:
        (100 * intervals.filter((v) => v > refresh * 1.5).length) / Math.max(1, intervals.length),
      meshMB: editor.stats.get().gpuMB,
    };
    result.set(done);
    console.info('Benchmark', done);
  };
  requestAnimationFrame(step);
  return result;
}
