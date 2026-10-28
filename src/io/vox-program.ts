import { type ObjectProgram, type VoxelObject, worldTransform } from '../core/scene';
import { cellToLocal, cellToWorld } from '../core/transform';

/**
 * Programs in .vox (docs/formats.md, “Programs”): a program object's program, parameters and
 * node graph as JSON in its transform node's dictionary, with the world cell of the program's
 * origin. A file moves an object's cells (MagicaVoxel centres models); the origin puts a rebuild
 * back where the voxels were. MagicaVoxel shows the voxels and keeps the key it does not know.
 */

export const PROGRAM_KEY = '_vx_program';

/** The program of an object in the scene, as JSON. */
export function writeProgram(object: VoxelObject, p: ObjectProgram): string {
  const at = cellToWorld(worldTransform(object), ...(p.offset ?? [0, 0, 0]));
  return JSON.stringify({ v: 1, source: p.source, params: p.params, graph: p.graph, at });
}

/** A program read back with the world cell of its origin, or null when it is not one of ours. */
export function readProgram(
  text: string | undefined,
): { program: ObjectProgram; at: [number, number, number] | null } | null {
  if (!text) return null;
  try {
    const o = JSON.parse(text) as {
      source?: unknown;
      params?: unknown;
      graph?: unknown;
      at?: unknown;
    };
    if (typeof o.source !== 'string') return null;
    const params: Record<string, number> = {};
    if (o.params && typeof o.params === 'object')
      for (const [k, v] of Object.entries(o.params))
        if (typeof v === 'number' && Number.isFinite(v)) params[k] = v;
    const graph =
      o.graph &&
      typeof o.graph === 'object' &&
      Array.isArray((o.graph as { nodes?: unknown }).nodes)
        ? o.graph
        : null;
    const at =
      Array.isArray(o.at) && o.at.length === 3 && o.at.every(Number.isInteger)
        ? (o.at as [number, number, number])
        : null;
    return { program: { source: o.source, params, graph }, at };
  } catch {
    return null;
  }
}

/** Once the object is in its place in the scene: where the program's origin is among its cells. */
export function placeProgram(object: VoxelObject, at: readonly [number, number, number]): void {
  if (!object.program) return;
  const offset = cellToLocal(worldTransform(object), at[0], at[1], at[2]);
  if (offset.some((v) => v !== 0)) object.program.offset = offset;
}
