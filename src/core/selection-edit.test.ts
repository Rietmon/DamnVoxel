import { describe, expect, it } from 'vitest';
import { VoxelDocument } from './document';
import { cellsOperation } from './operation';
import { SelectionMask } from './selection';
import {
  colorRegion,
  filledRegion,
  grownRegion,
  invertedRegion,
  SelectionTransaction,
  selectedColors,
  selectionMaskModifier,
  selectModeOf,
  shrunkRegion,
} from './selection-edit';

function setup() {
  const doc = VoxelDocument.createEmpty();
  const object = doc.scene.objects()[0]!;
  // A 5 × 5 × 5 cube.
  for (let x = 0; x < 5; x++)
    for (let y = 0; y < 5; y++) for (let z = 0; z < 5; z++) object.volume.set(x, y, z, 1);
  return { doc, object };
}

function region(...cells: [number, number, number][]): SelectionMask {
  const r = new SelectionMask();
  for (const [x, y, z] of cells) r.set(x, y, z, true);
  return r;
}

describe('selection edits', () => {
  it('maps modifiers to modes', () => {
    expect(selectModeOf(false, false)).toBe('replace');
    expect(selectModeOf(true, false)).toBe('add');
    expect(selectModeOf(false, true)).toBe('subtract');
    expect(selectModeOf(true, true)).toBe('intersect');
    expect(selectModeOf(false, false, 'add')).toBe('add');
  });

  it('combines regions in every mode as undoable commands', () => {
    const { doc, object } = setup();
    const apply = (r: SelectionMask, mode: Parameters<SelectionTransaction['combine']>[1]) => {
      const tx = new SelectionTransaction(object);
      tx.combine(r, mode);
      const cmd = tx.commit(mode);
      if (cmd) doc.history.push(cmd);
    };
    apply(region([0, 0, 0], [1, 0, 0]), 'replace');
    apply(region([2, 0, 0], [40, 0, 0]), 'add');
    expect(object.selection.count).toBe(4);
    apply(region([1, 0, 0]), 'subtract');
    expect(object.selection.has(1, 0, 0)).toBe(false);
    apply(region([0, 0, 0], [40, 0, 0], [3, 3, 3]), 'intersect');
    expect(object.selection.count).toBe(2);
    apply(region([4, 4, 4]), 'replace');
    expect(object.selection.count).toBe(1);
    // Undo walks back through every state.
    doc.history.undo();
    expect(object.selection.count).toBe(2);
    doc.history.undo();
    doc.history.undo();
    expect(object.selection.count).toBe(4);
    doc.history.undo();
    doc.history.undo();
    expect(object.selection.isEmpty).toBe(true);
    // A change that changes nothing is no step at all.
    const tx = new SelectionTransaction(object);
    tx.combine(new SelectionMask(), 'add');
    expect(tx.commit('noop')).toBeNull();
  });

  it('selects all, inverts, grows and shrinks', () => {
    const { object } = setup();
    expect(filledRegion(object).count).toBe(125);
    object.selection.set(2, 2, 2, true);
    expect(invertedRegion(object).count).toBe(124);
    const grown = grownRegion(object);
    expect(grown.count).toBe(7);
    object.selection.clear();
    const tx = new SelectionTransaction(object);
    tx.combine(filledRegion(object), 'replace');
    // Shrinking the full cube peels its surface: 3 × 3 × 3 remain.
    expect(shrunkRegion(object).count).toBe(27);
  });

  it('cancels back to the previous selection', () => {
    const { object } = setup();
    object.selection.set(1, 1, 1, true);
    const tx = new SelectionTransaction(object);
    tx.combine(region([2, 2, 2]), 'replace');
    expect(object.selection.has(1, 1, 1)).toBe(false);
    tx.cancel();
    expect(object.selection.has(1, 1, 1)).toBe(true);
    expect(object.selection.count).toBe(1);
  });
});

describe('colours and selection', () => {
  it('selects voxels by colour and reads back the colours of a selection', () => {
    const { object } = setup();
    object.volume.set(0, 0, 0, 3);
    object.volume.set(4, 4, 4, 7);
    const r = colorRegion(object, new Set([3, 7]));
    expect(r.count).toBe(2);
    expect(r.has(4, 4, 4)).toBe(true);
    object.selection.set(0, 0, 0, true);
    object.selection.set(1, 0, 0, true);
    expect(selectedColors(object).sort()).toEqual([1, 3]);
  });

  it('keeps edits inside or outside the selection', () => {
    const sel = region([0, 0, 0]);
    const op = cellsOperation('paint', 2, [0, 0, 0, 1, 0, 0]);
    const seen = (mask: 'all' | 'inside' | 'outside') => {
      const out: number[] = [];
      selectionMaskModifier(
        sel,
        mask,
      )(op).forEachCell((x) => {
        out.push(x);
      });
      return out;
    };
    expect(seen('all')).toEqual([0, 1]);
    expect(seen('inside')).toEqual([0]);
    expect(seen('outside')).toEqual([1]);
  });
});
