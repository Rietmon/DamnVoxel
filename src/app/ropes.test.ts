import { describe, expect, it } from 'vitest';
import { VoxelDocument } from '../core/document';
import { PhysicsWorker } from '../workers/physics-client';
import { type RopeSpec, ropeVolume, settleRope } from './ropes';

const spec = (kind: RopeSpec['kind']): RopeSpec => ({
  kind,
  a: [0.5, 20.5, 0.5],
  b: [30.5, 20.5, 0.5],
  slack: 1.3,
  thickness: 2,
  color: 5,
  color2: 6,
});

describe('ropes', () => {
  it('sag between their ends and rest on the model', async () => {
    const doc = VoxelDocument.createEmpty();
    const floor = doc.scene.objects()[0]!;
    for (let x = -5; x < 40; x++) for (let z = -5; z < 6; z++) floor.volume.set(x, 10, z, 1);
    const points = await settleRope(spec('rope'), doc.scene, null, new PhysicsWorker());
    const lowest = Math.min(...points.map((p) => p[1]));
    expect(lowest).toBeLessThan(20);
    // It lies on the slab (top at 11), not through it.
    expect(lowest).toBeGreaterThan(11);
    expect(points[0]).toEqual([0.5, 20.5, 0.5]);
  });

  it('turn into a twisted rope, chain links or a cable', () => {
    const points: [number, number, number][] = Array.from({ length: 21 }, (_, i) => [
      i + 0.5,
      5.5,
      0.5,
    ]);
    const rope = ropeVolume(spec('rope'), points);
    const colors = new Set<number>();
    const b = rope.getBounds()!;
    for (let x = b.minX; x <= b.maxX; x++)
      for (let y = b.minY; y <= b.maxY; y++)
        for (let z = b.minZ; z <= b.maxZ; z++) if (rope.get(x, y, z)) colors.add(rope.get(x, y, z));
    expect([...colors].sort()).toEqual([5, 6]);
    const chain = ropeVolume(spec('chain'), points);
    const cable = ropeVolume(spec('cable'), points);
    expect(chain.voxelCount).toBeGreaterThan(10);
    expect(chain.voxelCount).toBeLessThan(cable.voxelCount);
  });
});
