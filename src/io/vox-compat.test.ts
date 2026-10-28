import { describe, expect, it } from 'vitest';
import { packRgba } from '../core/color';
import { orientationMatrix } from '../core/orientation';
import { type GroupNode, type SceneNode, worldTransform } from '../core/scene';
import { cellToWorld } from '../core/transform';
import { parseVoxFile, type VoxChunk, type VoxDict, writeVoxFile } from '../formats/vox-chunks';
import { parseRotation } from './vox-axes';
import { readVox } from './vox-read';
import { writeVox } from './vox-write';

/**
 * Bugs other .vox readers shipped.
 * Expected positions here are worked out by hand from the specification, not from our own
 * conversion functions, so a mistake there cannot hide behind itself.
 */

const dict = (...pairs: [string, string][]): VoxDict => new Map(pairs);

function trn(nodeId: number, childId: number, frame: VoxDict, name?: string): VoxChunk {
  return {
    id: 'nTRN',
    nodeId,
    attrs: name ? dict(['_name', name]) : dict(),
    childId,
    reservedId: -1,
    layerId: nodeId === 0 ? -1 : 0,
    frames: [frame],
  };
}

const shape = (nodeId: number, modelId: number): VoxChunk => ({
  id: 'nSHP',
  nodeId,
  attrs: dict(),
  models: [{ modelId, attrs: dict() }],
});

/** World cells of an object's voxels in the editor, "x,y,z:index". */
function cells(node: SceneNode): string[] {
  if (node.kind !== 'object') return [];
  const t = worldTransform(node);
  const out: string[] = [];
  const b = node.volume.getBounds();
  if (!b) return out;
  for (let x = b.minX; x <= b.maxX; x++)
    for (let y = b.minY; y <= b.maxY; y++)
      for (let z = b.minZ; z <= b.maxZ; z++) {
        const v = node.volume.get(x, y, z);
        if (v) out.push(`${cellToWorld(t, x, y, z).join(',')}:${v}`);
      }
  return out.sort();
}

describe('bugs of other .vox readers', () => {
  it('reads every model of a scene, not only the first (Goxel #208)', () => {
    const chunks: VoxChunk[] = [];
    for (let m = 0; m < 3; m++) {
      chunks.push({ id: 'SIZE', x: 1, y: 1, z: 1 });
      chunks.push({ id: 'XYZI', voxels: Uint8Array.from([0, 0, 0, m + 1]) });
    }
    chunks.push(trn(0, 1, dict()), { id: 'nGRP', nodeId: 1, attrs: dict(), children: [2, 4, 6] });
    for (let m = 0; m < 3; m++) {
      chunks.push(trn(2 + m * 2, 3 + m * 2, dict(['_t', `${m * 10} 0 0`])), shape(3 + m * 2, m));
    }
    const doc = readVox(writeVoxFile({ version: 150, chunks }));
    const objects = doc.scene.objects();
    expect(objects).toHaveLength(3);
    // A 1³ model's pivot is 0: voxel (0, 0, 0) lands on _t, which is (x, 0, 0) → editor (x, 0, −1).
    expect(objects.map(cells)).toEqual([['0,0,-1:1'], ['10,0,-1:2'], ['20,0,-1:3']]);
  });

  it('keeps the hierarchy with group names and transforms (vengi #278, #583, #68)', () => {
    const chunks: VoxChunk[] = [
      { id: 'SIZE', x: 1, y: 1, z: 1 },
      { id: 'XYZI', voxels: Uint8Array.from([0, 0, 0, 7]) },
      trn(0, 1, dict()),
      { id: 'nGRP', nodeId: 1, attrs: dict(), children: [2] },
      trn(2, 3, dict(['_t', '100 0 0']), 'city'),
      { id: 'nGRP', nodeId: 3, attrs: dict(), children: [4] },
      trn(4, 5, dict(['_t', '0 50 0']), 'block'),
      { id: 'nGRP', nodeId: 5, attrs: dict(), children: [6] },
      trn(6, 7, dict(['_t', '0 0 20']), 'house'),
      shape(7, 0),
    ];
    const bytes = writeVoxFile({ version: 150, chunks });
    const doc = readVox(bytes);
    const city = doc.scene.root.children[0] as GroupNode;
    const block = city.children[0] as GroupNode;
    const house = block.children[0]!;
    expect([city.name, block.name, house.name]).toEqual(['city', 'block', 'house']);
    // Each level keeps its own translation; the voxel ends up at their sum (100, 50, 20).
    expect([city.transform.x, block.transform.z, house.transform.y]).toEqual([100, -50, 20]);
    expect(cells(house)).toEqual(['100,20,-51:7']);
    // And the file written back has the same three levels.
    const graph = parseVoxFile(writeVox(doc)).chunks.filter((c) => c.id === 'nGRP');
    expect(graph).toHaveLength(3);
  });

  it('reads `_r` row by row, as the specification shows (vengi #69)', () => {
    // The example from the specification: rows (0 1 0), (0 0 −1), (−1 0 0) give byte 105.
    expect(orientationMatrix(parseRotation('105'))).toEqual([0, 1, 0, 0, 0, -1, -1, 0, 0]);
    // A 3 × 1 × 1 bar of colours 1, 2, 3 along x, turned by +90° about the up axis z:
    // rows (0 −1 0), (1 0 0), (0 0 1) → byte 1 | 0 << 2 | 1 << 4 = 17.
    const chunks: VoxChunk[] = [
      { id: 'SIZE', x: 3, y: 1, z: 1 },
      { id: 'XYZI', voxels: Uint8Array.from([0, 0, 0, 1, 1, 0, 0, 2, 2, 0, 0, 3]) },
      trn(0, 1, dict()),
      { id: 'nGRP', nodeId: 1, attrs: dict(), children: [2] },
      trn(2, 3, dict(['_r', '17'])),
      shape(3, 0),
    ];
    const doc = readVox(writeVoxFile({ version: 150, chunks }));
    // Pivot (1, 0, 0): cells x − 1 = −1, 0, 1 turn to y = −1, 0, 1 at x = −1 in the file, so the
    // bar now runs along file +y, which is editor −z (cell −y − 1): z = 0, −1, −2.
    expect(cells(doc.scene.objects()[0]!)).toEqual(['-1,0,-2:3', '-1,0,-1:2', '-1,0,0:1'].sort());
  });

  it('loads a model of 256 voxels a side (vengi #71)', () => {
    const voxels = Uint8Array.from([0, 0, 0, 1, 255, 255, 255, 2, 255, 0, 128, 3]);
    const chunks: VoxChunk[] = [
      { id: 'SIZE', x: 256, y: 256, z: 256 },
      { id: 'XYZI', voxels },
      trn(0, 1, dict()),
      { id: 'nGRP', nodeId: 1, attrs: dict(), children: [2] },
      trn(2, 3, dict()),
      shape(3, 0),
    ];
    const doc = readVox(writeVoxFile({ version: 150, chunks }));
    // Pivot 128: file cells −128 … 127, editor z = −y − 1.
    expect(cells(doc.scene.objects()[0]!)).toEqual(
      ['-128,-128,127:1', '127,127,-128:2', '127,0,127:3'].sort(),
    );
    const out = parseVoxFile(writeVox(doc)).chunks;
    expect(out.find((c) => c.id === 'SIZE')).toEqual({ id: 'SIZE', x: 256, y: 256, z: 256 });
  });

  it('takes voxel colours straight from RGBA, not through IMAP (vengi #74)', () => {
    const colors = new Uint32Array(256);
    for (let i = 0; i < 256; i++) colors[i] = packRgba(i, 0, 0);
    // IMAP shows the palette reversed.
    const map = new Uint8Array(256);
    for (let s = 0; s < 255; s++) map[s] = 255 - s;
    map[255] = 0;
    const chunks: VoxChunk[] = [
      { id: 'SIZE', x: 1, y: 1, z: 1 },
      { id: 'XYZI', voxels: Uint8Array.from([0, 0, 0, 3]) },
      trn(0, 1, dict()),
      { id: 'nGRP', nodeId: 1, attrs: dict(), children: [2] },
      trn(2, 3, dict()),
      shape(3, 0),
      { id: 'RGBA', colors },
      { id: 'IMAP', map },
    ];
    const doc = readVox(writeVoxFile({ version: 150, chunks }));
    const object = doc.scene.objects()[0]!;
    // Index 3 is RGBA entry 2, whatever the panel order.
    expect(doc.palette.color(cells(object)[0]!.endsWith(':3') ? 3 : -1)).toBe(packRgba(2, 0, 0));
    expect(doc.palette.displayOrder()[0]).toBe(255);
  });
});
