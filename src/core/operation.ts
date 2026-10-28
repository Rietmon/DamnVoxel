/**
 * An operation describes an edit independently of the tool that made it: an action and the
 * cells it applies to, in object-local coordinates. Modifiers (mirror, selection mask)
 * transform operations; the executor writes them. See docs/architecture.md, "Modifiers".
 */

export type EditAction = 'add' | 'erase' | 'paint';

/** Visits a cell with the palette id add and paint write there. */
export type CellVisitor = (x: number, y: number, z: number, color: number) => void;

export interface Operation {
  readonly action: EditAction;
  /** Visits every cell of the operation; a cell may be visited more than once. */
  forEachCell(visit: CellVisitor): void;
}

/** Operation over an explicit list of cells (flat x, y, z triples) in one colour. */
export function cellsOperation(
  action: EditAction,
  color: number,
  cells: ArrayLike<number>,
): Operation {
  return {
    action,
    forEachCell(visit) {
      for (let i = 0; i + 2 < cells.length; i += 3)
        visit(cells[i]!, cells[i + 1]!, cells[i + 2]!, color);
    },
  };
}

/** Operation over flat x, y, z, colour quadruples: every cell has its own colour. */
export function colouredCellsOperation(action: EditAction, cells: ArrayLike<number>): Operation {
  return {
    action,
    forEachCell(visit) {
      for (let i = 0; i + 3 < cells.length; i += 4) {
        visit(cells[i]!, cells[i + 1]!, cells[i + 2]!, cells[i + 3]!);
      }
    },
  };
}

/**
 * The value a cell gets: add fills only empty cells, erase empties only filled ones, paint
 * recolours only filled ones. Returns the current value when the action does not apply.
 */
export function resultValue(action: EditAction, color: number, current: number): number {
  switch (action) {
    case 'add':
      return current === 0 ? color : current;
    case 'erase':
      return 0;
    case 'paint':
      return current === 0 ? 0 : color;
  }
}

export interface CellWriter {
  get(x: number, y: number, z: number): number;
  set(x: number, y: number, z: number, value: number): void;
}

/** Applies an operation through a writer; returns how many cells changed. */
export function executeOperation(op: Operation, target: CellWriter): number {
  let changed = 0;
  op.forEachCell((x, y, z, color) => {
    const current = target.get(x, y, z);
    const next = resultValue(op.action, color, current);
    if (next !== current) {
      target.set(x, y, z, next);
      changed++;
    }
  });
  return changed;
}
