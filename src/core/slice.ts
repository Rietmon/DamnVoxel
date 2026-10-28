import type { Modifier } from './modifiers';
import { orientationRows } from './orientation';
import type { Transform } from './scene';
import type { Box } from './volume';

/**
 * A cut through the world along one axis: cells past `at` are hidden — above it with dir 1,
 * below it with dir −1. Cell `at` itself stays.
 */
export interface WorldSlice {
  readonly axis: 0 | 1 | 2;
  readonly at: number;
  readonly dir: 1 | -1;
}

/**
 * The cut seen from one object. An axis-aligned orientation maps a world axis onto one local
 * axis, so in the object's own space the cut is `sign · cell[axis] > limit` — a half-space the
 * mesher, the picker and the tools can all apply cheaply and exactly.
 */
export interface LocalClip {
  readonly axis: number;
  readonly sign: 1 | -1;
  readonly limit: number;
}

/** The local form of a world cut for an object placed at `t`. */
export function sliceClip(t: Transform, slice: WorldSlice): LocalClip {
  const { perm, signs } = orientationRows(t.orientation);
  const a = slice.axis;
  const s = signs[a] as 1 | -1;
  const origin = a === 0 ? t.x : a === 1 ? t.y : t.z;
  // World cell of a local cell along a: s · c[perm[a]] − (s < 0 ? 1 : 0) + origin (see
  // orientCell). Hidden when dir · world > dir · at.
  const off = s < 0 ? 1 : 0;
  return {
    axis: perm[a]!,
    sign: (slice.dir * s) as 1 | -1,
    limit: slice.dir * (slice.at - origin + off),
  };
}

/** A key that changes whenever the cut does. */
export function sliceKey(slice: WorldSlice | null): string {
  return slice ? `${slice.axis},${slice.at},${slice.dir}` : '';
}

export function isClipped(clip: LocalClip, x: number, y: number, z: number): boolean {
  const c = clip.axis === 0 ? x : clip.axis === 1 ? y : z;
  return clip.sign * c > clip.limit;
}

/** The part of a local box the cut leaves visible, or null when it hides all of it. */
export function clipBox(box: Box, clip: LocalClip): Box | null {
  const lo: [number, number, number] = [box.minX, box.minY, box.minZ];
  const hi: [number, number, number] = [box.maxX, box.maxY, box.maxZ];
  if (clip.sign > 0) hi[clip.axis] = Math.min(hi[clip.axis]!, clip.limit);
  else lo[clip.axis] = Math.max(lo[clip.axis]!, -clip.limit);
  if (lo[clip.axis]! > hi[clip.axis]!) return null;
  return { minX: lo[0], minY: lo[1], minZ: lo[2], maxX: hi[0], maxY: hi[1], maxZ: hi[2] };
}

/** Drops the cells of an operation that the cut hides: tools never touch what you cannot see. */
export function sliceModifier(clip: LocalClip | null): Modifier {
  return (op) =>
    clip
      ? {
          action: op.action,
          forEachCell(visit) {
            op.forEachCell((x, y, z, color) => {
              if (!isClipped(clip, x, y, z)) visit(x, y, z, color);
            });
          },
        }
      : op;
}
