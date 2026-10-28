import { describe, expect, it } from 'vitest';
import { comboFromEvent, formatCombo, HotkeyMap, keyLabel, normalizeCombo } from './hotkeys';

const key = (
  code: string,
  mods: Partial<Record<'ctrl' | 'meta' | 'shift' | 'alt', boolean>> = {},
) => ({
  code,
  ctrlKey: !!mods.ctrl,
  metaKey: !!mods.meta,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt,
});

describe('hotkeys', () => {
  it('builds combinations from physical keys in a fixed modifier order', () => {
    expect(comboFromEvent(key('KeyZ', { ctrl: true, shift: true }))).toBe('Ctrl+Shift+KeyZ');
    expect(comboFromEvent(key('KeyZ', { meta: true }), true)).toBe('Ctrl+KeyZ');
    expect(comboFromEvent(key('KeyZ', { meta: true }), false)).toBe('KeyZ');
    expect(comboFromEvent(key('ShiftLeft', { shift: true }))).toBeNull();
    expect(normalizeCombo('Shift+Ctrl+KeyZ')).toBe('Ctrl+Shift+KeyZ');
  });

  it('labels keys for people', () => {
    expect(keyLabel('KeyF')).toBe('F');
    expect(keyLabel('Digit7')).toBe('7');
    expect(keyLabel('Numpad7')).toBe('Num7');
    expect(keyLabel('ArrowLeft')).toBe('←');
    expect(formatCombo('Ctrl+Shift+KeyZ')).toBe('Ctrl+Shift+Z');
    expect(formatCombo('Ctrl+KeyZ', true)).toBe('⌘+Z');
  });

  it('maps combinations to actions and refuses conflicts', () => {
    const map = new HotkeyMap();
    map.bind('undo', ['Ctrl+KeyZ']);
    map.bind('redo', ['Ctrl+Shift+KeyZ', 'Ctrl+KeyY']);
    expect(map.lookup('Ctrl+KeyY')).toBe('redo');
    expect(map.combosOf('redo')).toEqual(['Ctrl+Shift+KeyZ', 'Ctrl+KeyY']);
    expect(() => map.bind('other', ['Ctrl+KeyZ'])).toThrow(/taken by undo/);
    map.unbind('undo');
    expect(map.lookup('Ctrl+KeyZ')).toBeUndefined();
    map.bind('other', ['Ctrl+KeyZ']);
    expect(map.lookup('Ctrl+KeyZ')).toBe('other');
  });
});
