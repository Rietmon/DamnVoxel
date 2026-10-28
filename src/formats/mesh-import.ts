import { FormatError } from './binary';

/**
 * Reading meshes to voxelize: glTF 2.0 (.glb, or .gltf with
 * its .bin and pictures among the files), OBJ with its MTL and textures, STL (binary or text).
 * Out comes a flat list of triangles in the file's space with what colours them: a material
 * colour, vertex colours, a texture and its coordinates. Pictures stay encoded — the app decodes
 * them. Texture coordinates are given with v going down the picture (glTF's way).
 */

export interface MeshMaterial {
  /** sRGB 0…1 and alpha. */
  color: [number, number, number, number];
  /** Index into `images`, or null. */
  image: number | null;
  /** Pixels with alpha under half are holes (glTF MASK and BLEND); otherwise alpha is ignored. */
  cutout: boolean;
}

export interface MeshImage {
  name: string;
  bytes: Uint8Array;
  mime: string;
}

export interface ImportedMesh {
  /** 9 numbers per triangle. */
  positions: Float32Array;
  /** 6 per triangle, or null when no triangle has texture coordinates. */
  uvs: Float32Array | null;
  /** 12 per triangle: sRGB 0…1 and alpha per corner; null without vertex colours. */
  colors: Float32Array | null;
  /** Material per triangle, −1 for none. */
  materials: Int32Array;
  materialList: MeshMaterial[];
  images: MeshImage[];
  count: number;
  /** The file's own up axis: Z for STL, Y otherwise. */
  up: 'y' | 'z';
}

export interface MeshFile {
  name: string;
  bytes: Uint8Array;
}

const ext = (name: string) => name.toLowerCase().split('.').pop() ?? '';
const base = (name: string) => name.replace(/\\/g, '/').split('/').pop()!.toLowerCase();

/** The file to voxelize among the chosen ones: a model, not its companions. */
export function mainMeshFile(files: readonly MeshFile[]): MeshFile | null {
  return files.find((f) => ['glb', 'gltf', 'obj', 'stl'].includes(ext(f.name))) ?? null;
}

export function readMesh(files: readonly MeshFile[]): ImportedMesh {
  const main = mainMeshFile(files);
  if (!main) throw new FormatError('Needs a .glb, .gltf, .obj or .stl file');
  const find = (name: string) => files.find((f) => base(f.name) === base(decodeURIComponent(name)));
  switch (ext(main.name)) {
    case 'glb':
    case 'gltf':
      return readGltf(main.bytes, find);
    case 'obj':
      return readObj(main.bytes, find);
    default:
      return readStl(main.bytes);
  }
}

/** Triangles as they are gathered: grown arrays, then cut to size. */
class Builder {
  positions: number[] = [];
  uvs: number[] = [];
  colors: number[] = [];
  materials: number[] = [];
  anyUv = false;
  anyColor = false;

  add(
    p: readonly number[],
    uv: readonly number[] | null,
    color: readonly number[] | null,
    material: number,
  ): void {
    this.positions.push(...p);
    this.uvs.push(...(uv ?? [0, 0, 0, 0, 0, 0]));
    if (uv) this.anyUv = true;
    this.colors.push(...(color ?? [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]));
    if (color) this.anyColor = true;
    this.materials.push(material);
  }

  finish(materialList: MeshMaterial[], images: MeshImage[], up: 'y' | 'z'): ImportedMesh {
    const count = this.materials.length;
    if (count === 0) throw new FormatError('The file has no triangles');
    return {
      positions: new Float32Array(this.positions),
      uvs: this.anyUv ? new Float32Array(this.uvs) : null,
      colors: this.anyColor ? new Float32Array(this.colors) : null,
      materials: new Int32Array(this.materials),
      materialList,
      images,
      count,
      up,
    };
  }
}

// ---- STL ----

function readStl(bytes: Uint8Array): ImportedMesh {
  const b = new Builder();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = bytes.length >= 84 ? view.getUint32(80, true) : -1;
  if (count >= 0 && 84 + count * 50 === bytes.length) {
    for (let t = 0; t < count; t++) {
      const o = 84 + t * 50 + 12;
      const p: number[] = [];
      for (let k = 0; k < 9; k++) p.push(view.getFloat32(o + k * 4, true));
      b.add(p, null, null, -1);
    }
  } else {
    const text = new TextDecoder().decode(bytes);
    if (!/^\s*solid/.test(text)) throw new FormatError('This is not STL');
    let p: number[] = [];
    for (const m of text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)) {
      p.push(Number(m[1]), Number(m[2]), Number(m[3]));
      if (p.length === 9) {
        b.add(p, null, null, -1);
        p = [];
      }
    }
  }
  return b.finish([], [], 'z');
}

// ---- OBJ ----

function readMtl(text: string, find: (n: string) => MeshFile | undefined, images: MeshImage[]) {
  const out = new Map<string, MeshMaterial>();
  let current: MeshMaterial | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const [key, ...rest] = line.split(/\s+/);
    if (key === 'newmtl') {
      current = { color: [1, 1, 1, 1], image: null, cutout: false };
      out.set(rest.join(' '), current);
    } else if (current && key === 'Kd') {
      const [r, g, bl] = rest.map(Number);
      current.color = [r ?? 1, g ?? 1, bl ?? 1, 1];
    } else if (current && key === 'map_Kd') {
      // The file name is the last word (options may come first).
      const file = find(rest[rest.length - 1] ?? '');
      if (file) {
        images.push({ name: file.name, bytes: file.bytes, mime: mimeOf(file.name) });
        current.image = images.length - 1;
      }
    }
  }
  return out;
}

function readObj(bytes: Uint8Array, find: (n: string) => MeshFile | undefined): ImportedMesh {
  const text = new TextDecoder().decode(bytes);
  const v: number[][] = [];
  const vc: (number[] | null)[] = [];
  const vt: number[][] = [];
  const images: MeshImage[] = [];
  const materialList: MeshMaterial[] = [];
  const materialIds = new Map<string, number>();
  let named = new Map<string, MeshMaterial>();
  let material = -1;
  const b = new Builder();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === '#') continue;
    const [key, ...rest] = line.split(/\s+/);
    if (key === 'v') {
      const n = rest.map(Number);
      v.push(n.slice(0, 3));
      vc.push(n.length >= 6 ? n.slice(3, 6) : null);
    } else if (key === 'vt') {
      const n = rest.map(Number);
      vt.push([n[0] ?? 0, 1 - (n[1] ?? 0)]);
    } else if (key === 'mtllib') {
      const file = find(rest.join(' '));
      if (file)
        named = new Map([...named, ...readMtl(new TextDecoder().decode(file.bytes), find, images)]);
    } else if (key === 'usemtl') {
      const name = rest.join(' ');
      let id = materialIds.get(name);
      if (id === undefined) {
        materialList.push(named.get(name) ?? { color: [1, 1, 1, 1], image: null, cutout: false });
        id = materialList.length - 1;
        materialIds.set(name, id);
      }
      material = id;
    } else if (key === 'f') {
      const corners = rest.map((c) => {
        const [vi, ti] = c.split('/');
        const at = (s: string | undefined, n: number) => {
          const i = Number(s);
          return s ? (i < 0 ? n + i : i - 1) : -1;
        };
        return [at(vi, v.length), at(ti, vt.length)] as const;
      });
      // A polygon as a fan.
      for (let k = 1; k + 1 < corners.length; k++) {
        const tri = [corners[0]!, corners[k]!, corners[k + 1]!];
        const p = tri.flatMap(([vi]) => v[vi] ?? [0, 0, 0]);
        const hasUv = tri.every(([, ti]) => ti >= 0 && vt[ti]);
        const hasColor = tri.every(([vi]) => vc[vi]);
        b.add(
          p,
          hasUv ? tri.flatMap(([, ti]) => vt[ti]!) : null,
          hasColor ? tri.flatMap(([vi]) => [...vc[vi]!, 1]) : null,
          material,
        );
      }
    }
  }
  return b.finish(materialList, images, 'y');
}

// ---- glTF ----

interface GltfJson {
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: {
    children?: number[];
    mesh?: number;
    matrix?: number[];
    translation?: number[];
    rotation?: number[];
    scale?: number[];
  }[];
  meshes?: {
    primitives: {
      attributes: Record<string, number>;
      indices?: number;
      material?: number;
      mode?: number;
      extensions?: Record<string, unknown>;
    }[];
  }[];
  accessors?: {
    bufferView?: number;
    byteOffset?: number;
    componentType: number;
    normalized?: boolean;
    count: number;
    type: string;
    sparse?: unknown;
  }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  buffers?: { uri?: string; byteLength: number }[];
  materials?: {
    pbrMetallicRoughness?: {
      baseColorFactor?: number[];
      baseColorTexture?: { index: number; texCoord?: number };
    };
    alphaMode?: string;
  }[];
  textures?: { source?: number }[];
  images?: { uri?: string; bufferView?: number; mimeType?: string }[];
  extensionsRequired?: string[];
}

const SIZES: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function decodeBase64(s: string): Uint8Array {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (abc.indexOf(clean[i]!) << 18) |
      (abc.indexOf(clean[i + 1]!) << 12) |
      ((abc.indexOf(clean[i + 2] ?? 'A') & 63) << 6) |
      (abc.indexOf(clean[i + 3] ?? 'A') & 63);
    if (p < out.length) out[p++] = (n >> 16) & 255;
    if (p < out.length) out[p++] = (n >> 8) & 255;
    if (p < out.length) out[p++] = n & 255;
  }
  return out;
}

function mimeOf(name: string): string {
  const e = ext(name);
  return e === 'jpg' || e === 'jpeg' ? 'image/jpeg' : e === 'webp' ? 'image/webp' : 'image/png';
}

function srgb(linear: number): number {
  const c = Math.max(0, Math.min(1, linear));
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}

type Mat4 = number[];

function multiply(a: Mat4, b: Mat4): Mat4 {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r]! * b[c * 4 + k]!;
  return o;
}

/** A node's local matrix (column-major) from its matrix or its translation, rotation and scale. */
function nodeMatrix(n: NonNullable<GltfJson['nodes']>[number]): Mat4 {
  if (n.matrix?.length === 16) return n.matrix;
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  return [
    (1 - 2 * (y! * y! + z! * z!)) * sx!,
    2 * (x! * y! + z! * w!) * sx!,
    2 * (x! * z! - y! * w!) * sx!,
    0,
    2 * (x! * y! - z! * w!) * sy!,
    (1 - 2 * (x! * x! + z! * z!)) * sy!,
    2 * (y! * z! + x! * w!) * sy!,
    0,
    2 * (x! * z! + y! * w!) * sz!,
    2 * (y! * z! - x! * w!) * sz!,
    (1 - 2 * (x! * x! + y! * y!)) * sz!,
    0,
    tx!,
    ty!,
    tz!,
    1,
  ];
}

function readGltf(bytes: Uint8Array, find: (n: string) => MeshFile | undefined): ImportedMesh {
  let json: GltfJson;
  let bin: Uint8Array | null = null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 12 && view.getUint32(0, true) === 0x46546c67) {
    let p = 12;
    let text = '';
    while (p + 8 <= bytes.length) {
      const length = view.getUint32(p, true);
      const type = view.getUint32(p + 4, true);
      const chunk = bytes.subarray(p + 8, p + 8 + length);
      if (type === 0x4e4f534a) text = new TextDecoder().decode(chunk);
      else if (type === 0x004e4942) bin = chunk;
      p += 8 + length;
    }
    json = JSON.parse(text) as GltfJson;
  } else json = JSON.parse(new TextDecoder().decode(bytes)) as GltfJson;
  const required = json.extensionsRequired ?? [];
  if (required.some((e) => e.includes('draco') || e.includes('meshopt')))
    throw new FormatError('Compressed geometry (Draco, meshopt) cannot be read yet');

  const buffers = (json.buffers ?? []).map((b, i) => {
    if (!b.uri) {
      if (i === 0 && bin) return bin;
      throw new FormatError('No glTF binary buffer');
    }
    if (b.uri.startsWith('data:')) return decodeBase64(b.uri.slice(b.uri.indexOf(',') + 1));
    const file = find(b.uri);
    if (!file)
      throw new FormatError(`Needs the file “${b.uri}” next to the .gltf — choose them together`);
    return file.bytes;
  });
  const viewBytes = (i: number) => {
    const v = json.bufferViews![i]!;
    const buffer = buffers[v.buffer]!;
    return {
      bytes: buffer.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength),
      stride: v.byteStride,
    };
  };
  /** An accessor as plain numbers, normalized ones scaled to 0…1. */
  const read = (index: number): { values: number[]; size: number } => {
    const a = json.accessors![index]!;
    if (a.sparse) throw new FormatError('Sparse glTF data cannot be read yet');
    const size = SIZES[a.type] ?? 1;
    const values = new Array<number>(a.count * size).fill(0);
    if (a.bufferView === undefined) return { values, size };
    const { bytes: b, stride } = viewBytes(a.bufferView);
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const width = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[a.componentType] ?? 4;
    const step = stride ?? width * size;
    for (let i = 0; i < a.count; i++)
      for (let k = 0; k < size; k++) {
        const o = (a.byteOffset ?? 0) + i * step + k * width;
        let x: number;
        switch (a.componentType) {
          case 5120:
            x = dv.getInt8(o);
            if (a.normalized) x = Math.max(x / 127, -1);
            break;
          case 5121:
            x = dv.getUint8(o);
            if (a.normalized) x /= 255;
            break;
          case 5122:
            x = dv.getInt16(o, true);
            if (a.normalized) x = Math.max(x / 32767, -1);
            break;
          case 5123:
            x = dv.getUint16(o, true);
            if (a.normalized) x /= 65535;
            break;
          case 5125:
            x = dv.getUint32(o, true);
            break;
          default:
            x = dv.getFloat32(o, true);
        }
        values[i * size + k] = x;
      }
    return { values, size };
  };

  const images: MeshImage[] = (json.images ?? []).map((img, i) => {
    if (img.bufferView !== undefined)
      return {
        name: `image${i}`,
        bytes: viewBytes(img.bufferView).bytes,
        mime: img.mimeType ?? 'image/png',
      };
    const uri = img.uri ?? '';
    if (uri.startsWith('data:'))
      return {
        name: `image${i}`,
        bytes: decodeBase64(uri.slice(uri.indexOf(',') + 1)),
        mime: uri.slice(5, uri.indexOf(';')),
      };
    const file = find(uri);
    return { name: uri, bytes: file?.bytes ?? new Uint8Array(0), mime: mimeOf(uri) };
  });
  const materialList: MeshMaterial[] = (json.materials ?? []).map((m) => {
    const pbr = m.pbrMetallicRoughness ?? {};
    const f = pbr.baseColorFactor ?? [1, 1, 1, 1];
    const tex = pbr.baseColorTexture
      ? json.textures?.[pbr.baseColorTexture.index]?.source
      : undefined;
    return {
      color: [srgb(f[0]!), srgb(f[1]!), srgb(f[2]!), f[3] ?? 1],
      image: tex !== undefined && images[tex]?.bytes.length ? tex : null,
      cutout: m.alphaMode === 'MASK' || m.alphaMode === 'BLEND',
    };
  });

  const b = new Builder();
  const visit = (nodeIndex: number, parent: Mat4, seen: Set<number>) => {
    const node = json.nodes?.[nodeIndex];
    if (!node || seen.has(nodeIndex)) return;
    seen.add(nodeIndex);
    const world = multiply(parent, nodeMatrix(node));
    const mesh = node.mesh !== undefined ? json.meshes?.[node.mesh] : undefined;
    for (const prim of mesh?.primitives ?? []) {
      const mode = prim.mode ?? 4;
      if (mode < 4) continue;
      if (prim.attributes.POSITION === undefined) continue;
      const pos = read(prim.attributes.POSITION).values;
      const uv =
        prim.attributes.TEXCOORD_0 !== undefined ? read(prim.attributes.TEXCOORD_0).values : null;
      const col = prim.attributes.COLOR_0 !== undefined ? read(prim.attributes.COLOR_0) : null;
      const n = pos.length / 3;
      let idx =
        prim.indices !== undefined
          ? read(prim.indices).values
          : Array.from({ length: n }, (_, i) => i);
      // Strips and fans as plain triangles.
      if (mode === 5)
        idx = idx
          .slice(2)
          .flatMap((_, i) =>
            i % 2 ? [idx[i + 1]!, idx[i]!, idx[i + 2]!] : [idx[i]!, idx[i + 1]!, idx[i + 2]!],
          );
      else if (mode === 6)
        idx = idx.slice(2).flatMap((_, i) => [idx[0]!, idx[i + 1]!, idx[i + 2]!]);
      const at = (i: number) => {
        const x = pos[i * 3]!;
        const y = pos[i * 3 + 1]!;
        const z = pos[i * 3 + 2]!;
        return [
          world[0]! * x + world[4]! * y + world[8]! * z + world[12]!,
          world[1]! * x + world[5]! * y + world[9]! * z + world[13]!,
          world[2]! * x + world[6]! * y + world[10]! * z + world[14]!,
        ];
      };
      const colorAt = (i: number) =>
        col
          ? [
              srgb(col.values[i * col.size]!),
              srgb(col.values[i * col.size + 1]!),
              srgb(col.values[i * col.size + 2]!),
              col.size === 4 ? col.values[i * 4 + 3]! : 1,
            ]
          : null;
      for (let t = 0; t + 2 < idx.length; t += 3) {
        const c = [idx[t]!, idx[t + 1]!, idx[t + 2]!];
        b.add(
          c.flatMap(at),
          uv ? c.flatMap((i) => [uv[i * 2]!, uv[i * 2 + 1]!]) : null,
          col ? c.flatMap((i) => colorAt(i)!) : null,
          prim.material ?? -1,
        );
      }
    }
    for (const child of node.children ?? []) visit(child, world, seen);
  };
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const scene = json.scenes?.[json.scene ?? 0];
  const roots =
    scene?.nodes ??
    // No scene: every node nobody has as a child.
    (json.nodes ?? [])
      .map((_, i) => i)
      .filter((i) => !(json.nodes ?? []).some((n) => n.children?.includes(i)));
  const seen = new Set<number>();
  for (const r of roots) visit(r, identity, seen);
  return b.finish(materialList, images, 'y');
}
