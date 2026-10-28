import { describe, expect, it } from 'vitest';
import { VoxelDocument } from './document';
import { type Command, CompositeCommand } from './history';

/** Adds `delta` to a shared counter; merges with other counter steps. */
class CounterCommand implements Command {
  readonly label = 'count';
  bytes: number;

  constructor(
    private readonly state: { value: number },
    private delta: number,
    bytes = 10,
  ) {
    this.bytes = bytes;
  }

  apply(): void {
    this.state.value += this.delta;
  }

  revert(): void {
    this.state.value -= this.delta;
  }

  merge(next: Command): boolean {
    if (!(next instanceof CounterCommand)) return false;
    this.delta += next.delta;
    return true;
  }
}

describe('History', () => {
  it('undoes and redoes in order and drops redo after a new step', () => {
    const doc = new VoxelDocument();
    const state = { value: 0 };
    const h = doc.history;
    h.execute(new CounterCommand(state, 1));
    h.execute(new CounterCommand(state, 10));
    expect(state.value).toBe(11);
    expect(h.undo()).toBe(true);
    expect(state.value).toBe(1);
    expect(h.canRedo).toBe(true);
    expect(h.redo()).toBe(true);
    expect(state.value).toBe(11);
    h.undo();
    h.execute(new CounterCommand(state, 100));
    expect(h.canRedo).toBe(false);
    expect(state.value).toBe(101);
    h.undo();
    h.undo();
    expect(state.value).toBe(0);
    expect(h.undo()).toBe(false);
  });

  it('merges steps of one gesture only', () => {
    const doc = new VoxelDocument();
    const state = { value: 0 };
    const h = doc.history;
    h.execute(new CounterCommand(state, 1), { merge: true });
    h.execute(new CounterCommand(state, 2), { merge: true });
    h.execute(new CounterCommand(state, 3), { merge: true });
    h.closeMerge();
    h.execute(new CounterCommand(state, 4), { merge: true });
    expect(h.undoDepth).toBe(2);
    h.undo();
    expect(state.value).toBe(6);
    h.undo();
    expect(state.value).toBe(0);
  });

  it('drops the oldest steps over the memory limit but keeps the newest', () => {
    const doc = new VoxelDocument();
    const state = { value: 0 };
    const h = doc.history;
    h.limitBytes = 100;
    for (let i = 0; i < 20; i++) h.execute(new CounterCommand(state, 1, 30));
    expect(h.undoDepth).toBe(3);
    expect(h.memoryBytes).toBeLessThanOrEqual(100);
    h.execute(new CounterCommand(state, 1, 500));
    expect(h.undoDepth).toBe(1);
    expect(h.memoryBytes).toBe(500);
  });

  it('tracks the saved state through undo, redo and new steps', () => {
    const doc = new VoxelDocument();
    const state = { value: 0 };
    const h = doc.history;
    expect(h.isModified).toBe(false);
    h.execute(new CounterCommand(state, 1));
    expect(h.isModified).toBe(true);
    h.markSaved();
    expect(h.isModified).toBe(false);
    h.undo();
    expect(h.isModified).toBe(true);
    h.redo();
    expect(h.isModified).toBe(false);
    h.execute(new CounterCommand(state, 1), { merge: true });
    expect(h.isModified).toBe(true);
    h.undo();
    h.execute(new CounterCommand(state, 5));
    h.undo();
    // The saved state is reachable again by undoing back to it.
    expect(h.isModified).toBe(false);
  });

  it('notifies listeners about history changes', () => {
    const doc = new VoxelDocument();
    const state = { value: 0 };
    doc.history.execute(new CounterCommand(state, 1));
    expect(doc.flush()?.history).toBe(true);
    expect(doc.flush()).toBeNull();
    doc.history.undo();
    expect(doc.flush()?.history).toBe(true);
  });

  it('applies composite parts in order and reverts them backwards', () => {
    const doc = new VoxelDocument();
    const log: string[] = [];
    const part = (name: string): Command => ({
      label: name,
      bytes: 1,
      apply: () => log.push(`+${name}`),
      revert: () => log.push(`-${name}`),
    });
    doc.history.execute(new CompositeCommand('both', [part('a'), part('b')]));
    doc.history.undo();
    expect(log).toEqual(['+a', '+b', '-b', '-a']);
  });

  it('names the next undo and redo steps and clears everything', () => {
    const doc = new VoxelDocument();
    const state = { value: 0 };
    const h = doc.history;
    expect(h.undoLabel).toBeNull();
    h.execute(new CounterCommand(state, 1));
    expect(h.undoLabel).toBe('count');
    h.undo();
    expect(h.redoLabel).toBe('count');
    h.clear();
    expect(h.canUndo || h.canRedo).toBe(false);
    expect(h.memoryBytes).toBe(0);
    expect(h.isModified).toBe(false);
    expect(h.redo()).toBe(false);
  });
});
