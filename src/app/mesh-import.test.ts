import { describe, expect, it } from 'vitest';
import { blue, green, packRgba, red } from '../core/color';
import { Palette } from '../core/palette';
import { type ImportedMesh, readMesh } from '../formats/mesh-import';
import { createDemoDocument } from './demo';
import { DEFAULT_EXPORT, exportMeshes } from './export';
import { cellPalette, cellsToVolume, meshColorAt, voxelizeMesh, zUpToYUp } from './mesh-import';

/** One triangle with a material that has a 2 × 1 texture: left red, right clear. */
function mesh(cutout: boolean): ImportedMesh {
  return {
    positions: new Float32Array([0, 0, 0, 4, 0, 0, 0, 0, 4]),
    uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
    colors: null,
    materials: new Int32Array([0]),
    materialList: [{ color: [1, 1, 1, 1], image: 0, cutout }],
    images: [],
    count: 1,
    up: 'y',
  };
}
const TEXTURE = { width: 2, height: 1, data: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 0]) };

describe('mesh import', () => {
  it('colours points from the texture and cuts holes where it is clear', () => {
    const at = meshColorAt(mesh(true), [TEXTURE], [9, 9, 9]);
    expect(at(0, 1, 0, 0)).toBe(packRgba(255, 0, 0));
    // u = 0.75: the clear pixel.
    expect(at(0, 0.25, 0.75, 0)).toBe(0);
    // Without cut-outs alpha is ignored.
    expect(meshColorAt(mesh(false), [TEXTURE], [9, 9, 9])(0, 0.25, 0.75, 0)).toBe(
      packRgba(0, 0, 255),
    );
  });

  it('gives colourless meshes the fallback colour', () => {
    const m = { ...mesh(false), materials: new Int32Array([-1]), uvs: null };
    expect(meshColorAt(m, [], [10, 20, 30])(0, 1, 0, 0)).toBe(packRgba(10, 20, 30));
  });

  it('turns Z up to Y up', () => {
    const p = new Float32Array([1, 2, 3]);
    zUpToYUp(p);
    expect([...p]).toEqual([1, 3, -2]);
  });

  it('voxelizes into the palette, or a palette of its own', () => {
    const cells = voxelizeMesh(
      mesh(false),
      [TEXTURE],
      { size: 4, solid: false, up: 'auto', target: 'new' },
      [0, 0, 0],
    );
    expect(cells.size).toEqual([4, 1, 4]);
    const own = cellPalette(cells);
    expect(own.length).toBeLessThanOrEqual(2);
    const palette = Palette.createDefault();
    const v = cellsToVolume(cells, palette);
    expect(v.voxelCount).toBe(cells.cells.size);
    const c = palette.color(v.get(0, 0, 0));
    expect([red(c), green(c), blue(c)]).toEqual([255, 0, 0]);
  });
});

describe('round trip through our own export', () => {
  it('gives back the demo island voxel for voxel, colours included', () => {
    const doc = createDemoDocument();
    const o = doc.scene.objects()[0]!;
    const { files } = exportMeshes(doc, [o], 'd', { ...DEFAULT_EXPORT, format: 'glb' });
    const mesh = readMesh([{ name: 'd.glb', bytes: files[0]!.data }]);
    const b = o.volume.getBounds()!;
    const size = Math.max(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ) + 1;
    const cells = voxelizeMesh(
      mesh,
      [],
      { size, solid: true, up: 'auto', target: 'new' },
      [0, 0, 0],
    );
    const [sx, sy] = cells.size;
    let wrongPlace = 0;
    let wrongColour = 0;
    for (let x = b.minX; x <= b.maxX; x++)
      for (let y = b.minY; y <= b.maxY; y++)
        for (let z = b.minZ; z <= b.maxZ; z++) {
          const v = o.volume.get(x, y, z);
          const got = cells.cells.get(x - b.minX + (y - b.minY) * sx + (z - b.minZ) * sx * sy);
          if (!v !== (got === undefined)) wrongPlace++;
          // Surface voxels carry their colour; filled ones take the surface's above them.
          const open = [-1, 1].some(
            (d) =>
              !o.volume.get(x + d, y, z) ||
              !o.volume.get(x, y + d, z) ||
              !o.volume.get(x, y, z + d),
          );
          if (
            v &&
            open &&
            got !== undefined &&
            (got & 0xffffff) !== (doc.palette.color(v) & 0xffffff)
          )
            wrongColour++;
        }
    expect([wrongPlace, wrongColour]).toEqual([0, 0]);
    expect(cells.cells.size).toBe(o.volume.voxelCount);
  });
});
