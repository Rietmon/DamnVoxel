import {
  CHUNK_SIZE,
  CHUNK_VOLUME,
  FACE_NORMALS,
  indexX,
  indexY,
  indexZ,
  keyX,
  keyY,
  keyZ,
} from './coords';
import type { VoxelDocument } from './document';
import { type Command, CompositeCommand } from './history';
import { type VoxelObject, worldTransform } from './scene';
import { InsertNodeCommand, removeNodeCommand } from './scene-edit';
import { cellToLocal, cellToWorld } from './transform';
import { VoxelVolume } from './volume';
import { VoxelTransaction } from './voxel-edit';

/**
 * Booleans between objects and splitting one apart. Objects are
 * placed by whole-voxel transforms with axis-aligned turns, so a voxel of one object lands on
 * exactly one cell of another: the operations are exact, with no resampling.
 */

export type BooleanOp = 'union' | 'subtract' | 'intersect';

export const BOOLEAN_TITLES: Record<BooleanOp, string> = {
  union: 'Merge',
  subtract: 'Subtract',
  intersect: 'Intersect',
};

const dense = new Uint16Array(CHUNK_VOLUME);

/** Every voxel of a volume: x, y, z and colour. */
function forEachVoxel(v: VoxelVolume, visit: (x: number, y: number, z: number, c: number) => void) {
  for (const [key, chunk] of v.chunks()) {
    chunk.decodeInto(dense);
    const ox = keyX(key) * CHUNK_SIZE;
    const oy = keyY(key) * CHUNK_SIZE;
    const oz = keyZ(key) * CHUNK_SIZE;
    for (let i = 0; i < CHUNK_VOLUME; i++) {
      const c = dense[i]!;
      if (c) visit(ox + indexX(i), oy + indexY(i), oz + indexZ(i), c);
    }
  }
}

/** The voxels of `tool` in the cells of `target`. */
function inTarget(target: VoxelObject, tool: VoxelObject): VoxelVolume {
  const out = new VoxelVolume();
  const from = worldTransform(tool);
  const to = worldTransform(target);
  forEachVoxel(tool.volume, (x, y, z, c) => {
    const w = cellToWorld(from, x, y, z);
    const [lx, ly, lz] = cellToLocal(to, w[0], w[1], w[2]);
    out.set(lx, ly, lz, c);
  });
  return out;
}

/**
 * Combines tools into a target, as one step: union adds their voxels (and removes the tools,
 * merging them into it), subtract carves them out, intersect keeps only what they cover.
 */
export function booleanObjects(
  doc: VoxelDocument,
  target: VoxelObject,
  tools: readonly VoxelObject[],
  op: BooleanOp,
): Command | null {
  const shape = new VoxelVolume();
  for (const t of tools) forEachVoxel(inTarget(target, t), (x, y, z, c) => shape.set(x, y, z, c));
  const tx = new VoxelTransaction();
  if (op === 'union') {
    forEachVoxel(shape, (x, y, z, c) => {
      if (!target.volume.get(x, y, z)) tx.set(target, x, y, z, c);
    });
  } else if (op === 'subtract') {
    forEachVoxel(shape, (x, y, z) => {
      if (target.volume.get(x, y, z)) tx.set(target, x, y, z, 0);
    });
  } else {
    forEachVoxel(target.volume, (x, y, z) => {
      if (!shape.get(x, y, z)) tx.set(target, x, y, z, 0);
    });
  }
  const parts: Command[] = [];
  const voxels = tx.commit(BOOLEAN_TITLES[op]);
  if (voxels) parts.push(voxels);
  if (op === 'union') {
    for (const t of tools) {
      if (!t.parent || t.volume === target.volume) continue;
      const remove = removeNodeCommand(t, BOOLEAN_TITLES[op]);
      remove.apply(doc);
      parts.push(remove);
    }
  }
  return parts.length > 0 ? new CompositeCommand(BOOLEAN_TITLES[op], parts) : null;
}

/**
 * The parts of a volume: voxels joined across faces (or, by colour, only to their own colour)
 * form one part. Largest first.
 */
export function splitParts(v: VoxelVolume, byColor: boolean): VoxelVolume[] {
  const seen = new VoxelVolume();
  const parts: VoxelVolume[] = [];
  forEachVoxel(v, (sx, sy, sz, sc) => {
    if (seen.get(sx, sy, sz)) return;
    const part = new VoxelVolume();
    const stack = [sx, sy, sz];
    seen.set(sx, sy, sz, 1);
    while (stack.length > 0) {
      const z = stack.pop()!;
      const y = stack.pop()!;
      const x = stack.pop()!;
      const c = v.get(x, y, z);
      part.set(x, y, z, c);
      for (const [nx, ny, nz] of FACE_NORMALS) {
        const px = x + nx;
        const py = y + ny;
        const pz = z + nz;
        const pc = v.get(px, py, pz);
        if (!pc || seen.get(px, py, pz) || (byColor && pc !== sc)) continue;
        seen.set(px, py, pz, 1);
        stack.push(px, py, pz);
      }
    }
    part.takeMeshDirty();
    parts.push(part);
  });
  return parts.sort((a, b) => b.voxelCount - a.voxelCount);
}

/**
 * Splits an object into its parts: the largest stays, each other becomes an object of its own
 * in the same place, right after it. One step; the new objects are returned.
 */
export function splitObject(
  doc: VoxelDocument,
  object: VoxelObject,
  byColor: boolean,
): VoxelObject[] {
  const parts = splitParts(object.volume, byColor);
  if (parts.length < 2) return [];
  const tx = new VoxelTransaction();
  const made: VoxelObject[] = [];
  const commands: Command[] = [];
  const parent = object.parent ?? doc.scene.root;
  parts.slice(1).forEach((part, i) => {
    forEachVoxel(part, (x, y, z) => {
      tx.set(object, x, y, z, 0);
    });
    const o = doc.scene.createObject(`${object.name} · ${i + 2}`, part);
    o.transform = object.transform;
    o.layer = object.layer;
    made.push(o);
  });
  const erase = tx.commit('Split');
  if (erase) commands.push(erase);
  let index = parent.children.indexOf(object) + 1;
  for (const o of made) {
    const insert = new InsertNodeCommand('Split', o, parent, index++);
    insert.apply(doc);
    commands.push(insert);
  }
  doc.history.push(new CompositeCommand('Split', commands));
  return made;
}
