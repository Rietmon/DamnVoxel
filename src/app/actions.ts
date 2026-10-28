import { comboFromEvent, formatCombo, HotkeyMap, type KeyLike } from '../input/hotkeys';

/**
 * Everything the user can do by name: shortcuts, the command palette, tooltips and menus all
 * read this one list, so nothing is reachable only one way.
 */
export interface Action {
  readonly id: string;
  /** Short imperative title shown to people: “Undo”, “Front view”. */
  readonly title: string;
  /** Section in the command palette: “Edit”, “View”, “Camera”… */
  readonly group: string;
  /** Default shortcuts as physical-key combinations, see input/hotkeys.ts. */
  readonly keys?: readonly string[];
  /** Run again while the key is held (nudging with arrows). */
  readonly repeat?: boolean;
  /**
   * The browser handles the key itself and fires an event the editor listens to (copy, cut,
   * paste reach the system clipboard that way): the shortcut is shown but not intercepted.
   */
  readonly native?: boolean;
  run(): void;
  enabled?(): boolean;
  /** For toggles: whether the option is on. */
  checked?(): boolean;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export class ActionRegistry {
  readonly hotkeys = new HotkeyMap();
  private readonly actions = new Map<string, Action>();

  register(...actions: Action[]): void {
    for (const action of actions) {
      if (this.actions.has(action.id)) throw new Error(`Action ${action.id} is already registered`);
      this.actions.set(action.id, action);
      if (action.keys) this.hotkeys.bind(action.id, action.keys);
    }
  }

  get(id: string): Action | undefined {
    return this.actions.get(id);
  }

  /** All actions in registration order. */
  all(): Action[] {
    return [...this.actions.values()];
  }

  isEnabled(action: Action): boolean {
    return action.enabled?.() ?? true;
  }

  /** Runs an action if it exists and is enabled; returns whether it ran. */
  run(id: string): boolean {
    const action = this.actions.get(id);
    if (!action || !this.isEnabled(action)) return false;
    action.run();
    return true;
  }

  /** Rebinds every action from a layout (see app/keymaps.ts). */
  applyKeymap(entries: readonly (readonly [string, readonly string[]])[]): void {
    this.hotkeys.load(entries);
  }

  /** Every shortcut of an action as stored ("Ctrl+KeyZ"). */
  combos(id: string): readonly string[] {
    return this.hotkeys.combosOf(id);
  }

  /** A stored combination for people: "Ctrl+KeyZ" → «Ctrl+Z» (⌘ on macOS). */
  formatCombo(combo: string): string {
    return formatCombo(combo, isMac);
  }

  /** The combination of a key press, or null for a bare modifier. */
  comboOf(e: KeyLike): string | null {
    return comboFromEvent(e, isMac);
  }

  /** The first shortcut of an action for display, e.g. «Ctrl+Z», or null. */
  shortcut(id: string): string | null {
    const combo = this.hotkeys.combosOf(id)[0];
    return combo ? formatCombo(combo, isMac) : null;
  }
}
