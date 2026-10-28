import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  type ExportColors,
  type MeshPart,
  type PbrTerms,
  palettePng,
  writeGltf,
  writeObj,
  writePly,
  writeStl,
} from './mesh-formats';
import { encodePng } from './png';
import { crc32, zip } from './zip';

/** One unit quad facing +y, of colour 3, and one facing +x of colour 9 (emissive). */
const PART: MeshPart = {
  name: 'House',
  positions: new Float32Array([
    0, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1,
  ]),
  normals: new Float32Array([0, 1, 0, 1, 0, 0]),
  colors: new Uint8Array([3, 9]),
  count: 2,
};

const DIFFUSE: PbrTerms = {
  baseColor: [1, 0, 0, 1],
  metallic: 0,
  roughness: 0.9,
  emissive: [0, 0, 0],
  emissiveStrength: 0,
  transmission: 0,
  ior: 1.5,
};

const COLORS: ExportColors = {
  rgba: (id) => [id, 2 * id, 255 - id, 255],
  pbr: (id) => (id === 9 ? { ...DIFFUSE, emissive: [1, 1, 1], emissiveStrength: 4 } : DIFFUSE),
};

describe('zip and png', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('stores files with their names, sizes and checksums', () => {
    const a = new TextEncoder().encode('héllo ✓');
    const out = zip([
      { name: 'a.txt', data: a },
      { name: 'folder/b.bin', data: new Uint8Array([1, 2, 3]) },
    ]);
    const v = new DataView(out.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    expect(v.getUint32(14, true)).toBe(crc32(a));
    const end = out.length - 22;
    expect(v.getUint32(end, true)).toBe(0x06054b50);
    expect(v.getUint16(end + 10, true)).toBe(2);
    // The second local header sits where the central directory says.
    const dir = v.getUint32(end + 16, true);
    const second = dir + 46 + 'a.txt'.length;
    expect(v.getUint32(second + 42, true)).toBe(30 + 5 + a.length);
  });

  it('writes a PNG whose pixels inflate back', () => {
    const rgba = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const png = encodePng(3, 1, rgba);
    expect([...png.subarray(1, 4)].map((c) => String.fromCharCode(c)).join('')).toBe('PNG');
    const v = new DataView(png.buffer);
    expect([v.getUint32(16), v.getUint32(20)]).toEqual([3, 1]);
    const idatLength = v.getUint32(33);
    const raw = inflateSync(png.subarray(41, 41 + idatLength));
    expect([...raw]).toEqual([0, ...rgba]);
  });
});

describe('mesh files', () => {
  it('OBJ: palette texture or vertex colours', () => {
    const t = writeObj([PART], COLORS, 'texture', 'house');
    expect(t.obj).toContain('mtllib house.mtl');
    expect(t.obj.match(/^f /gm)).toHaveLength(2);
    expect(t.obj.match(/^vt /gm)).toHaveLength(2);
    expect(t.obj).toContain('vt 0.009766 0.5');
    // Corners shared between the quads are written once.
    expect(t.obj.match(/^v /gm)).toHaveLength(6);
    expect(t.mtl).toContain('map_Kd house.png');
    expect(t.png).not.toBeNull();
    const c = writeObj([PART], COLORS, 'vertex', 'house');
    expect(c.mtl).toBeNull();
    expect(c.obj).toMatch(/^v 0 1 0 0\.011765 0\.023529 0\.988235$/m);
    expect(c.obj.match(/^v /gm)).toHaveLength(8);
  });

  it('PLY: header and data sizes agree', () => {
    const ply = writePly([PART], COLORS);
    const text = new TextDecoder().decode(ply);
    expect(text).toContain('element vertex 8');
    expect(text).toContain('element face 2');
    const body = ply.length - (text.indexOf('end_header\n') + 'end_header\n'.length);
    expect(body).toBe(8 * 15 + 2 * 17);
  });

  it('STL: two triangles per quad, with the normal', () => {
    const stl = writeStl([PART]);
    const v = new DataView(stl.buffer);
    expect(v.getUint32(80, true)).toBe(4);
    expect(stl.length).toBe(84 + 4 * 50);
    expect([v.getFloat32(84, true), v.getFloat32(88, true), v.getFloat32(92, true)]).toEqual([
      0, 1, 0,
    ]);
  });

  it('GLB: valid header, a primitive per material, emission with its strength', () => {
    const glb = writeGltf([PART], COLORS, 'vertex', true);
    const v = new DataView(glb.buffer);
    expect(v.getUint32(0, true)).toBe(0x46546c67);
    expect(v.getUint32(8, true)).toBe(glb.length);
    const jsonLength = v.getUint32(12, true);
    expect(jsonLength % 4).toBe(0);
    const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength)));
    expect(json.meshes[0].primitives).toHaveLength(2);
    expect(json.nodes[0].name).toBe('House');
    const glow = json.materials.find((m: { emissiveFactor?: number[] }) => m.emissiveFactor);
    expect(glow.extensions.KHR_materials_emissive_strength.emissiveStrength).toBe(4);
    expect(json.extensionsUsed).toContain('KHR_materials_emissive_strength');
    const pos = json.accessors[json.meshes[0].primitives[0].attributes.POSITION];
    expect(pos.count).toBe(4);
    expect(pos.min).toEqual([0, 1, 0]);
    expect(pos.max).toEqual([1, 1, 1]);
    const binLength = v.getUint32(20 + jsonLength, true);
    expect(json.buffers[0].byteLength).toBe(binLength);
    for (const bv of json.bufferViews)
      expect(bv.byteOffset + bv.byteLength).toBeLessThanOrEqual(binLength);
  });

  it('glTF with the palette: texture, nearest sampling, data inside', () => {
    const gltf = JSON.parse(new TextDecoder().decode(writeGltf([PART], COLORS, 'texture', false)));
    expect(gltf.images[0].uri).toMatch(/^data:image\/png;base64,/);
    expect(gltf.buffers[0].uri).toMatch(/^data:application\/octet-stream;base64,/);
    expect(gltf.samplers[0].magFilter).toBe(9728);
    const prim = gltf.meshes[0].primitives[0];
    expect(prim.attributes.TEXCOORD_0).toBeDefined();
    expect(gltf.materials[prim.material].pbrMetallicRoughness.baseColorTexture.index).toBe(0);
    expect(palettePng(COLORS).length).toBeGreaterThan(256 * 4);
  });
});
