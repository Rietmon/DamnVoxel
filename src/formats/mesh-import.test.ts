import { describe, expect, it } from 'vitest';
import {
  type ExportColors,
  type MeshPart,
  type PbrTerms,
  writeGltf,
  writeStl,
} from './mesh-formats';
import { mainMeshFile, readMesh } from './mesh-import';

const text = (s: string) => new TextEncoder().encode(s);

const QUAD: MeshPart = {
  name: 'q',
  positions: new Float32Array([0, 0, 0, 2, 0, 0, 2, 0, 2, 0, 0, 2]),
  normals: new Float32Array([0, 1, 0]),
  colors: new Uint8Array([5]),
  count: 1,
};
const PBR: PbrTerms = {
  baseColor: [1, 1, 1, 1],
  metallic: 0,
  roughness: 1,
  emissive: [0, 0, 0],
  emissiveStrength: 0,
  transmission: 0,
  ior: 1.5,
};
const COLORS: ExportColors = { rgba: () => [255, 128, 0, 255], pbr: () => PBR };

describe('reading meshes', () => {
  it('picks the model among companion files', () => {
    const files = [
      { name: 'a.mtl', bytes: text('') },
      { name: 'a.obj', bytes: text('') },
    ];
    expect(mainMeshFile(files)?.name).toBe('a.obj');
  });

  it('reads OBJ polygons, negative indices and MTL colours', () => {
    const obj = [
      'mtllib m.mtl',
      'v 0 0 0',
      'v 1 0 0',
      'v 1 1 0',
      'v 0 1 0',
      'vt 0 0',
      'vt 1 1',
      'usemtl red',
      'f 1/1 2/1 3/2 4/2',
      'f -4 -2 -1',
    ].join('\n');
    const mtl = 'newmtl red\nKd 1 0 0\nmap_Kd tex.png\n';
    const mesh = readMesh([
      { name: 'x.obj', bytes: text(obj) },
      { name: 'M.MTL', bytes: text(mtl) },
      { name: 'textures/tex.png', bytes: new Uint8Array([1]) },
    ]);
    expect(mesh.count).toBe(3);
    expect(mesh.materialList[0]).toEqual({ color: [1, 0, 0, 1], image: 0, cutout: false });
    expect(mesh.images[0]!.mime).toBe('image/png');
    // v goes down the picture: OBJ's 1 is the top row.
    expect([...mesh.uvs!.subarray(0, 6)]).toEqual([0, 1, 0, 1, 1, 0]);
    expect([...mesh.positions.subarray(18, 27)]).toEqual([0, 0, 0, 1, 1, 0, 0, 1, 0]);
    expect(mesh.up).toBe('y');
  });

  it('reads binary and text STL, Z up', () => {
    const bin = readMesh([{ name: 'p.stl', bytes: writeStl([QUAD]) }]);
    expect(bin.count).toBe(2);
    expect(bin.up).toBe('z');
    const ascii = [
      'solid t',
      'facet normal 0 0 1',
      'outer loop',
      'vertex 0 0 0',
      'vertex 1 0 0',
      'vertex 0 1 0',
      'endloop',
      'endfacet',
      'endsolid t',
    ].join('\n');
    const t = readMesh([{ name: 't.STL', bytes: text(ascii) }]);
    expect([...t.positions]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  });

  it('reads back our glTF: positions, vertex colours, an embedded palette texture', () => {
    const glb = readMesh([{ name: 'a.glb', bytes: writeGltf([QUAD], COLORS, 'vertex', true) }]);
    expect(glb.count).toBe(2);
    expect([...glb.positions.subarray(0, 9)]).toEqual([0, 0, 0, 2, 0, 0, 2, 0, 2]);
    // Linear in the file, sRGB here again.
    expect(glb.colors![0]).toBeCloseTo(1, 3);
    expect(glb.colors![1]).toBeCloseTo(128 / 255, 2);
    const gltf = readMesh([{ name: 'a.gltf', bytes: writeGltf([QUAD], COLORS, 'texture', false) }]);
    const m = gltf.materialList[0]!;
    expect(m.image).toBe(0);
    expect(gltf.images[0]!.mime).toBe('image/png');
    expect(gltf.uvs![0]).toBeCloseTo((5 - 0.5) / 256);
  });

  it('asks for the files a .gltf refers to', () => {
    const json = JSON.stringify({
      asset: { version: '2.0' },
      buffers: [{ uri: 'data.bin', byteLength: 36 }],
    });
    expect(() => readMesh([{ name: 'a.gltf', bytes: text(json) }])).toThrow(/data\.bin/);
  });
});
