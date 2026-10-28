import {
  applyOrientation,
  composeOrientation,
  findOrientation,
  fromRotationByte,
  invertOrientation,
  orientCell,
  toRotationByte,
} from '../core/orientation';
import type { Transform } from '../core/scene';
import type { VoxDict } from '../formats/vox-chunks';

/**
 * The one place where .vox axes meet the editor's. MagicaVoxel is Z-up, the editor Y-up, both
 * right-handed: (x, y, z) in a file is (x, z, −y) here. It is a rotation, so handedness and
 * winding survive and every conversion below is exact on the grid.
 */
export const VOX_TO_EDITOR = findOrientation([1, 0, 0, 0, 0, 1, 0, -1, 0])!;
export const EDITOR_TO_VOX = invertOrientation(VOX_TO_EDITOR);

export type Vec3i = [number, number, number];

/** A voxel cell of a file model as an editor cell. */
export function cellFromVox(x: number, y: number, z: number): Vec3i {
  return orientCell(VOX_TO_EDITOR, x, y, z);
}

/** An editor cell in file axes. */
export function cellToVox(x: number, y: number, z: number): Vec3i {
  return orientCell(EDITOR_TO_VOX, x, y, z);
}

/** A file orientation (in file axes) as an editor orientation: C · R · C⁻¹. */
export function orientationFromVox(fileOrientation: number): number {
  return composeOrientation(VOX_TO_EDITOR, composeOrientation(fileOrientation, EDITOR_TO_VOX));
}

export function orientationToVox(orientation: number): number {
  return composeOrientation(EDITOR_TO_VOX, composeOrientation(orientation, VOX_TO_EDITOR));
}

/** A vector (translation, pivot) in file axes as an editor vector. */
export function vectorFromVox(v: readonly number[]): Vec3i {
  return applyOrientation(VOX_TO_EDITOR, v[0]!, v[1]!, v[2]!);
}

export function vectorToVox(v: readonly number[]): Vec3i {
  return applyOrientation(EDITOR_TO_VOX, v[0]!, v[1]!, v[2]!);
}

/** The pivot of a file model: MagicaVoxel centres models at floor(size / 2). */
export function modelPivot(size: readonly number[]): Vec3i {
  return [Math.floor(size[0]! / 2), Math.floor(size[1]! / 2), Math.floor(size[2]! / 2)];
}

/** `_r`: the rotation byte as a decimal string, as MagicaVoxel writes it. */
export function parseRotation(text: string | undefined): number {
  if (text === undefined) return 0;
  const byte = Number.parseInt(text, 10);
  if (!Number.isInteger(byte) || byte < 0 || byte > 255) return 0;
  return fromRotationByte(byte) ?? 0;
}

export function formatRotation(fileOrientation: number): string {
  return String(toRotationByte(fileOrientation));
}

/** `_t`: "x y z" as integers; anything unreadable is zero. */
export function parseTranslation(text: string | undefined): Vec3i {
  if (!text) return [0, 0, 0];
  const parts = text
    .trim()
    .split(/\s+/)
    .map((p) => Number.parseInt(p, 10));
  const at = (i: number) => (Number.isFinite(parts[i]) ? parts[i]! : 0);
  return [at(0), at(1), at(2)];
}

export function formatTranslation(t: readonly number[]): string {
  return `${t[0]} ${t[1]} ${t[2]}`;
}

/**
 * The editor transform of a file transform (rotation R, translation t, both in file axes).
 * For a shape the model geometry is first moved by −pivot, so the editor translation takes it
 * in: T = C(t − R·pivot), with the model's cells converted by {@link cellFromVox}.
 */
export function transformFromVox(rotation: number, t: readonly number[], pivot?: Vec3i): Transform {
  const r = pivot ? applyOrientation(rotation, pivot[0], pivot[1], pivot[2]) : [0, 0, 0];
  const [x, y, z] = vectorFromVox([t[0]! - r[0]!, t[1]! - r[1]!, t[2]! - r[2]!]);
  return { x, y, z, orientation: orientationFromVox(rotation) };
}

/**
 * The file rotation and translation of an editor transform. For a shape, `origin` is the file
 * cell where the model's voxel (0, 0, 0) sits in the object's own space (file axes): then
 * t = R·(origin + pivot) + C⁻¹·T.
 */
export function transformToVox(
  transform: Transform,
  shape?: { origin: Vec3i; pivot: Vec3i },
): { rotation: number; t: Vec3i } {
  const rotation = orientationToVox(transform.orientation);
  const back = vectorToVox([transform.x, transform.y, transform.z]);
  if (!shape) return { rotation, t: back };
  const o = shape.origin;
  const p = shape.pivot;
  const r = applyOrientation(rotation, o[0] + p[0], o[1] + p[1], o[2] + p[2]);
  return { rotation, t: [r[0] + back[0], r[1] + back[1], r[2] + back[2]] };
}

/** The editor transform of a frame's `_r` and `_t` (a group or the root: no pivot). */
export function frameTransform(frame: VoxDict): Transform {
  return transformFromVox(parseRotation(frame.get('_r')), parseTranslation(frame.get('_t')));
}
