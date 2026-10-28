import { CHUNK_SIZE, CHUNK_VOLUME, indexX, indexY, indexZ, keyX, keyY, keyZ } from '../core/coords';
import type { VoxelDocument } from '../core/document';
import { pbrOf } from '../core/materials';
import { isHidden, worldTransform } from '../core/scene';
import { worldBounds } from '../core/scene-edit';
import { cellToWorld } from '../core/transform';
import type { MaterialRow, RenderSettings, SceneGrid } from '../render/render-settings';

export type { RenderSettings } from '../render/render-settings';

/** Most cells the render grid may have: 64 million (128 MB on the GPU). */
export const RENDER_CELL_LIMIT = 64 * 1024 * 1024;

const dense = new Uint16Array(CHUNK_VOLUME);

/**
 * The visible voxels of the scene as one grid of palette ids for the path tracer, with an empty
 * cell around them so rays leave cleanly. Null when there is nothing, or too much.
 */
export function sceneGrid(doc: VoxelDocument): SceneGrid | 'empty' | 'too-big' {
  const objects = doc.scene.objects().filter((o) => !isHidden(o));
  const b = worldBounds(objects);
  if (!b) return 'empty';
  const min: [number, number, number] = [b.minX - 1, b.minY - 1, b.minZ - 1];
  const size: [number, number, number] = [
    b.maxX - b.minX + 3,
    b.maxY - b.minY + 3,
    b.maxZ - b.minZ + 3,
  ];
  if (size[0] * size[1] * size[2] > RENDER_CELL_LIMIT) return 'too-big';
  const cells = new Uint16Array(size[0] * size[1] * size[2]);
  for (const o of objects) {
    const t = worldTransform(o);
    for (const [key, chunk] of o.volume.chunks()) {
      chunk.decodeInto(dense);
      const ox = keyX(key) * CHUNK_SIZE;
      const oy = keyY(key) * CHUNK_SIZE;
      const oz = keyZ(key) * CHUNK_SIZE;
      for (let i = 0; i < CHUNK_VOLUME; i++) {
        const v = dense[i]!;
        if (!v) continue;
        const [x, y, z] = cellToWorld(t, ox + indexX(i), oy + indexY(i), oz + indexZ(i));
        cells[x - min[0] + size[0] * (y - min[1] + size[1] * (z - min[2]))] = v;
      }
    }
  }
  return { min, size, cells };
}

/**
 * The settings that decide what the samples hold. The rest — exposure, bloom, the film curve,
 * denoising, the sample count — only change how the samples show, so the picture carries on.
 */
export function lightKey(s: RenderSettings): string {
  return JSON.stringify({
    ...s,
    exposure: 0,
    bloom: 0,
    tonemap: 'aces',
    denoise: false,
    samples: 0,
  });
}

/** Material terms of every palette id (index = id). */
export function materialRows(doc: VoxelDocument): MaterialRow[] {
  const p = doc.palette;
  const rows: MaterialRow[] = [
    { metallic: 0, roughness: 1, transmission: 0, emission: 0, ior: 1.5 },
  ];
  for (let id = 1; id <= p.size; id++) {
    const m = pbrOf(p.entry(id));
    rows.push({
      metallic: m.metallic,
      roughness: m.roughness,
      transmission: m.transmission,
      emission: m.emissiveStrength,
      ior: m.ior,
    });
  }
  return rows;
}
