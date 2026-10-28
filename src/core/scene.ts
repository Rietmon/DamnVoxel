import { SelectionMask } from './selection';
import { composeTransform } from './transform';
import { VoxelVolume } from './volume';

/**
 * Placement of a node in its parent: integer translation and one of the 48 axis-aligned
 * orientations (index into the orientation table, 0 is identity). Exact on the voxel grid and
 * the same as a .vox transform. See docs/data-model.md, "Scene".
 */
export interface Transform {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly orientation: number;
}

export const IDENTITY_TRANSFORM: Transform = { x: 0, y: 0, z: 0, orientation: 0 };

/**
 * A layer, as in MagicaVoxel: nodes belong to one, and hiding or locking the layer hides or
 * locks them all (docs/data-model.md, “Layers”).
 */
export interface Layer {
  readonly id: number;
  name: string;
  hidden: boolean;
  /** The editor's own: kept in the session, MagicaVoxel layers cannot be locked. */
  locked: boolean;
}

/** The layer of objects outside any scene: previews, a floating piece. */
export const NO_LAYER: Layer = { id: -1, name: '', hidden: false, locked: false };

/** Animation keys of a node (core/animation.ts): placements and, for objects, voxel models. */
export interface AnimationKeys {
  transforms: Map<number, Transform>;
  volumes: Map<number, VoxelVolume>;
}

interface NodeBase {
  readonly id: number;
  name: string;
  hidden: boolean;
  locked: boolean;
  transform: Transform;
  parent: GroupNode | null;
  /** The layer the node is on; its hidden and locked apply to the node. */
  layer: Layer;
  /** Keys by frame; none for a still node. */
  keys?: AnimationKeys;
}

export interface GroupNode extends NodeBase {
  readonly kind: 'group';
  readonly children: SceneNode[];
}

/**
 * What a program object is built from (docs/programs.md): the program, the parameter values set
 * for it, and the node graph it was compiled from (null for code written by hand).
 */
export interface ObjectProgram {
  source: string;
  params: Record<string, number>;
  graph: unknown;
  /**
   * Where the program's (0, 0, 0) is among the object's cells; files move an object's cells
   * around (MagicaVoxel centres models), this keeps a rebuild where the voxels were.
   */
  offset?: [number, number, number];
}

export interface VoxelObject extends NodeBase {
  readonly kind: 'object';
  readonly volume: VoxelVolume;
  /** Selected voxels of this object, in its local space. */
  readonly selection: SelectionMask;
  /** Set for objects built by a program; the voxels are what it last made. */
  program?: ObjectProgram;
}

export type SceneNode = GroupNode | VoxelObject;

/** Placement of a node in the world: its transform inside every parent up to the root. */
export function worldTransform(node: SceneNode): Transform {
  let t = node.transform;
  for (let p = node.parent; p; p = p.parent) t = composeTransform(p.transform, t);
  return t;
}

/** Hidden itself or inside a hidden group. */
export function isHidden(node: SceneNode): boolean {
  for (let n: SceneNode | null = node; n; n = n.parent) if (n.hidden || n.layer.hidden) return true;
  return false;
}

/** Locked itself or inside a locked group: its voxels and placement cannot change. */
export function isLocked(node: SceneNode): boolean {
  for (let n: SceneNode | null = node; n; n = n.parent) if (n.locked || n.layer.locked) return true;
  return false;
}

/** True when `node` is `ancestor` or lies inside it. */
export function isInside(node: SceneNode, ancestor: SceneNode): boolean {
  for (let n: SceneNode | null = node; n; n = n.parent) if (n === ancestor) return true;
  return false;
}

/** Tree of groups and voxel objects. Changes go through commands; see core/commands. */
export class Scene {
  readonly root: GroupNode;
  /** Layers in panel order; there is always at least one. New nodes go on the first. */
  readonly layers: Layer[] = [{ id: 0, name: 'Layer 1', hidden: false, locked: false }];
  private readonly nodes = new Map<number, SceneNode>();
  private nextId = 1;

  constructor() {
    this.root = this.register({
      kind: 'group',
      id: 0,
      name: 'Scene',
      hidden: false,
      layer: this.layers[0]!,
      locked: false,
      transform: IDENTITY_TRANSFORM,
      parent: null,
      children: [],
    });
  }

  node(id: number): SceneNode | undefined {
    return this.nodes.get(id);
  }

  /** All voxel objects, depth first in tree order. */
  objects(): VoxelObject[] {
    const out: VoxelObject[] = [];
    const visit = (node: SceneNode) => {
      if (node.kind === 'object') out.push(node);
      else for (const child of node.children) visit(child);
    };
    visit(this.root);
    return out;
  }

  createObject(name: string, volume = new VoxelVolume()): VoxelObject {
    return this.register({
      kind: 'object',
      id: this.nextId++,
      name,
      hidden: false,
      locked: false,
      layer: this.layers[0]!,
      transform: IDENTITY_TRANSFORM,
      parent: null,
      volume,
      selection: new SelectionMask(),
    });
  }

  createGroup(name: string): GroupNode {
    return this.register({
      kind: 'group',
      id: this.nextId++,
      name,
      hidden: false,
      layer: this.layers[0]!,
      locked: false,
      transform: IDENTITY_TRANSFORM,
      parent: null,
      children: [],
    });
  }

  /** Puts a detached node into `parent` at `index` (end by default). */
  attach(node: SceneNode, parent: GroupNode, index = parent.children.length): void {
    if (node.parent) throw new Error(`Node ${node.id} is already attached`);
    parent.children.splice(index, 0, node);
    node.parent = parent;
  }

  /** Takes a node out of its parent and returns its former index. */
  detach(node: SceneNode): number {
    const parent = node.parent;
    if (!parent) throw new Error(`Node ${node.id} is not attached`);
    const index = parent.children.indexOf(node);
    parent.children.splice(index, 1);
    node.parent = null;
    return index;
  }

  layer(id: number): Layer | undefined {
    return this.layers.find((l) => l.id === id);
  }

  /** A new layer at the end, with the next free id. */
  createLayer(name?: string): Layer {
    const id = Math.max(-1, ...this.layers.map((l) => l.id)) + 1;
    return { id, name: name ?? `Layer ${id + 1}`, hidden: false, locked: false };
  }

  private register<T extends SceneNode>(node: T): T {
    this.nodes.set(node.id, node);
    return node;
  }
}
