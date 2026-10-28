import { PADDED_VOLUME, paddedIndex } from '../kernels/mesher';
import { CHUNK_MASK, CHUNK_SIZE, CHUNK_VOLUME, chunkKey, voxelIndex } from './coords';
import { isClipped, type LocalClip } from './slice';
import type { VolumeReader } from './volume';

const dense = new Uint16Array(CHUNK_VOLUME);

export function createPaddedBuffer(): Uint16Array {
  return new Uint16Array(PADDED_VOLUME);
}

/**
 * Fills `out` with chunk (cx, cy, cz) and a one-voxel shell from its 26 neighbours — the input of
 * the mesher. Returns false (leaving `out` undefined) when the chunk does not exist. With a
 * clip (a slice of the view), hidden cells count as empty, so the faces along the cut are meshed
 * and the model reads as solid instead of showing holes.
 */
export function buildPadded(
  volume: VolumeReader,
  cx: number,
  cy: number,
  cz: number,
  out: Uint16Array,
  clip: LocalClip | null = null,
): boolean {
  const center = volume.getChunk(chunkKey(cx, cy, cz));
  if (!center) return false;
  out.fill(0);
  center.decodeInto(dense);
  for (let z = 0; z < CHUNK_SIZE; z++)
    for (let y = 0; y < CHUNK_SIZE; y++) {
      const row = voxelIndex(0, y, z);
      out.set(dense.subarray(row, row + CHUNK_SIZE), paddedIndex(0, y, z));
    }

  for (let dz = -1; dz <= 1; dz++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0 && dz === 0) continue;
        const chunk = volume.getChunk(chunkKey(cx + dx, cy + dy, cz + dz));
        if (!chunk) continue;
        // Along each axis: offset −1 takes the neighbour's last layer, +1 its first, 0 all.
        const x0 = dx === 0 ? 0 : dx < 0 ? CHUNK_MASK : 0;
        const x1 = dx === 0 ? CHUNK_MASK : x0;
        const y0 = dy === 0 ? 0 : dy < 0 ? CHUNK_MASK : 0;
        const y1 = dy === 0 ? CHUNK_MASK : y0;
        const z0 = dz === 0 ? 0 : dz < 0 ? CHUNK_MASK : 0;
        const z1 = dz === 0 ? CHUNK_MASK : z0;
        const uniform = chunk.uniform;
        for (let z = z0; z <= z1; z++)
          for (let y = y0; y <= y1; y++)
            for (let x = x0; x <= x1; x++) {
              out[paddedIndex(x + dx * CHUNK_SIZE, y + dy * CHUNK_SIZE, z + dz * CHUNK_SIZE)] =
                uniform >= 0 ? uniform : chunk.get(voxelIndex(x, y, z));
            }
      }
  if (clip) clipPadded(out, [cx * CHUNK_SIZE, cy * CHUNK_SIZE, cz * CHUNK_SIZE], clip);
  return true;
}

/** Empties the layers of a padded block that a clip hides. */
function clipPadded(out: Uint16Array, origin: readonly number[], clip: LocalClip): void {
  const a = clip.axis;
  const u = (a + 1) % 3;
  const v = (a + 2) % 3;
  const at = [0, 0, 0];
  for (let i = -1; i <= CHUNK_SIZE; i++) {
    at[a] = origin[a]! + i;
    if (!isClipped(clip, at[0]!, at[1]!, at[2]!)) continue;
    // One 34 × 34 layer across the other two axes, in padded coordinates.
    at[a] = i;
    for (let j = -1; j <= CHUNK_SIZE; j++) {
      at[u] = j;
      for (let k = -1; k <= CHUNK_SIZE; k++) {
        at[v] = k;
        out[paddedIndex(at[0]!, at[1]!, at[2]!)] = 0;
      }
    }
  }
}
