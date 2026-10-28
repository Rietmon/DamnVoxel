import { CHUNK_SIZE, CHUNK_VOLUME, indexX, indexY, indexZ, keyX, keyY, keyZ } from '../core/coords';
import type { VoxelDocument } from '../core/document';
import type { Command } from '../core/history';
import { isHidden, type Scene, type VoxelObject, worldTransform } from '../core/scene';
import { curveCells, type P3 } from '../core/tools/curve';
import { cellToWorld } from '../core/transform';
import { VoxelVolume } from '../core/volume';
import type { SimInput } from '../kernels/verlet';
import type { PhysicsWorker } from '../workers/physics-client';

/**
 * Ropes, chains and cables between two points: a chain of
 * particles is let to sag under gravity and settle on the model in the physics worker, then
 * turned into voxels. A rope stays a procedural object: its parameters can change and it is
 * built again.
 */

export type RopeKind = 'rope' | 'chain' | 'cable';

export const ROPE_TITLES: Record<RopeKind, string> = {
  rope: 'Rope',
  chain: 'Chain',
  cable: 'Cable',
};

export interface RopeSpec {
  kind: RopeKind;
  /** The ends, world voxel units. */
  a: P3;
  b: P3;
  /** Length over the straight distance: 1 is taut, 1.5 hangs low. */
  slack: number;
  thickness: number;
  color: number;
  /** Rope: the second colour of its twist. */
  color2: number;
}

/** What each procedural object was made from. */
export const ropeSpecs = new WeakMap<VoxelObject, RopeSpec>();

const dense = new Uint16Array(CHUNK_VOLUME);

/** Solid world cells of the visible objects inside a box (except `skip`), for collisions. */
export function solidGrid(
  scene: Scene,
  min: P3,
  max: P3,
  skip: VoxelObject | null,
): NonNullable<SimInput['solid']> | null {
  const lo = min.map(Math.floor) as [number, number, number];
  const size = max.map((v, i) => Math.ceil(v) - lo[i]! + 1) as [number, number, number];
  if (size[0] * size[1] * size[2] > 16_000_000) return null;
  const cells = new Uint8Array(size[0] * size[1] * size[2]);
  for (const o of scene.objects()) {
    if (o === skip || isHidden(o)) continue;
    const t = worldTransform(o);
    for (const [key, chunk] of o.volume.chunks()) {
      chunk.decodeInto(dense);
      const ox = keyX(key) * CHUNK_SIZE;
      const oy = keyY(key) * CHUNK_SIZE;
      const oz = keyZ(key) * CHUNK_SIZE;
      for (let i = 0; i < CHUNK_VOLUME; i++) {
        if (!dense[i]) continue;
        const [x, y, z] = cellToWorld(t, ox + indexX(i), oy + indexY(i), oz + indexZ(i));
        const cx = x - lo[0];
        const cy = y - lo[1];
        const cz = z - lo[2];
        if (cx < 0 || cy < 0 || cz < 0 || cx >= size[0] || cy >= size[1] || cz >= size[2]) continue;
        cells[cx + size[0] * (cy + size[1] * cz)] = 1;
      }
    }
  }
  return { min: lo, size, cells };
}

/** The settled curve of a rope: particles from a to b, sagging, resting on the model. */
export async function settleRope(
  spec: RopeSpec,
  scene: Scene,
  skip: VoxelObject | null,
  physics: PhysicsWorker,
): Promise<P3[]> {
  const { a, b } = spec;
  const span = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const length = span * Math.max(1, spec.slack);
  const n = Math.max(6, Math.min(400, Math.ceil(length)));
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    positions.set(
      [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
      i * 3,
    );
  }
  const pinned = new Uint8Array(n);
  pinned[0] = 1;
  pinned[n - 1] = 1;
  const links = new Uint32Array((n - 1) * 2);
  for (let i = 0; i < n - 1; i++) links.set([i, i + 1], i * 2);
  const rest = new Float32Array(n - 1).fill(length / (n - 1));
  // Room for the sag: half the extra length can hang below the lower end.
  const sag = length / 2 + spec.thickness + 2;
  const r = spec.thickness / 2;
  const min: P3 = [
    Math.min(a[0], b[0]) - sag,
    Math.min(a[1], b[1]) - sag,
    Math.min(a[2], b[2]) - sag,
  ];
  const max: P3 = [
    Math.max(a[0], b[0]) + sag,
    Math.max(a[1], b[1]) + r + 1,
    Math.max(a[2], b[2]) + sag,
  ];
  const settled = await physics.run({
    positions,
    pinned,
    links,
    rest,
    solid: solidGrid(scene, min, max, skip),
    radius: Math.max(0.5, r),
    steps: 500,
    iterations: spec.kind === 'cable' ? 40 : 25,
    gravity: 0.02,
    damping: 0.97,
  });
  const out: P3[] = [];
  for (let i = 0; i < n; i++) out.push([settled[i * 3]!, settled[i * 3 + 1]!, settled[i * 3 + 2]!]);
  return out;
}

/** Points every quarter voxel along a polyline, with how far along each one is. */
function resample(points: readonly P3[]): { p: P3; s: number }[] {
  const out: { p: P3; s: number }[] = [];
  let s = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const steps = Math.max(1, Math.ceil(d * 4));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      out.push({
        p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
        s: s + d * t,
      });
    }
    s += d;
  }
  const last = points.at(-1);
  if (last) out.push({ p: last, s });
  return out;
}

/** Voxels of a settled rope in world cells: a twisted rope, chain links or a smooth cable. */
export function ropeVolume(spec: RopeSpec, points: readonly P3[]): VoxelVolume {
  const volume = new VoxelVolume();
  const t = Math.max(1, spec.thickness);
  if (spec.kind === 'chain') {
    // Links one after another, each turned a quarter from the last: flat ovals of voxels.
    const samples = resample(points);
    const linkLength = Math.max(2, t * 2);
    let next = 0;
    let k = 0;
    for (let i = 0; i < samples.length; i++) {
      const { p, s } = samples[i]!;
      if (s < next) continue;
      const q = samples[Math.min(samples.length - 1, i + 4)]!.p;
      const tan = norm([q[0] - p[0], q[1] - p[1], q[2] - p[2]]);
      const side = norm(cross(tan, Math.abs(tan[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
      const perp = k % 2 === 0 ? side : norm(cross(tan, side));
      const c: P3 = [
        p[0] + (tan[0] * linkLength) / 2,
        p[1] + (tan[1] * linkLength) / 2,
        p[2] + (tan[2] * linkLength) / 2,
      ];
      for (let a = 0; a < 64; a++) {
        const th = (a / 64) * Math.PI * 2;
        const x =
          c[0] + (tan[0] * Math.cos(th) * linkLength) / 2 + perp[0] * Math.sin(th) * (t / 2 + 0.5);
        const y =
          c[1] + (tan[1] * Math.cos(th) * linkLength) / 2 + perp[1] * Math.sin(th) * (t / 2 + 0.5);
        const z =
          c[2] + (tan[2] * Math.cos(th) * linkLength) / 2 + perp[2] * Math.sin(th) * (t / 2 + 0.5);
        volume.set(Math.floor(x), Math.floor(y), Math.floor(z), spec.color);
      }
      next = s + linkLength * 0.8;
      k++;
    }
  } else {
    // A tube; a rope twists two colours along its length.
    const samples = resample(points);
    const cells = curveCells(
      samples.map((x) => x.p),
      t,
    );
    for (let i = 0; i < cells.length; i += 3) {
      const [x, y, z] = [cells[i]!, cells[i + 1]!, cells[i + 2]!];
      let color = spec.color;
      if (spec.kind === 'rope') {
        const twist = Math.floor((x + y * 2 + z) / Math.max(1, Math.round(t))) % 2 === 0;
        color = twist ? spec.color : spec.color2;
      }
      volume.set(x, y, z, color);
    }
  }
  volume.takeMeshDirty();
  return volume;
}

const norm = (v: number[]): P3 => {
  const l = Math.hypot(v[0]!, v[1]!, v[2]!) || 1;
  return [v[0]! / l, v[1]! / l, v[2]! / l];
};
const cross = (a: number[], b: number[]): P3 => [
  a[1]! * b[2]! - a[2]! * b[1]!,
  a[2]! * b[0]! - a[0]! * b[2]!,
  a[0]! * b[1]! - a[1]! * b[0]!,
];

/** Swaps a procedural object's voxels and parameters: one step, merging while numbers change. */
export class ProceduralCommand implements Command {
  readonly label = 'Object settings';
  readonly bytes: number;

  constructor(
    private readonly object: VoxelObject,
    private readonly before: { volume: VoxelVolume; spec: RopeSpec },
    private after: { volume: VoxelVolume; spec: RopeSpec },
  ) {
    this.bytes = 256 + after.volume.voxelCount * 4;
  }

  apply(doc: VoxelDocument): void {
    this.put(doc, this.after);
  }

  revert(doc: VoxelDocument): void {
    this.put(doc, this.before);
  }

  merge(next: Command): boolean {
    if (!(next instanceof ProceduralCommand) || next.object !== this.object) return false;
    this.after = next.after;
    return true;
  }

  private put(doc: VoxelDocument, state: { volume: VoxelVolume; spec: RopeSpec }): void {
    (this.object as { volume: VoxelVolume }).volume = state.volume;
    ropeSpecs.set(this.object, state.spec);
    doc.notify('scene');
  }
}
