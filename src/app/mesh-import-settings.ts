/** Settings of voxelizing a mesh (docs/formats.md, “Voxelization”): light, for the window. */

export interface MeshImportSettings {
  /** Voxels along the longest side. */
  size: number;
  solid: boolean;
  /** The file's up axis; auto: Z for STL, Y otherwise. */
  up: 'auto' | 'y' | 'z';
  /** A new document with a palette from the model, or into this scene with its colours. */
  target: 'new' | 'scene';
}

export const DEFAULT_MESH_IMPORT: MeshImportSettings = {
  size: 64,
  solid: true,
  up: 'auto',
  target: 'new',
};

export const MAX_VOXELIZE_SIZE = 512;

export function vetMeshImport(s: MeshImportSettings): MeshImportSettings {
  return {
    size: Number.isFinite(s.size)
      ? Math.max(4, Math.min(MAX_VOXELIZE_SIZE, Math.round(s.size)))
      : 64,
    solid: s.solid !== false,
    up: s.up === 'y' || s.up === 'z' ? s.up : 'auto',
    target: s.target === 'scene' ? 'scene' : 'new',
  };
}
