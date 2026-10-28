/**
 * Voxel and chunk coordinates. Integer coordinates, Y up, right-handed.
 * Voxel (x, y, z) occupies the cube [x, x+1) × [y, y+1) × [z, z+1).
 * See docs/data-model.md, "Limits" and "Object volume".
 */

/** Chunk edge is 2^CHUNK_BITS voxels. */
export const CHUNK_BITS = 5;
export const CHUNK_SIZE = 1 << CHUNK_BITS;
export const CHUNK_MASK = CHUNK_SIZE - 1;
export const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE;

const KEY_OFFSET = 65536;
const KEY_SPAN = 131072;
const KEY_SPAN2 = KEY_SPAN * KEY_SPAN;

/** Chunk coordinates are limited so that a key packs into 51 bits (exact JS integers). */
export const CHUNK_COORD_MIN = -KEY_OFFSET;
export const CHUNK_COORD_MAX = KEY_OFFSET - 1;
export const VOXEL_COORD_MIN = CHUNK_COORD_MIN * CHUNK_SIZE;
export const VOXEL_COORD_MAX = (CHUNK_COORD_MAX + 1) * CHUNK_SIZE - 1;

/** Packs chunk coordinates into one number: 17 bits per axis. */
export function chunkKey(cx: number, cy: number, cz: number): number {
  return ((cx + KEY_OFFSET) * KEY_SPAN + (cy + KEY_OFFSET)) * KEY_SPAN + (cz + KEY_OFFSET);
}

export function keyX(key: number): number {
  return Math.floor(key / KEY_SPAN2) - KEY_OFFSET;
}

export function keyY(key: number): number {
  return (Math.floor(key / KEY_SPAN) % KEY_SPAN) - KEY_OFFSET;
}

export function keyZ(key: number): number {
  return (key % KEY_SPAN) - KEY_OFFSET;
}

/** Chunk coordinate of a voxel coordinate; arithmetic shift floors negatives correctly. */
export function toChunk(v: number): number {
  return v >> CHUNK_BITS;
}

/** Coordinate inside the chunk, 0…CHUNK_SIZE-1, also for negatives. */
export function toLocal(v: number): number {
  return v & CHUNK_MASK;
}

export function chunkKeyOfVoxel(x: number, y: number, z: number): number {
  return chunkKey(x >> CHUNK_BITS, y >> CHUNK_BITS, z >> CHUNK_BITS);
}

/** Index of a voxel inside a chunk; X changes fastest. */
export function voxelIndex(lx: number, ly: number, lz: number): number {
  return lx | (ly << CHUNK_BITS) | (lz << (2 * CHUNK_BITS));
}

export function indexX(i: number): number {
  return i & CHUNK_MASK;
}

export function indexY(i: number): number {
  return (i >> CHUNK_BITS) & CHUNK_MASK;
}

export function indexZ(i: number): number {
  return i >> (2 * CHUNK_BITS);
}

export function inVoxelRange(x: number, y: number, z: number): boolean {
  return (
    x >= VOXEL_COORD_MIN &&
    x <= VOXEL_COORD_MAX &&
    y >= VOXEL_COORD_MIN &&
    y <= VOXEL_COORD_MAX &&
    z >= VOXEL_COORD_MIN &&
    z <= VOXEL_COORD_MAX
  );
}

/**
 * Six face directions. Face f lies on axis f >> 1; even faces point to +, odd to −.
 * The order is shared by the mesher, the shaders, picking and tools.
 */
export const FACE_POS_X = 0;
export const FACE_NEG_X = 1;
export const FACE_POS_Y = 2;
export const FACE_NEG_Y = 3;
export const FACE_POS_Z = 4;
export const FACE_NEG_Z = 5;

export type Vec3i = [number, number, number];

export const FACE_NORMALS: readonly Readonly<Vec3i>[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

export function faceAxis(face: number): number {
  return face >> 1;
}

export function faceSign(face: number): 1 | -1 {
  return face & 1 ? -1 : 1;
}

/** Face index for a unit axis-aligned normal. */
export function faceOf(axis: number, sign: number): number {
  return axis * 2 + (sign < 0 ? 1 : 0);
}
