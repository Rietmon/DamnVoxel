import { describe, expect, it } from 'vitest';
import { VoxelDocument } from './document';
import { ORIENTATION_COUNT, quarterTurn } from './orientation';
import { isHidden, isLocked, type SceneNode, type Transform, worldTransform } from './scene';
import {
  duplicateNodes,
  groupNodes,
  MoveNodeCommand,
  NodePropertyCommand,
  orientNodes,
  removeNodes,
  TransformCommand,
  transformNodes,
  ungroup,
  worldBounds,
} from './scene-edit';
import { cellToWorld, composeTransform, invertTransform } from './transform';

function setup() {
  const doc = new VoxelDocument();
  const scene = doc.scene;
  const a = scene.createObject('A');
  const b = scene.createObject('B');
  const c = scene.createObject('C');
  for (const o of [a, b, c]) scene.attach(o, scene.root);
  a.volume.set(1, 2, 3, 5);
  return { doc, scene, a, b, c };
}

const names = (nodes: readonly SceneNode[]) => nodes.map((n) => n.name);

describe('transforms', () => {
  it('compose like applying one after the other, and invert exactly', () => {
    const cells: [number, number, number][] = [
      [0, 0, 0],
      [3, -2, 7],
      [-5, 4, -1],
    ];
    for (let o1 = 0; o1 < ORIENTATION_COUNT; o1 += 5) {
      for (let o2 = 0; o2 < ORIENTATION_COUNT; o2 += 7) {
        const outer: Transform = { x: 4, y: -3, z: 9, orientation: o1 };
        const inner: Transform = { x: -2, y: 5, z: 1, orientation: o2 };
        const both = composeTransform(outer, inner);
        for (const c of cells) {
          expect(cellToWorld(both, ...c)).toEqual(cellToWorld(outer, ...cellToWorld(inner, ...c)));
        }
        const back = composeTransform(invertTransform(both), both);
        expect(back).toEqual({ x: 0, y: 0, z: 0, orientation: 0 });
      }
    }
  });

  it('places a node through all its parents, and inherits hiding and locking', () => {
    const { doc, a } = setup();
    const group = groupNodes(doc, [a], 'G')!;
    group.transform = { x: 10, y: 0, z: 0, orientation: quarterTurn(1) };
    a.transform = { x: 1, y: 0, z: 0, orientation: 0 };
    expect(worldTransform(a)).toEqual(composeTransform(group.transform, a.transform));
    expect(isHidden(a)).toBe(false);
    group.hidden = true;
    group.locked = true;
    expect(isHidden(a)).toBe(true);
    expect(isLocked(a)).toBe(true);
  });
});

describe('scene commands', () => {
  it('groups nodes at the place of the first and ungroups them back', () => {
    const { doc, scene, a, c } = setup();
    a.transform = { x: 3, y: 0, z: 0, orientation: 0 };
    const group = groupNodes(doc, [c, a], 'G')!;
    expect(names(scene.root.children)).toEqual(['G', 'B']);
    expect(names(group.children)).toEqual(['A', 'C']);
    expect(doc.history.undoLabel).toBe('Group');
    expect(worldTransform(a).x).toBe(3);
    doc.history.undo();
    expect(names(scene.root.children)).toEqual(['A', 'B', 'C']);
    doc.history.redo();
    group.transform = { x: 100, y: 0, z: 0, orientation: 0 };
    ungroup(doc, group);
    expect(names(scene.root.children)).toEqual(['A', 'C', 'B']);
    // The children keep their place in the world.
    expect(worldTransform(a).x).toBe(103);
    expect(group.parent).toBeNull();
    doc.history.undo();
    expect(names(scene.root.children)).toEqual(['G', 'B']);
    expect(a.transform.x).toBe(3);
  });

  it('moves a node among its siblings and into a turned group keeping its world place', () => {
    const { doc, scene, a, b, c } = setup();
    doc.history.execute(new MoveNodeCommand('Order', a, scene.root, 2));
    expect(names(scene.root.children)).toEqual(['B', 'C', 'A']);
    const group = groupNodes(doc, [b], 'G')!;
    group.transform = { x: 5, y: 6, z: 7, orientation: quarterTurn(1) };
    c.transform = { x: 1, y: 2, z: 3, orientation: 11 };
    const world = worldTransform(c);
    doc.history.execute(new MoveNodeCommand('Into group', c, group, 0));
    expect(c.parent).toBe(group);
    expect(worldTransform(c)).toEqual(world);
    doc.history.undo();
    expect(c.parent).toBe(scene.root);
    expect(c.transform).toEqual({ x: 1, y: 2, z: 3, orientation: 11 });
    expect(() => new MoveNodeCommand('x', group, group, 0)).toThrow();
  });

  it('removes and duplicates nodes with their voxels, undoably', () => {
    const { doc, scene, a, b } = setup();
    const [copy] = duplicateNodes(doc, [a]);
    expect(names(scene.root.children)).toEqual(['A', 'A', 'B', 'C']);
    expect(copy).not.toBe(a);
    expect(copy!.kind === 'object' && copy.volume.get(1, 2, 3)).toBe(5);
    // The copy has its own voxels.
    a.volume.set(1, 2, 3, 0);
    expect(copy!.kind === 'object' && copy.volume.get(1, 2, 3)).toBe(5);
    removeNodes(doc, [a, b]);
    expect(names(scene.root.children)).toEqual(['A', 'C']);
    doc.history.undo();
    expect(names(scene.root.children)).toEqual(['A', 'A', 'B', 'C']);
    expect(scene.root.children[0]).toBe(a);
  });

  it('duplicates a group with everything inside', () => {
    const { doc, scene, a, b } = setup();
    const group = groupNodes(doc, [a, b], 'G')!;
    const [copy] = duplicateNodes(doc, [group, a]);
    expect(names(scene.root.children)).toEqual(['G', 'G', 'C']);
    expect(copy!.kind === 'group' && names(copy.children)).toEqual(['A', 'B']);
    expect(scene.objects()).toHaveLength(5);
  });

  it('merges transforms of the same drag and renames, hides and locks', () => {
    const { doc, a } = setup();
    const t = (x: number): Transform => ({ x, y: 0, z: 0, orientation: 0 });
    doc.history.execute(new TransformCommand('Move', [a], [t(0)], [t(1)]), { merge: true });
    doc.history.execute(new TransformCommand('Move', [a], [t(1)], [t(2)]), { merge: true });
    expect(doc.history.undoDepth).toBe(1);
    expect(a.transform.x).toBe(2);
    doc.history.undo();
    expect(a.transform.x).toBe(0);
    doc.history.execute(new NodePropertyCommand('Rename', a, 'name', 'House'));
    doc.history.execute(new NodePropertyCommand('Hide', a, 'hidden', true));
    expect([a.name, a.hidden]).toEqual(['House', true]);
    doc.history.undo();
    doc.history.undo();
    expect([a.name, a.hidden]).toEqual(['A', false]);
  });

  it('turns objects about the centre of their bounds, back after four turns', () => {
    const { doc, a, b } = setup();
    a.volume.set(4, 2, 3, 5);
    b.volume.set(0, 0, 0, 1);
    b.transform = { x: 10, y: 0, z: 0, orientation: 0 };
    const box = worldBounds([a, b])!;
    expect(box).toEqual({ minX: 1, minY: 0, minZ: 0, maxX: 10, maxY: 2, maxZ: 3 });
    const turn = quarterTurn(1);
    orientNodes(doc, [a, b], turn, 'Turn');
    expect(doc.history.undoDepth).toBe(1);
    const turned = worldBounds([a, b])!;
    // The 10 × 4 footprint becomes 4 × 10 around the same centre (rounded to the grid).
    expect([turned.maxX - turned.minX, turned.maxZ - turned.minZ]).toEqual([3, 9]);
    expect(Math.abs(turned.minX + turned.maxX - (box.minX + box.maxX))).toBeLessThanOrEqual(1);
    for (let i = 0; i < 3; i++) orientNodes(doc, [a, b], turn, 'Turn');
    expect(worldBounds([a, b])).toEqual(box);
  });

  it('moves nodes in world space whatever their parents, skipping locked ones', () => {
    const { doc, a, b, c } = setup();
    const group = groupNodes(doc, [a], 'G')!;
    group.transform = { x: 0, y: 0, z: 0, orientation: quarterTurn(1) };
    const before = worldTransform(a);
    c.locked = true;
    transformNodes(doc, [a, b, c], { x: 2, y: 0, z: 0, orientation: 0 }, 'Move');
    expect(worldTransform(a)).toEqual({ ...before, x: before.x + 2 });
    expect(b.transform.x).toBe(2);
    expect(c.transform.x).toBe(0);
  });

  it('turns a square footprint exactly in place, odd or even', () => {
    for (const size of [49, 8]) {
      const { doc, a } = setup();
      a.volume.set(1, 2, 3, 0);
      a.volume.set(0, 0, 0, 1);
      a.volume.set(size - 1, 3, size - 1, 1);
      const box = worldBounds([a]);
      for (let i = 0; i < 4; i++) {
        orientNodes(doc, [a], quarterTurn(1), 'Turn');
        expect(worldBounds([a])).toEqual(box);
      }
    }
  });
});
