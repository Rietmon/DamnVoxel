import type { VoxelDocument } from './document';
import type { Command } from './history';
import type { SceneNode, Transform, VoxelObject } from './scene';
import { VoxelVolume } from './volume';

/**
 * Frame animation, as in MagicaVoxel: a node can have keys —
 * placements and, for objects, voxel models — at frames. A frame shows, for each node, the latest
 * key at or before it (the earliest one before the first key): models and placements hold until
 * the next key. Editing voxels on a frame edits the model of the key shown there; moving an
 * animated node updates its key at the current frame.
 */

export interface AnimationSettings {
  /** The frame shown and edited. */
  frame: number;
  /** Playback range, inclusive. */
  start: number;
  end: number;
  fps: number;
  loop: boolean;
  /**
   * Placements glide between keys (translation in whole voxels, turns switch at the key) instead
   * of holding. MagicaVoxel holds, so «bake» writes the glide out as a key per frame.
   */
  smooth: boolean;
}

export const DEFAULT_ANIMATION: AnimationSettings = {
  frame: 0,
  start: 0,
  end: 23,
  fps: 8,
  loop: true,
  smooth: false,
};

/** The key in force at a frame: the latest at or before it, else the earliest. */
export function keyAt<T>(keys: ReadonlyMap<number, T>, frame: number): T | undefined {
  let best: number | null = null;
  let first: number | null = null;
  for (const f of keys.keys()) {
    if (first === null || f < first) first = f;
    if (f <= frame && (best === null || f > best)) best = f;
  }
  const at = best ?? first;
  return at === null ? undefined : keys.get(at);
}

/** The placement at a frame: the key in force, or with `smooth` a glide between two keys. */
export function placementAt(
  keys: ReadonlyMap<number, Transform>,
  frame: number,
  smooth: boolean,
): Transform | undefined {
  const held = keyAt(keys, frame);
  if (!smooth || !held || keys.has(frame)) return held;
  let prev: number | null = null;
  let next: number | null = null;
  for (const f of keys.keys()) {
    if (f < frame && (prev === null || f > prev)) prev = f;
    if (f > frame && (next === null || f < next)) next = f;
  }
  if (prev === null || next === null) return held;
  const a = keys.get(prev)!;
  const b = keys.get(next)!;
  const t = (frame - prev) / (next - prev);
  return {
    x: Math.round(a.x + (b.x - a.x) * t),
    y: Math.round(a.y + (b.y - a.y) * t),
    z: Math.round(a.z + (b.z - a.z) * t),
    orientation: a.orientation,
  };
}

/** Every key frame of a node, sorted. */
export function keyFrames(node: SceneNode): number[] {
  const k = node.keys;
  if (!k) return [];
  return [...new Set([...k.transforms.keys(), ...k.volumes.keys()])].sort((a, b) => a - b);
}

/** Every node with keys, depth first. */
export function animatedNodes(doc: VoxelDocument): SceneNode[] {
  const out: SceneNode[] = [];
  const visit = (n: SceneNode) => {
    if (n.keys && (n.keys.transforms.size > 0 || n.keys.volumes.size > 0)) out.push(n);
    if (n.kind === 'group') for (const c of n.children) visit(c);
  };
  visit(doc.scene.root);
  return out;
}

/** Shows a frame: every animated node takes its key placement and model there. */
export function showFrame(doc: VoxelDocument, frame: number): void {
  doc.animation.frame = frame;
  for (const node of animatedNodes(doc)) {
    const k = node.keys!;
    const t = placementAt(k.transforms, frame, doc.animation.smooth);
    if (t) node.transform = t;
    if (node.kind === 'object') {
      const v = keyAt(k.volumes, frame);
      if (v) (node as { volume: VoxelVolume }).volume = v;
    }
  }
  doc.notify('scene');
}

function cloneVolume(v: VoxelVolume): VoxelVolume {
  const out = new VoxelVolume();
  for (const [key, chunk] of v.chunks()) out.putChunk(key, chunk.clone());
  out.takeMeshDirty();
  return out;
}

export type KeyKind = 'model' | 'place';

/**
 * Adds or removes a key at a frame: a model key copies the voxels shown now, a placement key the
 * placement now. A node's first key also keeps what it was at the start of the range, so the
 * frames before still show it.
 */
export class KeyCommand implements Command {
  readonly bytes: number;
  readonly label: string;
  private readonly before: {
    transforms: Map<number, Transform>;
    volumes: Map<number, VoxelVolume>;
  } | null;
  private readonly after: { transforms: Map<number, Transform>; volumes: Map<number, VoxelVolume> };

  constructor(
    private readonly node: SceneNode,
    frame: number,
    kind: KeyKind,
    add: boolean,
    start: number,
  ) {
    const k = node.keys;
    this.before = k ? { transforms: new Map(k.transforms), volumes: new Map(k.volumes) } : null;
    const transforms = new Map(k?.transforms ?? []);
    const volumes = new Map(k?.volumes ?? []);
    if (kind === 'place') {
      if (add) {
        if (transforms.size === 0 && frame !== start) transforms.set(start, node.transform);
        transforms.set(frame, node.transform);
      } else transforms.delete(frame);
    } else if (node.kind === 'object') {
      const object = node as VoxelObject;
      if (add) {
        if (volumes.size === 0 && frame !== start) volumes.set(start, object.volume);
        volumes.set(frame, cloneVolume(object.volume));
      } else volumes.delete(frame);
    }
    this.after = { transforms, volumes };
    this.label = add ? (kind === 'model' ? 'Model frame' : 'Position key') : 'Delete key';
    this.bytes =
      256 +
      (kind === 'model' && add && node.kind === 'object'
        ? (node as VoxelObject).volume.voxelCount * 4
        : 0);
  }

  apply(doc: VoxelDocument): void {
    this.node.keys = {
      transforms: new Map(this.after.transforms),
      volumes: new Map(this.after.volumes),
    };
    showFrame(doc, doc.animation.frame);
  }

  revert(doc: VoxelDocument): void {
    this.node.keys = this.before
      ? { transforms: new Map(this.before.transforms), volumes: new Map(this.before.volumes) }
      : undefined;
    showFrame(doc, doc.animation.frame);
  }
}

/** Changes the playback range, speed or looping. */
export class AnimationSettingsCommand implements Command {
  readonly bytes = 64;
  readonly label = 'Animation settings';
  private readonly before: AnimationSettings;

  constructor(
    doc: VoxelDocument,
    private readonly after: Partial<Omit<AnimationSettings, 'frame'>>,
  ) {
    this.before = { ...doc.animation };
  }

  apply(doc: VoxelDocument): void {
    Object.assign(doc.animation, this.after);
    doc.notify('scene');
  }

  revert(doc: VoxelDocument): void {
    const { frame } = doc.animation;
    Object.assign(doc.animation, this.before, { frame });
    doc.notify('scene');
  }

  merge(next: Command): boolean {
    if (!(next instanceof AnimationSettingsCommand)) return false;
    Object.assign(this.after, next.after);
    return true;
  }
}

/**
 * Writes glides out as keys: every animated node with two placement keys or more gets a key on
 * every frame between its first and last, as the glide places it. One step.
 */
export class BakeCommand implements Command {
  readonly label = 'Bake motion into frames';
  readonly bytes: number;
  private readonly changes: {
    node: SceneNode;
    before: Map<number, Transform>;
    after: Map<number, Transform>;
  }[] = [];

  constructor(doc: VoxelDocument) {
    for (const node of animatedNodes(doc)) {
      const t = node.keys!.transforms;
      if (t.size < 2) continue;
      const frames = [...t.keys()];
      const first = Math.min(...frames);
      const last = Math.max(...frames);
      const after = new Map<number, Transform>();
      for (let f = first; f <= last; f++) after.set(f, placementAt(t, f, true)!);
      this.changes.push({ node, before: new Map(t), after });
    }
    this.bytes = 64 + this.changes.reduce((s, c) => s + c.after.size * 48, 0);
  }

  get empty(): boolean {
    return this.changes.length === 0;
  }

  apply(doc: VoxelDocument): void {
    for (const c of this.changes) c.node.keys!.transforms = new Map(c.after);
    showFrame(doc, doc.animation.frame);
  }

  revert(doc: VoxelDocument): void {
    for (const c of this.changes) c.node.keys!.transforms = new Map(c.before);
    showFrame(doc, doc.animation.frame);
  }
}
