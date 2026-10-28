import { FACE_NORMALS, faceAxis, faceSign } from '../coords';
import type { EditAction } from '../operation';
import type { VolumeReader } from '../volume';
import type { BrushMode, BrushShape } from './tool';

export interface StampOptions {
  shape: BrushShape;
  mode: BrushMode;
  /** Edge or diameter in voxels. */
  size: number;
  action: EditAction;
}

export const MAX_BRUSH_SIZE = 64;

const NEIGHBOURS = FACE_NORMALS;

/**
 * Cells of one brush stamp around `center` (an integer cell), in object-local coordinates.
 *
 * - `face` is the face of the hit: plane mode keeps the stamp in the layer across that face.
 * - `point` is the exact hit point: an even-sized stamp has no centre cell, so across the face
 *   it extends towards the side of the cell the pointer is on (the brush follows the pointer at
 *   half a voxel), and along the normal away from the surface for add, into it otherwise.
 * - Surface mode keeps only the surface layer of `reader`: for add, empty cells touching the
 *   model; for erase and paint, filled cells touching empty space.
 */
export function stampCells(
  center: readonly number[],
  face: number,
  point: readonly number[],
  options: StampOptions,
  reader: VolumeReader,
): number[] {
  const size = Math.max(1, Math.min(MAX_BRUSH_SIZE, Math.round(options.size)));
  const normalAxis = faceAxis(face);
  const flat = options.mode === 'plane';
  // Continuous centre of the stamp per axis.
  const c = [0, 0, 0];
  const lo = [0, 0, 0];
  const hi = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    if (flat && a === normalAxis) {
      c[a] = center[a]! + 0.5;
      lo[a] = hi[a] = center[a]!;
      continue;
    }
    let mid = center[a]! + 0.5;
    if (size % 2 === 0) {
      // Even: the centre is a cell corner, on the side of the cell the pointer is on.
      // Along the normal it grows away from the surface for add and into it otherwise.
      const grows =
        a === normalAxis
          ? faceSign(face) > 0 === (options.action === 'add')
          : point[a]! - Math.floor(point[a]!) >= 0.5;
      mid += grows ? 0.5 : -0.5;
    }
    c[a] = mid;
    lo[a] = Math.round(mid - size / 2);
    hi[a] = lo[a]! + size - 1;
  }

  const r2 = (size / 2) ** 2;
  const out: number[] = [];
  for (let z = lo[2]!; z <= hi[2]!; z++)
    for (let y = lo[1]!; y <= hi[1]!; y++)
      for (let x = lo[0]!; x <= hi[0]!; x++) {
        if (options.shape === 'sphere') {
          const dx = x + 0.5 - c[0]!;
          const dy = y + 0.5 - c[1]!;
          const dz = z + 0.5 - c[2]!;
          const d2 =
            (flat && normalAxis === 0 ? 0 : dx * dx) +
            (flat && normalAxis === 1 ? 0 : dy * dy) +
            (flat && normalAxis === 2 ? 0 : dz * dz);
          // A little slack rounds small spheres nicely (size 3 keeps its edge cells).
          if (d2 > r2 + 0.25) continue;
        }
        if (options.mode === 'surface' && !onSurface(reader, x, y, z, options.action)) continue;
        out.push(x, y, z);
      }
  return out;
}

/** True when a cell belongs to the surface layer an action works on. */
function onSurface(
  reader: VolumeReader,
  x: number,
  y: number,
  z: number,
  action: EditAction,
): boolean {
  const filled = reader.get(x, y, z) !== 0;
  if (action === 'add' ? filled : !filled) return false;
  for (const [nx, ny, nz] of NEIGHBOURS) {
    const neighbour = reader.get(x + nx, y + ny, z + nz) !== 0;
    // Add: an empty cell next to the model. Erase/paint: a filled cell next to air.
    if (action === 'add' ? neighbour : !neighbour) return true;
  }
  return false;
}
