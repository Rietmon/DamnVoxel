import { nearestPaletteId } from '../core/clipboard';
import { packRgba } from '../core/color';
import type { Picture } from '../core/image-voxels';
import type { Palette } from '../core/palette';
import { VoxelVolume } from '../core/volume';
import { type VoxelCells, voxelize } from '../core/voxelize';
import { medianCut } from '../formats/gif';
import type { ImportedMesh } from '../formats/mesh-import';
import type { MeshImportSettings } from './mesh-import-settings';

export {
  DEFAULT_MESH_IMPORT,
  MAX_VOXELIZE_SIZE,
  type MeshImportSettings,
  vetMeshImport,
} from './mesh-import-settings';

/**
 * Voxelizing a mesh file (docs/formats.md, “Voxelization”): the settings, the colour of a point
 * on a triangle (material × vertex colour × texture), and the cells turned into palette ids —
 * the nearest colours of the document's palette, or a palette made from the model's own colours.
 */

/** Turns a Z-up mesh to Y up in place: (x, y, z) → (x, z, −y). */
export function zUpToYUp(positions: Float32Array): void {
  for (let i = 0; i < positions.length; i += 3) {
    const y = positions[i + 1]!;
    positions[i + 1] = positions[i + 2]!;
    positions[i + 2] = -y;
  }
}

/**
 * The colour of a point on a triangle: material colour × interpolated vertex colour × the
 * texture at the interpolated coordinates (nearest pixel, repeating). Holes (cut-out pixels)
 * give 0; meshes without any colour take `fallback`.
 */
export function meshColorAt(
  mesh: ImportedMesh,
  pictures: readonly (Picture | null)[],
  fallback: readonly [number, number, number],
): (t: number, w0: number, w1: number, w2: number) => number {
  return (t, w0, w1, w2) => {
    const m = mesh.materials[t]!;
    const material = m >= 0 ? mesh.materialList[m] : undefined;
    const plain = !material && !mesh.colors;
    const c = plain
      ? [fallback[0] / 255, fallback[1] / 255, fallback[2] / 255, 1]
      : [...(material?.color ?? [1, 1, 1, 1])];
    if (mesh.colors) {
      const o = t * 12;
      for (let k = 0; k < 4; k++)
        c[k]! *=
          w0 * mesh.colors[o + k]! + w1 * mesh.colors[o + 4 + k]! + w2 * mesh.colors[o + 8 + k]!;
    }
    const pic = material?.image != null ? pictures[material.image] : null;
    if (pic && mesh.uvs) {
      const o = t * 6;
      const u = w0 * mesh.uvs[o]! + w1 * mesh.uvs[o + 2]! + w2 * mesh.uvs[o + 4]!;
      const v = w0 * mesh.uvs[o + 1]! + w1 * mesh.uvs[o + 3]! + w2 * mesh.uvs[o + 5]!;
      const x = Math.min(pic.width - 1, Math.floor((u - Math.floor(u)) * pic.width));
      const y = Math.min(pic.height - 1, Math.floor((v - Math.floor(v)) * pic.height));
      const p = (y * pic.width + x) * 4;
      for (let k = 0; k < 4; k++) c[k]! *= pic.data[p + k]! / 255;
    }
    if (material?.cutout && c[3]! < 0.5) return 0;
    const byte = (x: number) => Math.max(0, Math.min(255, Math.round(x * 255)));
    return packRgba(byte(c[0]!), byte(c[1]!), byte(c[2]!), 255);
  };
}

/** The mesh as voxel cells, scaled to `size` along its longest side. */
export function voxelizeMesh(
  mesh: ImportedMesh,
  pictures: readonly (Picture | null)[],
  s: MeshImportSettings,
  fallback: readonly [number, number, number],
): VoxelCells {
  const positions = mesh.positions.slice();
  if ((s.up === 'auto' ? mesh.up : s.up) === 'z') zUpToYUp(positions);
  return voxelize(
    positions,
    mesh.count,
    { size: s.size, solid: s.solid },
    meshColorAt(mesh, pictures, fallback),
  );
}

/** Up to 255 colours that stand for the cells (median cut), packed RGBA. */
export function cellPalette(cells: VoxelCells): number[] {
  const pixels = new Uint8Array(cells.cells.size * 4);
  let p = 0;
  for (const c of cells.cells.values()) {
    pixels[p++] = c & 255;
    pixels[p++] = (c >>> 8) & 255;
    pixels[p++] = (c >>> 16) & 255;
    pixels[p++] = 255;
  }
  return medianCut([{ pixels }], 255).map(([r, g, b]) => packRgba(r!, g!, b!));
}

/** The cells as a volume, each colour as the nearest palette id. */
export function cellsToVolume(cells: VoxelCells, palette: Palette): VoxelVolume {
  const [sx, sy] = cells.size;
  const ids = new Map<number, number>();
  const v = new VoxelVolume();
  for (const [index, c] of cells.cells) {
    let id = ids.get(c);
    if (id === undefined) {
      id = nearestPaletteId(palette, c);
      ids.set(c, id);
    }
    v.set(index % sx, Math.floor(index / sx) % sy, Math.floor(index / (sx * sy)), id);
  }
  v.takeMeshDirty();
  return v;
}
