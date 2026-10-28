import type { Vec3 } from '../render/math';

/**
 * Reference images: a picture behind the model, fitted
 * to the viewport, or a picture standing in the scene on a plane facing one of the axes, to
 * model against a drawing. They belong to the open document's tab and are not written into
 * .vox (the format has no place for pictures); the editor's own format will keep them.
 */

export type ReferenceMode = 'background' | 'plane';
/** Which way a plane faces: front (normal Z), side (X) or top (Y). */
export type ReferenceFacing = 'front' | 'side' | 'top';

export interface Reference {
  readonly id: number;
  name: string;
  /** The picture, decoded once. */
  readonly image: ImageBitmap;
  /** An object URL of the file, for the thumbnail in the panel. */
  readonly thumb: string;
  mode: ReferenceMode;
  /** 0…1. */
  opacity: number;
  visible: boolean;
  /** A locked reference keeps its place and settings until unlocked. */
  locked: boolean;
  facing: ReferenceFacing;
  /** Centre of the plane, world voxels. */
  center: Vec3;
  /** Width of the plane in voxels; the height follows the picture. */
  size: number;
}

export const FACING_TITLES: Record<ReferenceFacing, string> = {
  front: 'Front',
  side: 'Side',
  top: 'Top',
};

/**
 * Corners of a plane reference in the order top-left, top-right, bottom-right, bottom-left of
 * the picture, as seen by the matching view (front, right, top).
 */
export function referenceCorners(ref: Reference): [Vec3, Vec3, Vec3, Vec3] {
  const w = ref.size / 2;
  const h = (ref.size * (ref.image.height / Math.max(1, ref.image.width))) / 2;
  const [cx, cy, cz] = ref.center;
  // Right and up directions of the picture for each facing.
  const [right, up]: [Vec3, Vec3] =
    ref.facing === 'front'
      ? [
          [1, 0, 0],
          [0, 1, 0],
        ]
      : ref.facing === 'side'
        ? [
            [0, 0, -1],
            [0, 1, 0],
          ]
        : [
            [1, 0, 0],
            [0, 0, -1],
          ];
  const at = (sx: number, sy: number): Vec3 => [
    cx + right[0] * sx * w + up[0] * sy * h,
    cy + right[1] * sx * w + up[1] * sy * h,
    cz + right[2] * sx * w + up[2] * sy * h,
  ];
  return [at(-1, 1), at(1, 1), at(1, -1), at(-1, -1)];
}

/** Pictures larger than this on a side are scaled down: a texture that size is plenty. */
export const MAX_REFERENCE_SIDE = 4096;

/** Decodes a picture file for a reference; throws for anything that is not a picture. */
export async function decodeReference(file: Blob): Promise<ImageBitmap> {
  const probe = await createImageBitmap(file);
  const scale = Math.min(1, MAX_REFERENCE_SIDE / Math.max(probe.width, probe.height));
  if (scale === 1) return probe;
  probe.close();
  return createImageBitmap(file, {
    resizeWidth: Math.round(probe.width * scale),
    resizeHeight: Math.round(probe.height * scale),
    resizeQuality: 'high',
  });
}
