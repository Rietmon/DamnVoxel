import { describe, expect, it } from 'vitest';
import {
  MAX_QUADS,
  MESH_CHUNK,
  meshChunk,
  meshScratch,
  PADDED,
  PADDED_VOLUME,
  paddedIndex,
  QUAD_WORDS,
  VERTEX_AO_SHIFT,
  VERTEX_FACE_SHIFT,
} from './mesher';

interface Vertex {
  x: number;
  y: number;
  z: number;
  face: number;
  ao: number;
  color: number;
}

interface Quad {
  v: Vertex[];
  face: number;
  color: number;
  area: number;
}

const NORMALS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

function decode(out: Uint32Array, quads: number): Quad[] {
  const result: Quad[] = [];
  for (let q = 0; q < quads; q++) {
    const v: Vertex[] = [];
    for (let k = 0; k < 4; k++) {
      const w0 = out[q * QUAD_WORDS + k * 2]!;
      const w1 = out[q * QUAD_WORDS + k * 2 + 1]!;
      v.push({
        x: w0 & 63,
        y: (w0 >> 6) & 63,
        z: (w0 >> 12) & 63,
        face: (w0 >> VERTEX_FACE_SHIFT) & 7,
        ao: (w0 >> VERTEX_AO_SHIFT) & 3,
        color: w1 & 0xffff,
      });
    }
    const [a, b, c] = v as [Vertex, Vertex, Vertex];
    const e1 = [b.x - a.x, b.y - a.y, b.z - a.z];
    const e2 = [c.x - a.x, c.y - a.y, c.z - a.z];
    const n = [
      e1[1]! * e2[2]! - e1[2]! * e2[1]!,
      e1[2]! * e2[0]! - e1[0]! * e2[2]!,
      e1[0]! * e2[1]! - e1[1]! * e2[0]!,
    ];
    const xs = v.map((p) => p.x);
    const ys = v.map((p) => p.y);
    const zs = v.map((p) => p.z);
    const span = (arr: number[]) => Math.max(...arr) - Math.min(...arr);
    const dims = [span(xs), span(ys), span(zs)].filter((d) => d > 0);
    const face = a.face;
    // Winding: the first triangle's normal points along the face normal.
    const normal = NORMALS[face]!;
    expect(n[0]! * normal[0]! + n[1]! * normal[1]! + n[2]! * normal[2]!).toBeGreaterThan(0);
    result.push({ v, face, color: a.color, area: dims[0]! * dims[1]! });
  }
  return result;
}

function padded(fill: (x: number, y: number, z: number) => number): Uint16Array {
  const p = new Uint16Array(PADDED_VOLUME);
  for (let z = -1; z <= MESH_CHUNK; z++)
    for (let y = -1; y <= MESH_CHUNK; y++)
      for (let x = -1; x <= MESH_CHUNK; x++) p[paddedIndex(x, y, z)] = fill(x, y, z);
  return p;
}

function mesh(p: Uint16Array): Quad[] {
  const out = meshScratch();
  return decode(out, meshChunk(p, out));
}

/** Exposed faces counted voxel by voxel, per face direction. */
function bruteForceFaces(p: Uint16Array): number[] {
  const counts = [0, 0, 0, 0, 0, 0];
  for (let z = 0; z < MESH_CHUNK; z++)
    for (let y = 0; y < MESH_CHUNK; y++)
      for (let x = 0; x < MESH_CHUNK; x++) {
        if (!p[paddedIndex(x, y, z)]) continue;
        NORMALS.forEach(([nx, ny, nz], f) => {
          if (!p[paddedIndex(x + nx!, y + ny!, z + nz!)]) counts[f]!++;
        });
      }
  return counts;
}

function areaByFace(quads: Quad[]): number[] {
  const counts = [0, 0, 0, 0, 0, 0];
  for (const q of quads) counts[q.face]! += q.area;
  return counts;
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('meshChunk', () => {
  it('meshes a single voxel into six fully lit unit quads', () => {
    const quads = mesh(padded((x, y, z) => (x === 5 && y === 6 && z === 7 ? 9 : 0)));
    expect(quads).toHaveLength(6);
    expect(new Set(quads.map((q) => q.face)).size).toBe(6);
    for (const q of quads) {
      expect(q.area).toBe(1);
      expect(q.color).toBe(9);
      expect(q.v.every((v) => v.ao === 3)).toBe(true);
    }
    const top = quads.find((q) => q.face === 2)!;
    expect(new Set(top.v.map((v) => v.y))).toEqual(new Set([7]));
    expect(new Set(top.v.map((v) => v.x))).toEqual(new Set([5, 6]));
  });

  it('merges a full chunk into six 32×32 quads and hides it inside full neighbours', () => {
    const open = mesh(
      padded((x, y, z) => (Math.max(x, y, z) < 32 && Math.min(x, y, z) >= 0 ? 1 : 0)),
    );
    expect(open).toHaveLength(6);
    expect(open.every((q) => q.area === 1024)).toBe(true);
    expect(mesh(padded(() => 1))).toHaveLength(0);
  });

  it('culls border faces against the neighbour shell', () => {
    // A voxel on the +X border with a solid neighbour cell across it has no +X face.
    const p = padded((x, y, z) => ((x === 31 || x === 32) && y === 0 && z === 0 ? 1 : 0));
    const faces = mesh(p).map((q) => q.face);
    expect(faces).not.toContain(0);
    expect(faces).toHaveLength(5);
  });

  it('keeps colours apart and merges same-colour runs', () => {
    const row = mesh(padded((x, y, z) => (y === 0 && z === 0 && x >= 0 && x < 4 ? 1 : 0)));
    expect(row).toHaveLength(6);
    const twoColours = mesh(
      padded((x, y, z) => (y === 0 && z === 0 && x >= 0 && x < 4 ? (x < 2 ? 1 : 2) : 0)),
    );
    expect(twoColours).toHaveLength(10);
  });

  it('darkens corners next to occluders', () => {
    // Floor voxel with a wall voxel above its −X neighbour: the floor's top face is shaded
    // along the wall side.
    const p = padded((x, y, z) =>
      (y === 0 && x >= 0 && x <= 1 && z === 0) || (x === 0 && y === 1 && z === 0) ? 1 : 0,
    );
    const top = mesh(p).find((q) => q.face === 2 && q.v.every((v) => v.x >= 1))!;
    const byX = (x: number) => top.v.filter((v) => v.x === x).map((v) => v.ao);
    expect(byX(1)).toEqual([2, 2]);
    expect(byX(2)).toEqual([3, 3]);
  });

  it('covers exactly the exposed faces for random volumes', () => {
    const random = rng(3);
    for (const density of [0.05, 0.3, 0.7, 0.97]) {
      const p = padded(() => (random() < density ? 1 + Math.floor(random() * 3) : 0));
      expect(areaByFace(mesh(p))).toEqual(bruteForceFaces(p));
    }
  });

  it('handles the worst case checkerboard', () => {
    const p = padded((x, y, z) =>
      (x + y + z) & 1 && Math.min(x, y, z) >= 0 && Math.max(x, y, z) < 32 ? 1 : 0,
    );
    const out = meshScratch();
    expect(meshChunk(p, out)).toBe(MAX_QUADS);
    expect(PADDED).toBe(34);
  });
});
