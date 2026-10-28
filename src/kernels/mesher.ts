/**
 * Chunk mesher: face culling, per-vertex ambient occlusion and greedy merging into quads.
 * A pure function over typed arrays — runs in workers and, for chunks under the brush, in the
 * main thread. See docs/rendering.md, "Meshing" and "Vertex — 8 bytes".
 *
 * Input is a padded chunk: (32 + 2)³ palette ids, the chunk plus a one-voxel shell taken from
 * all 26 neighbours. The shell decides which border faces are hidden and gives the occluders for
 * AO on chunk edges and corners.
 */

export const MESH_CHUNK = 32;
export const PADDED = MESH_CHUNK + 2;
export const PADDED_VOLUME = PADDED * PADDED * PADDED;

/** Index of padded cell (x, y, z), where each coordinate is −1…32. */
export function paddedIndex(x: number, y: number, z: number): number {
  return x + 1 + (y + 1) * PADDED + (z + 1) * PADDED * PADDED;
}

/** Words per quad: 4 vertices × 2 words. */
export const QUAD_WORDS = 8;
/** Worst case: a checkerboard exposes all six faces of half the voxels. */
export const MAX_QUADS = (MESH_CHUNK ** 3 / 2) * 6;

// Vertex word 0 layout.
export const VERTEX_FACE_SHIFT = 18;
export const VERTEX_AO_SHIFT = 21;
export const VERTEX_CORNER_SHIFT = 23;
export const VERTEX_FLIP_BIT = 1 << 25;

const STRIDES = [1, PADDED, PADDED * PADDED] as const;

/** Mask cell: palette id << 9 | no-merge flag << 8 | four 2-bit AO values. 0 = no face. */
const NO_MERGE = 1 << 8;
const mask = new Int32Array(MESH_CHUNK * MESH_CHUNK);

let scratch: Uint32Array | null = null;

/** A buffer large enough for any chunk mesh. Reused; copy out what you keep. */
export function meshScratch(): Uint32Array {
  scratch ??= new Uint32Array(MAX_QUADS * QUAD_WORDS);
  return scratch;
}

/**
 * Corner order of a quad in (u, v) for each face sign. Counter-clockwise seen from outside:
 * for axis a, u = a+1 and v = a+2 (mod 3), so e_u × e_v = e_a.
 */
const CORNERS_POS = [0, 0, 1, 0, 1, 1, 0, 1] as const;
const CORNERS_NEG = [0, 0, 0, 1, 1, 1, 1, 0] as const;

/**
 * Meshes a padded chunk into `out` (see {@link meshScratch}) and returns the number of quads.
 * Vertex positions are 0…32 inside the chunk.
 */
export function meshChunk(padded: Uint16Array, out: Uint32Array): number {
  let quads = 0;
  for (let face = 0; face < 6; face++) {
    const a = face >> 1;
    const positive = (face & 1) === 0;
    const ua = (a + 1) % 3;
    const va = (a + 2) % 3;
    const sa = STRIDES[a];
    const su = STRIDES[ua];
    const sv = STRIDES[va];
    const toNeighbour = positive ? sa : -sa;
    const corners = positive ? CORNERS_POS : CORNERS_NEG;

    for (let layer = 0; layer < MESH_CHUNK; layer++) {
      // Build the mask of visible faces in this layer.
      let any = false;
      const layerBase = (layer + 1) * sa + su + sv;
      for (let v = 0; v < MESH_CHUNK; v++) {
        let idx = layerBase + v * sv;
        const row = v * MESH_CHUNK;
        for (let u = 0; u < MESH_CHUNK; u++, idx += su) {
          const color = padded[idx]!;
          const n = idx + toNeighbour;
          if (color === 0 || padded[n] !== 0) {
            mask[row + u] = 0;
            continue;
          }
          const s0u = padded[n - su] !== 0 ? 1 : 0;
          const s1u = padded[n + su] !== 0 ? 1 : 0;
          const s0v = padded[n - sv] !== 0 ? 1 : 0;
          const s1v = padded[n + sv] !== 0 ? 1 : 0;
          const ao00 = s0u && s0v ? 0 : 3 - s0u - s0v - (padded[n - su - sv] !== 0 ? 1 : 0);
          const ao10 = s1u && s0v ? 0 : 3 - s1u - s0v - (padded[n + su - sv] !== 0 ? 1 : 0);
          const ao11 = s1u && s1v ? 0 : 3 - s1u - s1v - (padded[n + su + sv] !== 0 ? 1 : 0);
          const ao01 = s0u && s1v ? 0 : 3 - s0u - s1v - (padded[n - su + sv] !== 0 ? 1 : 0);
          const uniform = ao00 === ao10 && ao00 === ao11 && ao00 === ao01;
          mask[row + u] =
            (color << 9) |
            (uniform ? 0 : NO_MERGE) |
            ao00 |
            (ao10 << 2) |
            (ao11 << 4) |
            (ao01 << 6);
          any = true;
        }
      }
      if (!any) continue;

      const plane = positive ? layer + 1 : layer;
      // Greedy merge: only faces with the same colour and one AO value everywhere merge, so
      // interpolation over a merged quad looks exactly like the separate faces would.
      for (let v = 0; v < MESH_CHUNK; v++) {
        for (let u = 0; u < MESH_CHUNK; ) {
          const m = mask[v * MESH_CHUNK + u]!;
          if (m === 0) {
            u++;
            continue;
          }
          let w = 1;
          let h = 1;
          if ((m & NO_MERGE) === 0) {
            while (u + w < MESH_CHUNK && mask[v * MESH_CHUNK + u + w] === m) w++;
            grow: while (v + h < MESH_CHUNK) {
              const row = (v + h) * MESH_CHUNK + u;
              for (let k = 0; k < w; k++) if (mask[row + k] !== m) break grow;
              h++;
            }
            for (let dv = 0; dv < h; dv++)
              mask.fill(0, (v + dv) * MESH_CHUNK + u, (v + dv) * MESH_CHUNK + u + w);
          } else {
            mask[v * MESH_CHUNK + u] = 0;
          }
          quads = emitQuad(out, quads, m, a, face, plane, u, v, w, h, corners);
          u += w;
        }
      }
    }
  }
  return quads;
}

function emitQuad(
  out: Uint32Array,
  quad: number,
  m: number,
  a: number,
  face: number,
  plane: number,
  u: number,
  v: number,
  w: number,
  h: number,
  corners: readonly number[],
): number {
  const color = m >>> 9;
  const ao00 = m & 3;
  const ao10 = (m >> 2) & 3;
  const ao11 = (m >> 4) & 3;
  const ao01 = (m >> 6) & 3;
  // Split along the diagonal whose ends differ less; otherwise AO streaks across the quad.
  const flip = Math.abs(ao00 - ao11) > Math.abs(ao10 - ao01);
  let o = quad * QUAD_WORDS;
  for (let k = 0; k < 4; k++) {
    const c = flip ? (k + 1) & 3 : k;
    const cu = corners[c * 2]!;
    const cv = corners[c * 2 + 1]!;
    const pu = u + cu * w;
    const pv = v + cv * h;
    // Axis a carries the plane; u and v are the next two axes cyclically.
    const x = a === 0 ? plane : a === 1 ? pv : pu;
    const y = a === 0 ? pu : a === 1 ? plane : pv;
    const z = a === 0 ? pv : a === 1 ? pu : plane;
    const ao = cu ? (cv ? ao11 : ao10) : cv ? ao01 : ao00;
    out[o++] =
      (x |
        (y << 6) |
        (z << 12) |
        (face << VERTEX_FACE_SHIFT) |
        (ao << VERTEX_AO_SHIFT) |
        (cu << VERTEX_CORNER_SHIFT) |
        (cv << (VERTEX_CORNER_SHIFT + 1)) |
        (flip ? VERTEX_FLIP_BIT : 0)) >>>
      0;
    out[o++] = color;
  }
  return quad + 1;
}
