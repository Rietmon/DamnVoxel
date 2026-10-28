import type { VoxelDocument } from '../core/document';
import type { SceneNode } from '../core/scene';
import type { VoxelVolume } from '../core/volume';
import type { VoxChunk, VoxDict } from '../formats/vox-chunks';
import type { Vec3i } from './vox-axes';

/**
 * What a .vox file held that the editor shows but does not edit, kept beside the document so
 * that open → save gives the same file content (docs/formats.md, "Guarantee"). Kept in weak maps:
 * the core model stays free of format details, and a node or volume that goes away takes its
 * extras along.
 */

export type TransformChunk = Extract<VoxChunk, { id: 'nTRN' }>;
export type GroupChunk = Extract<VoxChunk, { id: 'nGRP' }>;
export type ShapeChunk = Extract<VoxChunk, { id: 'nSHP' }>;

export interface VoxModel {
  size: Vec3i;
  /** x, y, z, colour index per voxel, as in XYZI. */
  voxels: Uint8Array;
}

export interface VoxDocumentExtras {
  /** RGBA entry 255: the colour of voxel index 0, which nothing uses. */
  index0Color: number;
  /** MATL chunks of ids other than 1…255 (0 and 256 both mean index 0). */
  otherMaterials: VoxChunk[];
  /** IMAP as read; written back while the panel order still matches it. */
  imap: Uint8Array | null;
  /** The root transform and group, for their attributes and frames. */
  rootTransform: TransformChunk | null;
  rootGroup: GroupChunk | null;
  /** Chunks written back as they are, in file order: LAYR, rOBJ, rCAM, NOTE, META, unknown. */
  kept: VoxChunk[];
}

export interface VoxNodeExtras {
  /** The transform node above this node as read: attributes, layer, every frame. */
  transform: TransformChunk;
  /** The frame whose rotation and translation the editor shows and edits. */
  frame: number;
  /** A name the editor made up because the file had none: not written unless changed. */
  madeUpName: string | null;
  group?: GroupChunk;
  shape?: ShapeChunk;
}

/** Where a volume came from: unchanged volumes of the same model are written as one model. */
export interface VoxModelSource {
  modelId: number;
  /** Volume revision right after reading; any edit changes it. */
  revision: number;
  /** The model box in file axes: SIZE, and the object-space file cell of voxel (0, 0, 0). */
  size: Vec3i;
  origin: Vec3i;
}

export const voxDocumentExtras = new WeakMap<VoxelDocument, VoxDocumentExtras>();
export const voxNodeExtras = new WeakMap<SceneNode, VoxNodeExtras>();
export const voxModelSources = new WeakMap<VoxelVolume, VoxModelSource>();

export function dictCopy(dict: VoxDict | undefined): VoxDict {
  return new Map(dict ?? []);
}
