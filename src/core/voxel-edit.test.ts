import { describe, expect, it } from 'vitest';
import { Chunk } from './chunk';
import { CHUNK_SIZE, CHUNK_VOLUME, chunkKey } from './coords';
import { VoxelDocument } from './document';
import type { VoxelObject } from './scene';
import { VoxelTransaction } from './voxel-edit';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Snapshot of every voxel in a box, for comparing states. */
function dump(object: VoxelObject, min: number, max: number): Uint16Array {
  const size = max - min + 1;
  const out = new Uint16Array(size * size * size);
  let i = 0;
  for (let z = min; z <= max; z++)
    for (let y = min; y <= max; y++)
      for (let x = min; x <= max; x++) out[i++] = object.volume.get(x, y, z);
  return out;
}

function setup() {
  const doc = VoxelDocument.createEmpty();
  const object = doc.scene.objects()[0]!;
  return { doc, object };
}

describe('VoxelTransaction', () => {
  it('writes live and becomes one undoable command', () => {
    const { doc, object } = setup();
    const tx = new VoxelTransaction();
    for (let x = 0; x < 10; x++) tx.set(object, x, 0, 0, 3);
    expect(object.volume.get(5, 0, 0)).toBe(3);
    const cmd = tx.commit('Stroke')!;
    doc.history.push(cmd);
    expect(cmd.chunkCount).toBe(1);
    doc.history.undo();
    expect(object.volume.isEmpty).toBe(true);
    doc.history.redo();
    expect(object.volume.voxelCount).toBe(10);
    expect(object.volume.get(9, 0, 0)).toBe(3);
  });

  it('returns null when writes cancel each other out', () => {
    const { object } = setup();
    object.volume.set(1, 1, 1, 2);
    const tx = new VoxelTransaction();
    tx.set(object, 1, 1, 1, 5);
    tx.set(object, 1, 1, 1, 2);
    tx.set(object, 7, 7, 7, 4);
    tx.set(object, 7, 7, 7, 0);
    expect(tx.commit('Nothing')).toBeNull();
  });

  it('cancels back to the exact previous state', () => {
    const { object } = setup();
    object.volume.set(0, 0, 0, 1);
    object.volume.set(40, 0, 0, 1);
    const before = dump(object, -8, 48);
    const tx = new VoxelTransaction();
    tx.set(object, 0, 0, 0, 0);
    tx.set(object, 41, 0, 0, 9);
    tx.set(object, -5, -5, -5, 9);
    tx.cancel();
    expect(dump(object, -8, 48)).toEqual(before);
  });

  it('shows the state before the transaction through the base view', () => {
    const { object } = setup();
    object.volume.set(2, 2, 2, 7);
    const tx = new VoxelTransaction();
    tx.set(object, 2, 2, 2, 0);
    tx.set(object, 3, 2, 2, 8);
    const base = tx.baseOf(object);
    expect(base.get(2, 2, 2)).toBe(7);
    expect(base.get(3, 2, 2)).toBe(0);
    expect(object.volume.get(3, 2, 2)).toBe(8);
    expect(tx.original(object, 3, 2, 2)).toBe(0);
    tx.cancel();
  });

  it('stores whole chunks for large edits and still undoes exactly', () => {
    const { doc, object } = setup();
    const random = rng(7);
    for (let i = 0; i < 2000; i++) {
      object.volume.set(
        Math.floor(random() * 40),
        Math.floor(random() * 40),
        Math.floor(random() * 40),
        1 + Math.floor(random() * 5),
      );
    }
    const before = dump(object, -1, 40);
    const tx = new VoxelTransaction();
    // Fill a whole chunk: one full diff, plus small sparse diffs around it.
    for (let z = 0; z < CHUNK_SIZE; z++)
      for (let y = 0; y < CHUNK_SIZE; y++)
        for (let x = 0; x < CHUNK_SIZE; x++) tx.set(object, x, y, z, 9);
    tx.set(object, 35, 35, 35, 0);
    tx.set(object, 36, 35, 35, 11);
    const cmd = tx.commit('Fill')!;
    doc.history.push(cmd);
    const after = dump(object, -1, 40);
    doc.history.undo();
    expect(dump(object, -1, 40)).toEqual(before);
    doc.history.redo();
    expect(dump(object, -1, 40)).toEqual(after);
    doc.history.undo();
    expect(dump(object, -1, 40)).toEqual(before);
  });

  it('keeps the recorded state intact when the document is edited after commit', () => {
    const { doc, object } = setup();
    const tx = new VoxelTransaction();
    for (let z = 0; z < CHUNK_SIZE; z++)
      for (let y = 0; y < CHUNK_SIZE; y++)
        for (let x = 0; x < CHUNK_SIZE; x++) tx.set(object, x, y, z, 4);
    doc.history.push(tx.commit('Fill')!);
    // A direct write into the chunk the command handed to the volume must not leak back.
    doc.history.undo();
    doc.history.redo();
    object.volume.set(0, 0, 0, 1);
    doc.history.undo();
    doc.history.redo();
    expect(object.volume.get(0, 0, 0)).toBe(4);
  });

  it('edits several objects in one command', () => {
    const { doc, object } = setup();
    const other = doc.scene.createObject('B');
    doc.scene.attach(other, doc.scene.root);
    const tx = new VoxelTransaction();
    tx.set(object, 0, 0, 0, 1);
    tx.set(other, 0, 0, 0, 2);
    doc.history.push(tx.commit('Both')!);
    doc.history.undo();
    expect(object.volume.isEmpty && other.volume.isEmpty).toBe(true);
    doc.history.redo();
    expect([object.volume.get(0, 0, 0), other.volume.get(0, 0, 0)]).toEqual([1, 2]);
  });

  it('refuses writes after it is finished', () => {
    const { object } = setup();
    const tx = new VoxelTransaction();
    tx.set(object, 0, 0, 0, 1);
    tx.commit('One');
    expect(() => tx.set(object, 1, 0, 0, 1)).toThrow();
    expect(() => tx.commit('Again')).toThrow();
  });

  it('records whole-chunk replacements', () => {
    const { doc, object } = setup();
    object.volume.set(1, 1, 1, 3);
    const tx = new VoxelTransaction();
    tx.putChunk(object, chunkKey(0, 0, 0), Chunk.uniform(6));
    tx.putChunk(object, chunkKey(5, 0, 0), Chunk.uniform(2));
    doc.history.push(tx.commit('Replace')!);
    expect(object.volume.voxelCount).toBe(2 * CHUNK_VOLUME);
    doc.history.undo();
    expect(object.volume.voxelCount).toBe(1);
    expect(object.volume.get(1, 1, 1)).toBe(3);
  });
});
