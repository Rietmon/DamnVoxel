import { describe, expect, it } from 'vitest';
import { CHUNK_VOLUME } from './coords';
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

const MIN = -24;
const MAX = 24;

const dense = new Uint16Array(CHUNK_VOLUME);

/** Hash of every voxel of the object, chunk by chunk in key order. */
function snapshot(object: VoxelObject): string {
  const keys = [...object.volume.chunkKeys()].sort((a, b) => a - b);
  let hash = 0;
  for (const key of keys) {
    object.volume.getChunk(key)!.decodeInto(dense);
    hash = (Math.imul(hash, 31) + (key % 1000003)) | 0;
    for (let i = 0; i < CHUNK_VOLUME; i++) hash = (Math.imul(hash, 31) + dense[i]!) | 0;
  }
  return `${hash}:${object.volume.voxelCount}:${keys.length}`;
}

describe('history over random edits', () => {
  it('returns to every recorded state through any walk of undo and redo', {
    timeout: 30000,
  }, () => {
    const random = rng(42);
    const doc = VoxelDocument.createEmpty();
    const object = doc.scene.objects()[0]!;
    const int = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1));

    // states[i] is the state after i steps of the current branch.
    const states = [snapshot(object)];
    let position = 0;

    for (let step = 0; step < 150; step++) {
      const r = random();
      if (r < 0.2 && doc.history.canUndo) {
        doc.history.undo();
        position--;
      } else if (r < 0.35 && doc.history.canRedo) {
        doc.history.redo();
        position++;
      } else {
        const tx = new VoxelTransaction();
        const kind = random();
        if (kind < 0.6) {
          // A stroke: a few hundred scattered writes, some erasing.
          const writes = int(1, 400);
          for (let i = 0; i < writes; i++) {
            tx.set(
              object,
              int(MIN, MAX),
              int(MIN, MAX),
              int(MIN, MAX),
              random() < 0.25 ? 0 : int(1, 300),
            );
          }
        } else {
          // A box fill or clear, often covering whole chunks.
          const x0 = int(MIN, MAX - 1);
          const y0 = int(MIN, MAX - 1);
          const z0 = int(MIN, MAX - 1);
          const x1 = Math.min(MAX, x0 + int(1, 24));
          const y1 = Math.min(MAX, y0 + int(1, 24));
          const z1 = Math.min(MAX, z0 + int(1, 24));
          const value = random() < 0.3 ? 0 : int(1, 20);
          for (let z = z0; z <= z1; z++)
            for (let y = y0; y <= y1; y++)
              for (let x = x0; x <= x1; x++) tx.set(object, x, y, z, value);
        }
        const cmd = tx.commit('Edit');
        if (!cmd) continue;
        doc.history.push(cmd);
        position++;
        states.length = position;
        states.push(snapshot(object));
      }
      expect(snapshot(object), `step ${step}`).toBe(states[position]);
    }

    while (doc.history.undo()) position--;
    expect(position).toBe(0);
    expect(snapshot(object)).toBe(states[0]);
    expect(object.volume.isEmpty).toBe(true);
  });
});
