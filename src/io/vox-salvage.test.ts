import { describe, expect, it } from 'vitest';
import { VoxelDocument } from '../core/document';
import { readVox } from './vox-read';
import { salvageVox } from './vox-salvage';
import { writeVox } from './vox-write';

/** Two objects of 6 × 6 × 6 voxels, apart. */
function sample(): Uint8Array {
  const doc = VoxelDocument.createEmpty();
  const first = doc.scene.objects()[0]!;
  const second = doc.scene.createObject('m2');
  doc.scene.attach(second, doc.scene.root);
  second.transform = { ...second.transform, x: 20 };
  for (const [o, id] of [
    [first, 1],
    [second, 2],
  ] as const)
    for (let a = 0; a < 6; a++)
      for (let b = 0; b < 6; b++) for (let c = 0; c < 6; c++) o.volume.set(a, b, c, id);
  return writeVox(doc);
}

/** Where a chunk tag first occurs in the bytes. */
const find = (b: Uint8Array, tag: string, from = 0) => {
  for (let p = from; p + 4 <= b.length; p++)
    if (String.fromCharCode(b[p]!, b[p + 1]!, b[p + 2]!, b[p + 3]!) === tag) return p;
  return -1;
};

const voxels = (doc: VoxelDocument) =>
  doc.scene.objects().reduce((s, o) => s + o.volume.voxelCount, 0);

describe('salvaging damaged .vox', () => {
  it('keeps the voxels of a cut-off model', () => {
    const bytes = sample();
    const second = find(bytes, 'XYZI', find(bytes, 'XYZI') + 4);
    // Cut 100 voxels into the second model.
    const cut = bytes.slice(0, second + 16 + 100 * 4);
    expect(() => readVox(cut)).toThrow();
    const out = salvageVox(cut)!;
    expect(out.report.models).toBe(2);
    expect(voxels(out.doc)).toBe(216 + 100);
    expect(out.report.problems.join(' ')).toMatch(/truncated/);
  });

  it('skips garbage, works out a broken size and keeps the scene', () => {
    const bytes = sample();
    const at = find(bytes, 'XYZI', find(bytes, 'XYZI') + 4) - 12;
    const junk = new Uint8Array(37).fill(0xab);
    const broken = new Uint8Array([...bytes.subarray(0, at), ...junk, ...bytes.subarray(at)]);
    expect(() => readVox(broken)).toThrow();
    const out = salvageVox(broken)!;
    expect(voxels(out.doc)).toBe(432);
    // The scene graph survived: the objects are still apart.
    const xs = out.doc.scene.objects().map((o) => o.transform.x);
    expect(Math.abs(xs[1]! - xs[0]!)).toBe(20);
    // The junk landed in the second model's size, and past it.
    expect(out.report.problems.join(' ')).toMatch(/Model size is damaged.*garbage/);
  });

  it('reads past a broken header', () => {
    const bytes = sample();
    bytes.set([0x58, 0x58, 0x58, 0x58], 0);
    bytes.set([0, 0, 0, 0], 8);
    const out = salvageVox(bytes)!;
    expect(voxels(out.doc)).toBe(432);
    expect(out.report.problems[0]).toMatch(/header/);
  });

  it('puts models at the origin when the scene graph is lost', () => {
    const bytes = sample();
    // Overwrite every shape node's tag: the graph no longer reaches the models.
    for (let p = find(bytes, 'nSHP'); p >= 0; p = find(bytes, 'nSHP', p + 4))
      bytes.set([0x7a, 0x7a, 0x7a, 0x7a], p);
    const out = salvageVox(bytes)!;
    expect(out.doc.scene.objects()).toHaveLength(2);
    expect(voxels(out.doc)).toBe(432);
    expect(out.report.problems.join(' ')).toMatch(/origin/);
  });

  it('gives up on what is not a model', () => {
    expect(salvageVox(new Uint8Array(200).fill(7))).toBeNull();
  });
});
