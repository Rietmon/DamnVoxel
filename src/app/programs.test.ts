import { describe, expect, it } from 'vitest';
import { VoxelDocument } from '../core/document';
import { worldTransform } from '../core/scene';
import { cellToWorld } from '../core/transform';
import { readVox } from '../io/vox-read';
import { writeVox } from '../io/vox-write';
import { runProgram } from '../kernels/program';
import { programPalette, resultVolume } from './programs';

describe('a program rebuilt after a file', () => {
  it('lands its voxels where they were, though the file moved the cells', () => {
    const doc = VoxelDocument.createEmpty();
    const o = doc.scene.objects()[0]!;
    const source = 'box(0, 0, 0, 4, 2, 0, 1);';
    const build = (offset?: [number, number, number]) =>
      resultVolume(runProgram({ source, params: {}, palette: programPalette(doc) }), offset);
    (o as { volume: unknown }).volume = build();
    o.transform = { x: 10, y: 0, z: -3, orientation: 0 };
    o.program = { source, params: {}, graph: null };
    const world = (obj: typeof o, volume = obj.volume) => {
      const out: string[] = [];
      const b = volume.getBounds()!;
      for (let x = b.minX; x <= b.maxX; x++)
        for (let y = b.minY; y <= b.maxY; y++)
          for (let z = b.minZ; z <= b.maxZ; z++)
            if (volume.get(x, y, z)) out.push(cellToWorld(worldTransform(obj), x, y, z).join(','));
      return out.sort();
    };
    const before = world(o);
    const back = readVox(writeVox(doc)).scene.objects()[0]!;
    // The file centred the model: its cells moved, the world did not.
    expect(world(back)).toEqual(before);
    expect(back.program?.offset).toBeDefined();
    expect(world(back, build(back.program!.offset))).toEqual(before);
  });
});
