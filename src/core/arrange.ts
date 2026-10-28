import type { VoxelDocument } from './document';
import type { Command } from './history';
import { applyOrientation } from './orientation';
import {
  isLocked,
  type SceneNode,
  type Transform,
  type VoxelObject,
  worldTransform,
} from './scene';
import { TransformCommand, topmost, worldBounds } from './scene-edit';
import { composeTransform, invertTransform } from './transform';
import type { Box } from './volume';
import { VoxelVolume } from './volume';

/**
 * Arranging objects: align to the edited object, put on the
 * ground, place by numbers, and move an object's origin without moving it in the world.
 */

export type AlignEdge = 'min' | 'center' | 'max';

const low = (b: Box, a: number) => (a === 0 ? b.minX : a === 1 ? b.minY : b.minZ);
const high = (b: Box, a: number) => (a === 0 ? b.maxX : a === 1 ? b.maxY : b.maxZ);

/** The coordinate of a box's side or middle along an axis, on cell edges. */
function edgeOf(b: Box, axis: number, edge: AlignEdge): number {
  if (edge === 'min') return low(b, axis);
  if (edge === 'max') return high(b, axis) + 1;
  return Math.floor((low(b, axis) + high(b, axis) + 1) / 2);
}

/**
 * Moves nodes by world offsets as one step (nodes inside a moved group and locked ones stay).
 * Returns false when nothing moved.
 */
function moveBy(
  doc: VoxelDocument,
  label: string,
  moves: readonly { node: SceneNode; d: [number, number, number] }[],
): boolean {
  const items = moves.filter(({ node, d }) => node.parent && !isLocked(node) && d.some((v) => v));
  if (items.length === 0) return false;
  const nodes = items.map((m) => m.node);
  const before = nodes.map((n) => n.transform);
  const after = items.map(({ node, d }): Transform => {
    const by: Transform = { x: d[0], y: d[1], z: d[2], orientation: 0 };
    const world = composeTransform(by, worldTransform(node));
    return composeTransform(invertTransform(worldTransform(node.parent!)), world);
  });
  doc.history.execute(new TransformCommand(label, nodes, before, after));
  return true;
}

const along = (axis: number, d: number): [number, number, number] => [
  axis === 0 ? d : 0,
  axis === 1 ? d : 0,
  axis === 2 ? d : 0,
];

/** Lines nodes up with `target` along an axis: their low sides, middles or high sides. */
export function alignNodes(
  doc: VoxelDocument,
  target: SceneNode,
  nodes: readonly SceneNode[],
  axis: number,
  edge: AlignEdge,
): boolean {
  const goal = worldBounds([target]);
  if (!goal) return false;
  const want = edgeOf(goal, axis, edge);
  return moveBy(
    doc,
    'Align',
    topmost(nodes)
      .filter((n) => n !== target)
      .map((node) => {
        const b = worldBounds([node]);
        return { node, d: along(axis, b ? want - edgeOf(b, axis, edge) : 0) };
      }),
  );
}

/** Every node stands on the ground: its lowest voxel at height 0. */
export function dropToGround(doc: VoxelDocument, nodes: readonly SceneNode[]): boolean {
  return moveBy(
    doc,
    'Put on the ground',
    topmost(nodes).map((node) => {
      const b = worldBounds([node]);
      return { node, d: along(1, b ? -b.minY : 0) };
    }),
  );
}

/** Places a node so its world box starts at `at` along an axis (merges while dragging). */
export function placeNode(
  doc: VoxelDocument,
  node: SceneNode,
  axis: number,
  at: number,
  merge = false,
): void {
  const b = worldBounds([node]);
  if (!b || !node.parent || isLocked(node)) return;
  const d = at - low(b, axis);
  if (d === 0) return;
  const by: Transform = { ...{ x: 0, y: 0, z: 0 }, ...vec(along(axis, d)), orientation: 0 };
  const world = composeTransform(by, worldTransform(node));
  const after = composeTransform(invertTransform(worldTransform(node.parent)), world);
  doc.history.execute(new TransformCommand('Position', [node], [node.transform], [after]), {
    merge,
  });
}

const vec = (d: [number, number, number]) => ({ x: d[0], y: d[1], z: d[2] });

export type OriginPlace = 'bottom' | 'center';

/** The local cell that becomes an object's origin: the bottom middle or the middle of its voxels. */
export function originOffset(
  object: VoxelObject,
  place: OriginPlace,
): [number, number, number] | null {
  const b = object.volume.getBounds();
  if (!b) return null;
  return [
    Math.floor((b.minX + b.maxX + 1) / 2),
    place === 'bottom' ? b.minY : Math.floor((b.minY + b.maxY + 1) / 2),
    Math.floor((b.minZ + b.maxZ + 1) / 2),
  ];
}

/**
 * Moves an object's origin to a local cell: the voxels shift inside the object and its placement
 * shifts back, so nothing moves in the world; turns then go around the new origin.
 */
export class SetOriginCommand implements Command {
  readonly label = 'Object origin';
  readonly bytes: number;
  private readonly old: VoxelVolume;
  private readonly moved = new VoxelVolume();
  private readonly before: Transform;
  private readonly after: Transform;

  constructor(
    private readonly object: VoxelObject,
    offset: readonly [number, number, number],
  ) {
    const [dx, dy, dz] = offset;
    this.old = object.volume;
    const b = object.volume.getBounds();
    if (b) {
      for (let z = b.minZ; z <= b.maxZ; z++)
        for (let y = b.minY; y <= b.maxY; y++)
          for (let x = b.minX; x <= b.maxX; x++) {
            const c = object.volume.get(x, y, z);
            if (c) this.moved.set(x - dx, y - dy, z - dz, c);
          }
    }
    this.moved.takeMeshDirty();
    const t = object.transform;
    // Shifting the voxels by −offset is undone by moving the placement by the turned offset.
    const [tx, ty, tz] = applyOrientation(t.orientation, dx, dy, dz);
    this.before = t;
    this.after = { ...t, x: t.x + tx, y: t.y + ty, z: t.z + tz };
    this.bytes = 64 + this.moved.voxelCount * 8;
  }

  apply(doc: VoxelDocument): void {
    this.put(doc, this.moved, this.after);
  }

  revert(doc: VoxelDocument): void {
    this.put(doc, this.old, this.before);
  }

  private put(doc: VoxelDocument, volume: VoxelVolume, transform: Transform): void {
    (this.object as { volume: VoxelVolume }).volume = volume;
    this.object.transform = transform;
    doc.notify('scene');
  }
}
