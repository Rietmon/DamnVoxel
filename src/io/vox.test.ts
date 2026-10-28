import { describe, expect, it } from 'vitest';
import { packRgba } from '../core/color';
import { CHUNK_SIZE, keyX, keyY, keyZ } from '../core/coords';
import { MAGICAVOXEL_DEFAULT_PALETTE } from '../core/default-palette';
import { VoxelDocument } from '../core/document';
import { ORIENTATION_COUNT, orientCell, quarterTurn, toRotationByte } from '../core/orientation';
import { PaletteOrderCommand } from '../core/palette-edit';
import { type SceneNode, type VoxelObject, worldTransform } from '../core/scene';
import { groupNodes } from '../core/scene-edit';
import { cellToWorld } from '../core/transform';
import { parseVoxFile, type VoxChunk, type VoxDict, writeVoxFile } from '../formats/vox-chunks';
import {
  cellFromVox,
  cellToVox,
  modelPivot,
  orientationFromVox,
  orientationToVox,
  parseRotation,
  parseTranslation,
  transformFromVox,
  transformToVox,
  vectorFromVox,
} from './vox-axes';
import { readVox } from './vox-read';
import { writeVox } from './vox-write';

const dict = (...pairs: [string, string][]): VoxDict => new Map(pairs);

/** Every voxel of every visible object in world cells: "x,y,z:id", sorted. */
function worldVoxels(doc: VoxelDocument): string[] {
  const out: string[] = [];
  for (const object of doc.scene.objects()) {
    const t = worldTransform(object);
    for (const [key, chunk] of object.volume.chunks()) {
      for (let i = 0; i < CHUNK_SIZE ** 3; i++) {
        const id = chunk.get(i);
        if (!id) continue;
        const c = cellToWorld(
          t,
          keyX(key) * CHUNK_SIZE + (i & 31),
          keyY(key) * CHUNK_SIZE + ((i >> 5) & 31),
          keyZ(key) * CHUNK_SIZE + (i >> 10),
        );
        out.push(`${c.join(',')}:${doc.palette.color(id).toString(16)}`);
      }
    }
  }
  return out.sort();
}

/** A file the way MagicaVoxel writes one: root transform, root group, one shape per model. */
function mvFile(
  models: { size: [number, number, number]; voxels: number[] }[],
  placements: { model: number; r?: number; t?: [number, number, number]; name?: string }[],
  extra: VoxChunk[] = [],
): Uint8Array {
  const chunks: VoxChunk[] = [];
  for (const m of models) {
    chunks.push({ id: 'SIZE', x: m.size[0], y: m.size[1], z: m.size[2] });
    chunks.push({ id: 'XYZI', voxels: Uint8Array.from(m.voxels) });
  }
  const children = placements.map((_, i) => 2 + i * 2);
  chunks.push({
    id: 'nTRN',
    nodeId: 0,
    attrs: dict(),
    childId: 1,
    reservedId: -1,
    layerId: -1,
    frames: [dict()],
  });
  chunks.push({ id: 'nGRP', nodeId: 1, attrs: dict(), children });
  placements.forEach((p, i) => {
    const frame = dict();
    if (p.r !== undefined) frame.set('_r', String(p.r));
    if (p.t) frame.set('_t', p.t.join(' '));
    chunks.push({
      id: 'nTRN',
      nodeId: 2 + i * 2,
      attrs: p.name ? dict(['_name', p.name]) : dict(),
      childId: 3 + i * 2,
      reservedId: -1,
      layerId: 0,
      frames: [frame],
    });
    chunks.push({
      id: 'nSHP',
      nodeId: 3 + i * 2,
      attrs: dict(),
      models: [{ modelId: p.model, attrs: dict() }],
    });
  });
  chunks.push(...extra);
  return writeVoxFile({ version: 150, chunks });
}

describe('.vox axes and transforms', () => {
  it('turns Z-up into Y-up without mirroring', () => {
    expect(vectorFromVox([0, 0, 1])).toEqual([0, 1, 0]);
    expect(vectorFromVox([0, 1, 0])).toEqual([0, 0, -1]);
    expect(vectorFromVox([1, 0, 0])).toEqual([1, 0, 0]);
    for (const c of [
      [0, 0, 0],
      [3, -2, 7],
      [255, 255, 255],
    ] as [number, number, number][]) {
      expect(cellToVox(...cellFromVox(...c))).toEqual(c);
    }
  });

  it('reads and writes `_r` and `_t` as strings, tolerating junk', () => {
    expect(parseTranslation('-3 4 17')).toEqual([-3, 4, 17]);
    expect(parseTranslation('  1   2 3 ')).toEqual([1, 2, 3]);
    expect(parseTranslation('x')).toEqual([0, 0, 0]);
    expect(parseTranslation(undefined)).toEqual([0, 0, 0]);
    expect(parseRotation('4')).toBe(0);
    expect(parseRotation('3')).toBe(0); // no column 3: not a rotation
    expect(parseRotation('abc')).toBe(0);
    expect(parseRotation('999')).toBe(0);
  });

  it('places a model like MagicaVoxel does, for all 48 rotations and odd and even sizes', () => {
    const t: [number, number, number] = [5, -7, 3];
    for (const size of [
      [3, 4, 5],
      [2, 2, 2],
      [1, 7, 4],
    ] as [number, number, number][]) {
      const pivot = modelPivot(size);
      for (let r = 0; r < ORIENTATION_COUNT; r++) {
        // The byte survives a trip through the string form.
        expect(parseRotation(String(toRotationByte(r)))).toBe(r);
        expect(orientationToVox(orientationFromVox(r))).toBe(r);
        const editor = transformFromVox(r, t, pivot);
        for (const v of [
          [0, 0, 0],
          [size[0] - 1, size[1] - 1, size[2] - 1],
          [1, 0, size[2] - 1],
        ] as [number, number, number][]) {
          // MagicaVoxel: geometry moved by −pivot, rotated, moved by t.
          const mv = orientCell(r, v[0] - pivot[0], v[1] - pivot[1], v[2] - pivot[2]);
          const expected = cellFromVox(mv[0] + t[0], mv[1] + t[1], mv[2] + t[2]);
          expect(cellToWorld(editor, ...cellFromVox(...v))).toEqual(expected);
        }
        const back = transformToVox(editor, { origin: [0, 0, 0], pivot });
        expect(back).toEqual({ rotation: r, t });
      }
    }
  });
});

describe('.vox palette', () => {
  it('shifts RGBA by one index and keeps entry 255', () => {
    const colors = new Uint32Array(256);
    for (let i = 0; i < 256; i++) colors[i] = packRgba(i, 255 - i, 7);
    const bytes = mvFile(
      [{ size: [1, 1, 1], voxels: [0, 0, 0, 1] }],
      [{ model: 0 }],
      [{ id: 'RGBA', colors }],
    );
    const doc = readVox(bytes);
    // Voxel index 1 takes RGBA entry 0.
    expect(doc.palette.color(1)).toBe(packRgba(0, 255, 7));
    expect(doc.palette.color(255)).toBe(packRgba(254, 1, 7));
    const again = parseVoxFile(writeVox(doc)).chunks.find((c) => c.id === 'RGBA');
    expect(again).toEqual({ id: 'RGBA', colors });
  });

  it('uses the MagicaVoxel default palette when there is no RGBA', () => {
    const doc = readVox(mvFile([{ size: [1, 1, 1], voxels: [0, 0, 0, 9] }], [{ model: 0 }]));
    expect(doc.palette.color(9)).toBe(MAGICAVOXEL_DEFAULT_PALETTE[9]);
    expect(doc.palette.color(255)).toBe(MAGICAVOXEL_DEFAULT_PALETTE[255]);
  });

  it('gives material i to voxel index i and keeps the material of index 0', () => {
    const bytes = mvFile(
      [{ size: [1, 1, 1], voxels: [0, 0, 0, 1] }],
      [{ model: 0 }],
      [
        { id: 'MATL', materialId: 1, props: dict(['_type', '_metal'], ['_rough', '0.1']) },
        { id: 'MATL', materialId: 256, props: dict(['_type', '_diffuse']) },
      ],
    );
    const doc = readVox(bytes);
    expect(doc.palette.entry(1).material.get('_type')).toBe('_metal');
    expect(doc.palette.entry(2).material.size).toBe(0);
    const matl = parseVoxFile(writeVox(doc)).chunks.filter((c) => c.id === 'MATL');
    expect(matl).toEqual([
      { id: 'MATL', materialId: 1, props: dict(['_type', '_metal'], ['_rough', '0.1']) },
      { id: 'MATL', materialId: 256, props: dict(['_type', '_diffuse']) },
    ]);
  });

  it('reads IMAP as display slot → voxel index and writes the order back', () => {
    const map = new Uint8Array(256);
    // Index 3 shown first, then 1, 2, 4…255, index 0 in the last slot.
    map[0] = 3;
    map[1] = 1;
    map[2] = 2;
    for (let s = 3; s < 255; s++) map[s] = s + 1;
    map[255] = 0;
    const bytes = mvFile(
      [{ size: [1, 1, 1], voxels: [0, 0, 0, 3] }],
      [{ model: 0 }],
      [{ id: 'IMAP', map }],
    );
    const doc = readVox(bytes);
    expect(doc.palette.displayOrder().slice(0, 4)).toEqual([3, 1, 2, 4]);
    // The voxel keeps its index: IMAP only orders the panel.
    expect(doc.scene.objects()[0]!.volume.get(0, 0, -1)).toBe(3);
    const written = parseVoxFile(writeVox(doc)).chunks.find((c) => c.id === 'IMAP');
    expect(written).toEqual({ id: 'IMAP', map });
    // A new order is written as a new map.
    const p = doc.palette;
    doc.history.execute(
      new PaletteOrderCommand('x', p, [2, ...p.displayOrder().filter((i) => i !== 2)]),
    );
    const next = parseVoxFile(writeVox(doc)).chunks.find((c) => c.id === 'IMAP') as {
      map: Uint8Array;
    };
    expect([...next.map.slice(0, 3)]).toEqual([2, 3, 1]);
    expect(next.map[255]).toBe(0);
    // Plain order and no IMAP before: none written.
    expect(
      parseVoxFile(writeVox(VoxelDocument.createEmpty())).chunks.some((c) => c.id === 'IMAP'),
    ).toBe(false);
  });
});

describe('.vox scene', () => {
  it('reads models where MagicaVoxel shows them', () => {
    // A 3 × 3 × 3 model centred on (1, 1, 1): its voxel (0, 0, 0) sits at (−1, −1, −1) in the file.
    const bytes = mvFile(
      [{ size: [3, 3, 3], voxels: [0, 0, 0, 5, 2, 2, 2, 6] }],
      [{ model: 0, name: 'Cube', t: [10, 0, 0] }],
    );
    const doc = readVox(bytes);
    const object = doc.scene.objects()[0]!;
    expect(object.name).toBe('Cube');
    expect(worldVoxels(doc)).toEqual(
      [
        `${cellFromVox(9, -1, -1).join(',')}:${doc.palette.color(5).toString(16)}`,
        `${cellFromVox(11, 1, 1).join(',')}:${doc.palette.color(6).toString(16)}`,
      ].sort(),
    );
  });

  it('keeps several models, instances of one model and their places', () => {
    const bytes = mvFile(
      [
        { size: [2, 1, 1], voxels: [0, 0, 0, 1, 1, 0, 0, 2] },
        { size: [1, 1, 3], voxels: [0, 0, 2, 4] },
      ],
      [
        { model: 0, t: [0, 0, 0] },
        { model: 1, t: [5, 5, 5], r: toRotationByte(quarterTurn(2)) },
        { model: 0, t: [-9, 0, 0] },
      ],
    );
    const doc = readVox(bytes);
    expect(doc.scene.objects()).toHaveLength(3);
    const before = worldVoxels(doc);
    const written = writeVox(doc);
    // The two untouched instances of model 0 still share one model.
    expect(parseVoxFile(written).chunks.filter((c) => c.id === 'XYZI')).toHaveLength(2);
    expect(worldVoxels(readVox(written))).toEqual(before);
    // Writing what was read gives the same bytes again.
    expect(writeVox(readVox(written))).toEqual(written);
  });

  it('round-trips groups, names, hiding and transforms of an edited document', () => {
    const doc = VoxelDocument.createEmpty();
    const scene = doc.scene;
    const a = scene.objects()[0]!;
    a.name = 'House';
    for (let x = -3; x < 4; x++) a.volume.set(x, 0, 2, 7);
    a.volume.set(0, 5, -1, 8);
    const b = scene.createObject('Tree');
    b.volume.set(1, 1, 1, 9);
    b.transform = { x: 4, y: 0, z: -2, orientation: quarterTurn(1) };
    b.hidden = true;
    scene.attach(b, scene.root);
    const group = groupNodes(doc, [a, b], 'Street')!;
    group.transform = { x: 10, y: 3, z: 0, orientation: quarterTurn(0, true) };
    const back = readVox(writeVox(doc));
    const names = (nodes: readonly SceneNode[]): unknown[] =>
      nodes.map((n) => (n.kind === 'group' ? [n.name, names(n.children)] : n.name));
    expect(names(back.scene.root.children)).toEqual([['Street', ['House', 'Tree']]]);
    const backB = back.scene.objects()[1]!;
    expect(backB.hidden).toBe(true);
    // Compare every voxel in the world, hidden ones included.
    backB.hidden = false;
    b.hidden = false;
    expect(worldVoxels(back)).toEqual(worldVoxels(doc));
  });

  it('splits objects larger than 256 into a group of pieces', () => {
    const doc = VoxelDocument.createEmpty();
    const object = doc.scene.objects()[0]!;
    object.volume.set(0, 0, 0, 1);
    object.volume.set(300, 10, -2, 2);
    object.volume.set(150, 0, -400, 3);
    const bytes = writeVox(doc);
    const sizes = parseVoxFile(bytes).chunks.filter((c) => c.id === 'SIZE') as {
      x: number;
      y: number;
      z: number;
    }[];
    expect(sizes.length).toBeGreaterThan(1);
    for (const s of sizes) expect(Math.max(s.x, s.y, s.z)).toBeLessThanOrEqual(256);
    const back = readVox(bytes);
    expect(back.scene.root.children[0]!.kind).toBe('group');
    expect(worldVoxels(back)).toEqual(worldVoxels(doc));
  });

  it('reads a full 256³ model box with voxels in its far corners', () => {
    const bytes = mvFile(
      [{ size: [256, 256, 256], voxels: [0, 0, 0, 1, 255, 255, 255, 2] }],
      [{ model: 0 }],
    );
    const doc = readVox(bytes);
    expect(doc.scene.objects()[0]!.volume.voxelCount).toBe(2);
    const sizes = parseVoxFile(writeVox(doc)).chunks.filter((c) => c.id === 'SIZE');
    expect(sizes).toEqual([{ id: 'SIZE', x: 256, y: 256, z: 256 }]);
  });

  it('keeps layers, cameras, render settings, notes and unknown chunks', () => {
    const kept: VoxChunk[] = [
      { id: 'LAYR', layerId: 0, attrs: dict(['_name', 'background']), reservedId: -1 },
      { id: 'rOBJ', attrs: dict(['_type', '_bloom']) },
      { id: 'rCAM', cameraId: 0, attrs: dict(['_mode', 'pers']) },
      { id: 'NOTE', names: ['a', 'b'] },
      { id: 'META', raw: true, content: new Uint8Array([1, 2, 3, 4]), children: new Uint8Array(0) },
    ];
    const bytes = mvFile([{ size: [1, 1, 1], voxels: [0, 0, 0, 1] }], [{ model: 0 }], kept);
    const chunks = parseVoxFile(writeVox(readVox(bytes))).chunks;
    for (const c of kept) expect(chunks).toContainEqual(c);
  });

  it('reads old files without a scene graph, centring every model', () => {
    const bytes = writeVoxFile({
      version: 150,
      chunks: [
        { id: 'SIZE', x: 2, y: 2, z: 2 },
        { id: 'XYZI', voxels: Uint8Array.from([0, 0, 0, 1, 1, 1, 1, 2]) },
      ],
    });
    const doc = readVox(bytes);
    expect(worldVoxels(doc)).toHaveLength(2);
    expect(worldVoxels(doc)[0]).toContain(cellFromVox(-1, -1, -1).join(','));
  });

  it('maps palette ids above 255 to the nearest .vox colour', () => {
    const doc = VoxelDocument.createEmpty();
    const id = doc.palette.add({ color: doc.palette.color(17), material: new Map(), name: '' });
    const object = doc.scene.objects()[0] as VoxelObject;
    object.volume.set(0, 0, 0, id);
    const back = readVox(writeVox(doc));
    expect(worldVoxels(back)).toEqual([`0,0,0:${doc.palette.color(17).toString(16)}`]);
  });

  it('keeps every animation frame of a node and shape', () => {
    const chunks: VoxChunk[] = [
      { id: 'SIZE', x: 1, y: 1, z: 1 },
      { id: 'XYZI', voxels: Uint8Array.from([0, 0, 0, 1]) },
      { id: 'SIZE', x: 1, y: 1, z: 2 },
      { id: 'XYZI', voxels: Uint8Array.from([0, 0, 1, 2]) },
      {
        id: 'nTRN',
        nodeId: 0,
        attrs: dict(),
        childId: 1,
        reservedId: -1,
        layerId: -1,
        frames: [dict()],
      },
      { id: 'nGRP', nodeId: 1, attrs: dict(), children: [2] },
      {
        id: 'nTRN',
        nodeId: 2,
        attrs: dict(),
        childId: 3,
        reservedId: -1,
        layerId: 0,
        frames: [dict(['_f', '0'], ['_t', '1 0 0']), dict(['_f', '6'], ['_t', '0 9 0'])],
      },
      {
        id: 'nSHP',
        nodeId: 3,
        attrs: dict(),
        models: [
          { modelId: 0, attrs: dict(['_f', '0']) },
          { modelId: 1, attrs: dict(['_f', '6']) },
        ],
      },
    ];
    const bytes = writeVoxFile({ version: 150, chunks });
    const out = parseVoxFile(writeVox(readVox(bytes))).chunks;
    expect(out.filter((c) => c.id === 'XYZI')).toHaveLength(2);
    const trn = out.find((c) => c.id === 'nTRN' && 'nodeId' in c && c.nodeId !== 0) as {
      frames: VoxDict[];
    };
    expect(trn.frames).toEqual([
      dict(['_f', '0'], ['_t', '1 0 0']),
      dict(['_f', '6'], ['_t', '0 9 0']),
    ]);
  });
});
