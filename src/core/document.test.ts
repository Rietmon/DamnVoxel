import { describe, expect, it } from 'vitest';
import { chunkKey } from './coords';
import { VoxelDocument } from './document';

describe('VoxelDocument', () => {
  it('starts with one empty object and the default palette', () => {
    const doc = VoxelDocument.createEmpty();
    expect(doc.scene.objects()).toHaveLength(1);
    expect(doc.scene.objects()[0]!.volume.isEmpty).toBe(true);
    expect(doc.palette.size).toBe(255);
    expect(doc.flush()).toBeNull();
  });

  it('batches many voxel writes into one notification per flush', () => {
    const doc = VoxelDocument.createEmpty();
    const object = doc.scene.objects()[0]!;
    const calls: number[] = [];
    doc.subscribe((changes) => calls.push(changes.voxels.get(object)?.length ?? 0));
    for (let x = 1; x < 30; x++) object.volume.set(x, 1, 1, 1);
    expect(calls).toEqual([]);
    expect(doc.hasPendingChanges).toBe(true);
    doc.flush();
    expect(calls).toEqual([1]);
    expect(doc.flush()).toBeNull();
    expect(calls).toEqual([1]);
  });

  it('reports stale chunks per object and topics together', () => {
    const doc = VoxelDocument.createEmpty();
    const a = doc.scene.objects()[0]!;
    const b = doc.scene.createObject('B');
    doc.scene.attach(b, doc.scene.root);
    a.volume.set(5, 40, 5, 2);
    b.volume.set(-1, 0, 0, 3);
    doc.notify('palette');
    doc.notifySelection(b);
    const changes = doc.flush()!;
    expect(changes.voxels.get(a)).toEqual([chunkKey(0, 1, 0)]);
    // (-1, 0, 0) is a corner of its chunk: the mesh of all 8 chunks around that corner goes stale.
    expect(changes.voxels.get(b)?.length).toBe(8);
    expect(changes.palette).toBe(true);
    expect(changes.scene).toBe(false);
    expect([...changes.selection]).toEqual([b]);
  });

  it('stops notifying after unsubscribe', () => {
    const doc = VoxelDocument.createEmpty();
    let calls = 0;
    const off = doc.subscribe(() => calls++);
    doc.notify('scene');
    doc.flush();
    off();
    doc.notify('scene');
    doc.flush();
    expect(calls).toBe(1);
  });
});
