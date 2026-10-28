import { keyAt } from '../core/animation';
import { blue, green, red } from '../core/color';
import { CHUNK_SIZE, CHUNK_VOLUME, keyX, keyY, keyZ } from '../core/coords';
import type { VoxelDocument } from '../core/document';
import type { Palette } from '../core/palette';
import type { SceneNode, Transform, VoxelObject } from '../core/scene';
import { composeTransform, invertTransform, isIdentityTransform } from '../core/transform';
import type { VoxelVolume } from '../core/volume';
import { VOX_VERSION, type VoxChunk, type VoxDict, writeVoxFile } from '../formats/vox-chunks';
import {
  cellToVox,
  formatRotation,
  formatTranslation,
  frameTransform,
  modelPivot,
  transformToVox,
  type Vec3i,
} from './vox-axes';
import { writeCameras } from './vox-cameras';
import {
  dictCopy,
  type GroupChunk,
  type ShapeChunk,
  type TransformChunk,
  type VoxDocumentExtras,
  type VoxModel,
  type VoxNodeExtras,
  voxDocumentExtras,
  voxModelSources,
  voxNodeExtras,
} from './vox-extras';
import { layerIdFor, writeLayers } from './vox-layers';
import { writeNotes } from './vox-notes';
import { PROGRAM_KEY, writeProgram } from './vox-program';
import { orderFromImap, shownFrame } from './vox-read';

/** Largest model side MagicaVoxel accepts. */
export const VOX_MAX_SIZE = 256;

/** Writes a document as a .vox file (version 150, like MagicaVoxel). */
export function writeVox(doc: VoxelDocument): Uint8Array {
  return new VoxWriter(doc).write();
}

/** Ids above 255 do not fit a .vox palette: they take the nearest colour among 1…255. */
function idRemap(palette: Palette): (id: number) => number {
  if (palette.size <= 255) return (id) => id;
  const cache = new Map<number, number>();
  return (id) => {
    if (id <= 255) return id;
    let best = cache.get(id);
    if (best !== undefined) return best;
    const c = palette.color(id);
    let bestDistance = Number.POSITIVE_INFINITY;
    best = 1;
    for (let k = 1; k <= 255; k++) {
      const o = palette.color(k);
      const d = (red(o) - red(c)) ** 2 + (green(o) - green(c)) ** 2 + (blue(o) - blue(c)) ** 2;
      if (d < bestDistance) {
        bestDistance = d;
        best = k;
      }
    }
    cache.set(id, best);
    return best;
  };
}

interface PlacedModel {
  index: number;
  origin: Vec3i;
  size: Vec3i;
}

class VoxWriter {
  private readonly extras: VoxDocumentExtras | undefined;
  private readonly models: VoxModel[] = [];
  /** Models of volumes unchanged since reading, by their model id in the source file. */
  private readonly reused = new Map<number, PlacedModel>();
  private readonly byVolume = new Map<VoxelVolume, PlacedModel[]>();
  private readonly graph: VoxChunk[] = [];
  private nextId = 0;
  private readonly remap: (id: number) => number;

  constructor(private readonly doc: VoxelDocument) {
    this.extras = voxDocumentExtras.get(doc);
    this.remap = idRemap(doc.palette);
  }

  write(): Uint8Array {
    this.writeGraph();
    const chunks: VoxChunk[] = [];
    for (const m of this.models) {
      chunks.push({ id: 'SIZE', x: m.size[0], y: m.size[1], z: m.size[2] });
      chunks.push({ id: 'XYZI', voxels: m.voxels });
    }
    chunks.push(...this.graph);
    const kept = writeNotes(this.doc, writeCameras(this.doc, this.extras?.kept ?? []));
    chunks.push(...writeLayers(this.doc));
    // A damaged LAYR that could not be read stays where it was kept.
    chunks.push(...kept.filter((c) => c.id === 'LAYR'));
    chunks.push(...this.paletteChunks());
    chunks.push(...kept.filter((c) => c.id !== 'LAYR'));
    return writeVoxFile({ version: VOX_VERSION, chunks });
  }

  // --- Palette ---

  private paletteChunks(): VoxChunk[] {
    const palette = this.doc.palette;
    const colors = new Uint32Array(256);
    for (let id = 1; id <= 255; id++) colors[id - 1] = palette.has(id) ? palette.color(id) : 0;
    colors[255] = this.extras?.index0Color ?? 0;
    const out: VoxChunk[] = [{ id: 'RGBA', colors }];
    const imap = this.imap();
    if (imap) out.push({ id: 'IMAP', map: imap });
    for (let id = 1; id <= Math.min(255, palette.size); id++) {
      const material = palette.entry(id).material;
      if (material.size > 0) out.push({ id: 'MATL', materialId: id, props: new Map(material) });
    }
    out.push(...(this.extras?.otherMaterials ?? []));
    return out;
  }

  /** IMAP when the panel order is not plain 1…255, or the file had one. */
  private imap(): Uint8Array | null {
    const order = this.doc.palette.displayOrder().filter((id) => id <= 255);
    const old = this.extras?.imap ?? null;
    if (old) {
      const before = orderFromImap(old);
      if (before.length === order.length && before.every((id, i) => id === order[i])) return old;
    } else if (order.every((id, i) => id === i + 1)) {
      return null;
    }
    // Index 0 keeps its old slot, the last one by default.
    const zeroSlot = old ? Math.max(0, old.indexOf(0)) : 255;
    const map = new Uint8Array(256);
    let k = 0;
    for (let slot = 0; slot < 256; slot++) map[slot] = slot === zeroSlot ? 0 : (order[k++] ?? 0);
    return map;
  }

  // --- Scene graph ---

  private writeGraph(): void {
    const root = this.doc.scene.root;
    const extras = this.extras;
    const rootTrnId = this.nextId++;
    const rootGrpId = this.nextId++;
    const rootTrn: TransformChunk = {
      id: 'nTRN',
      nodeId: rootTrnId,
      attrs: dictCopy(extras?.rootTransform?.attrs),
      childId: rootGrpId,
      reservedId: extras?.rootTransform?.reservedId ?? -1,
      layerId: extras?.rootTransform?.layerId ?? -1,
      frames: extras?.rootTransform?.frames.map((f) => dictCopy(f)) ?? [new Map()],
    };
    const rootGroup: GroupChunk = {
      id: 'nGRP',
      nodeId: rootGrpId,
      attrs: dictCopy(extras?.rootGroup?.attrs),
      children: [],
    };
    this.graph.push(rootTrn, rootGroup);
    // A root transform from the file was folded into the top nodes on reading: unfold it.
    const rootFrame = rootTrn.frames[shownFrame(rootTrn.frames)];
    const fold = rootFrame ? frameTransform(rootFrame) : null;
    const unfold = fold && !isIdentityTransform(fold) ? invertTransform(fold) : null;
    const toLocal = (t: Transform) => (unfold ? composeTransform(unfold, t) : t);
    for (const child of root.children) rootGroup.children.push(this.writeNode(child, toLocal));
  }

  /** Writes a node with its subtree; returns the id of its transform node. */
  private writeNode(node: SceneNode, toLocal: (t: Transform) => Transform = (t) => t): number {
    const extras = voxNodeExtras.get(node);
    const local = toLocal(node.transform);
    if (node.kind === 'group') {
      const trnId = this.nextId++;
      const grpId = this.nextId++;
      const { rotation, t } = transformToVox(local);
      const keyed = node.keys?.transforms.size
        ? new Map([...node.keys.transforms].map(([f, k]) => [f, transformToVox(toLocal(k))]))
        : null;
      this.graph.push(this.transformChunk(trnId, grpId, node, extras, rotation, t, -1, keyed));
      const group: GroupChunk = {
        id: 'nGRP',
        nodeId: grpId,
        attrs: dictCopy(extras?.group?.attrs),
        children: [],
      };
      this.graph.push(group);
      for (const child of node.children) group.children.push(this.writeNode(child));
      return trnId;
    }
    return this.writeObject(node, toLocal, extras);
  }

  private writeObject(
    object: VoxelObject,
    toLocal: (t: Transform) => Transform,
    extras: VoxNodeExtras | undefined,
  ): number {
    const local = toLocal(object.transform);
    const animated = this.writeAnimated(object, toLocal, extras);
    if (animated !== null) return animated;
    const pieces = this.placeModels(object.volume);
    if (pieces.length === 1) {
      const piece = pieces[0]!;
      const trnId = this.nextId++;
      const shpId = this.nextId++;
      const { rotation, t } = transformToVox(local, {
        origin: piece.origin,
        pivot: modelPivot(piece.size),
      });
      this.graph.push(this.transformChunk(trnId, shpId, object, extras, rotation, t, 0));
      this.graph.push(this.shapeChunk(shpId, piece.index, extras));
      return trnId;
    }
    // Bigger than a .vox model: a group of pieces at their places, nothing lost.
    const trnId = this.nextId++;
    const grpId = this.nextId++;
    const { rotation, t } = transformToVox(local);
    this.graph.push(this.transformChunk(trnId, grpId, object, extras, rotation, t, 0));
    const group: GroupChunk = { id: 'nGRP', nodeId: grpId, attrs: new Map(), children: [] };
    this.graph.push(group);
    for (const piece of pieces) {
      const pieceTrn = this.nextId++;
      const pieceShp = this.nextId++;
      const placed = transformToVox(
        { x: 0, y: 0, z: 0, orientation: 0 },
        { origin: piece.origin, pivot: modelPivot(piece.size) },
      );
      this.graph.push({
        id: 'nTRN',
        nodeId: pieceTrn,
        attrs: new Map(),
        childId: pieceShp,
        reservedId: -1,
        layerId: 0,
        frames: [new Map([['_t', formatTranslation(placed.t)]])],
      });
      this.graph.push({
        id: 'nSHP',
        nodeId: pieceShp,
        attrs: new Map(),
        models: [{ modelId: piece.index, attrs: new Map() }],
      });
      group.children.push(pieceTrn);
    }
    return trnId;
  }

  private transformChunk(
    nodeId: number,
    childId: number,
    node: SceneNode,
    extras: VoxNodeExtras | undefined,
    rotation: number,
    t: Vec3i,
    layer: number,
    keyed: Map<number, { rotation: number; t: Vec3i }> | null = null,
  ): TransformChunk {
    const attrs = dictCopy(extras?.transform.attrs);
    if (extras?.madeUpName !== node.name) attrs.set('_name', node.name);
    if (node.hidden) attrs.set('_hidden', '1');
    else if (attrs.has('_hidden')) attrs.set('_hidden', '0');
    // A program object keeps its program; MagicaVoxel keeps the voxels and ignores the key.
    if (node.kind === 'object' && node.program)
      attrs.set(PROGRAM_KEY, writeProgram(node, node.program));
    else attrs.delete(PROGRAM_KEY);
    let frames: VoxDict[];
    if (keyed && keyed.size > 0) {
      // Animated: a frame per placement key, keeping what else the file had on that frame.
      const old = new Map((extras?.transform.frames ?? []).map((f) => [frameOfDict(f), f]));
      frames = [...keyed.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([f, v]) => {
          const frame = dictCopy(old.get(f));
          if (f !== 0 || frame.has('_f')) frame.set('_f', String(f));
          setOrDrop(frame, '_r', formatRotation(v.rotation), v.rotation === 0);
          setOrDrop(
            frame,
            '_t',
            formatTranslation(v.t),
            v.t[0] === 0 && v.t[1] === 0 && v.t[2] === 0,
          );
          return frame;
        });
    } else {
      frames = extras ? extras.transform.frames.map((f) => dictCopy(f)) : [new Map()];
      const frame = frames[extras?.frame ?? 0] ?? new Map<string, string>();
      setOrDrop(frame, '_r', formatRotation(rotation), rotation === 0);
      setOrDrop(frame, '_t', formatTranslation(t), t[0] === 0 && t[1] === 0 && t[2] === 0);
      if (frames.length === 0) frames.push(frame);
    }
    return {
      id: 'nTRN',
      nodeId,
      attrs,
      childId,
      reservedId: extras?.transform.reservedId ?? -1,
      layerId: node.layer
        ? layerIdFor(this.doc, node, extras?.transform)
        : (extras?.transform.layerId ?? layer),
      frames,
    };
  }

  /**
   * An object with animation keys: a model per model key, all centred on the first one's centre,
   * and a placement frame per placement key. Null when it cannot be written that way (no keys,
   * or a frame bigger than a .vox model): then it is written as it is now.
   */
  private writeAnimated(
    object: VoxelObject,
    toLocal: (t: Transform) => Transform,
    extras: VoxNodeExtras | undefined,
  ): number | null {
    const keys = object.keys;
    if (!keys || (keys.volumes.size === 0 && keys.transforms.size === 0)) return null;
    const anchorVolume = keyAt(keys.volumes, 0) ?? object.volume;
    const anchor = this.placeModels(anchorVolume);
    if (anchor.length !== 1) return null;
    const piece = anchor[0]!;
    const pivot = modelPivot(piece.size);
    const centre = [0, 1, 2].map((a) => piece.origin[a]! + pivot[a]!) as Vec3i;
    const models: { frame: number; index: number }[] = [];
    for (const [f, v] of [...keys.volumes].sort((a, b) => a[0] - b[0])) {
      const placed = v === anchorVolume ? piece : this.placeCentred(v, centre);
      if (!placed) return null;
      models.push({ frame: f, index: placed.index });
    }
    const shape = { origin: piece.origin, pivot };
    const keyed = keys.transforms.size
      ? new Map([...keys.transforms].map(([f, k]) => [f, transformToVox(toLocal(k), shape)]))
      : null;
    const still = transformToVox(toLocal(keyAt(keys.transforms, 0) ?? object.transform), shape);
    const trnId = this.nextId++;
    const shpId = this.nextId++;
    this.graph.push(
      this.transformChunk(trnId, shpId, object, extras, still.rotation, still.t, 0, keyed),
    );
    if (models.length === 0) {
      this.graph.push(this.shapeChunk(shpId, piece.index, extras));
      return trnId;
    }
    const old = new Map((extras?.shape?.models ?? []).map((m) => [frameOfDict(m.attrs), m.attrs]));
    this.graph.push({
      id: 'nSHP',
      nodeId: shpId,
      attrs: dictCopy(extras?.shape?.attrs),
      models: models.map(({ frame, index }) => {
        const attrs = dictCopy(old.get(frame));
        if (frame !== 0 || attrs.has('_f')) attrs.set('_f', String(frame));
        return { modelId: index, attrs };
      }),
    });
    return trnId;
  }

  private shapeChunk(
    nodeId: number,
    modelIndex: number,
    extras: VoxNodeExtras | undefined,
  ): ShapeChunk {
    const shape = extras?.shape;
    if (!shape)
      return {
        id: 'nSHP',
        nodeId,
        attrs: new Map(),
        models: [{ modelId: modelIndex, attrs: new Map() }],
      };
    // One model (animated shapes go through writeAnimated): keep its attributes.
    const shown = shownFrame(shape.models.map((m) => m.attrs));
    const attrs = dictCopy(shape.models[shown]?.attrs);
    return {
      id: 'nSHP',
      nodeId,
      attrs: dictCopy(shape.attrs),
      models: [{ modelId: modelIndex, attrs }],
    };
  }

  // --- Models ---

  private addModel(model: VoxModel): number {
    this.models.push(model);
    return this.models.length - 1;
  }

  /**
   * The model (or, past 256 a side, the pieces) holding an object's voxels, in file axes. An
   * untouched volume keeps its model box and is written once however many objects share it.
   */
  private placeModels(volume: VoxelVolume): PlacedModel[] {
    // Linked copies share one volume: one model for all of them.
    const placedVolume = this.byVolume.get(volume);
    if (placedVolume) return placedVolume;
    const pieces = this.placeVolume(volume);
    this.byVolume.set(volume, pieces);
    return pieces;
  }

  /**
   * A frame's model of an animation, its box centred on the shared centre `c` (file axes) so one
   * placement serves every frame; an untouched model whose centre is there stays as it was.
   */
  private placeCentred(volume: VoxelVolume, c: Vec3i): PlacedModel | null {
    const source = voxModelSources.get(volume);
    if (source && source.revision === volume.revision) {
      const centre = [0, 1, 2].map((a) => source.origin[a]! + Math.floor(source.size[a]! / 2));
      if (centre.every((v, a) => v === c[a])) return this.placeModels(volume)[0] ?? null;
    }
    const bounds = this.fileBounds(volume);
    const half = [0, 1, 2].map((a) =>
      bounds ? Math.max(1, c[a]! - bounds.min[a]!, bounds.max[a]! - c[a]! + 1) : 1,
    );
    const size = half.map((h) => Math.min(VOX_MAX_SIZE, 2 * h)) as Vec3i;
    const origin = [0, 1, 2].map((a) => c[a]! - Math.floor(size[a]! / 2)) as Vec3i;
    return {
      index: this.addModel({ size, voxels: this.voxelBytes(volume, origin, size) }),
      origin,
      size,
    };
  }

  private placeVolume(volume: VoxelVolume): PlacedModel[] {
    const source = voxModelSources.get(volume);
    const untouched = source && source.revision === volume.revision;
    if (untouched) {
      const known = this.reused.get(source.modelId);
      if (known) return [known];
    }
    const bounds = this.fileBounds(volume);
    let origin: Vec3i;
    let size: Vec3i;
    if (!bounds) {
      origin = source?.origin ?? [0, 0, 0];
      size = source?.size ?? [1, 1, 1];
    } else if (source && fits(bounds, source.origin, source.size)) {
      origin = source.origin;
      size = source.size;
    } else {
      origin = bounds.min;
      size = [0, 1, 2].map((i) => bounds.max[i]! - bounds.min[i]! + 1) as Vec3i;
    }
    if (size.every((s) => s <= VOX_MAX_SIZE)) {
      const placed = {
        index: this.addModel({ size, voxels: this.voxelBytes(volume, origin, size) }),
        origin,
        size,
      };
      if (untouched) this.reused.set(source.modelId, placed);
      return [placed];
    }
    const pieces: PlacedModel[] = [];
    for (let x = origin[0]; x < origin[0] + size[0]; x += VOX_MAX_SIZE)
      for (let y = origin[1]; y < origin[1] + size[1]; y += VOX_MAX_SIZE)
        for (let z = origin[2]; z < origin[2] + size[2]; z += VOX_MAX_SIZE) {
          const o: Vec3i = [x, y, z];
          const s = [0, 1, 2].map((i) =>
            Math.min(VOX_MAX_SIZE, origin[i]! + size[i]! - o[i]!),
          ) as Vec3i;
          const voxels = this.voxelBytes(volume, o, s);
          if (voxels.length === 0) continue;
          pieces.push({ index: this.addModel({ size: s, voxels }), origin: o, size: s });
        }
    return pieces;
  }

  /** A volume's voxel bounds in file axes. */
  private fileBounds(volume: VoxelVolume): { min: Vec3i; max: Vec3i } | null {
    const b = volume.getBounds();
    if (!b) return null;
    const p = cellToVox(b.minX, b.minY, b.minZ);
    const q = cellToVox(b.maxX, b.maxY, b.maxZ);
    return {
      min: [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.min(p[2], q[2])],
      max: [Math.max(p[0], q[0]), Math.max(p[1], q[1]), Math.max(p[2], q[2])],
    };
  }

  /** XYZI bytes of the voxels inside a model box (file axes). */
  private voxelBytes(volume: VoxelVolume, origin: Vec3i, size: Vec3i): Uint8Array {
    const out = new Uint8Array(volume.voxelCount * 4);
    let n = 0;
    const dense = new Uint16Array(CHUNK_VOLUME);
    for (const [key, chunk] of volume.chunks()) {
      chunk.decodeInto(dense);
      const ox = keyX(key) * CHUNK_SIZE;
      const oy = keyY(key) * CHUNK_SIZE;
      const oz = keyZ(key) * CHUNK_SIZE;
      for (let i = 0; i < CHUNK_VOLUME; i++) {
        const id = dense[i]!;
        if (id === 0) continue;
        const [fx, fy, fz] = cellToVox(ox + (i & 31), oy + ((i >> 5) & 31), oz + (i >> 10));
        const x = fx - origin[0];
        const y = fy - origin[1];
        const z = fz - origin[2];
        if (x < 0 || y < 0 || z < 0 || x >= size[0] || y >= size[1] || z >= size[2]) continue;
        out[n++] = x;
        out[n++] = y;
        out[n++] = z;
        out[n++] = this.remap(id);
      }
    }
    return out.slice(0, n);
  }
}

function fits(bounds: { min: Vec3i; max: Vec3i }, origin: Vec3i, size: Vec3i): boolean {
  return [0, 1, 2].every(
    (i) => bounds.min[i]! >= origin[i]! && bounds.max[i]! < origin[i]! + size[i]!,
  );
}

/** The frame number of a frame dictionary (`_f`, 0 when missing). */
function frameOfDict(dict: VoxDict): number {
  const f = Number.parseInt(dict.get('_f') ?? '0', 10);
  return Number.isFinite(f) ? f : 0;
}

/** Sets a frame value, or leaves it out when it is the default and the file had none. */
function setOrDrop(frame: VoxDict, key: string, value: string, isDefault: boolean): void {
  if (isDefault && !frame.has(key)) return;
  frame.set(key, value);
}
