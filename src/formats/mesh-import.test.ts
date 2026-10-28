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

  it('refuses files it cannot read', () => {
    expect(() => readMesh([{ name: 'a.mtl', bytes: text('') }])).toThrow(/Needs a/);
    expect(() => readMesh([{ name: 'a.stl', bytes: text('hello') }])).toThrow(/not STL/);
    expect(() => readMesh([{ name: 'a.obj', bytes: text('# nothing\nv 0 0 0') }])).toThrow(
      /no triangles/,
    );
    const gltf = (json: object) =>
      readMesh([{ name: 'a.gltf', bytes: text(JSON.stringify(json)) }]);
    expect(() => gltf({ extensionsRequired: ['KHR_draco_mesh_compression'] })).toThrow(/Draco/);
    expect(() => gltf({ buffers: [{ byteLength: 4 }] })).toThrow(/binary buffer/);
    expect(() =>
      gltf({
        accessors: [{ componentType: 5126, count: 3, type: 'VEC3', sparse: {} }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
        nodes: [{ mesh: 0 }],
      }),
    ).toThrow(/Sparse/);
  });

  it('reads OBJ vertex colours, faces without texture, and unknown materials as white', () => {
    const obj = ['v 0 0 0 1 0 0', 'v 1 0 0 0 1 0', 'v 0 1 0 0 0 1', 'vn 0 0 1', 'f 1//1 2//1 3//1'];
    const mesh = readMesh([{ name: 'c.obj', bytes: text(obj.join('\r\n')) }]);
    expect(mesh.uvs).toBeNull();
    expect([...mesh.colors!.subarray(0, 8)]).toEqual([1, 0, 0, 1, 0, 1, 0, 1]);
    expect(mesh.materials[0]).toBe(-1);
    const plain = readMesh([
      {
        name: 'p.obj',
        bytes: text('mtllib gone.mtl\nusemtl x\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3'),
      },
    ]);
    expect(plain.materialList).toEqual([{ color: [1, 1, 1, 1], image: null, cutout: false }]);
  });

  it('reads glTF component types, strips and fans, node transforms and materials', () => {
    const bytes: number[] = [];
    const put = (array: ArrayBufferView) => {
      const at = bytes.length;
      bytes.push(...new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
      while (bytes.length % 4) bytes.push(0);
      return { buffer: 0, byteOffset: at, byteLength: array.byteLength };
    };
    const views = [
      // A unit square's corners; indices as bytes, shorts and ints.
      put(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0])),
      put(new Uint8Array([0, 1, 2, 3])),
      put(new Uint16Array([0, 1, 2, 3])),
      put(new Uint32Array([0, 1, 2])),
      // Colours as normalized bytes and shorts, uvs as normalized signed bytes and shorts.
      put(new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 128, 255, 255, 255, 255])),
      put(new Uint16Array([65535, 0, 0, 0, 65535, 0, 0, 0, 65535, 0, 0, 0])),
      put(new Int8Array([127, 0, 0, 127, -127, -127, 0, 0])),
      put(new Int16Array([32767, 0, 0, 32767, -32767, -32767, 0, 0])),
      // A picture.
      put(new Uint8Array([137, 80, 78, 71])),
    ];
    const uri = `data:application/octet-stream;base64,${btoa(String.fromCharCode(...bytes))}`;
    const acc = (
      bufferView: number | undefined,
      componentType: number,
      count: number,
      type: string,
    ) => ({
      bufferView,
      componentType,
      count,
      type,
      normalized: componentType !== 5126 && type !== 'SCALAR',
    });
    const json = {
      buffers: [{ uri, byteLength: bytes.length }],
      bufferViews: views,
      accessors: [
        acc(0, 5126, 4, 'VEC3'),
        acc(1, 5121, 4, 'SCALAR'),
        acc(2, 5123, 4, 'SCALAR'),
        acc(3, 5125, 3, 'SCALAR'),
        acc(4, 5121, 4, 'VEC4'),
        acc(5, 5123, 4, 'VEC3'),
        acc(6, 5120, 4, 'VEC2'),
        acc(7, 5122, 4, 'VEC2'),
        // No buffer view: all zeros.
        acc(undefined, 5126, 3, 'VEC3'),
      ],
      images: [
        { bufferView: 8, mimeType: 'image/png' },
        { uri: 'data:image/jpeg;base64,/9j/' },
        { uri: 'missing.webp' },
        { bufferView: 8 },
      ],
      textures: [{ source: 0 }, { source: 2 }],
      materials: [
        { pbrMetallicRoughness: { baseColorTexture: { index: 0 } }, alphaMode: 'MASK' },
        {
          pbrMetallicRoughness: { baseColorFactor: [0, 0, 0, 0.5], baseColorTexture: { index: 1 } },
        },
        {},
      ],
      meshes: [
        {
          primitives: [
            // A strip and a fan of the square: two triangles each.
            {
              attributes: { POSITION: 0, COLOR_0: 4, TEXCOORD_0: 6 },
              indices: 1,
              mode: 5,
              material: 0,
            },
            {
              attributes: { POSITION: 0, COLOR_0: 5, TEXCOORD_0: 7 },
              indices: 2,
              mode: 6,
              material: 1,
            },
            { attributes: { POSITION: 0 }, indices: 3, material: 2 },
            // Lines and a primitive without positions are skipped.
            { attributes: { POSITION: 0 }, mode: 1 },
            { attributes: {} },
          ],
        },
        { primitives: [{ attributes: { POSITION: 8 } }] },
      ],
      // No scene: the roots are the nodes nobody holds; node 2 points back at node 1.
      nodes: [
        { mesh: 0, translation: [10, 0, 0], children: [1] },
        { mesh: 1, scale: [2, 2, 2], rotation: [0, 0, 0, 1], children: [2] },
        { matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 5, 1], children: [1] },
      ],
    };
    const mesh = readMesh([{ name: 'm.gltf', bytes: text(JSON.stringify(json)) }]);
    expect(mesh.count).toBe(2 + 2 + 1 + 1);
    expect([...mesh.positions.subarray(0, 3)]).toEqual([10, 0, 0]);
    expect([...mesh.materials]).toEqual([0, 0, 1, 1, 2, -1]);
    expect(mesh.materialList[0]).toMatchObject({ image: 0, cutout: true });
    // The second texture's picture is missing: just the colour.
    expect(mesh.materialList[1]).toMatchObject({
      color: [0, 0, 0, 0.5],
      image: null,
      cutout: false,
    });
    for (const c of mesh.materialList[2]!.color) expect(c).toBeCloseTo(1);
    expect(mesh.images.map((i) => i.mime)).toEqual([
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/png',
    ]);
    expect(mesh.images[2]!.bytes.length).toBe(0);
    // Normalized values come out within −1…1, colours back in sRGB.
    expect(mesh.colors![0]).toBeCloseTo(1);
    expect(mesh.colors![3]).toBeCloseTo(1);
    expect(mesh.uvs![0]).toBeCloseTo(1);
    expect(Math.min(...mesh.uvs!)).toBe(-1);
  });

  it('follows the scene a glTF names, finding its buffer by file name', () => {
    const raw = new Uint8Array(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
    const json = {
      scene: 1,
      scenes: [{ nodes: [0] }, { nodes: [1] }],
      buffers: [{ uri: 'tri.bin', byteLength: raw.length }],
      bufferViews: [{ buffer: 0, byteLength: raw.length }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      nodes: [{ mesh: 0 }, { mesh: 0, translation: [0, 7, 0] }],
    };
    const mesh = readMesh([
      { name: 'dir/s.gltf', bytes: text(JSON.stringify(json)) },
      { name: 'dir\\tri.bin', bytes: raw },
    ]);
    expect(mesh.count).toBe(1);
    expect(mesh.positions[1]).toBe(7);
  });
});
