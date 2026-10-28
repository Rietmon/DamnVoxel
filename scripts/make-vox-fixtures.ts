/**
 * Writes the generated part of the .vox test corpus into tests/fixtures/vox/. The files imitate
 * what MagicaVoxel writes (layers, 256 materials, cameras, render settings, notes, IMAP, groups,
 * rotations, animation frames) and the older layouts readers meet in the wild. Real files from
 * MagicaVoxel go into the same folder by hand; the corpus test reads everything there.
 *
 *   node scripts/make-vox-fixtures.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runnerImport } from 'vite';
import type { VoxChunk, VoxDict } from '../src/formats/vox-chunks.ts';

const root = join(import.meta.dirname, '..');
// The source uses extensionless imports, as bundlers do: load it through Vite.
const { module: chunksModule } = await runnerImport<typeof import('../src/formats/vox-chunks.ts')>(
  './src/formats/vox-chunks.ts',
  { root, configFile: false, logLevel: 'error' },
);
const { writeVoxFile } = chunksModule;

const out = join(root, 'tests', 'fixtures', 'vox');
mkdirSync(out, { recursive: true });

const dict = (...pairs: [string, string][]): VoxDict => new Map(pairs);

/** A deterministic pseudo-random generator, so the files never change between runs. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function model(size: [number, number, number], fill: (x: number, y: number, z: number) => number) {
  const voxels: number[] = [];
  for (let z = 0; z < size[2]; z++)
    for (let y = 0; y < size[1]; y++)
      for (let x = 0; x < size[0]; x++) {
        const c = fill(x, y, z);
        if (c) voxels.push(x, y, z, c);
      }
  return [
    { id: 'SIZE', x: size[0], y: size[1], z: size[2] },
    { id: 'XYZI', voxels: Uint8Array.from(voxels) },
  ] satisfies VoxChunk[];
}

/** What MagicaVoxel 0.99.x appends after the scene graph. */
function mvTail(random: () => number): VoxChunk[] {
  const chunks: VoxChunk[] = [];
  for (let i = 0; i < 16; i++) {
    chunks.push({
      id: 'LAYR',
      layerId: i,
      attrs: i === 0 ? dict(['_name', 'background']) : i === 3 ? dict(['_hidden', '1']) : dict(),
      reservedId: -1,
    });
  }
  const colors = new Uint32Array(256);
  for (let i = 0; i < 256; i++) colors[i] = (Math.floor(random() * 0xffffff) | 0xff000000) >>> 0;
  chunks.push({ id: 'RGBA', colors });
  const map = new Uint8Array(256);
  for (let s = 0; s < 256; s++) map[s] = (s + 1) & 255;
  // Swap a few slots, as reordering the palette in MagicaVoxel does.
  [map[0], map[5]] = [map[5]!, map[0]!];
  [map[40], map[200]] = [map[200]!, map[40]!];
  chunks.push({ id: 'IMAP', map });
  for (let id = 1; id <= 256; id++) {
    const type =
      id % 17 === 0 ? '_metal' : id % 23 === 0 ? '_glass' : id % 29 === 0 ? '_emit' : '_diffuse';
    const props = dict(
      ['_type', type],
      ['_weight', '1'],
      ['_rough', '0.1'],
      ['_spec', '0.5'],
      ['_ior', '0.3'],
    );
    if (type === '_emit') props.set('_flux', '2');
    chunks.push({ id: 'MATL', materialId: id, props });
  }
  chunks.push({ id: 'rOBJ', attrs: dict(['_type', '_setting'], ['_ground', '1'], ['_grid', '0']) });
  chunks.push({ id: 'rOBJ', attrs: dict(['_type', '_bg'], ['_color', '0 0 0']) });
  chunks.push({
    id: 'rOBJ',
    attrs: dict(['_type', '_bloom'], ['_mix', '0.5'], ['_scale', '0'], ['_aspect', '0']),
  });
  for (let i = 0; i < 10; i++) {
    chunks.push({
      id: 'rCAM',
      cameraId: i,
      attrs: dict(
        ['_mode', 'pers'],
        ['_focus', '0 0 0'],
        ['_angle', '30 45 0'],
        ['_radius', '60'],
        ['_frustum', '0.4'],
        ['_fov', '45'],
      ),
    });
  }
  const names: string[] = [];
  for (let i = 0; i < 32; i++) names.push(i % 7 === 0 ? `row ${i}` : '');
  chunks.push({ id: 'NOTE', names });
  return chunks;
}

function trn(
  nodeId: number,
  childId: number,
  frame: VoxDict,
  attrs: VoxDict = dict(),
  layerId = 0,
): VoxChunk {
  return { id: 'nTRN', nodeId, attrs, childId, reservedId: -1, layerId, frames: [frame] };
}

function write(name: string, chunks: VoxChunk[], version = 150): void {
  writeFileSync(join(out, name), writeVoxFile({ version, chunks }));
  console.log(`wrote ${name}`);
}

// A scene as MagicaVoxel 0.99 writes it: nested groups, names, rotations, a hidden node.
{
  const random = rng(1);
  const chunks: VoxChunk[] = [
    ...model([9, 7, 5], (x, y, z) => (z === 0 || (x + y + z) % 5 === 0 ? 1 + ((x + y) % 30) : 0)),
    ...model([4, 4, 12], (x, y, z) => (x === 0 || y === 0 ? 40 + (z % 8) : 0)),
    ...model([3, 3, 3], (x, y, z) => ((x + y + z) % 2 ? 200 : 0)),
    trn(0, 1, dict(), dict(), -1),
    { id: 'nGRP', nodeId: 1, attrs: dict(), children: [2, 4, 10] },
    trn(2, 3, dict(['_t', '0 0 2']), dict(['_name', 'base'])),
    { id: 'nSHP', nodeId: 3, attrs: dict(), models: [{ modelId: 0, attrs: dict() }] },
    trn(4, 5, dict(['_r', '20'], ['_t', '12 -3 7']), dict(['_name', 'towers']), -1),
    { id: 'nGRP', nodeId: 5, attrs: dict(), children: [6, 8] },
    trn(6, 7, dict(['_r', '40'], ['_t', '-2 0 6'])),
    { id: 'nSHP', nodeId: 7, attrs: dict(), models: [{ modelId: 1, attrs: dict() }] },
    trn(8, 9, dict(['_r', '82'], ['_t', '5 5 6']), dict(['_name', 'tower 2'], ['_hidden', '1'])),
    { id: 'nSHP', nodeId: 9, attrs: dict(), models: [{ modelId: 1, attrs: dict() }] },
    trn(10, 11, dict(['_r', '98'], ['_t', '-9 4 1']), dict(), 2),
    { id: 'nSHP', nodeId: 11, attrs: dict(), models: [{ modelId: 2, attrs: dict() }] },
    ...mvTail(random),
  ];
  write('mv-scene.vox', chunks);
}

// The 0.98 layout: PACK, several models, no scene graph, no palette.
write('old-pack.vox', [
  { id: 'PACK', models: 2 },
  ...model([5, 5, 5], (x, y, z) => (x === y && y === z ? 9 : 0)),
  ...model([2, 3, 4], () => 79),
]);

// Animation: a node with three frames and a shape with a model per frame.
write('animation.vox', [
  ...model([2, 2, 2], () => 10),
  ...model([2, 2, 3], () => 11),
  ...model([1, 1, 1], () => 12),
  trn(0, 1, dict(), dict(), -1),
  { id: 'nGRP', nodeId: 1, attrs: dict(), children: [2] },
  {
    id: 'nTRN',
    nodeId: 2,
    attrs: dict(['_name', 'jumper']),
    childId: 3,
    reservedId: -1,
    layerId: 0,
    frames: [
      dict(['_f', '0'], ['_t', '0 0 1']),
      dict(['_f', '4'], ['_t', '0 0 6']),
      dict(['_f', '8'], ['_r', '17'], ['_t', '0 0 1']),
    ],
  },
  {
    id: 'nSHP',
    nodeId: 3,
    attrs: dict(),
    models: [
      { modelId: 0, attrs: dict(['_f', '0']) },
      { modelId: 1, attrs: dict(['_f', '4']) },
      { modelId: 2, attrs: dict(['_f', '8']) },
    ],
  },
]);

// The largest model MagicaVoxel allows, mostly empty, with voxels at the far corners.
write('max-256.vox', [
  ...model([256, 256, 256], (x, y, z) =>
    (x === 0 || x === 255) && (y === 0 || y === 255) && (z === 0 || z === 255)
      ? 1 + x / 255 + 2 * (y / 255)
      : 0,
  ),
  trn(0, 1, dict(), dict(), -1),
  { id: 'nGRP', nodeId: 1, attrs: dict(), children: [2] },
  trn(2, 3, dict(['_t', '0 0 128'])),
  { id: 'nSHP', nodeId: 3, attrs: dict(), models: [{ modelId: 0, attrs: dict() }] },
]);

// Version 200 with chunks nobody documented and one nobody knows.
write(
  'unknown-chunks.vox',
  [
    ...model([3, 1, 1], (x) => x + 1),
    trn(0, 1, dict(), dict(), -1),
    { id: 'nGRP', nodeId: 1, attrs: dict(), children: [2] },
    trn(2, 3, dict()),
    { id: 'nSHP', nodeId: 3, attrs: dict(), models: [{ modelId: 0, attrs: dict() }] },
    {
      id: 'META',
      raw: true,
      content: Uint8Array.from([1, 0, 0, 0, 8, 0, 0, 0]),
      children: new Uint8Array(0),
    },
    {
      id: 'MATT',
      raw: true,
      content: Uint8Array.from([1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 63, 0, 0, 0, 0]),
      children: new Uint8Array(0),
    },
    {
      id: 'zZz!',
      raw: true,
      content: Uint8Array.from([42]),
      children: Uint8Array.from(
        [...'ABCD'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0, 0, 0, 0, 0]),
      ),
    },
  ],
  200,
);
