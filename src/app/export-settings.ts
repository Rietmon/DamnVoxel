import type { ColorMode } from '../formats/mesh-formats';

/**
 * Settings of the mesh export (docs/formats.md, “Mesh export”) and what the export window
 * needs to show them. Light on purpose: the window loads it, the writers load on export.
 */

export type MeshFormat = 'glb' | 'gltf' | 'obj' | 'ply' | 'stl';
/** Where the file's origin goes: the middle of the bounds, the middle of their bottom, or the world's. */
export type ExportPivot = 'center' | 'bottom' | 'world';
export type ExportAxes = 'y-up' | 'z-up';

export interface ExportSettings {
  format: MeshFormat;
  /** glTF and OBJ: colour by vertex or by the palette texture. */
  colors: ColorMode;
  /** Only the selected objects (or the active one), not every visible object. */
  selectedOnly: boolean;
  /** A file per object instead of one for all. */
  separate: boolean;
  pivot: ExportPivot;
  /** Units per voxel. */
  scale: number;
  /** Up axis of the file; glTF is always Y up. */
  axes: ExportAxes;
  /** File names: {doc}, {object}, {n}. */
  names: string;
}

export const DEFAULT_EXPORT: ExportSettings = {
  format: 'glb',
  colors: 'vertex',
  selectedOnly: false,
  separate: false,
  pivot: 'bottom',
  scale: 1,
  axes: 'y-up',
  names: '{doc}',
};

export const MESH_FORMATS: readonly MeshFormat[] = ['glb', 'gltf', 'obj', 'ply', 'stl'];

export function vetExport(s: ExportSettings): ExportSettings {
  const d = DEFAULT_EXPORT;
  return {
    format: MESH_FORMATS.includes(s.format) ? s.format : d.format,
    colors: s.colors === 'texture' ? 'texture' : 'vertex',
    selectedOnly: s.selectedOnly === true,
    separate: s.separate === true,
    pivot: (['center', 'bottom', 'world'] as const).includes(s.pivot) ? s.pivot : d.pivot,
    scale: Number.isFinite(s.scale) && s.scale > 0 ? s.scale : d.scale,
    axes: s.axes === 'z-up' ? 'z-up' : 'y-up',
    names: typeof s.names === 'string' && s.names.trim() ? s.names : d.names,
  };
}

/** Which formats carry colour, and how. */
export function formatColors(format: MeshFormat): 'choice' | 'vertex' | 'none' {
  if (format === 'stl') return 'none';
  return format === 'ply' ? 'vertex' : 'choice';
}

export interface ExportFile {
  name: string;
  data: Uint8Array;
}

/** A file name from the template: tokens filled, characters file systems refuse replaced. */
export function fileBase(template: string, doc: string, object: string, n: number): string {
  const name = template
    .replaceAll('{doc}', doc)
    .replaceAll('{object}', object)
    .replaceAll('{n}', String(n))
    .replace(/[\\/:*?"<>|]+/g, '_')
    .trim();
  return name || 'export';
}
