/**
 * Particles and links (ropes and cloth): position-based Verlet. Each step
 * moves particles by their velocity and gravity, then several passes pull linked pairs back to
 * their rest length and push particles out of solid voxels. Pure numbers in typed arrays, so it
 * runs in a worker; the caller builds ropes and cloth out of it.
 */

export interface SimInput {
  /** x, y, z per particle (voxel units). */
  positions: Float32Array;
  /** 1 for particles that stay where they are (rope ends, a pinned cloth edge). */
  pinned: Uint8Array;
  /** Pairs of particle indices. */
  links: Uint32Array;
  /** Rest length per link. */
  rest: Float32Array;
  /** Solid cells: a box and one byte per cell, x fastest. */
  solid: {
    min: [number, number, number];
    size: [number, number, number];
    cells: Uint8Array;
  } | null;
  /** Particle radius against the grid, voxels. */
  radius: number;
  steps: number;
  /** Constraint passes per step: more is stiffer. */
  iterations: number;
  /** Voxels per step², downwards (−y). */
  gravity: number;
  /** 0…1: how much velocity survives a step. */
  damping: number;
}

/** Runs the simulation in place on `input.positions` and returns them. */
export function simulate(input: SimInput): Float32Array {
  const { positions: p, pinned, links, rest, solid, radius } = input;
  const n = p.length / 3;
  const prev = p.slice();
  for (let step = 0; step < input.steps; step++) {
    for (let i = 0; i < n; i++) {
      if (pinned[i]) continue;
      const k = i * 3;
      for (let a = 0; a < 3; a++) {
        const v = (p[k + a]! - prev[k + a]!) * input.damping;
        prev[k + a] = p[k + a]!;
        p[k + a] = p[k + a]! + v - (a === 1 ? input.gravity : 0);
      }
    }
    for (let it = 0; it < input.iterations; it++) {
      for (let l = 0; l < links.length; l += 2) {
        const a = links[l]! * 3;
        const b = links[l + 1]! * 3;
        const dx = p[b]! - p[a]!;
        const dy = p[b + 1]! - p[a + 1]!;
        const dz = p[b + 2]! - p[a + 2]!;
        const d = Math.hypot(dx, dy, dz) || 1e-6;
        const diff = (d - rest[l / 2]!) / d;
        const wa = pinned[a / 3] ? 0 : 1;
        const wb = pinned[b / 3] ? 0 : 1;
        const w = wa + wb;
        if (w === 0) continue;
        const sa = (diff * wa) / w;
        const sb = (diff * wb) / w;
        p[a] = p[a]! + dx * sa;
        p[a + 1] = p[a + 1]! + dy * sa;
        p[a + 2] = p[a + 2]! + dz * sa;
        p[b] = p[b]! - dx * sb;
        p[b + 1] = p[b + 1]! - dy * sb;
        p[b + 2] = p[b + 2]! - dz * sb;
      }
      if (solid) for (let i = 0; i < n; i++) if (!pinned[i]) collide(p, prev, i * 3, solid, radius);
    }
  }
  return p;
}

/** Pushes a particle out of solid cells along the shallowest way out, killing its speed there. */
function collide(
  p: Float32Array,
  prev: Float32Array,
  k: number,
  solid: NonNullable<SimInput['solid']>,
  r: number,
): void {
  const { min, size, cells } = solid;
  const at = (x: number, y: number, z: number) => {
    const cx = Math.floor(x) - min[0];
    const cy = Math.floor(y) - min[1];
    const cz = Math.floor(z) - min[2];
    if (cx < 0 || cy < 0 || cz < 0 || cx >= size[0] || cy >= size[1] || cz >= size[2]) return false;
    return cells[cx + size[0] * (cy + size[1] * cz)] === 1;
  };
  // The sphere's six extreme points: any inside a solid cell is pushed back out of it.
  for (let a = 0; a < 3; a++) {
    for (const s of [-1, 1]) {
      const q = [p[k]!, p[k + 1]!, p[k + 2]!];
      q[a] = q[a]! + s * r;
      if (!at(q[0]!, q[1]!, q[2]!)) continue;
      // Into the cell's face on the side the particle came from.
      const face = s > 0 ? Math.floor(q[a]!) : Math.floor(q[a]!) + 1;
      p[k + a] = face - s * r;
      // Friction against the surface: the motion along it slows.
      for (let b = 0; b < 3; b++)
        if (b !== a) prev[k + b] = prev[k + b]! + (p[k + b]! - prev[k + b]!) * 0.6;
      prev[k + a] = p[k + a]!;
    }
  }
}
