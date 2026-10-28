import { describe, expect, it } from 'vitest';
import { VoxelDocument } from '../core/document';
import { worldBounds } from '../core/scene-edit';
import { PhysicsWorker } from '../workers/physics-client';
import { clothVolume, settleCloth } from './cloth';

describe('cloth', () => {
  it('drapes over a block: on top of it, hanging down its sides', async () => {
    const doc = VoxelDocument.createEmpty();
    const block = doc.scene.objects()[0]!;
    for (let x = 0; x < 6; x++)
      for (let y = 0; y < 6; y++) for (let z = 0; z < 6; z++) block.volume.set(x, y, z, 1);
    const box = worldBounds([block])!;
    const sheet = await settleCloth({ box, margin: 4, color: 7 }, doc.scene, new PhysicsWorker());
    const volume = clothVolume(sheet, 7);
    // Nothing inside the block.
    for (let x = 0; x < 6; x++)
      for (let y = 0; y < 6; y++) for (let z = 0; z < 6; z++) expect(volume.get(x, y, z)).toBe(0);
    // A layer lies on its top and the edges fall below it.
    expect(volume.get(3, 6, 3)).toBe(7);
    const b = volume.getBounds()!;
    expect(b.minY).toBeLessThan(5);
  });
});
