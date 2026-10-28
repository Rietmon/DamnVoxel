import { describe, expect, it } from 'vitest';
import { showFrame } from '../core/animation';
import { readVox } from '../io/vox-read';
import { writeVox } from '../io/vox-write';
import { EXAMPLES } from './examples';

describe('examples', () => {
  it('build, have voxels and survive .vox', () => {
    for (const e of EXAMPLES) {
      const doc = e.build();
      const voxels = doc.scene.objects().reduce((s, o) => s + o.volume.voxelCount, 0);
      expect(voxels, e.id).toBeGreaterThan(100);
      const back = readVox(writeVox(doc));
      expect(
        back.scene.objects().reduce((s, o) => s + o.volume.voxelCount, 0),
        e.id,
      ).toBe(voxels);
    }
  });

  it('show what they are about', () => {
    const byId = (id: string) => EXAMPLES.find((e) => e.id === id)!.build();
    const village = byId('village');
    const houses = village.scene.objects().filter((o) => o.name === 'House');
    expect(new Set(houses.map((h) => h.volume)).size).toBe(1);
    expect(village.scene.objects().filter((o) => o.layer.name === 'Trees')).toHaveLength(6);
    const bounce = byId('bounce');
    const ball = bounce.scene.objects().find((o) => o.name === 'Ball')!;
    showFrame(bounce, 12);
    expect(ball.transform.y).toBe(21);
    const materials = byId('materials');
    const types = new Set(
      materials.scene.objects().map((o) => {
        const id = [...o.volume.chunks()][0]
          ? o.volume.get(0, 0, 0) || o.volume.get(-24, 0, -9)
          : 0;
        return materials.palette.entry(id).material.get('_type') ?? '_diffuse';
      }),
    );
    expect([...types].sort()).toEqual(['_diffuse', '_emit', '_glass', '_metal']);
  });
});
