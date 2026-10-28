import { encodePng } from './png';

/**
 * Mesh files: OBJ with MTL and the palette as a 256 × 1
 * PNG (as MagicaVoxel writes it) or with vertex colours, binary PLY with vertex colours, binary
 * STL for printing, and glTF 2.0 — .glb or .gltf — with PBR materials read from MagicaVoxel's
 * (metal, glass with its IOR, emission and its strength), coloured by vertex or by the palette.
 */

/** A mesh as it goes into a file: quads in their final place — moved, scaled, on the file's axes. */
export interface MeshPart {
  name: string;
  /** Corners, 4 per quad, counter-clockwise seen from outside. */
  positions: Float32Array;
  /** One normal per quad. */
  normals: Float32Array;
  /** Palette id per quad. */
  colors: Uint8Array;
  count: number;
}

/** What the writers need of the palette. */
export interface ExportColors {
  /** sRGB 0…255 and alpha of a palette id. */
  rgba(id: number): readonly [number, number, number, number];
  pbr(id: number): PbrTerms;
}

export type ColorMode = 'vertex' | 'texture';

/** Metallic-roughness terms of a palette colour, as glTF wants them. */
export interface PbrTerms {
  /** sRGB 0…1, alpha last. */
  baseColor: [number, number, number, number];
  metallic: number;
  roughness: number;
  /** sRGB 0…1; black when it does not glow. */
  emissive: [number, number, number];
  emissiveStrength: number;
  transmission: number;
  ior: number;
}

const num = (v: number) => {
  const s = (Math.round(v * 1e6) / 1e6).toString();
  return s === '-0' ? '0' : s;
};

/** The palette as a 256 × 1 strip: id k at x = k − 1, as MagicaVoxel's exports. */
export function palettePng(colors: ExportColors): Uint8Array {
  const rgba = new Uint8Array(256 * 4);
  for (let id = 1; id <= 255; id++) rgba.set(colors.rgba(id), (id - 1) * 4);
  return encodePng(256, 1, rgba);
}

/** Where a palette id sits in the palette strip. */
const paletteU = (id: number) => (id - 0.5) / 256;

export function writeObj(
  parts: readonly MeshPart[],
  colors: ExportColors,
  mode: ColorMode,
  baseName: string,
): { obj: string; mtl: string | null; png: Uint8Array | null } {
  const lines = ['# DamnVoxel'];
  if (mode === 'texture') lines.push(`mtllib ${baseName}.mtl`);
  const vertexIndex = new Map<string, number>();
  const normalIndex = new Map<string, number>();
  const uvIndex = new Map<number, number>();
  const body: string[] = [];
  const head: string[] = [];
  for (const part of parts) {
    body.push(`o ${part.name.replace(/\s+/g, '_') || 'object'}`);
    if (mode === 'texture') body.push('usemtl palette');
    for (let q = 0; q < part.count; q++) {
      const id = part.colors[q]!;
      const n = [0, 1, 2].map((k) => num(part.normals[q * 3 + k]!)).join(' ');
      let vn = normalIndex.get(n);
      if (vn === undefined) {
        vn = normalIndex.size + 1;
        normalIndex.set(n, vn);
        head.push(`vn ${n}`);
      }
      let vt = 0;
      if (mode === 'texture') {
        vt = uvIndex.get(id) ?? 0;
        if (!vt) {
          vt = uvIndex.size + 1;
          uvIndex.set(id, vt);
          head.push(`vt ${num(paletteU(id))} 0.5`);
        }
      }
      const rgb = colors.rgba(id);
      const refs: string[] = [];
      for (let c = 0; c < 4; c++) {
        const o = (q * 4 + c) * 3;
        const p = `${num(part.positions[o]!)} ${num(part.positions[o + 1]!)} ${num(part.positions[o + 2]!)}`;
        // With vertex colours a corner is its position and its colour.
        const key = mode === 'vertex' ? `${p}|${id}` : p;
        let v = vertexIndex.get(key);
        if (v === undefined) {
          v = vertexIndex.size + 1;
          vertexIndex.set(key, v);
          head.push(
            mode === 'vertex'
              ? `v ${p} ${num(rgb[0] / 255)} ${num(rgb[1] / 255)} ${num(rgb[2] / 255)}`
              : `v ${p}`,
          );
        }
        refs.push(mode === 'texture' ? `${v}/${vt}/${vn}` : `${v}//${vn}`);
      }
      body.push(`f ${refs.join(' ')}`);
    }
  }
  const obj = `${[...lines, ...head, ...body].join('\n')}\n`;
  if (mode !== 'texture') return { obj, mtl: null, png: null };
  const mtl = [
    '# DamnVoxel',
    'newmtl palette',
    'Ka 1 1 1',
    'Kd 1 1 1',
    'Ks 0 0 0',
    'd 1',
    'illum 1',
    `map_Kd ${baseName}.png`,
    '',
  ].join('\n');
  return { obj, mtl, png: palettePng(colors) };
}

/** Binary PLY: four corners per quad with the quad's colour, and the quads as faces. */
export function writePly(parts: readonly MeshPart[], colors: ExportColors): Uint8Array {
  const quads = parts.reduce((s, p) => s + p.count, 0);
  const header = [
    'ply',
    'format binary_little_endian 1.0',
    'comment DamnVoxel',
    `element vertex ${quads * 4}`,
    'property float x',
    'property float y',
    'property float z',
    'property uchar red',
    'property uchar green',
    'property uchar blue',
    `element face ${quads}`,
    'property list uchar int vertex_indices',
    'end_header',
    '',
  ].join('\n');
  const head = new TextEncoder().encode(header);
  const out = new Uint8Array(head.length + quads * 4 * 15 + quads * 17);
  out.set(head);
  const view = new DataView(out.buffer);
  let p = head.length;
  for (const part of parts)
    for (let q = 0; q < part.count; q++) {
      const rgb = colors.rgba(part.colors[q]!);
      for (let c = 0; c < 4; c++) {
        const o = (q * 4 + c) * 3;
        view.setFloat32(p, part.positions[o]!, true);
        view.setFloat32(p + 4, part.positions[o + 1]!, true);
        view.setFloat32(p + 8, part.positions[o + 2]!, true);
        out[p + 12] = rgb[0];
        out[p + 13] = rgb[1];
        out[p + 14] = rgb[2];
        p += 15;
      }
    }
  let first = 0;
  for (const part of parts)
    for (let q = 0; q < part.count; q++) {
      out[p++] = 4;
      for (let c = 0; c < 4; c++) {
        view.setInt32(p, first + c, true);
        p += 4;
      }
      first += 4;
    }
  return out;
}

/** Binary STL: two triangles per quad, no colour. */
export function writeStl(parts: readonly MeshPart[]): Uint8Array {
  const quads = parts.reduce((s, p) => s + p.count, 0);
  const out = new Uint8Array(84 + quads * 2 * 50);
  const title = new TextEncoder().encode('DamnVoxel');
  out.set(title.subarray(0, 80));
  const view = new DataView(out.buffer);
  view.setUint32(80, quads * 2, true);
  let p = 84;
  for (const part of parts)
    for (let q = 0; q < part.count; q++)
      for (const tri of [
        [0, 1, 2],
        [0, 2, 3],
      ]) {
        for (let k = 0; k < 3; k++) view.setFloat32(p + k * 4, part.normals[q * 3 + k]!, true);
        p += 12;
        for (const c of tri)
          for (let k = 0; k < 3; k++) {
            view.setFloat32(p, part.positions[(q * 4 + c) * 3 + k]!, true);
            p += 4;
          }
        p += 2;
      }
  return out;
}

const srgbToLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

/** The glTF material a palette id gets: equal ones are shared. */
function materialKey(pbr: PbrTerms, id: number, mode: ColorMode): string {
  const r = (v: number) => v.toFixed(3);
  const glow =
    pbr.emissiveStrength > 0 ? (mode === 'vertex' ? `e${id}` : `e${r(pbr.emissiveStrength)}`) : '';
  return [r(pbr.metallic), r(pbr.roughness), r(pbr.transmission), r(pbr.ior), glow].join('|');
}

function base64(bytes: Uint8Array): string {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    s += abc[(n >> 18) & 63]! + abc[(n >> 12) & 63]!;
    s += i + 1 < bytes.length ? abc[(n >> 6) & 63]! : '=';
    s += i + 2 < bytes.length ? abc[n & 63]! : '=';
  }
  return s;
}

/**
 * glTF 2.0: a node and a mesh per part, a primitive per material within it. Vertex colours go
 * to COLOR_0 (linear); the palette mode samples the 256 × 1 strip without filtering.
 * `binary` gives a .glb, otherwise a .gltf with the data inside as base64.
 */
export function writeGltf(
  parts: readonly MeshPart[],
  colors: ExportColors,
  mode: ColorMode,
  binary: boolean,
): Uint8Array {
  const chunks: Uint8Array[] = [];
  let length = 0;
  const bufferViews: object[] = [];
  const accessors: object[] = [];
  /** Adds data as a buffer view (4-byte aligned) and returns its index. */
  const view = (data: Uint8Array, target?: number): number => {
    const pad = (4 - (length % 4)) % 4;
    if (pad) {
      chunks.push(new Uint8Array(pad));
      length += pad;
    }
    chunks.push(data);
    bufferViews.push({
      buffer: 0,
      byteOffset: length,
      byteLength: data.length,
      ...(target ? { target } : {}),
    });
    length += data.length;
    return bufferViews.length - 1;
  };
  const accessor = (data: Float32Array | Uint32Array, type: string, extra: object = {}): number => {
    const size = { SCALAR: 1, VEC2: 2, VEC3: 3 }[type]!;
    const float = data instanceof Float32Array;
    accessors.push({
      bufferView: view(
        new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
        float ? 34962 : 34963,
      ),
      componentType: float ? 5126 : 5125,
      count: data.length / size,
      type,
      ...extra,
    });
    return accessors.length - 1;
  };

  const used = new Set<string>();
  const materials: object[] = [];
  const materialIndex = new Map<string, number>();
  const materialOf = (id: number): number => {
    const pbr = colors.pbr(id);
    const key = materialKey(pbr, id, mode);
    const known = materialIndex.get(key);
    if (known !== undefined) return known;
    const m: Record<string, unknown> = {
      name: `material ${materials.length + 1}`,
      pbrMetallicRoughness: {
        baseColorFactor: [1, 1, 1, 1],
        metallicFactor: pbr.metallic,
        roughnessFactor: pbr.roughness,
        ...(mode === 'texture' ? { baseColorTexture: { index: 0 } } : {}),
      },
    };
    const ext: Record<string, unknown> = {};
    if (pbr.emissiveStrength > 0) {
      if (mode === 'texture') {
        m.emissiveFactor = [1, 1, 1];
        m.emissiveTexture = { index: 0 };
      } else {
        const rgb = colors.rgba(id);
        m.emissiveFactor = [rgb[0], rgb[1], rgb[2]].map(srgbToLinear);
      }
      if (pbr.emissiveStrength > 1)
        ext.KHR_materials_emissive_strength = { emissiveStrength: pbr.emissiveStrength };
    }
    if (pbr.transmission > 0)
      ext.KHR_materials_transmission = { transmissionFactor: pbr.transmission };
    if (pbr.transmission > 0 || pbr.ior !== 1.5) ext.KHR_materials_ior = { ior: pbr.ior };
    if (Object.keys(ext).length > 0) {
      m.extensions = ext;
      for (const k of Object.keys(ext)) used.add(k);
    }
    materials.push(m);
    materialIndex.set(key, materials.length - 1);
    return materials.length - 1;
  };

  const meshes: object[] = [];
  const nodes: object[] = [];
  for (const part of parts) {
    const groups = new Map<number, number[]>();
    for (let q = 0; q < part.count; q++) {
      const m = materialOf(part.colors[q]!);
      const list = groups.get(m) ?? [];
      list.push(q);
      groups.set(m, list);
    }
    const primitives: object[] = [];
    for (const [material, quads] of groups) {
      const n = quads.length * 4;
      const pos = new Float32Array(n * 3);
      const nor = new Float32Array(n * 3);
      const col = mode === 'vertex' ? new Float32Array(n * 3) : null;
      const uv = mode === 'texture' ? new Float32Array(n * 2) : null;
      const idx = new Uint32Array(quads.length * 6);
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      quads.forEach((q, k) => {
        const id = part.colors[q]!;
        const rgb = colors.rgba(id).slice(0, 3).map(srgbToLinear);
        for (let c = 0; c < 4; c++) {
          const v = k * 4 + c;
          for (let a = 0; a < 3; a++) {
            const x = part.positions[(q * 4 + c) * 3 + a]!;
            pos[v * 3 + a] = x;
            if (x < min[a]!) min[a] = x;
            if (x > max[a]!) max[a] = x;
            nor[v * 3 + a] = part.normals[q * 3 + a]!;
            if (col) col[v * 3 + a] = rgb[a]!;
          }
          if (uv) {
            uv[v * 2] = paletteU(id);
            uv[v * 2 + 1] = 0.5;
          }
        }
        idx.set([k * 4, k * 4 + 1, k * 4 + 2, k * 4, k * 4 + 2, k * 4 + 3], k * 6);
      });
      const attributes: Record<string, number> = {
        POSITION: accessor(pos, 'VEC3', { min, max }),
        NORMAL: accessor(nor, 'VEC3'),
      };
      if (col) attributes.COLOR_0 = accessor(col, 'VEC3');
      if (uv) attributes.TEXCOORD_0 = accessor(uv, 'VEC2');
      primitives.push({ attributes, indices: accessor(idx, 'SCALAR'), material });
    }
    meshes.push({ name: part.name, primitives });
    nodes.push({ name: part.name, mesh: meshes.length - 1 });
  }

  const json: Record<string, unknown> = {
    asset: { version: '2.0', generator: 'DamnVoxel' },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
  };
  if (mode === 'texture') {
    const png = palettePng(colors);
    json.samplers = [{ magFilter: 9728, minFilter: 9728, wrapS: 33071, wrapT: 33071 }];
    json.textures = [{ sampler: 0, source: 0 }];
    json.images = binary
      ? [{ bufferView: view(png), mimeType: 'image/png' }]
      : [{ uri: `data:image/png;base64,${base64(png)}` }];
  }
  if (used.size > 0) json.extensionsUsed = [...used];
  const bin = new Uint8Array(length + ((4 - (length % 4)) % 4));
  let p = 0;
  for (const c of chunks) {
    bin.set(c, p);
    p += c.length;
  }
  if (!binary) {
    json.buffers = [
      { byteLength: bin.length, uri: `data:application/octet-stream;base64,${base64(bin)}` },
    ];
    return new TextEncoder().encode(JSON.stringify(json));
  }
  json.buffers = [{ byteLength: bin.length }];
  let text = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (text.length % 4)) % 4;
  if (jsonPad) {
    const padded = new Uint8Array(text.length + jsonPad).fill(0x20);
    padded.set(text);
    text = padded;
  }
  const out = new Uint8Array(12 + 8 + text.length + 8 + bin.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x46546c67, true);
  v.setUint32(4, 2, true);
  v.setUint32(8, out.length, true);
  v.setUint32(12, text.length, true);
  v.setUint32(16, 0x4e4f534a, true);
  out.set(text, 20);
  v.setUint32(20 + text.length, bin.length, true);
  v.setUint32(24 + text.length, 0x004e4942, true);
  out.set(bin, 28 + text.length);
  return out;
}
