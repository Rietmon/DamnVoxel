import { type GroupNode, isInside, type SceneNode } from '../core/scene';

/** One visible line of the scene tree. */
export interface TreeRow {
  readonly node: SceneNode;
  readonly depth: number;
  /** For groups: whether the children are shown below. */
  readonly expanded: boolean;
}

/** Visible rows, depth first; children of collapsed groups are left out. The root is not a row. */
export function treeRows(root: GroupNode, collapsed: ReadonlySet<number>): TreeRow[] {
  const rows: TreeRow[] = [];
  const visit = (node: SceneNode, depth: number) => {
    const expanded = node.kind === 'group' && !collapsed.has(node.id);
    rows.push({ node, depth, expanded });
    if (node.kind === 'group' && expanded)
      for (const child of node.children) visit(child, depth + 1);
  };
  for (const child of root.children) visit(child, 0);
  return rows;
}

/** Where dropped nodes go: into `parent`, right before `before` (at the end when null). */
export interface DropTarget {
  readonly parent: GroupNode;
  readonly before: SceneNode | null;
  /** What to draw: a line above or below a row, or the row of a group highlighted. */
  readonly row: number;
  readonly place: 'above' | 'below' | 'inside';
}

/**
 * The drop target for a pointer over row `index` at `fraction` of its height (0 top, 1 bottom);
 * an index past the last row means below everything. Null when the drop would put a group
 * inside itself.
 */
export function dropTarget(
  rows: readonly TreeRow[],
  root: GroupNode,
  index: number,
  fraction: number,
  dragged: readonly SceneNode[],
): DropTarget | null {
  let target: DropTarget;
  const row = rows[index];
  if (!row) {
    target = { parent: root, before: null, row: rows.length - 1, place: 'below' };
  } else {
    const node = row.node;
    const parent = node.parent ?? root;
    const isGroup = node.kind === 'group';
    if (isGroup && fraction > 0.25 && fraction < 0.75) {
      target = { parent: node, before: null, row: index, place: 'inside' };
    } else if (fraction < 0.5) {
      target = { parent, before: node, row: index, place: 'above' };
    } else if (isGroup && row.expanded && node.children.length > 0) {
      // Below an open group means at the top of its children.
      target = { parent: node, before: node.children[0]!, row: index, place: 'below' };
    } else {
      const next = parent.children[parent.children.indexOf(node) + 1] ?? null;
      target = { parent, before: next, row: index, place: 'below' };
    }
  }
  if (dragged.some((n) => isInside(target.parent, n))) return null;
  return target;
}

/** Nodes of the rows between two nodes, both included, in row order (Shift-click). */
export function rowRange(rows: readonly TreeRow[], from: SceneNode, to: SceneNode): SceneNode[] {
  const a = rows.findIndex((r) => r.node === from);
  const b = rows.findIndex((r) => r.node === to);
  if (a < 0 || b < 0) return [to];
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return rows.slice(lo, hi + 1).map((r) => r.node);
}
