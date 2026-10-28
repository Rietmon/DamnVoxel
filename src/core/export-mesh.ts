import { MESH_CHUNK, paddedIndex } from '../kernels/mesher';
import { keyX, keyY, keyZ } from './coords';
import { buildPadded, createPaddedBuffer } from './padded';
import type { VoxelVolume } from './volume';

/**
 * Meshes for export (docs/formats.md, “Mesh export”): only the faces that show, merged
 * greedily into the largest rectangles of one colour within each 32³ chunk. No ambient
 * occlusion: it would stop the merging, and lighting is the business of whatever imports it.
 */

export interface QuadMesh {
  /** Corners, 4 per quad, counter-clockwise seen from outside: x, y, z each, object-local. */
  positions: Float32Array;
  /** Face per quad: 0…5 = +x, −x, +y, −y, +z, −z. */
  faces: Uint8Array;
  /** Palette id per quad. */
  colors: Uint8Array;
  count: number;
}

const N = MESH_CHUNK;

/** The quads of a volume's visible faces, one colour per quad. */
export function meshForExport(volume: VoxelVolume): QuadMesh {
  let positions = new Float32Array(1024 * 12);
  let faces = new Uint8Array(1024);
  let colors = new Uint8Array(1024);
  let count = 0;
  const push = (corners: number[], face: number, color: number) => {
    if (count === faces.length) {
      const p = new Float32Array(positions.length * 2);
      p.set(positions);
      positions = p;
      const f = new Uint8Array(faces.length * 2);
      f.set(faces);
      faces = f;
      const c = new Uint8Array(colors.length * 2);
      c.set(colors);
      colors = c;
    }
    positions.set(corners, count * 12);
    faces[count] = face;
    colors[count] = color;
    count++;
  };

  const padded = createPaddedBuffer();
  const mask = new Uint16Array(N * N);
  const cell = [0, 0, 0];
  for (const key of volume.chunkKeys()) {
    const cx = keyX(key);
    const cy = keyY(key);
    const cz = keyZ(key);
    if (!buildPadded(volume, cx, cy, cz, padded)) continue;
    const origin = [cx * N, cy * N, cz * N];
    for (let face = 0; face < 6; face++) {
      const a = face >> 1;
      const positive = (face & 1) === 0;
      const u = (a + 1) % 3;
      const v = (a + 2) % 3;
      for (let d = 0; d < N; d++) {
        // The faces of this slice that show: a voxel with nothing beyond it.
        let any = false;
        for (let j = 0; j < N; j++)
          for (let i = 0; i < N; i++) {
            cell[a] = d;
            cell[u] = i;
            cell[v] = j;
            const id = padded[paddedIndex(cell[0]!, cell[1]!, cell[2]!)]!;
            cell[a] = positive ? d + 1 : d - 1;
            const beyond = padded[paddedIndex(cell[0]!, cell[1]!, cell[2]!)]!;
            const m = id !== 0 && beyond === 0 ? id : 0;
            mask[i + j * N] = m;
            if (m) any = true;
          }
        if (!any) continue;
        const plane = d + (positive ? 1 : 0);
        for (let j = 0; j < N; j++)
          for (let i = 0; i < N; ) {
            const m = mask[i + j * N]!;
            if (!m) {
              i++;
              continue;
            }
            let w = 1;
            while (i + w < N && mask[i + w + j * N] === m) w++;
            let h = 1;
            grow: while (j + h < N) {
              for (let k = 0; k < w; k++) if (mask[i + k + (j + h) * N] !== m) break grow;
              h++;
            }
            for (let y = 0; y < h; y++) mask.fill(0, i + (j + y) * N, i + w + (j + y) * N);
            // Corners in (u, v), counter-clockwise from outside: e_u × e_v = e_a.
            const uv = positive
              ? [i, j, i + w, j, i + w, j + h, i, j + h]
              : [i, j, i, j + h, i + w, j + h, i + w, j];
            const corners: number[] = [];
            for (let c = 0; c < 4; c++) {
              const p = [0, 0, 0];
              p[a] = origin[a]! + plane;
              p[u] = origin[u]! + uv[c * 2]!;
              p[v] = origin[v]! + uv[c * 2 + 1]!;
              corners.push(p[0]!, p[1]!, p[2]!);
            }
            push(corners, face, m);
            i += w;
          }
      }
    }
  }
  return {
    positions: positions.subarray(0, count * 12),
    faces: faces.subarray(0, count),
    colors: colors.subarray(0, count),
    count,
  };
}
