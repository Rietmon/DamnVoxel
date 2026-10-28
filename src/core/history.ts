import type { VoxelDocument } from './document';

/**
 * The only way to change a document (docs/architecture.md, "Commands and history").
 * `apply` and `revert` must be exact inverses.
 */
export interface Command {
  readonly label: string;
  /** Approximate memory the command holds, in bytes; counts against the history limit. */
  readonly bytes: number;
  apply(doc: VoxelDocument): void;
  revert(doc: VoxelDocument): void;
  /**
   * Absorbs `next`, which has already been applied, so both become one step.
   * Returns false when the two cannot be one step.
   */
  merge?(next: Command): boolean;
}

/** Default history memory limit; a setting can change it. */
export const DEFAULT_HISTORY_LIMIT_BYTES = 256 * 1024 * 1024;

interface Entry {
  readonly command: Command;
  /** Unique, increasing; identifies the document state right after this command. */
  id: number;
  /** Memory of the command and everything merged into it. */
  bytes: number;
}

/**
 * Undo and redo stacks with a memory limit instead of a step limit. The oldest steps are
 * dropped when the limit is exceeded; the newest step is always kept.
 */
export class History {
  limitBytes = DEFAULT_HISTORY_LIMIT_BYTES;

  private readonly undoStack: Entry[] = [];
  private readonly redoStack: Entry[] = [];
  private bytes = 0;
  private nextId = 1;
  /** Id of the state below the oldest kept step; changes when old steps are dropped. */
  private baseId = 0;
  /** State id at the last save; 0 is the initial state. */
  private savedId = 0;
  private mergeOpen = false;

  constructor(private readonly doc: VoxelDocument) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoLabel(): string | null {
    return this.undoStack.at(-1)?.command.label ?? null;
  }

  /** The step undo would take back, or null. */
  get last(): Command | null {
    return this.undoStack.at(-1)?.command ?? null;
  }

  get redoLabel(): string | null {
    return this.redoStack.at(-1)?.command.label ?? null;
  }

  get memoryBytes(): number {
    return this.bytes;
  }

  get undoDepth(): number {
    return this.undoStack.length;
  }

  /** True when the document differs from the last saved (or initial) state. */
  get isModified(): boolean {
    return this.currentId !== this.savedId;
  }

  /** Remembers the current state as saved. */
  markSaved(): void {
    this.savedId = this.currentId;
    this.mergeOpen = false;
    this.doc.notify('history');
  }

  /** Applies a command and records it. */
  execute(command: Command, options: { merge?: boolean } = {}): void {
    command.apply(this.doc);
    this.push(command, options);
  }

  /**
   * Records a command whose effect is already in the document (a stroke written live).
   * With `merge`, the command may be absorbed by the previous step of the same gesture.
   */
  push(command: Command, options: { merge?: boolean } = {}): void {
    this.dropRedo();
    const top = this.undoStack.at(-1);
    if (options.merge && this.mergeOpen && top?.command.merge?.(command)) {
      // The merged step leads to a new state, so it gets a new id.
      top.id = this.nextId++;
      top.bytes += command.bytes;
    } else {
      this.undoStack.push({ command, id: this.nextId++, bytes: command.bytes });
    }
    this.bytes += command.bytes;
    this.mergeOpen = options.merge === true;
    this.trim();
    this.doc.notify('history');
  }

  /** Ends the current gesture: the next step will not merge into the previous one. */
  closeMerge(): void {
    this.mergeOpen = false;
  }

  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    entry.command.revert(this.doc);
    this.redoStack.push(entry);
    this.mergeOpen = false;
    this.doc.notify('history');
    return true;
  }

  redo(): boolean {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    entry.command.apply(this.doc);
    this.undoStack.push(entry);
    this.mergeOpen = false;
    this.doc.notify('history');
    return true;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.bytes = 0;
    this.savedId = this.currentId;
    this.mergeOpen = false;
    this.doc.notify('history');
  }

  private get currentId(): number {
    return this.undoStack.at(-1)?.id ?? this.baseId;
  }

  private dropRedo(): void {
    for (const entry of this.redoStack) this.bytes -= entry.bytes;
    this.redoStack.length = 0;
  }

  private trim(): void {
    while (this.bytes > this.limitBytes && this.undoStack.length > 1) {
      const dropped = this.undoStack.shift()!;
      this.bytes -= dropped.bytes;
      this.baseId = dropped.id;
    }
  }
}

/** Several commands as one step, applied in order and reverted in reverse. */
export class CompositeCommand implements Command {
  readonly bytes: number;

  constructor(
    readonly label: string,
    private readonly parts: readonly Command[],
  ) {
    this.bytes = parts.reduce((sum, part) => sum + part.bytes, 0);
  }

  apply(doc: VoxelDocument): void {
    for (const part of this.parts) part.apply(doc);
  }

  revert(doc: VoxelDocument): void {
    for (let i = this.parts.length - 1; i >= 0; i--) this.parts[i]!.revert(doc);
  }
}
