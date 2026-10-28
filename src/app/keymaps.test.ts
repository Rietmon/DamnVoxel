import { describe, expect, it } from 'vitest';
import { HotkeyMap } from '../input/hotkeys';
import {
  assignKeys,
  DEFAULT_KEYMAP,
  exportKeymap,
  importKeymap,
  KEYMAP_PRESETS,
  KEYMAPS,
  keymapEntries,
  resetKeys,
  sanitizeKeymap,
} from './keymaps';

const ACTIONS = [
  { id: 'edit.undo', keys: ['Ctrl+KeyZ'] },
  { id: 'select.all', keys: ['Ctrl+KeyA'] },
  { id: 'action.add', keys: ['KeyA'] },
  { id: 'tool.face', keys: ['KeyX'] },
  { id: 'edit.delete', keys: ['Delete', 'Backspace'] },
  { id: 'tool.move', keys: ['KeyT'] },
];

function load(settings = DEFAULT_KEYMAP) {
  const map = new HotkeyMap();
  map.load(keymapEntries(ACTIONS, settings));
  return map;
}

describe('keymaps', () => {
  it('uses the actions’ own keys by default', () => {
    const map = load();
    expect(map.lookup('Ctrl+KeyA')).toBe('select.all');
    expect(map.lookup('KeyA')).toBe('action.add');
  });

  it('lets a preset take keys away from the defaults', () => {
    const map = load({ preset: 'blender', overrides: {} });
    expect(map.lookup('KeyA')).toBe('select.all');
    expect(map.lookup('KeyX')).toBe('edit.delete');
    expect(map.lookup('KeyG')).toBe('tool.move');
    expect(map.combosOf('tool.face')).toEqual(['KeyE']);
    expect(map.combosOf('action.add')).toEqual(['Shift+KeyA']);
    // Keys the preset does not mention stay.
    expect(map.lookup('Ctrl+KeyZ')).toBe('edit.undo');
  });

  it('puts the person’s own keys above the preset', () => {
    const map = load({ preset: 'blender', overrides: { 'tool.face': ['KeyX'] } });
    expect(map.lookup('KeyX')).toBe('tool.face');
    expect(map.combosOf('edit.delete')).toEqual(['Delete']);
  });

  it('takes a key from its old action when assigning it', () => {
    const map = load();
    const next = assignKeys(
      DEFAULT_KEYMAP,
      'tool.move',
      ['Shift+Ctrl+KeyA', 'KeyX'],
      (id) => map.combosOf(id),
      (c) => map.lookup(c),
    );
    expect(next.overrides).toEqual({ 'tool.move': ['Ctrl+Shift+KeyA', 'KeyX'], 'tool.face': [] });
    const after = load(next);
    expect(after.lookup('KeyX')).toBe('tool.move');
    expect(resetKeys(next, 'tool.move').overrides).toEqual({ 'tool.face': [] });
  });

  it('exports and imports a layout, refusing other files', () => {
    const settings = { preset: 'blockbench' as const, overrides: { 'edit.undo': ['Ctrl+KeyU'] } };
    expect(importKeymap(exportKeymap(settings))).toEqual(settings);
    expect(() => importKeymap('nope')).toThrow(/not JSON/);
    expect(() => importKeymap('{"format":"x"}')).toThrow(/not a key layout file/);
  });

  it('cleans stored settings', () => {
    expect(sanitizeKeymap(null)).toEqual(DEFAULT_KEYMAP);
    expect(
      sanitizeKeymap({
        preset: 'maya' as never,
        overrides: { a: ['Shift+Ctrl+KeyQ', 5, 'bad key'] as never, b: 'x' as never },
      }),
    ).toEqual({ preset: 'magicavoxel', overrides: { a: ['Ctrl+Shift+KeyQ'] } });
  });

  it('gives every preset a mouse layout that moves the camera', () => {
    for (const p of KEYMAP_PRESETS) {
      expect(KEYMAPS[p].mouse.orbit.length).toBeGreaterThan(0);
      expect(KEYMAPS[p].mouse.pan.length).toBeGreaterThan(0);
    }
  });
});
