import { alpha, blue, green, red } from '../core/color';
import { FACE_NORMALS } from '../core/coords';
import type { VoxelDocument } from '../core/document';
import { meshForExport, type QuadMesh } from '../core/export-mesh';
import { pbrOf } from '../core/materials';
import { type VoxelObject, worldTransform } from '../core/scene';
import { dirToWorld, localToWorld } from '../core/transform';
import type { VoxelVolume } from '../core/volume';
import {
  type ExportColors,
  type MeshPart,
  writeGltf,
  writeObj,
  writePly,
  writeStl,
} from '../formats/mesh-formats';
import {
  type ExportAxes,
  type ExportFile,
  type ExportSettings,
  fileBase,
  formatColors,
} from './export-settings';

export {
  DEFAULT_EXPORT,
  type ExportSettings,
  fileBase,
  formatColors,
  MESH_FORMATS,
  vetExport,
} from './export-settings';

/**
 * Mesh export (docs/formats.md, “Mesh export”): the chosen objects as they stand in the
 * world, into one file or a file each, moved to a pivot, scaled, turned to the file's axes, and
 * named by a template.
 */

/** The palette as the writers want it. */
export function exportColors(doc: VoxelDocument): ExportColors {
  const p = doc.palette;
  return {
    rgba: (id) => {
      const c = p.color(id);
      return [red(c), green(c), blue(c), alpha(c)];
    },
    pbr: (id) => pbrOf(p.entry(id)),
  };
}

/** An object's quads in the world: corners through its transform, normals turned with it. */
function worldPart(object: VoxelObject, mesh: QuadMesh): MeshPart {
  const t = worldTransform(object);
  const positions = new Float32Array(mesh.count * 12);
  const normals = new Float32Array(mesh.count * 3);
  for (let q = 0; q < mesh.count; q++) {
    for (let c = 0; c < 4; c++) {
      const o = (q * 4 + c) * 3;
      positions.set(
        localToWorld(t, mesh.positions[o]!, mesh.positions[o + 1]!, mesh.positions[o + 2]!),
        o,
      );
    }
    const n = FACE_NORMALS[mesh.faces[q]!]!;
    normals.set(dirToWorld(t, n[0], n[1], n[2]), q * 3);
  }
  return { name: object.name, positions, normals, colors: mesh.colors, count: mesh.count };
}

/** Moves parts so the pivot is at the origin, scales them and turns them to the file's axes. */
function place(parts: MeshPart[], s: ExportSettings, axes: ExportAxes): MeshPart[] {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of parts)
    for (let i = 0; i < p.positions.length; i++) {
      const a = i % 3;
      min[a] = Math.min(min[a]!, p.positions[i]!);
      max[a] = Math.max(max[a]!, p.positions[i]!);
    }
  const pivot =
    s.pivot === 'world' || min[0] === Infinity
      ? [0, 0, 0]
      : [
          (min[0]! + max[0]!) / 2,
          s.pivot === 'bottom' ? min[1]! : (min[1]! + max[1]!) / 2,
          (min[2]! + max[2]!) / 2,
        ];
  // Y up to Z up: a quarter turn about X, (x, y, z) → (x, −z, y).
  const turn = (x: number, y: number, z: number): [number, number, number] =>
    axes === 'z-up' ? [x, -z, y] : [x, y, z];
  return parts.map((p) => {
    const positions = new Float32Array(p.positions.length);
    const normals = new Float32Array(p.normals.length);
    for (let i = 0; i < p.positions.length; i += 3)
      positions.set(
        turn(
          (p.positions[i]! - pivot[0]!) * s.scale,
          (p.positions[i + 1]! - pivot[1]!) * s.scale,
          (p.positions[i + 2]! - pivot[2]!) * s.scale,
        ),
        i,
      );
    for (let i = 0; i < p.normals.length; i += 3)
      normals.set(turn(p.normals[i]!, p.normals[i + 1]!, p.normals[i + 2]!), i);
    return { ...p, positions, normals };
  });
}

/** The files of one mesh file's worth of parts. */
function filesFor(
  parts: MeshPart[],
  base: string,
  s: ExportSettings,
  colors: ExportColors,
): ExportFile[] {
  const encoder = new TextEncoder();
  const mode = formatColors(s.format) === 'choice' ? s.colors : 'vertex';
  switch (s.format) {
    case 'glb':
      return [{ name: `${base}.glb`, data: writeGltf(parts, colors, mode, true) }];
    case 'gltf':
      return [{ name: `${base}.gltf`, data: writeGltf(parts, colors, mode, false) }];
    case 'obj': {
      const o = writeObj(parts, colors, mode, base);
      const files: ExportFile[] = [{ name: `${base}.obj`, data: encoder.encode(o.obj) }];
      if (o.mtl) files.push({ name: `${base}.mtl`, data: encoder.encode(o.mtl) });
      if (o.png) files.push({ name: `${base}.png`, data: o.png });
      return files;
    }
    case 'ply':
      return [{ name: `${base}.ply`, data: writePly(parts, colors) }];
    case 'stl':
      return [{ name: `${base}.stl`, data: writeStl(parts) }];
  }
}

/**
 * The files of an export, and how many quads they hold. Objects that share their voxels (linked
 * copies) are meshed once.
 */
export function exportMeshes(
  doc: VoxelDocument,
  objects: readonly VoxelObject[],
  docName: string,
  s: ExportSettings,
): { files: ExportFile[]; quads: number } {
  const colors = exportColors(doc);
  const meshes = new Map<VoxelVolume, QuadMesh>();
  const parts = objects
    .map((o) => {
      let mesh = meshes.get(o.volume);
      if (!mesh) {
        mesh = meshForExport(o.volume);
        meshes.set(o.volume, mesh);
      }
      return worldPart(o, mesh);
    })
    .filter((p) => p.count > 0);
  // glTF is Y up by its specification.
  const axes = s.format === 'glb' || s.format === 'gltf' ? 'y-up' : s.axes;
  const quads = parts.reduce((n, p) => n + p.count, 0);
  if (!s.separate)
    return {
      files: filesFor(place(parts, s, axes), fileBase(s.names, docName, docName, 1), s, colors),
      quads,
    };
  // One file each: names must differ, so a template without a per-object token gets a number.
  const template = /\{object\}|\{n\}/.test(s.names) ? s.names : `${s.names}-{n}`;
  const files = parts.flatMap((p, i) =>
    filesFor(place([p], s, axes), fileBase(template, docName, p.name, i + 1), s, colors),
  );
  return { files, quads };
}
