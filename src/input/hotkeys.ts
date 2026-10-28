/**
 * Key combinations by physical key (`KeyboardEvent.code`), so shortcuts stay in place on any
 * layout, Russian included: "Ctrl+Shift+KeyZ". Ctrl means Cmd on macOS.
 */

export interface KeyLike {
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

const MODIFIER_CODES = new Set([
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
]);

/** The combination of a key event, or null for a bare modifier key. */
export function comboFromEvent(e: KeyLike, mac = false): string | null {
  if (MODIFIER_CODES.has(e.code) || !e.code) return null;
  const parts: string[] = [];
  if (mac ? e.metaKey : e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(e.code);
  return parts.join('+');
}

/** Puts modifiers of a combination written by hand into the canonical order. */
export function normalizeCombo(combo: string): string {
  const parts = combo.split('+');
  const key = parts.pop()!;
  const mods = new Set(parts);
  return [...['Ctrl', 'Alt', 'Shift'].filter((m) => mods.has(m)), key].join('+');
}

const KEY_LABELS: Record<string, string> = {
  Space: 'Space',
  Escape: 'Esc',
  Enter: 'Enter',
  Backspace: '⌫',
  Delete: 'Del',
  Tab: 'Tab',
  Home: 'Home',
  End: 'End',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Minus: '−',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backquote: '`',
  Slash: '/',
  Backslash: '\\',
  Comma: ',',
  Period: '.',
  Semicolon: ';',
  Quote: "'",
  NumpadAdd: 'Num+',
  NumpadSubtract: 'Num−',
  NumpadDecimal: 'Num.',
};

/** Human-readable label of a key code: "KeyZ" → "Z", "Numpad1" → "Num1". */
export function keyLabel(code: string): string {
  if (KEY_LABELS[code]) return KEY_LABELS[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num${code.slice(6)}`;
  return code;
}

/** "Ctrl+Shift+KeyZ" → "Ctrl+Shift+Z" (⌘ instead of Ctrl on macOS). */
export function formatCombo(combo: string, mac = false): string {
  const parts = combo.split('+');
  const key = parts.pop()!;
  return [...parts.map((p) => (mac && p === 'Ctrl' ? '⌘' : p)), keyLabel(key)].join('+');
}

/**
 * Table from key combinations to action ids. Defaults come from the actions; a layout (preset
 * and the person's own keys) replaces the whole table with load().
 */
export class HotkeyMap {
  private readonly byCombo = new Map<string, string>();
  private readonly byAction = new Map<string, string[]>();

  bind(actionId: string, combos: readonly string[]): void {
    for (const raw of combos) {
      const combo = normalizeCombo(raw);
      const previous = this.byCombo.get(combo);
      if (previous && previous !== actionId) {
        throw new Error(`Shortcut ${combo} is taken by ${previous}, cannot bind ${actionId}`);
      }
      this.byCombo.set(combo, actionId);
      const list = this.byAction.get(actionId) ?? [];
      if (!list.includes(combo)) list.push(combo);
      this.byAction.set(actionId, list);
    }
  }

  /**
   * Replaces every binding. Earlier entries win: a combination already taken is skipped for the
   * later ones.
   */
  load(entries: readonly (readonly [string, readonly string[]])[]): void {
    this.byCombo.clear();
    this.byAction.clear();
    for (const [actionId, combos] of entries) {
      const list: string[] = [];
      for (const raw of combos) {
        const combo = normalizeCombo(raw);
        if (this.byCombo.has(combo)) continue;
        this.byCombo.set(combo, actionId);
        list.push(combo);
      }
      this.byAction.set(actionId, list);
    }
  }

  unbind(actionId: string): void {
    for (const combo of this.byAction.get(actionId) ?? []) this.byCombo.delete(combo);
    this.byAction.delete(actionId);
  }

  lookup(combo: string): string | undefined {
    return this.byCombo.get(combo);
  }

  combosOf(actionId: string): readonly string[] {
    return this.byAction.get(actionId) ?? [];
  }
}
