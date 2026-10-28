import { describe, expect, it } from 'vitest';
import { VoxelDocument } from '../core/document';
import { quarterTurn } from '../core/orientation';
import { DEFAULT_EXPORT, exportMeshes, fileBase, vetExport } from './export';

function scene() {
  const doc = VoxelDocument.createEmpty();
  const a = doc.scene.objects()[0]!;
  a.name = 'House';
  for (let x = 0; x < 4; x++) for (let y = 0; y < 2; y++) a.volume.set(x, y, 0, 1);
  const b = doc.scene.createObject('Tree');
  doc.scene.attach(b, doc.scene.root);
  b.volume.set(0, 0, 0, 2);
  b.transform = { x: 10, y: 0, z: 0, orientation: quarterTurn(1) };
  return { doc, a, b };
}

/** Bounds of the vertex positions in an ASCII OBJ. */
function objBounds(text: string): number[][] {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const line of text.split('\n')) {
    if (!line.startsWith('v ')) continue;
    const p = line.split(' ').slice(1, 4).map(Number);
    p.forEach((v, i) => {
      min[i] = Math.min(min[i]!, v);
      max[i] = Math.max(max[i]!, v);
    });
  }
  return [min, max];
}

const text = (b: Uint8Array) => new TextDecoder().decode(b);

describe('mesh export', () => {
  it('puts one file at the bottom middle, scaled', () => {
    const { doc } = scene();
    const s = { ...DEFAULT_EXPORT, format: 'obj' as const, scale: 0.5 };
    const { files, quads } = exportMeshes(doc, doc.scene.objects(), 'Street', s);
    expect(files.map((f) => f.name)).toEqual(['Street.obj']);
    expect(quads).toBe(6 + 6);
    const [min, max] = objBounds(text(files[0]!.data));
    // Both span x 0…11 and z −1…1 in the world (the turned tree reaches back): halved.
    expect(min).toEqual([-2.75, 0, -0.5]);
    expect(max).toEqual([2.75, 1, 0.5]);
  });

  it('turns to Z up for OBJ, never for glTF', () => {
    const { doc, a } = scene();
    const zUp = {
      ...DEFAULT_EXPORT,
      format: 'obj' as const,
      axes: 'z-up' as const,
      pivot: 'world' as const,
    };
    const [min, max] = objBounds(text(exportMeshes(doc, [a], 'x', zUp).files[0]!.data));
    // Height (y 0…2) is now z; depth z 0…1 is now −y.
    expect(min).toEqual([0, -1, 0]);
    expect(max).toEqual([4, 0, 2]);
    const glb = exportMeshes(doc, [a], 'x', { ...zUp, format: 'glb' }).files[0]!;
    const json = JSON.parse(
      text(glb.data.subarray(20, 20 + new DataView(glb.data.buffer).getUint32(12, true))),
    );
    expect(json.accessors[0].max).toEqual([4, 2, 1]);
  });

  it('writes a file per object, named by the template', () => {
    const { doc } = scene();
    const s = {
      ...DEFAULT_EXPORT,
      format: 'obj' as const,
      colors: 'texture' as const,
      separate: true,
      names: '{doc}_{object}',
    };
    const names = exportMeshes(doc, doc.scene.objects(), 'Street', s).files.map((f) => f.name);
    expect(names).toEqual([
      'Street_House.obj',
      'Street_House.mtl',
      'Street_House.png',
      'Street_Tree.obj',
      'Street_Tree.mtl',
      'Street_Tree.png',
    ]);
    const plain = exportMeshes(doc, doc.scene.objects(), 'Street', {
      ...s,
      format: 'stl',
      names: '{doc}',
    });
    expect(plain.files.map((f) => f.name)).toEqual(['Street-1.stl', 'Street-2.stl']);
  });

  it('cleans file names and stored settings', () => {
    expect(fileBase('{doc}/{object}', 'a:b', 'c*d', 3)).toBe('a_b_c_d');
    expect(vetExport({ ...DEFAULT_EXPORT, scale: -1, format: 'fbx' as 'glb' })).toEqual(
      DEFAULT_EXPORT,
    );
  });
});
