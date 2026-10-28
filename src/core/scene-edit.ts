import type { VoxelDocument } from './document';
import { type Command, CompositeCommand } from './history';
import { applyOrientation } from './orientation';
import {
  type GroupNode,
  isInside,
  isLocked,
  type Layer,
  type Scene,
  type SceneNode,
  type Transform,
  type VoxelObject,
  worldTransform,
} from './scene';
import { cellToWorld, composeTransform, invertTransform } from './transform';
import { type Box, VoxelVolume } from './volume';

/** Memory of a node kept alive by history: its voxels, or a little for a group. */
function nodeBytes(node: SceneNode): number {
  if (node.kind === 'group') return node.children.reduce((sum, c) => sum + nodeBytes(c), 64);
  let bytes = 256;
  for (const [, chunk] of node.volume.chunks()) bytes += chunk.memoryBytes();
  return bytes;
}

/**
 * Puts a detached node into a group; reverting takes it out. With `insert = false` the same
 * command removes an attached node instead (and reverting puts it back where it was).
 */
export class InsertNodeCommand implements Command {
  readonly bytes: number;
  private parent: GroupNode;
  private index: number;

  constructor(
    readonly label: string,
    private readonly node: SceneNode,
    parent: GroupNode,
    index: number,
    private readonly insert = true,
  ) {
    this.parent = parent;
    this.index = index;
    this.bytes = nodeBytes(node);
  }

  apply(doc: VoxelDocument): void {
    if (this.insert) this.put(doc);
    else this.take(doc);
  }

  revert(doc: VoxelDocument): void {
    if (this.insert) this.take(doc);
    else this.put(doc);
  }

  private put(doc: VoxelDocument): void {
    doc.scene.attach(this.node, this.parent, this.index);
    doc.notify('scene');
  }

  private take(doc: VoxelDocument): void {
    this.parent = this.node.parent!;
    this.index = doc.scene.detach(this.node);
    doc.notify('scene');
  }
}

/** Removes an attached node; undo puts it back at the same place. */
export function removeNodeCommand(node: SceneNode, label = 'Delete'): InsertNodeCommand {
  const parent = node.parent;
  if (!parent) throw new Error(`Node ${node.id} is not attached`);
  return new InsertNodeCommand(label, node, parent, parent.children.indexOf(node), false);
}

/**
 * Moves a node to another place in the tree: another group or another position among the same
 * siblings. The node keeps its place in the world: its transform is recomputed for the new
 * parent. `index` counts the new parent's children without the node itself.
 */
export class MoveNodeCommand implements Command {
  readonly bytes = 96;
  private before: { parent: GroupNode; index: number; transform: Transform } | null = null;

  constructor(
    readonly label: string,
    private readonly node: SceneNode,
    private readonly parent: GroupNode,
    private readonly index: number,
  ) {
    if (isInside(parent, node)) throw new Error('A group cannot go inside itself');
  }

  apply(doc: VoxelDocument): void {
    const node = this.node;
    const world = worldTransform(node);
    const oldParent = node.parent!;
    const transform = node.transform;
    const index = doc.scene.detach(node);
    this.before = { parent: oldParent, index, transform };
    node.transform = composeTransform(invertTransform(worldTransform(this.parent)), world);
    doc.scene.attach(node, this.parent, Math.min(this.index, this.parent.children.length));
    doc.notify('scene');
  }

  revert(doc: VoxelDocument): void {
    const before = this.before!;
    doc.scene.detach(this.node);
    this.node.transform = before.transform;
    doc.scene.attach(this.node, before.parent, before.index);
    doc.notify('scene');
  }
}

/**
 * Moves nodes, in tree order, to sit together in `parent` right before `before` (at the end
 * when null): a drop in the scene tree. Every node keeps its place in the world.
 */
export class MoveNodesCommand implements Command {
  readonly bytes: number;
  private readonly nodes: readonly SceneNode[];
  private before: { parent: GroupNode; index: number; transform: Transform }[] = [];

  constructor(
    readonly label: string,
    scene: Scene,
    nodes: readonly SceneNode[],
    private readonly parent: GroupNode,
    private readonly beforeNode: SceneNode | null,
  ) {
    this.nodes = inTreeOrder(scene, topmost(nodes)).filter((n) => n.parent);
    if (this.nodes.some((n) => isInside(parent, n))) {
      throw new Error('A group cannot go inside itself');
    }
    this.bytes = 64 + this.nodes.length * 96;
  }

  /** False when the move would change nothing worth a history step. */
  get isEmpty(): boolean {
    return this.nodes.length === 0;
  }

  apply(doc: VoxelDocument): void {
    const worlds = this.nodes.map((n) => worldTransform(n));
    // The reference may be one of the moved nodes: take the next sibling that stays.
    let ref = this.beforeNode;
    if (ref?.parent) {
      const siblings = ref.parent.children;
      let k = siblings.indexOf(ref);
      while (k < siblings.length && this.nodes.includes(siblings[k]!)) k++;
      ref = siblings[k] ?? null;
    }
    const records: typeof this.before = [];
    // Last first: each recorded index is right for putting nodes back first to last.
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const node = this.nodes[i]!;
      const parent = node.parent!;
      const transform = node.transform;
      records[i] = { parent, index: doc.scene.detach(node), transform };
    }
    this.before = records;
    const inverse = invertTransform(worldTransform(this.parent));
    let index =
      ref && ref.parent === this.parent
        ? this.parent.children.indexOf(ref)
        : this.parent.children.length;
    this.nodes.forEach((node, i) => {
      node.transform = composeTransform(inverse, worlds[i]!);
      doc.scene.attach(node, this.parent, index++);
    });
    doc.notify('scene');
  }

  revert(doc: VoxelDocument): void {
    for (const node of this.nodes) doc.scene.detach(node);
    this.nodes.forEach((node, i) => {
      const b = this.before[i]!;
      node.transform = b.transform;
      doc.scene.attach(node, b.parent, b.index);
    });
    doc.notify('scene');
  }
}

/** Moves nodes before `before` in `parent` as one step; false when nothing could move. */
export function moveNodes(
  doc: VoxelDocument,
  nodes: readonly SceneNode[],
  parent: GroupNode,
  before: SceneNode | null,
): boolean {
  if (nodes.some((n) => isInside(parent, n))) return false;
  const command = new MoveNodesCommand('Move in tree', doc.scene, nodes, parent, before);
  if (command.isEmpty) return false;
  doc.history.execute(command);
  return true;
}

/** New transforms for several nodes as one step; drags of the same nodes merge into it. */
export class TransformCommand implements Command {
  readonly bytes: number;

  constructor(
    readonly label: string,
    private readonly nodes: readonly SceneNode[],
    private readonly before: readonly Transform[],
    private after: readonly Transform[],
  ) {
    this.bytes = 64 + nodes.length * 48;
  }

  /** The placement keys at the frame of the first apply, as they were (animated nodes). */
  private keyed: { frame: number; before: (Transform | undefined)[] } | null = null;

  apply(doc: VoxelDocument): void {
    const frame = doc.animation.frame;
    this.keyed ??= { frame, before: this.nodes.map((n) => n.keys?.transforms.get(frame)) };
    this.nodes.forEach((node, i) => {
      node.transform = this.after[i]!;
      if (node.keys && node.keys.transforms.size > 0)
        node.keys.transforms.set(this.keyed!.frame, this.after[i]!);
    });
    doc.notify('scene');
  }

  revert(doc: VoxelDocument): void {
    this.nodes.forEach((node, i) => {
      node.transform = this.before[i]!;
      const keyed = this.keyed;
      if (!keyed || !node.keys || node.keys.transforms.size === 0) return;
      const old = keyed.before[i];
      if (old) node.keys.transforms.set(keyed.frame, old);
      else node.keys.transforms.delete(keyed.frame);
    });
    doc.notify('scene');
  }

  merge(next: Command): boolean {
    if (!(next instanceof TransformCommand) || next.label !== this.label) return false;
    if (next.nodes.length !== this.nodes.length) return false;
    if (next.nodes.some((n, i) => n !== this.nodes[i])) return false;
    this.after = next.after;
    return true;
  }
}

type NodeProperty = 'name' | 'hidden' | 'locked' | 'layer';

/** Renames, hides or locks a node, or puts it on another layer. */
export class NodePropertyCommand<K extends NodeProperty> implements Command {
  readonly bytes = 64;
  private readonly before: SceneNode[K];

  constructor(
    readonly label: string,
    private readonly node: SceneNode,
    private readonly key: K,
    private readonly value: SceneNode[K],
  ) {
    this.before = node[key];
  }

  apply(doc: VoxelDocument): void {
    this.node[this.key] = this.value;
    doc.notify('scene');
  }

  revert(doc: VoxelDocument): void {
    this.node[this.key] = this.before;
    doc.notify('scene');
  }
}

/** Nodes without those inside another listed group: moving a group moves its children. */
export function topmost(nodes: readonly SceneNode[]): SceneNode[] {
  return nodes.filter((n) => !nodes.some((other) => other !== n && isInside(n, other)));
}

/** Nodes in tree order (depth first), so moving them keeps their relative order. */
export function inTreeOrder(scene: Scene, nodes: readonly SceneNode[]): SceneNode[] {
  const wanted = new Set(nodes);
  const out: SceneNode[] = [];
  const visit = (node: SceneNode) => {
    if (wanted.has(node)) out.push(node);
    if (node.kind === 'group') for (const child of node.children) visit(child);
  };
  visit(scene.root);
  return out;
}

/**
 * Puts nodes into a new group at the place of the first of them. Returns the command (already
 * applied and recorded) and the group, or null when there is nothing to group.
 */
export function groupNodes(
  doc: VoxelDocument,
  nodes: readonly SceneNode[],
  name: string,
): GroupNode | null {
  const items = inTreeOrder(doc.scene, topmost(nodes)).filter((n) => n.parent);
  const first = items[0];
  if (!first) return null;
  const parent = first.parent!;
  const group = doc.scene.createGroup(name);
  const parts: Command[] = [
    new InsertNodeCommand('Group', group, parent, parent.children.indexOf(first)),
  ];
  items.forEach((node, i) => {
    parts.push(new MoveNodeCommand('Group', node, group, i));
  });
  doc.history.execute(new CompositeCommand('Group', parts));
  return group;
}

/** Moves a group's children to its place and removes the group; returns the children. */
export function ungroup(doc: VoxelDocument, group: GroupNode): SceneNode[] {
  const parent = group.parent;
  if (!parent) return [];
  const children = [...group.children];
  const index = parent.children.indexOf(group);
  const parts: Command[] = children.map(
    (child, i) => new MoveNodeCommand('Ungroup', child, parent, index + i),
  );
  parts.push(removeNodeCommand(group));
  doc.history.execute(new CompositeCommand('Ungroup', parts));
  return children;
}

/** A deep copy of a node with new ids, detached. */
export function cloneNode(scene: Scene, node: SceneNode): SceneNode {
  if (node.kind === 'object') {
    const volume = new VoxelVolume();
    for (const [key, chunk] of node.volume.chunks()) volume.putChunk(key, chunk.clone());
    volume.takeMeshDirty();
    const copy: VoxelObject = scene.createObject(node.name, volume);
    copy.transform = node.transform;
    copy.hidden = node.hidden;
    copy.locked = node.locked;
    copy.layer = node.layer;
    if (node.program) copy.program = JSON.parse(JSON.stringify(node.program));
    return copy;
  }
  const copy = scene.createGroup(node.name);
  copy.transform = node.transform;
  copy.hidden = node.hidden;
  copy.locked = node.locked;
  copy.layer = node.layer;
  for (const child of node.children) scene.attach(cloneNode(scene, child), copy);
  return copy;
}

/** Copies of nodes, each right after its original. Returns the copies. */
export function duplicateNodes(doc: VoxelDocument, nodes: readonly SceneNode[]): SceneNode[] {
  const items = inTreeOrder(doc.scene, topmost(nodes)).filter((n) => n.parent);
  const copies: SceneNode[] = [];
  const parts: Command[] = [];
  // Last first, so the indices of earlier originals stay valid while inserting.
  for (const node of [...items].reverse()) {
    const parent = node.parent!;
    const copy = cloneNode(doc.scene, node);
    copies.unshift(copy);
    parts.push(new InsertNodeCommand('Copy', copy, parent, parent.children.indexOf(node) + 1));
  }
  if (parts.length > 0) doc.history.execute(new CompositeCommand('Duplicate', parts));
  return copies;
}

/** Removes nodes (with everything inside the groups among them) as one step. */
export function removeNodes(doc: VoxelDocument, nodes: readonly SceneNode[]): void {
  const items = topmost(nodes).filter((n) => n.parent && n !== doc.scene.root);
  if (items.length === 0) return;
  doc.history.execute(
    new CompositeCommand(
      'Delete',
      items.map((n) => removeNodeCommand(n)),
    ),
  );
}

/** The world-space cell box around the voxels of nodes (groups count their objects). */
export function worldBounds(nodes: readonly SceneNode[]): Box | null {
  let box: Box | null = null;
  const add = (node: SceneNode) => {
    if (node.kind === 'group') {
      for (const child of node.children) add(child);
      return;
    }
    const b = node.volume.getBounds();
    if (!b) return;
    const t = worldTransform(node);
    const p = cellToWorld(t, b.minX, b.minY, b.minZ);
    const q = cellToWorld(t, b.maxX, b.maxY, b.maxZ);
    const lo = [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.min(p[2], q[2])] as const;
    const hi = [Math.max(p[0], q[0]), Math.max(p[1], q[1]), Math.max(p[2], q[2])] as const;
    box = box
      ? {
          minX: Math.min(box.minX, lo[0]),
          minY: Math.min(box.minY, lo[1]),
          minZ: Math.min(box.minZ, lo[2]),
          maxX: Math.max(box.maxX, hi[0]),
          maxY: Math.max(box.maxY, hi[1]),
          maxZ: Math.max(box.maxZ, hi[2]),
        }
      : { minX: lo[0], minY: lo[1], minZ: lo[2], maxX: hi[0], maxY: hi[1], maxZ: hi[2] };
  };
  for (const node of nodes) add(node);
  return box;
}

/**
 * Applies a world-space transform to nodes (after their current placement) as one step. Locked
 * nodes and nodes inside other listed groups are skipped.
 */
export function transformNodes(
  doc: VoxelDocument,
  nodes: readonly SceneNode[],
  by: Transform,
  label: string,
  merge = false,
): void {
  const items = topmost(nodes).filter((n) => n.parent && !isLocked(n));
  if (items.length === 0) return;
  const before = items.map((n) => n.transform);
  const after = items.map((n) => {
    const world = composeTransform(by, worldTransform(n));
    return composeTransform(invertTransform(worldTransform(n.parent!)), world);
  });
  doc.history.execute(new TransformCommand(label, items, before, after), { merge });
}

/**
 * Turns or mirrors nodes about the centre of their joint bounds, so they stay in place. An odd
 * box size against an even one rounds the centre down to the grid.
 */
export function orientNodes(
  doc: VoxelDocument,
  nodes: readonly SceneNode[],
  orientation: number,
  label: string,
  merge = false,
): void {
  const box = worldBounds(nodes);
  if (!box) return;
  // Doubled centre keeps the arithmetic in integers.
  const c2 = [box.minX + box.maxX + 1, box.minY + box.maxY + 1, box.minZ + box.maxZ + 1] as const;
  const r = applyOrientation(orientation, c2[0], c2[1], c2[2]);
  const by: Transform = {
    x: Math.floor((c2[0] - r[0]) / 2),
    y: Math.floor((c2[1] - r[1]) / 2),
    z: Math.floor((c2[2] - r[2]) / 2),
    orientation,
  };
  transformNodes(doc, nodes, by, label, merge);
}

type LayerProperty = 'name' | 'hidden' | 'locked';

/** Renames, hides or locks a layer. */
export class LayerPropertyCommand<K extends LayerProperty> implements Command {
  readonly bytes = 64;
  private readonly before: Layer[K];

  constructor(
    readonly label: string,
    private readonly layer: Layer,
    private readonly key: K,
    private readonly value: Layer[K],
  ) {
    this.before = layer[key];
  }

  apply(doc: VoxelDocument): void {
    this.layer[this.key] = this.value;
    doc.notify('scene');
  }

  revert(doc: VoxelDocument): void {
    this.layer[this.key] = this.before;
    doc.notify('scene');
  }
}

/**
 * Adds a layer at a place in the list, or with `add = false` removes one: its nodes move to
 * `fallback` (and back on undo).
 */
export class LayerListCommand implements Command {
  readonly bytes = 128;
  private moved: SceneNode[] = [];

  constructor(
    readonly label: string,
    private readonly layer: Layer,
    private readonly index: number,
    private readonly add: boolean,
    private readonly fallback: Layer | null = null,
  ) {}

  apply(doc: VoxelDocument): void {
    if (this.add) this.put(doc);
    else this.take(doc);
    doc.notify('scene');
  }

  revert(doc: VoxelDocument): void {
    if (this.add) this.take(doc);
    else this.put(doc);
    doc.notify('scene');
  }

  private put(doc: VoxelDocument): void {
    doc.scene.layers.splice(this.index, 0, this.layer);
    for (const n of this.moved) n.layer = this.layer;
  }

  private take(doc: VoxelDocument): void {
    const at = doc.scene.layers.indexOf(this.layer);
    if (at >= 0) doc.scene.layers.splice(at, 1);
    const fallback = this.fallback ?? doc.scene.layers[0]!;
    this.moved = [];
    const visit = (n: SceneNode) => {
      if (n.layer === this.layer) {
        n.layer = fallback;
        this.moved.push(n);
      }
      if (n.kind === 'group') for (const c of n.children) visit(c);
    };
    visit(doc.scene.root);
  }
}

/** Other objects sharing this one's voxels (linked copies). */
export function linkedCopies(scene: Scene, object: VoxelObject): VoxelObject[] {
  return scene.objects().filter((o) => o !== object && o.volume === object.volume);
}

/**
 * Linked copies of objects: new objects sharing the
 * originals' voxels, each right after its original; editing one edits all. One step.
 */
export function linkedCopiesOf(doc: VoxelDocument, objects: readonly VoxelObject[]): VoxelObject[] {
  const items = objects.filter((o) => o.parent);
  const copies: VoxelObject[] = [];
  const parts: Command[] = [];
  for (const o of [...items].reverse()) {
    const copy = doc.scene.createObject(o.name, o.volume);
    copy.transform = o.transform;
    copy.layer = o.layer;
    copies.unshift(copy);
    const parent = o.parent!;
    parts.push(new InsertNodeCommand('Linked copy', copy, parent, parent.children.indexOf(o) + 1));
  }
  if (parts.length > 0) doc.history.execute(new CompositeCommand('Linked copy', parts));
  return copies;
}

/** Gives an object voxels of its own, no longer shared with its linked copies. */
export class UnlinkCommand implements Command {
  readonly label = 'Unlink copy';
  readonly bytes: number;
  private readonly shared: VoxelVolume;
  private readonly own: VoxelVolume;

  constructor(private readonly object: VoxelObject) {
    this.shared = object.volume;
    this.own = new VoxelVolume();
    for (const [key, chunk] of this.shared.chunks()) this.own.putChunk(key, chunk.clone());
    this.own.takeMeshDirty();
    this.bytes = nodeBytes(object);
  }

  apply(doc: VoxelDocument): void {
    this.swap(doc, this.own);
  }

  revert(doc: VoxelDocument): void {
    this.swap(doc, this.shared);
  }

  private swap(doc: VoxelDocument, volume: VoxelVolume): void {
    (this.object as { volume: VoxelVolume }).volume = volume;
    doc.notify('scene');
  }
}
