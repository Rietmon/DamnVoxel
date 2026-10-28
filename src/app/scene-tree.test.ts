import { describe, expect, it } from 'vitest';
import { VoxelDocument } from '../core/document';
import type { SceneNode } from '../core/scene';
import { groupNodes, moveNodes } from '../core/scene-edit';
import { dropTarget, rowRange, treeRows } from './scene-tree';

/** Scene: A, G { B, C }, D. */
function setup() {
  const doc = new VoxelDocument();
  const s = doc.scene;
  const [a, b, c, d] = ['A', 'B', 'C', 'D'].map((n) => s.createObject(n)) as [
    SceneNode,
    SceneNode,
    SceneNode,
    SceneNode,
  ];
  for (const o of [a, b, c, d]) s.attach(o, s.root);
  const g = groupNodes(doc, [b, c], 'G')!;
  doc.history.clear();
  return { doc, root: s.root, a, b, c, d, g };
}

const names = (nodes: readonly SceneNode[]) => nodes.map((n) => n.name);

describe('scene tree', () => {
  it('lists rows depth first and hides children of collapsed groups', () => {
    const { root, g } = setup();
    const rows = treeRows(root, new Set());
    expect(rows.map((r) => `${r.depth}${r.node.name}`)).toEqual(['0A', '0G', '1B', '1C', '0D']);
    expect(names(treeRows(root, new Set([g.id])).map((r) => r.node))).toEqual(['A', 'G', 'D']);
  });

  it('drops above, below and inside rows', () => {
    const { root, a, b, d, g } = setup();
    const rows = treeRows(root, new Set());
    // Upper half of D: before D in the root.
    expect(dropTarget(rows, root, 4, 0.2, [a])).toMatchObject({ parent: root, before: d });
    // Middle of the group row: into the group, at the end.
    expect(dropTarget(rows, root, 1, 0.5, [a])).toMatchObject({ parent: g, before: null });
    // Lower edge of the open group: first among its children.
    expect(dropTarget(rows, root, 1, 0.9, [a])).toMatchObject({ parent: g, before: b });
    // Past the last row: the end of the scene.
    expect(dropTarget(rows, root, 9, 0, [a])).toMatchObject({ parent: root, before: null });
    // A group cannot be dropped into itself or its children.
    expect(dropTarget(rows, root, 2, 0.2, [g])).toBeNull();
  });

  it('moves dropped nodes together and undoes the move', () => {
    const { doc, root, a, c, d, g } = setup();
    expect(moveNodes(doc, [d, a], g, c)).toBe(true);
    expect(names(g.children)).toEqual(['B', 'A', 'D', 'C']);
    expect(names(root.children)).toEqual(['G']);
    doc.history.undo();
    expect(names(root.children)).toEqual(['A', 'G', 'D']);
    expect(names(g.children)).toEqual(['B', 'C']);
    // Dropping right before itself keeps the order.
    moveNodes(doc, [a], root, a);
    expect(names(root.children)).toEqual(['A', 'G', 'D']);
    moveNodes(doc, [a], root, null);
    expect(names(root.children)).toEqual(['G', 'D', 'A']);
    expect(moveNodes(doc, [g], g, null)).toBe(false);
  });

  it('selects ranges of visible rows', () => {
    const { root, a, c, d } = setup();
    const rows = treeRows(root, new Set());
    expect(names(rowRange(rows, d, c))).toEqual(['C', 'D']);
    expect(names(rowRange(rows, a, c))).toEqual(['A', 'G', 'B', 'C']);
  });
});
