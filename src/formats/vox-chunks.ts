import { ByteReader, ByteWriter, FormatError } from './binary';

/**
 * The .vox chunk layer: bytes ⇄ typed chunks, with nothing interpreted yet (axes, palette
 * shift, scene graph come later, in vox-read / vox-write). Every chunk the editor knows is
 * decoded into its fields; any other chunk — and any known chunk with bytes left over — is kept
 * as raw bytes and written back unchanged. See docs/formats.md, ".vox".
 */

/** Key-value strings of a .vox DICT, in file order. */
export type VoxDict = Map<string, string>;

export type VoxChunk =
  | { id: 'PACK'; models: number }
  | { id: 'SIZE'; x: number; y: number; z: number }
  /** Voxels as stored: four bytes x, y, z, colour index each. */
  | { id: 'XYZI'; voxels: Uint8Array }
  /** 256 packed colours in file order (entry k is voxel index k + 1, entry 255 is index 0). */
  | { id: 'RGBA'; colors: Uint32Array }
  | { id: 'MATL'; materialId: number; props: VoxDict }
  | {
      id: 'nTRN';
      nodeId: number;
      attrs: VoxDict;
      childId: number;
      reservedId: number;
      layerId: number;
      frames: VoxDict[];
    }
  | { id: 'nGRP'; nodeId: number; attrs: VoxDict; children: number[] }
  | { id: 'nSHP'; nodeId: number; attrs: VoxDict; models: { modelId: number; attrs: VoxDict }[] }
  | { id: 'LAYR'; layerId: number; attrs: VoxDict; reservedId: number }
  | { id: 'rOBJ'; attrs: VoxDict }
  | { id: 'rCAM'; cameraId: number; attrs: VoxDict }
  | { id: 'NOTE'; names: string[] }
  /** Display slot → voxel index; 256 bytes. */
  | { id: 'IMAP'; map: Uint8Array }
  | RawChunk;

/** A chunk kept as bytes: unknown ids (MATT, META, future ones) and anything malformed. */
export interface RawChunk {
  id: string;
  raw: true;
  content: Uint8Array;
  children: Uint8Array;
}

export interface VoxFile {
  version: number;
  /** Children of MAIN, in file order. */
  chunks: VoxChunk[];
  /** MAIN's own content; empty in every known file, kept anyway. */
  mainContent?: Uint8Array;
}

/** Versions MagicaVoxel writes: 150 (also in new files, for old readers) and 200. */
export const VOX_VERSION = 150;

function readDict(r: ByteReader): VoxDict {
  const n = r.i32();
  if (n < 0 || n > r.remaining / 8) throw new FormatError(`Bad DICT size ${n}`);
  const dict: VoxDict = new Map();
  for (let i = 0; i < n; i++) {
    const key = r.string();
    dict.set(key, r.string());
  }
  return dict;
}

function writeDict(w: ByteWriter, dict: VoxDict): void {
  w.i32(dict.size);
  for (const [k, v] of dict) {
    w.string(k);
    w.string(v);
  }
}

/** Decodes the content of a known chunk; throws when it does not fit the expected layout. */
function decode(id: string, r: ByteReader): VoxChunk | null {
  switch (id) {
    case 'PACK':
      return { id, models: r.i32() };
    case 'SIZE':
      return { id, x: r.i32(), y: r.i32(), z: r.i32() };
    case 'XYZI': {
      const n = r.i32();
      if (n < 0 || n * 4 > r.remaining) throw new FormatError(`Bad voxel count ${n}`);
      return { id, voxels: r.take(n * 4).slice() };
    }
    case 'RGBA': {
      const colors = new Uint32Array(256);
      for (let i = 0; i < 256; i++) colors[i] = r.u32();
      return { id, colors };
    }
    case 'MATL':
      return { id, materialId: r.i32(), props: readDict(r) };
    case 'nTRN': {
      const nodeId = r.i32();
      const attrs = readDict(r);
      const childId = r.i32();
      const reservedId = r.i32();
      const layerId = r.i32();
      const count = r.i32();
      if (count < 0 || count > r.remaining / 4) throw new FormatError(`Bad frame count ${count}`);
      const frames: VoxDict[] = [];
      for (let i = 0; i < count; i++) frames.push(readDict(r));
      return { id, nodeId, attrs, childId, reservedId, layerId, frames };
    }
    case 'nGRP': {
      const nodeId = r.i32();
      const attrs = readDict(r);
      const count = r.i32();
      if (count < 0 || count > r.remaining / 4) throw new FormatError(`Bad child count ${count}`);
      const children: number[] = [];
      for (let i = 0; i < count; i++) children.push(r.i32());
      return { id, nodeId, attrs, children };
    }
    case 'nSHP': {
      const nodeId = r.i32();
      const attrs = readDict(r);
      const count = r.i32();
      if (count < 0 || count > r.remaining / 8) throw new FormatError(`Bad model count ${count}`);
      const models: { modelId: number; attrs: VoxDict }[] = [];
      for (let i = 0; i < count; i++) models.push({ modelId: r.i32(), attrs: readDict(r) });
      return { id, nodeId, attrs, models };
    }
    case 'LAYR':
      return { id, layerId: r.i32(), attrs: readDict(r), reservedId: r.i32() };
    case 'rOBJ':
      return { id, attrs: readDict(r) };
    case 'rCAM':
      return { id, cameraId: r.i32(), attrs: readDict(r) };
    case 'NOTE': {
      const n = r.i32();
      if (n < 0 || n > r.remaining / 4) throw new FormatError(`Bad note count ${n}`);
      const names: string[] = [];
      for (let i = 0; i < n; i++) names.push(r.string());
      return { id, names };
    }
    case 'IMAP':
      return { id, map: r.take(256).slice() };
    default:
      return null;
  }
}

function encode(chunk: Exclude<VoxChunk, RawChunk>, w: ByteWriter): void {
  switch (chunk.id) {
    case 'PACK':
      w.i32(chunk.models);
      return;
    case 'SIZE':
      w.i32(chunk.x);
      w.i32(chunk.y);
      w.i32(chunk.z);
      return;
    case 'XYZI':
      w.i32(chunk.voxels.length / 4);
      w.bytes(chunk.voxels);
      return;
    case 'RGBA':
      for (const c of chunk.colors) w.u32(c);
      return;
    case 'MATL':
      w.i32(chunk.materialId);
      writeDict(w, chunk.props);
      return;
    case 'nTRN':
      w.i32(chunk.nodeId);
      writeDict(w, chunk.attrs);
      w.i32(chunk.childId);
      w.i32(chunk.reservedId);
      w.i32(chunk.layerId);
      w.i32(chunk.frames.length);
      for (const f of chunk.frames) writeDict(w, f);
      return;
    case 'nGRP':
      w.i32(chunk.nodeId);
      writeDict(w, chunk.attrs);
      w.i32(chunk.children.length);
      for (const c of chunk.children) w.i32(c);
      return;
    case 'nSHP':
      w.i32(chunk.nodeId);
      writeDict(w, chunk.attrs);
      w.i32(chunk.models.length);
      for (const m of chunk.models) {
        w.i32(m.modelId);
        writeDict(w, m.attrs);
      }
      return;
    case 'LAYR':
      w.i32(chunk.layerId);
      writeDict(w, chunk.attrs);
      w.i32(chunk.reservedId);
      return;
    case 'rOBJ':
      writeDict(w, chunk.attrs);
      return;
    case 'rCAM':
      w.i32(chunk.cameraId);
      writeDict(w, chunk.attrs);
      return;
    case 'NOTE':
      w.i32(chunk.names.length);
      for (const n of chunk.names) w.string(n);
      return;
    case 'IMAP':
      w.bytes(chunk.map);
      return;
  }
}

function isRaw(chunk: VoxChunk): chunk is RawChunk {
  return 'raw' in chunk;
}

/** Splits .vox bytes into the version and the chunks inside MAIN. */
export function parseVoxFile(bytes: Uint8Array): VoxFile {
  const r = new ByteReader(bytes);
  if (bytes.length < 8 || r.tag() !== 'VOX ') throw new FormatError('Not a .vox file');
  const version = r.i32();
  if (r.tag() !== 'MAIN') throw new FormatError('No MAIN chunk');
  const mainSize = r.i32();
  r.i32(); // Size of MAIN's children: some writers get it wrong, so read to the end instead.
  const mainContent = r.take(mainSize);
  const chunks: VoxChunk[] = [];
  while (r.remaining >= 12) {
    const id = r.tag();
    const n = r.i32();
    const m = r.i32();
    if (n < 0 || m < 0 || r.offset + n + m > bytes.length) {
      throw new FormatError(`Chunk ${id} runs past the end of the file`);
    }
    const content = r.take(n);
    const children = r.take(m);
    chunks.push(decodeChunk(id, content, children));
  }
  return { version, chunks, mainContent: mainContent.length > 0 ? mainContent.slice() : undefined };
}

/**
 * A typed chunk, or the raw bytes when the id is unknown, the chunk has children, or its content
 * does not match the layout exactly: such a chunk round-trips byte for byte.
 */
export function decodeChunk(id: string, content: Uint8Array, children: Uint8Array): VoxChunk {
  const raw: RawChunk = { id, raw: true, content: content.slice(), children: children.slice() };
  if (children.length > 0) return raw;
  try {
    const r = new ByteReader(content);
    const chunk = decode(id, r);
    if (!chunk || r.remaining !== 0) return raw;
    return chunk;
  } catch (e) {
    if (e instanceof FormatError) return raw;
    throw e;
  }
}

/** Bytes of one chunk's content. */
export function encodeChunk(chunk: VoxChunk): Uint8Array {
  if (isRaw(chunk)) return chunk.content;
  const w = new ByteWriter();
  encode(chunk, w);
  return w.finish();
}

export function writeVoxFile(file: VoxFile): Uint8Array {
  const w = new ByteWriter();
  w.tag('VOX ');
  w.i32(file.version);
  w.tag('MAIN');
  const main = file.mainContent ?? new Uint8Array(0);
  w.i32(main.length);
  const childrenAt = w.length;
  w.i32(0);
  w.bytes(main);
  const start = w.length;
  for (const chunk of file.chunks) {
    const content = encodeChunk(chunk);
    const children = isRaw(chunk) ? chunk.children : new Uint8Array(0);
    w.tag(chunk.id);
    w.i32(content.length);
    w.i32(children.length);
    w.bytes(content);
    w.bytes(children);
  }
  w.patchI32(childrenAt, w.length - start);
  return w.finish();
}
