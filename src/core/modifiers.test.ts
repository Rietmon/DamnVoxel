import { describe, expect, it } from 'vitest';
import { applyModifiers, type Modifier } from './modifiers';
import { cellsOperation, type Operation } from './operation';

function cells(op: Operation): string[] {
  const out: string[] = [];
  op.forEachCell((x, y, z, c) => out.push(`${x},${y},${z}:${c}`));
  return out;
}

/** Shifts cells along X: a stand-in for real modifiers. */
const shift =
  (dx: number): Modifier =>
  (op) => ({
    action: op.action,
    forEachCell: (visit) => op.forEachCell((x, y, z, c) => visit(x + dx, y, z, c)),
  });

/** Keeps cells with x ≥ 0. */
const clip: Modifier = (op) => ({
  action: op.action,
  forEachCell: (visit) =>
    op.forEachCell((x, y, z, c) => {
      if (x >= 0) visit(x, y, z, c);
    }),
});

describe('applyModifiers', () => {
  it('passes the operation through unchanged without modifiers', () => {
    const op = cellsOperation('add', 3, [1, 2, 3]);
    expect(applyModifiers(op, [])).toBe(op);
  });

  it('applies modifiers in order and keeps action and colour', () => {
    const op = cellsOperation('paint', 7, [-2, 0, 0, 0, 0, 0]);
    expect(cells(applyModifiers(op, [shift(1), clip]))).toEqual(['1,0,0:7']);
    expect(cells(applyModifiers(op, [clip, shift(1)]))).toEqual(['1,0,0:7']);
    expect(cells(applyModifiers(op, [shift(3), clip]))).toEqual(['1,0,0:7', '3,0,0:7']);
    expect(applyModifiers(op, [shift(1)]).action).toBe('paint');
  });
});
