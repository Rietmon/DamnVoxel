import { CHUNK_SIZE, CHUNK_VOLUME, indexX, indexY, indexZ, keyX, keyY, keyZ } from './coords';
import type { VoxelDocument } from './document';
import { type Command, CompositeCommand } from './history';
import type { VoxelObject } from './scene';
import { SelectionMask } from './selection';
import { SelectionTransaction } from './selection-edit';
import { type Box, VoxelVolume } from './volume';
import { VoxelTransaction } from './voxel-edit';

/**
 * Transforms of a piece of a model: turn by
 * any angle, scale, loop (shift with wrap-around), array (repeated copies) and crop to a box with
 * an anchor. They act on the selected voxels, or on the whole object without a selection, and
 * the selection follows the result. Turning and scaling map every new cell back to the old
 * piece (nearest neighbour), so there are no holes.
 */

export type RegionTransform = 'rotate' | 'scale' | 'loop' | 'array' | 'crop';

/** The voxels a transform works on: x, y, z, colour quads, their box and a lookup. */
interface Region {
  cells: number[];
  box: Box;
  lookup: VoxelVolume;
  selected: boolean;
}

const dense = new Uint16Array(CHUNK_VOLUME);

function regionOf(object: VoxelObject): Region | null {
  const selected = !object.selection.isEmpty;
  const lookup = new VoxelVolume();
  const cells: number[] = [];
  for (const [key, chunk] of object.volume.chunks()) {
    const bits = selected ? object.selection.getChunk(key) : null;
    if (selected && !bits) continue;
    chunk.decodeInto(dense);
    const ox = keyX(key) * CHUNK_SIZE;
    const oy = keyY(key) * CHUNK_SIZE;
    const oz = keyZ(key) * CHUNK_SIZE;
    for (let i = 0; i < CHUNK_VOLUME; i++) {
      const v = dense[i]!;
      if (!v || (bits && (bits[i >>> 5]! & (1 << (i & 31))) === 0)) continue;
      const x = ox + indexX(i);
      const y = oy + indexY(i);
      const z = oz + indexZ(i);
      cells.push(x, y, z, v);
      lookup.set(x, y, z, v);
    }
  }
  const box = lookup.getBounds();
  return box ? { cells, box, lookup, selected } : null;
}

type Values = Readonly<Record<string, number>>;

/** Cells to empty and cells to fill (with colours) for a transform of a region. */
export function transformRegion(
  r: Region,
  kind: RegionTransform,
  v: Values,
): { erase: number[]; add: number[] } {
  const { box, lookup } = r;
  const all = () => {
    const out: number[] = [];
    for (let i = 0; i < r.cells.length; i += 4)
      out.push(r.cells[i]!, r.cells[i + 1]!, r.cells[i + 2]!);
    return out;
  };
  const lo = [box.minX, box.minY, box.minZ];
  const hi = [box.maxX, box.maxY, box.maxZ];
  const size = [0, 1, 2].map((a) => hi[a]! - lo[a]! + 1);
  const pivot = [0, 1, 2].map((a) => (lo[a]! + hi[a]! + 1) / 2);
  /** Every cell of a box whose centre maps back (through `back`) onto a voxel of the region. */
  const resample = (min: number[], max: number[], back: (p: number[]) => number[]) => {
    const add: number[] = [];
    for (let z = min[2]!; z <= max[2]!; z++)
      for (let y = min[1]!; y <= max[1]!; y++)
        for (let x = min[0]!; x <= max[0]!; x++) {
          const s = back([x + 0.5, y + 0.5, z + 0.5]);
          const c = lookup.get(Math.floor(s[0]!), Math.floor(s[1]!), Math.floor(s[2]!));
          if (c) add.push(x, y, z, c);
        }
    return add;
  };
  switch (kind) {
    case 'rotate': {
      const axis = v.axis ?? 1;
      const a = ((v.angle ?? 0) * Math.PI) / 180;
      const [u, w] = axis === 0 ? [1, 2] : axis === 1 ? [2, 0] : [0, 1];
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      // The turned box: the half extents in the plane of turning grow by |cos|, |sin|.
      const hu = size[u]! / 2;
      const hw = size[w]! / 2;
      const nu = Math.abs(cos) * hu + Math.abs(sin) * hw;
      const nw = Math.abs(sin) * hu + Math.abs(cos) * hw;
      const min = [...lo];
      const max = [...hi];
      min[u] = Math.floor(pivot[u]! - nu);
      max[u] = Math.ceil(pivot[u]! + nu) - 1;
      min[w] = Math.floor(pivot[w]! - nw);
      max[w] = Math.ceil(pivot[w]! + nw) - 1;
      const add = resample(min, max, (p) => {
        const du = p[u]! - pivot[u]!;
        const dw = p[w]! - pivot[w]!;
        const s = [...p];
        // The inverse turn.
        s[u] = pivot[u]! + cos * du + sin * dw;
        s[w] = pivot[w]! - sin * du + cos * dw;
        return s;
      });
      return { erase: all(), add };
    }
    case 'scale': {
      const f = [v.sx ?? 1, v.sy ?? 1, v.sz ?? 1].map((s) => Math.max(0.05, s));
      const min = [0, 1, 2].map((a) => Math.floor(pivot[a]! - (size[a]! * f[a]!) / 2));
      const max = [0, 1, 2].map((a) => Math.ceil(pivot[a]! + (size[a]! * f[a]!) / 2) - 1);
      const add = resample(min, max, (p) => p.map((c, a) => pivot[a]! + (c - pivot[a]!) / f[a]!));
      return { erase: all(), add };
    }
    case 'loop': {
      const d = [v.dx ?? 0, v.dy ?? 0, v.dz ?? 0];
      const add: number[] = [];
      for (let i = 0; i < r.cells.length; i += 4) {
        const c = [r.cells[i]!, r.cells[i + 1]!, r.cells[i + 2]!].map(
          (p, a) =>
            lo[a]! + ((((p - lo[a]! + Math.round(d[a]!)) % size[a]!) + size[a]!) % size[a]!),
        );
        add.push(c[0]!, c[1]!, c[2]!, r.cells[i + 3]!);
      }
      return { erase: all(), add };
    }
    case 'array': {
      const n = Math.max(1, Math.round(v.count ?? 1));
      const d = [v.dx ?? 0, v.dy ?? 0, v.dz ?? 0].map(Math.round);
      const add: number[] = [];
      for (let k = 1; k < n; k++)
        for (let i = 0; i < r.cells.length; i += 4)
          add.push(
            r.cells[i]! + d[0]! * k,
            r.cells[i + 1]! + d[1]! * k,
            r.cells[i + 2]! + d[2]! * k,
            r.cells[i + 3]!,
          );
      return { erase: [], add };
    }
    case 'crop': {
      const want = [v.w ?? size[0]!, v.h ?? size[1]!, v.d ?? size[2]!].map((s) =>
        Math.max(1, Math.round(s)),
      );
      const anchor = [v.ax ?? 1, v.ay ?? 1, v.az ?? 1];
      // The kept box: at the low side, the middle or the high side of the old one.
      const min = [0, 1, 2].map((a) =>
        anchor[a] === 0
          ? lo[a]!
          : anchor[a] === 2
            ? hi[a]! - want[a]! + 1
            : lo[a]! + Math.floor((size[a]! - want[a]!) / 2),
      );
      const erase: number[] = [];
      for (let i = 0; i < r.cells.length; i += 4) {
        const c = [r.cells[i]!, r.cells[i + 1]!, r.cells[i + 2]!];
        if (c.some((p, a) => p < min[a]! || p >= min[a]! + want[a]!))
          erase.push(c[0]!, c[1]!, c[2]!);
      }
      return { erase, add: [] };
    }
  }
}

/**
 * Applies a transform to an object's selected voxels (all of them without a selection) and
 * returns the step, already applied but not in history; null when nothing changed.
 */
export function applyRegionTransform(
  doc: VoxelDocument,
  object: VoxelObject,
  kind: RegionTransform,
  values: Values,
  label: string,
): Command | null {
  const region = regionOf(object);
  if (!region) return null;
  const { erase, add } = transformRegion(region, kind, values);
  const tx = new VoxelTransaction();
  for (let i = 0; i < erase.length; i += 3)
    tx.set(object, erase[i]!, erase[i + 1]!, erase[i + 2]!, 0);
  for (let i = 0; i < add.length; i += 4)
    tx.set(object, add[i]!, add[i + 1]!, add[i + 2]!, add[i + 3]!);
  const voxels = tx.commit(label);
  const parts: Command[] = voxels ? [voxels] : [];
  if (region.selected) {
    // The selection follows: what was added, plus what stayed (an array keeps the original).
    const mask = new SelectionMask();
    const keep = kind === 'array' || kind === 'crop';
    if (keep)
      object.selection.forEach((x, y, z) => {
        mask.set(x, y, z, object.volume.get(x, y, z) !== 0);
      });
    for (let i = 0; i < add.length; i += 4) mask.set(add[i]!, add[i + 1]!, add[i + 2]!, true);
    const sel = new SelectionTransaction(object);
    sel.combine(mask, 'replace');
    const command = sel.commit(label);
    if (command) parts.push(command);
    doc.notifySelection(object);
  }
  return parts.length > 0 ? new CompositeCommand(label, parts) : null;
}

/** The box of what a transform would act on, for default numbers. */
export function regionBox(object: VoxelObject): Box | null {
  return regionOf(object)?.box ?? null;
}
