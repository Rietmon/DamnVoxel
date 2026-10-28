import { CHUNK_SIZE, CHUNK_VOLUME, FACE_NORMALS, keyX, keyY, keyZ } from '../coords';
import type { VoxelObject } from '../scene';
import { MASK_WORDS, SelectionMask } from '../selection';
import { faceRegion } from './face';
import type { Cell } from './shapes';

/** Projects an object-local point to viewport pixels; false when it is behind the camera. */
export type ScreenProjector = (x: number, y: number, z: number, out: [number, number]) => boolean;

/** Connected regions never grow past this many voxels (a click must stay fast). */
const MAX_CONNECTED = 4_000_000;

const dense = new Uint16Array(CHUNK_VOLUME);

function setBit(mask: Uint32Array, i: number): void {
  mask[i >>> 5] = mask[i >>> 5]! | (1 << (i & 31));
}

/** Filled voxels inside an inclusive cell box, chunk by chunk. */
export function boxRegion(object: VoxelObject, min: Cell, max: Cell): SelectionMask {
  const region = new SelectionMask();
  for (const [key, chunk] of object.volume.chunks()) {
    const ox = keyX(key) * CHUNK_SIZE;
    const oy = keyY(key) * CHUNK_SIZE;
    const oz = keyZ(key) * CHUNK_SIZE;
    const x0 = Math.max(min[0], ox) - ox;
    const y0 = Math.max(min[1], oy) - oy;
    const z0 = Math.max(min[2], oz) - oz;
    const x1 = Math.min(max[0], ox + CHUNK_SIZE - 1) - ox;
    const y1 = Math.min(max[1], oy + CHUNK_SIZE - 1) - oy;
    const z1 = Math.min(max[2], oz + CHUNK_SIZE - 1) - oz;
    if (x0 > x1 || y0 > y1 || z0 > z1) continue;
    chunk.decodeInto(dense);
    const mask = new Uint32Array(MASK_WORDS);
    for (let z = z0; z <= z1; z++)
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const i = x | (y << 5) | (z << 10);
          if (dense[i] !== 0) setBit(mask, i);
        }
    region.putChunk(key, mask);
  }
  return region;
}

/**
 * Filled voxels whose centres project inside a screen shape, through the whole depth. Chunks
 * whose projected box misses the shape's screen box are skipped without looking inside.
 */
export function screenRegion(
  object: VoxelObject,
  project: ScreenProjector,
  inside: (x: number, y: number) => boolean,
  bounds: [number, number, number, number],
): SelectionMask {
  const region = new SelectionMask();
  const p: [number, number] = [0, 0];
  const [bx0, by0, bx1, by1] = bounds;
  for (const [key, chunk] of object.volume.chunks()) {
    const ox = keyX(key) * CHUNK_SIZE;
    const oy = keyY(key) * CHUNK_SIZE;
    const oz = keyZ(key) * CHUNK_SIZE;
    let sx0 = Infinity;
    let sy0 = Infinity;
    let sx1 = -Infinity;
    let sy1 = -Infinity;
    let behind = false;
    for (const cx of [ox, ox + CHUNK_SIZE])
      for (const cy of [oy, oy + CHUNK_SIZE])
        for (const cz of [oz, oz + CHUNK_SIZE]) {
          if (!project(cx, cy, cz, p)) behind = true;
          sx0 = Math.min(sx0, p[0]);
          sy0 = Math.min(sy0, p[1]);
          sx1 = Math.max(sx1, p[0]);
          sy1 = Math.max(sy1, p[1]);
        }
    // A chunk partly behind the camera is tested voxel by voxel.
    if (!behind && (sx1 < bx0 || sx0 > bx1 || sy1 < by0 || sy0 > by1)) continue;
    chunk.decodeInto(dense);
    const mask = new Uint32Array(MASK_WORDS);
    let any = false;
    for (let i = 0; i < CHUNK_VOLUME; i++) {
      if (dense[i] === 0) continue;
      if (!project(ox + (i & 31) + 0.5, oy + ((i >> 5) & 31) + 0.5, oz + (i >> 10) + 0.5, p))
        continue;
      if (inside(p[0], p[1])) {
        setBit(mask, i);
        any = true;
      }
    }
    if (any) region.putChunk(key, mask);
  }
  return region;
}

/** Point-in-polygon by ray crossing; the polygon is closed implicitly. */
export function insidePolygon(points: readonly [number, number][], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]!;
    const [xj, yj] = points[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

export type RegionMode = 'volume' | 'face' | 'color';

/**
 * The region of a click: the connected solid (6-connected), the connected flat face, or the
 * connected voxels of the same colour.
 */
export function clickRegion(
  object: VoxelObject,
  x: number,
  y: number,
  z: number,
  face: number,
  mode: RegionMode,
): SelectionMask {
  const region = new SelectionMask();
  const volume = object.volume;
  const seed = volume.get(x, y, z);
  if (seed === 0) return region;
  if (mode === 'face') {
    const cells = faceRegion(volume, x, y, z, face, false);
    for (let i = 0; i < cells.length; i += 4)
      region.set(cells[i]!, cells[i + 1]!, cells[i + 2]!, true);
    return region;
  }
  const stack: number[] = [x, y, z];
  region.set(x, y, z, true);
  while (stack.length > 0 && region.count < MAX_CONNECTED) {
    const cz = stack.pop()!;
    const cy = stack.pop()!;
    const cx = stack.pop()!;
    for (const [nx, ny, nz] of FACE_NORMALS) {
      const px = cx + nx;
      const py = cy + ny;
      const pz = cz + nz;
      if (region.has(px, py, pz)) continue;
      const v = volume.get(px, py, pz);
      if (v === 0 || (mode === 'color' && v !== seed)) continue;
      region.set(px, py, pz, true);
      stack.push(px, py, pz);
    }
  }
  return region;
}
