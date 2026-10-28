import { FACE_NORMALS, type Vec3i } from '../coords';
import { cellsOperation, colouredCellsOperation, type Operation } from '../operation';
import type { VolumeReader } from '../volume';

/**
 * Sculpting: reshape the surface inside a ball instead of placing
 * voxels one by one. Every mode reads the model as it was before the stroke, so one stroke is
 * one layer however long the pointer lingers.
 */

export type SculptMode = 'grow' | 'erode' | 'smooth' | 'bumps' | 'flatten';
/** Which way growing and eroding go: along the face normal, straight up, or out of every side. */
export type SculptDirection = 'normal' | 'up' | 'all';

export const SCULPT_TITLES: Record<SculptMode, string> = {
  grow: 'Grow',
  erode: 'Erode',
  smooth: 'Smooth',
  bumps: 'Bumps',
  flatten: 'Flatten',
};

export interface SculptOptions {
  mode: SculptMode;
  /** Diameter of the ball in voxels. */
  size: number;
  direction: SculptDirection;
  /** Face of the first hit: its normal for 'normal', and the plane flatten levels to. */
  face: number;
  /** Flatten: the cell whose layer the surface is levelled to. */
  anchor: Vec3i;
  /** Colour for new voxels; null takes the colour of a neighbour. */
  color: number | null;
}

/** What a sculpt pass does: voxels to add (with colours) and cells to empty. */
export interface SculptEdit {
  add: Operation;
  erase: Operation;
  /** Changed cells, for an empty check. */
  count: number;
}

const UP = 2;

/** Cells of the ball around `center`, diameter `size`. */
function forBall(center: Vec3i, size: number, visit: (x: number, y: number, z: number) => void) {
  const r = Math.max(0.5, size / 2);
  const reach = Math.ceil(r);
  const r2 = r * r;
  for (let dz = -reach; dz <= reach; dz++)
    for (let dy = -reach; dy <= reach; dy++)
      for (let dx = -reach; dx <= reach; dx++)
        if (dx * dx + dy * dy + dz * dz <= r2)
          visit(center[0] + dx, center[1] + dy, center[2] + dz);
}

/** A colour of a filled face neighbour, or 0. */
function neighbourColor(v: VolumeReader, x: number, y: number, z: number): number {
  for (const [nx, ny, nz] of FACE_NORMALS) {
    const c = v.get(x + nx, y + ny, z + nz);
    if (c) return c;
  }
  return 0;
}

/** A cheap repeatable hash: the same cell always gets the same bump. */
function noise(x: number, y: number, z: number): number {
  let h = Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(z, 0xcb1ab31f);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 0x100000000;
}

/** One sculpt pass inside the ball around `center`, read from `base`. */
export function sculpt(base: VolumeReader, center: Vec3i, o: SculptOptions): SculptEdit {
  const add: number[] = [];
  const erase: number[] = [];
  const dirs: readonly Readonly<Vec3i>[] =
    o.direction === 'all' ? FACE_NORMALS : [FACE_NORMALS[o.direction === 'up' ? UP : o.face]!];
  const colorFor = (x: number, y: number, z: number) => o.color ?? neighbourColor(base, x, y, z);
  forBall(center, o.size, (x, y, z) => {
    const v = base.get(x, y, z);
    switch (o.mode) {
      case 'grow':
      case 'bumps': {
        // An empty cell resting on the surface: its neighbour against the direction is filled.
        if (v) return;
        const rests = dirs.some(([dx, dy, dz]) => base.get(x - dx, y - dy, z - dz) !== 0);
        if (!rests || (o.mode === 'bumps' && noise(x, y, z) > 0.3)) return;
        const c = colorFor(x, y, z);
        if (c) add.push(x, y, z, c);
        return;
      }
      case 'erode': {
        // A filled cell open to the direction.
        if (!v) return;
        if (dirs.some(([dx, dy, dz]) => base.get(x + dx, y + dy, z + dz) === 0))
          erase.push(x, y, z);
        return;
      }
      case 'smooth': {
        // A 3³ vote: lonely voxels go, deep dents fill.
        let filled = 0;
        for (let dz = -1; dz <= 1; dz++)
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++)
              if ((dx || dy || dz) && base.get(x + dx, y + dy, z + dz)) filled++;
        if (v && filled <= 9) erase.push(x, y, z);
        else if (!v && filled >= 17) {
          const c = colorFor(x, y, z);
          if (c) add.push(x, y, z, c);
        }
        return;
      }
      case 'flatten': {
        // Level to the anchor's layer along the face normal: cut what stands above it, fill
        // what lies below it under the surface.
        const n = FACE_NORMALS[o.face]!;
        const axis = n[0] ? 0 : n[1] ? 1 : 2;
        const sign = n[axis]!;
        const height = ([x, y, z][axis]! - o.anchor[axis]!) * sign;
        if (height > 0 && v) erase.push(x, y, z);
        else if (height <= 0 && !v) {
          // Fill a dent: only above model further down the same column, so flattening never
          // builds floating slabs.
          const reach = Math.ceil(o.size);
          for (let k = 1; k <= reach; k++) {
            const below = base.get(x - n[0] * k, y - n[1] * k, z - n[2] * k);
            if (!below) continue;
            add.push(x, y, z, o.color ?? below);
            break;
          }
        }
        return;
      }
    }
  });
  return {
    add: colouredCellsOperation('add', add),
    erase: cellsOperation('erase', 0, erase),
    count: add.length / 4 + erase.length / 3,
  };
}
