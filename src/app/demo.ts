import { blue, green, red } from '../core/color';
import { VoxelDocument } from '../core/document';
import type { Palette } from '../core/palette';

/** Palette id whose colour is closest to the given sRGB colour. */
function nearest(palette: Palette, r: number, g: number, b: number): number {
  let best = 1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let id = 1; id <= palette.size; id++) {
    const c = palette.color(id);
    const d = (red(c) - r) ** 2 + (green(c) - g) ** 2 + (blue(c) - b) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = id;
    }
  }
  return best;
}

/**
 * A small island with a pond, a tree and a house: a sample model to look at and try tools on.
 * Written straight into the volume because it is the initial state, not an undoable step.
 */
export function createDemoDocument(): VoxelDocument {
  const doc = VoxelDocument.createEmpty();
  const object = doc.scene.objects()[0]!;
  object.name = 'Island';
  const v = object.volume;
  const p = doc.palette;
  const grass = nearest(p, 102, 153, 51);
  const dirt = nearest(p, 153, 102, 51);
  const stone = nearest(p, 136, 136, 136);
  const trunk = nearest(p, 102, 51, 0);
  const leaves = nearest(p, 51, 102, 0);
  const wall = nearest(p, 238, 238, 238);
  const roof = nearest(p, 204, 51, 0);
  const water = nearest(p, 51, 102, 204);

  const topAt = (x: number, z: number): number => {
    let y = 40;
    while (y > -40 && v.get(x, y, z) === 0) y--;
    return y;
  };

  const R = 24;
  for (let z = -R; z <= R; z++)
    for (let x = -R; x <= R; x++) {
      const d = Math.hypot(x, z);
      if (d > R) continue;
      const height = Math.round(5 + 3 * Math.sin(x / 6) * Math.cos(z / 5) - (d / R) ** 3 * 5);
      const depth = Math.round(4 + (1 - d / R) * 8);
      for (let y = -depth; y <= height; y++) {
        v.set(x, y, z, y === height ? grass : y > height - 3 ? dirt : stone);
      }
    }

  // Pond.
  for (let z = 6; z <= 12; z++)
    for (let x = -14; x <= -6; x++) {
      if (Math.hypot(x + 10, z - 9) > 3.6) continue;
      const top = topAt(x, z);
      v.set(x, top, z, 0);
      v.set(x, top - 1, z, water);
    }

  // Tree.
  const tx = 9;
  const tz = -6;
  const ground = topAt(tx, tz);
  for (let y = ground + 1; y <= ground + 8; y++) v.set(tx, y, tz, trunk);
  for (let z = -4; z <= 4; z++)
    for (let y = -3; y <= 4; y++)
      for (let x = -4; x <= 4; x++) {
        if (x * x + (y * 1.3) ** 2 + z * z <= 17) v.set(tx + x, ground + 10 + y, tz + z, leaves);
      }

  // House with a door, windows and a stepped roof.
  const hx = -6;
  const hz = -8;
  let base = -40;
  for (let z = 0; z < 8; z++)
    for (let x = 0; x < 10; x++) base = Math.max(base, topAt(hx + x, hz + z));
  for (let z = 0; z < 8; z++)
    for (let x = 0; x < 10; x++)
      for (let y = 1; y <= 6; y++) {
        const edge = x === 0 || x === 9 || z === 0 || z === 7;
        const door = z === 7 && x >= 4 && x <= 5 && y <= 3;
        const opening =
          edge && !door && y >= 3 && y <= 4 && (x === 2 || x === 7 || z === 3 || z === 4);
        v.set(hx + x, base + y, hz + z, edge && !door && !opening ? wall : 0);
      }
  for (let level = 0; level < 5; level++)
    for (let x = -1 + level; x <= 10 - level; x++)
      for (let z = -1; z <= 8; z++) v.set(hx + x, base + 7 + level, hz + z, roof);
  return doc;
}
