import type { VoxelDocument } from '../core/document';
import type { Layer, SceneNode } from '../core/scene';
import type { VoxChunk, VoxDict } from '../formats/vox-chunks';
import type { TransformChunk } from './vox-extras';

/**
 * Layers ↔ LAYR chunks and the layer id of nTRN. A layer keeps the chunk it was read from, so
 * an untouched layer is written back as it was (name, hidden, every other key, reserved id).
 */

type LayerChunk = Extract<VoxChunk, { id: 'LAYR' }>;

const readChunks = new WeakMap<Layer, LayerChunk>();
/** Layers the file only named in nTRN, with no LAYR of their own: not written while untouched. */
const implicit = new WeakMap<Layer, string>();
const signature = (l: Layer) => `${l.name}|${l.hidden}`;

/** Takes the LAYR chunks out of `kept` into the document's layers, in file order. */
export function readLayers(doc: VoxelDocument, kept: VoxChunk[]): void {
  const chunks = kept.filter((c): c is LayerChunk => c.id === 'LAYR' && 'layerId' in c);
  if (chunks.length === 0) return;
  const layers = doc.scene.layers;
  layers.length = 0;
  for (const c of chunks) {
    const layer: Layer = {
      id: c.layerId,
      name: c.attrs.get('_name') ?? `Layer ${c.layerId + 1}`,
      hidden: c.attrs.get('_hidden') === '1',
      locked: false,
    };
    readChunks.set(layer, c);
    layers.push(layer);
  }
  for (let i = kept.length - 1; i >= 0; i--)
    if (chunks.includes(kept[i] as LayerChunk)) kept.splice(i, 1);
}

/**
 * The layer a node read with `layerId` is on: that layer, created when the file names a layer
 * it has no LAYR for, or the first layer for −1 (MagicaVoxel writes −1 on groups).
 */
export function layerForId(doc: VoxelDocument, layerId: number): Layer {
  const scene = doc.scene;
  if (layerId < 0) return scene.layers[0]!;
  let layer = scene.layer(layerId);
  if (!layer) {
    layer = { id: layerId, name: `Layer ${layerId + 1}`, hidden: false, locked: false };
    implicit.set(layer, signature(layer));
    scene.layers.push(layer);
  }
  return layer;
}

/** The layer id to write for a node: as read while its layer did not change. */
export function layerIdFor(
  doc: VoxelDocument,
  node: SceneNode,
  read: TransformChunk | undefined,
): number {
  if (read && layerForId(doc, read.layerId) === node.layer) return read.layerId;
  return node.kind === 'group' && node.layer === doc.scene.layers[0] ? -1 : node.layer.id;
}

/**
 * LAYR chunks for the document's layers: an untouched one exactly as read. A layer the file
 * never had a chunk for (the default one of a file without layers, or one only named by a node)
 * gets one only once it is renamed or hidden: open → save keeps the file's chunks.
 */
export function writeLayers(doc: VoxelDocument): VoxChunk[] {
  const layers = doc.scene.layers;
  const untouched = (l: Layer) =>
    implicit.get(l) === signature(l) ||
    (layers.length === 1 && !readChunks.has(l) && l.id === 0 && l.name === 'Layer 1' && !l.hidden);
  return layers
    .filter((l) => readChunks.has(l) || !untouched(l))
    .map((layer): VoxChunk => {
      const read = readChunks.get(layer);
      const name = read?.attrs.get('_name') ?? `Layer ${layer.id + 1}`;
      const hidden = read?.attrs.get('_hidden') === '1';
      if (read && read.layerId === layer.id && name === layer.name && hidden === layer.hidden)
        return read;
      const attrs: VoxDict = new Map(read?.attrs ?? []);
      attrs.set('_name', layer.name);
      if (layer.hidden) attrs.set('_hidden', '1');
      else if (attrs.has('_hidden')) attrs.set('_hidden', '0');
      return { id: 'LAYR', layerId: layer.id, attrs, reservedId: read?.reservedId ?? -1 };
    });
}
