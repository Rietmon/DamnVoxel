import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, CHUNK_VOLUME, keyX, keyY, keyZ } from '../core/coords';
import type { VoxelDocument } from '../core/document';
import { type SceneNode, worldTransform } from '../core/scene';
import { cellToWorld } from '../core/transform';
import { parseVoxFile, type VoxChunk, type VoxDict } from '../formats/vox-chunks';
import { readVox } from './vox-read';
import { writeVox } from './vox-write';

/**
 * Every file in tests/fixtures/vox goes through read → write → read and must keep its content
 * (docs/formats.md, "Guarantee"). Generated files come from scripts/make-vox-fixtures.ts; real
 * files from MagicaVoxel can be dropped into the folder and are tested the same way.
 */
// Vitest runs from the project root.
const dir = join(process.cwd(), 'tests', 'fixtures', 'vox');
const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.vox'));

const GRAPH = new Set(['SIZE', 'XYZI', 'PACK', 'nTRN', 'nGRP', 'nSHP']);

/** The scene graph as a tree of plain values: what a reader of the file would see. */
function graphTree(bytes: Uint8Array): unknown {
  const chunks = parseVoxFile(bytes).chunks;
  const models: { size: number[]; voxels: string[] }[] = [];
  let size: number[] = [];
  const nodes = new Map<number, Extract<VoxChunk, { nodeId: number }>>();
  for (const c of chunks) {
    if (c.id === 'SIZE' && 'x' in c) size = [c.x, c.y, c.z];
    else if (c.id === 'XYZI' && 'voxels' in c) {
      const voxels: string[] = [];
      for (let i = 0; i < c.voxels.length; i += 4)
        voxels.push(c.voxels.subarray(i, i + 4).join(','));
      models.push({ size, voxels: voxels.sort() });
    } else if ('nodeId' in c) nodes.set(c.nodeId, c);
  }
  if (!nodes.has(0)) return null;
  const plain = (d: VoxDict) => [...d];
  const walk = (id: number): unknown => {
    const c = nodes.get(id);
    if (!c) return null;
    if (c.id === 'nTRN') {
      return {
        attrs: plain(c.attrs),
        layer: c.layerId,
        frames: c.frames.map(plain),
        child: walk(c.childId),
      };
    }
    if (c.id === 'nGRP') return { attrs: plain(c.attrs), children: c.children.map(walk) };
    if (c.id === 'nSHP') {
      return {
        attrs: plain(c.attrs),
        models: c.models.map((m) => ({ attrs: plain(m.attrs), model: models[m.modelId] })),
      };
    }
    return null;
  };
  return walk(0);
}

/** Chunks outside the scene graph, in file order. */
function otherChunks(bytes: Uint8Array): VoxChunk[] {
  return parseVoxFile(bytes).chunks.filter((c) => !GRAPH.has(c.id));
}

/** What the document shows: names, hiding, world voxels with colours, palette. */
function documentContent(doc: VoxelDocument): unknown {
  const objects: unknown[] = [];
  const path = (n: SceneNode): string =>
    n.parent && n.parent !== doc.scene.root ? `${path(n.parent)}/${n.name}` : n.name;
  for (const object of doc.scene.objects()) {
    const t = worldTransform(object);
    const voxels: string[] = [];
    for (const [key, chunk] of object.volume.chunks()) {
      for (let i = 0; i < CHUNK_VOLUME; i++) {
        const id = chunk.get(i);
        if (!id) continue;
        const c = cellToWorld(
          t,
          keyX(key) * CHUNK_SIZE + (i & 31),
          keyY(key) * CHUNK_SIZE + ((i >> 5) & 31),
          keyZ(key) * CHUNK_SIZE + (i >> 10),
        );
        voxels.push(`${c.join(',')}:${id}`);
      }
    }
    objects.push({ path: path(object), hidden: object.hidden, voxels: voxels.sort() });
  }
  const p = doc.palette;
  const palette = p.displayOrder().map((id) => [id, p.color(id), [...p.entry(id).material]]);
  return { objects, palette };
}

describe('.vox corpus', () => {
  it('has files to test', () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  for (const name of files) {
    it(`${name}: read → write → read keeps the content`, () => {
      const original = new Uint8Array(readFileSync(join(dir, name)));
      const doc = readVox(original);
      const written = writeVox(doc);
      const again = readVox(written);
      expect(documentContent(again)).toEqual(documentContent(doc));
      // The file a reader sees: the same graph, models, frames and every other chunk.
      const tree = graphTree(original);
      if (tree) expect(graphTree(written)).toEqual(tree);
      // A file without RGBA used the default palette; it is written out like MagicaVoxel does.
      const before = otherChunks(original);
      const hadPalette = before.some((c) => c.id === 'RGBA');
      const after = otherChunks(written).filter((c) => hadPalette || c.id !== 'RGBA');
      expect(after).toEqual(before);
      // Saving what was opened is stable: the second save gives the same bytes.
      expect(writeVox(again)).toEqual(written);
    });
  }
});
