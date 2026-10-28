import { Chunk } from '../core/chunk';
import { CHUNK_BITS, CHUNK_MASK, CHUNK_VOLUME, chunkKey } from '../core/coords';
import { MAGICAVOXEL_DEFAULT_PALETTE } from '../core/default-palette';
import { VoxelDocument } from '../core/document';
import { EMPTY_MATERIAL, Palette, type PaletteEntry } from '../core/palette';
import {
  type GroupNode,
  Scene,
  type SceneNode,
  type Transform,
  type VoxelObject,
} from '../core/scene';
import { composeTransform, isIdentityTransform } from '../core/transform';
import { VoxelVolume } from '../core/volume';
import { FormatError } from '../formats/binary';
import { parseVoxFile, type VoxChunk, type VoxDict } from '../formats/vox-chunks';
import {
  cellFromVox,
  frameTransform,
  modelPivot,
  parseRotation,
  parseTranslation,
  transformFromVox,
  type Vec3i,
} from './vox-axes';
import { readCameras } from './vox-cameras';
import {
  type GroupChunk,
  type ShapeChunk,
  type TransformChunk,
  type VoxDocumentExtras,
  type VoxModel,
  voxDocumentExtras,
  voxModelSources,
  voxNodeExtras,
} from './vox-extras';
import { layerForId, readLayers } from './vox-layers';
import { readNotes } from './vox-notes';
import { PROGRAM_KEY, placeProgram, readProgram } from './vox-program';

type GraphChunk = TransformChunk | GroupChunk | ShapeChunk;

/** The frame a node shows: frame 0 (no `_f` counts as 0), else the first one. */
export function shownFrame(frames: readonly VoxDict[]): number {
  const i = frames.findIndex((f) => Number.parseInt(f.get('_f') ?? '0', 10) === 0);
  return Math.max(i, 0);
}

/** The frame number of a frame or model dictionary (`_f`, 0 when missing). */
export function frameOf(dict: VoxDict): number {
  const f = Number.parseInt(dict.get('_f') ?? '0', 10);
  return Number.isFinite(f) ? f : 0;
}

/**
 * A model's voxels as an editor volume, built chunk by chunk through dense buffers; `offset`
 * moves them in file axes (frames of an animation share one centre).
 */
function volumeOf(model: VoxModel, offset: Vec3i = [0, 0, 0]): VoxelVolume {
  const dense = new Map<number, Uint16Array>();
  const v = model.voxels;
  for (let i = 0; i + 3 < v.length; i += 4) {
    const id = v[i + 3]!;
    if (id === 0) continue;
    const [x, y, z] = cellFromVox(v[i]! + offset[0], v[i + 1]! + offset[1], v[i + 2]! + offset[2]);
    const key = chunkKey(x >> CHUNK_BITS, y >> CHUNK_BITS, z >> CHUNK_BITS);
    let block = dense.get(key);
    if (!block) {
      block = new Uint16Array(CHUNK_VOLUME);
      dense.set(key, block);
    }
    block[
      (x & CHUNK_MASK) | ((y & CHUNK_MASK) << CHUNK_BITS) | ((z & CHUNK_MASK) << (2 * CHUNK_BITS))
    ] = id;
  }
  const volume = new VoxelVolume();
  for (const [key, block] of dense) volume.putChunk(key, Chunk.fromDense(block));
  volume.takeMeshDirty();
  return volume;
}

/** The palette: RGBA entry k is voxel index k + 1; no RGBA means MagicaVoxel's default. */
function readPalette(chunks: readonly VoxChunk[], extras: VoxDocumentExtras): Palette {
  const rgba = chunks.find(
    (c): c is Extract<VoxChunk, { id: 'RGBA' }> => c.id === 'RGBA' && !('raw' in c),
  );
  const colors: number[] = [];
  for (let id = 1; id <= 255; id++) {
    colors.push(rgba ? rgba.colors[id - 1]! : MAGICAVOXEL_DEFAULT_PALETTE[id]!);
  }
  extras.index0Color = rgba ? rgba.colors[255]! : 0;
  const materials = new Map<number, VoxDict>();
  for (const c of chunks) {
    if (c.id !== 'MATL' || 'raw' in c) continue;
    // Material ids are voxel indices; 0 and 256 both stand for index 0, which has no entry.
    if (c.materialId >= 1 && c.materialId <= 255) materials.set(c.materialId, c.props);
    else extras.otherMaterials.push(c);
  }
  const entries: PaletteEntry[] = colors.map((color, i) => ({
    color,
    material: materials.get(i + 1) ?? EMPTY_MATERIAL,
    name: materials.get(i + 1)?.get('_name') ?? '',
  }));
  const imap = chunks.find(
    (c): c is Extract<VoxChunk, { id: 'IMAP' }> => c.id === 'IMAP' && !('raw' in c),
  );
  extras.imap = imap ? imap.map : null;
  return new Palette(entries, imap ? orderFromImap(imap.map) : undefined);
}

/**
 * The panel order from IMAP: slot s shows voxel index map[s] (display → index, not the other
 * way round). Index 0 and repeats are skipped; indices the map forgot go at the end.
 */
export function orderFromImap(map: Uint8Array): number[] {
  const seen = new Set<number>();
  const order: number[] = [];
  for (const index of map) {
    if (index === 0 || seen.has(index)) continue;
    seen.add(index);
    order.push(index);
  }
  for (let id = 1; id <= 255; id++) if (!seen.has(id)) order.push(id);
  return order;
}

/** Reads a .vox file into a new document. Throws FormatError when it is not one. */
export function readVox(bytes: Uint8Array): VoxelDocument {
  const file = parseVoxFile(bytes);
  const extras: VoxDocumentExtras = {
    index0Color: 0,
    otherMaterials: [],
    imap: null,
    rootTransform: null,
    rootGroup: null,
    kept: [],
  };

  const models: VoxModel[] = [];
  let size: Vec3i | null = null;
  const graph = new Map<number, GraphChunk>();
  for (const c of file.chunks) {
    if ('raw' in c) {
      // Pieces of the model data that did not decode: the model cannot be rebuilt.
      if (c.id === 'SIZE' || c.id === 'XYZI') throw new FormatError(`Damaged ${c.id} chunk`);
      if (c.id !== 'RGBA' && c.id !== 'MATL' && c.id !== 'IMAP') extras.kept.push(c);
      continue;
    }
    switch (c.id) {
      case 'SIZE':
        size = [c.x, c.y, c.z];
        break;
      case 'XYZI':
        models.push({ size: size ?? sizeOf(c.voxels), voxels: c.voxels });
        size = null;
        break;
      case 'nTRN':
      case 'nGRP':
      case 'nSHP':
        graph.set(c.nodeId, c);
        break;
      case 'PACK':
      case 'RGBA':
      case 'MATL':
      case 'IMAP':
        break;
      default:
        extras.kept.push(c);
    }
  }

  const palette = readPalette(file.chunks, extras);
  const doc = new VoxelDocument(new Scene(), palette);
  // Layers first: nodes look theirs up while the scene is built.
  readLayers(doc, extras.kept);
  readNotes(doc, extras.kept);
  const builder = new SceneBuilder(doc, models, graph, extras);
  builder.build();
  // Programs find their origin once every object sits in its group.
  for (const [object, at] of builder.programOrigins) placeProgram(object, at);
  readCameras(doc, extras.kept);
  voxDocumentExtras.set(doc, extras);
  return doc;
}

/** The size of a model given without SIZE: just big enough for its voxels. */
function sizeOf(voxels: Uint8Array): Vec3i {
  const s: Vec3i = [1, 1, 1];
  for (let i = 0; i + 3 < voxels.length; i += 4)
    for (let k = 0; k < 3; k++) s[k] = Math.max(s[k]!, voxels[i + k]! + 1);
  return s;
}

class SceneBuilder {
  /** The volume each model became, shared by every shape that shows it. */
  private readonly volumes = new Map<number, VoxelVolume>();
  private readonly visited = new Set<number>();
  private objects = 0;
  private groups = 0;
  /** Program objects and the world cell of their program's origin, placed after the build. */
  readonly programOrigins = new Map<VoxelObject, [number, number, number]>();

  constructor(
    private readonly doc: VoxelDocument,
    private readonly models: readonly VoxModel[],
    private readonly graph: ReadonlyMap<number, GraphChunk>,
    private readonly extras: VoxDocumentExtras,
  ) {}

  build(): void {
    const scene = this.doc.scene;
    const root = this.rootTransform();
    if (!root) {
      // An old file without a scene graph: every model at the origin, centred like MagicaVoxel.
      this.models.forEach((model, i) => {
        const object = this.makeObject(model, i, { x: 0, y: 0, z: 0, orientation: 0 }, null);
        scene.attach(object, scene.root);
      });
      return;
    }
    this.extras.rootTransform = root;
    this.visited.add(root.nodeId);
    const frame = root.frames[shownFrame(root.frames)];
    const fold = frame ? frameTransform(frame) : null;
    const child = this.graph.get(root.childId);
    if (child?.id === 'nGRP') {
      this.extras.rootGroup = child;
      this.visited.add(child.nodeId);
      for (const id of child.children) this.visitTransform(id, scene.root, fold);
    } else {
      this.visitTransform(root.nodeId, scene.root, null, true);
    }
  }

  /** Node 0 by the spec; otherwise a transform node nobody points at. */
  private rootTransform(): TransformChunk | null {
    const zero = this.graph.get(0);
    if (zero?.id === 'nTRN') return zero;
    const pointed = new Set<number>();
    for (const c of this.graph.values()) {
      if (c.id === 'nTRN') pointed.add(c.childId);
      else if (c.id === 'nGRP') for (const id of c.children) pointed.add(id);
    }
    for (const c of this.graph.values()) if (c.id === 'nTRN' && !pointed.has(c.nodeId)) return c;
    return null;
  }

  private visitTransform(
    id: number,
    parent: GroupNode,
    fold: Transform | null,
    again = false,
  ): void {
    const trn = this.graph.get(id);
    if (trn?.id !== 'nTRN' || (!again && this.visited.has(id))) return;
    this.visited.add(id);
    const frameIndex = shownFrame(trn.frames);
    const frame = trn.frames[frameIndex];
    const rotation = parseRotation(frame?.get('_r'));
    const t = parseTranslation(frame?.get('_t'));
    const child = this.graph.get(trn.childId);
    if (!child || this.visited.has(child.nodeId)) return;
    this.visited.add(child.nodeId);
    const place = (local: Transform) =>
      fold && !isIdentityTransform(fold) ? composeTransform(fold, local) : local;
    let node: SceneNode;
    if (child.id === 'nGRP') {
      const madeUp = `Group ${++this.groups}`;
      const group = this.doc.scene.createGroup(trn.attrs.get('_name') ?? madeUp);
      group.transform = place(transformFromVox(rotation, t));
      if (trn.frames.length > 1) {
        const transforms = new Map<number, Transform>();
        for (const fr of trn.frames)
          transforms.set(
            frameOf(fr),
            place(transformFromVox(parseRotation(fr.get('_r')), parseTranslation(fr.get('_t')))),
          );
        group.keys = { transforms, volumes: new Map() };
      }
      node = group;
      voxNodeExtras.set(group, {
        transform: trn,
        frame: frameIndex,
        madeUpName: trn.attrs.has('_name') ? null : madeUp,
        group: child,
      });
      this.finish(node, trn, parent);
      for (const childId of child.children) this.visitTransform(childId, group, null);
      return;
    }
    if (child.id !== 'nSHP') return;
    const entry = shownFrame(child.models.map((m) => m.attrs));
    const modelId = child.models[entry]?.modelId ?? -1;
    const model = this.models[modelId];
    if (!model) return;
    const object = this.makeObject(model, modelId, { x: 0, y: 0, z: 0, orientation: 0 }, trn);
    const pivot = modelPivot(model.size);
    object.transform = place(transformFromVox(rotation, t, pivot));
    const extras = voxNodeExtras.get(object)!;
    extras.frame = frameIndex;
    extras.shape = child;
    if (trn.frames.length > 1 || child.models.length > 1) {
      // An animation: every frame's model shares the shown model's centre, so one placement
      // serves them all, as MagicaVoxel centres each frame's model on the same point.
      const volumes = new Map<number, VoxelVolume>();
      child.models.forEach((m, i) => {
        if (i === entry) {
          volumes.set(frameOf(m.attrs), object.volume);
          return;
        }
        const other = this.models[m.modelId];
        if (!other) return;
        const p = modelPivot(other.size);
        const offset: Vec3i = [pivot[0] - p[0], pivot[1] - p[1], pivot[2] - p[2]];
        const volume = volumeOf(other, offset);
        voxModelSources.set(volume, {
          modelId: m.modelId,
          revision: volume.revision,
          size: other.size,
          origin: offset,
        });
        volumes.set(frameOf(m.attrs), volume);
      });
      const transforms = new Map<number, Transform>();
      if (trn.frames.length > 1)
        for (const fr of trn.frames)
          transforms.set(
            frameOf(fr),
            place(
              transformFromVox(parseRotation(fr.get('_r')), parseTranslation(fr.get('_t')), pivot),
            ),
          );
      object.keys = { transforms, volumes: child.models.length > 1 ? volumes : new Map() };
    }
    this.finish(object, trn, parent);
  }

  private finish(node: SceneNode, trn: TransformChunk, parent: GroupNode): void {
    node.hidden = trn.attrs.get('_hidden') === '1';
    node.layer = layerForId(this.doc, trn.layerId);
    this.doc.scene.attach(node, parent);
  }

  private makeObject(
    model: VoxModel,
    modelId: number,
    transform: Transform,
    trn: TransformChunk | null,
  ): VoxelObject {
    // Shapes of one model share its voxels: linked copies, as in MagicaVoxel.
    let volume = this.volumes.get(modelId);
    if (!volume) {
      volume = volumeOf(model);
      this.volumes.set(modelId, volume);
    }
    const madeUp = `Object ${++this.objects}`;
    const object = this.doc.scene.createObject(trn?.attrs.get('_name') ?? madeUp, volume);
    object.transform =
      trn === null ? transformFromVox(0, [0, 0, 0], modelPivot(model.size)) : transform;
    const read = readProgram(trn?.attrs.get(PROGRAM_KEY));
    if (read) {
      object.program = read.program;
      if (read.at) this.programOrigins.set(object, read.at);
    }
    voxModelSources.set(volume, {
      modelId,
      revision: volume.revision,
      size: model.size,
      origin: [0, 0, 0],
    });
    if (trn) {
      voxNodeExtras.set(object, {
        transform: trn,
        frame: 0,
        madeUpName: trn.attrs.has('_name') ? null : madeUp,
      });
    }
    return object;
  }
}
