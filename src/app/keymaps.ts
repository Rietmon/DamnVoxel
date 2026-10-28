import { normalizeCombo } from '../input/hotkeys';
import type { MouseLayout } from '../input/types';

/**
 * Control layouts: people come from MagicaVoxel,
 * Blockbench or Blender with their hands already trained. A preset changes the keys that differ
 * and which mouse buttons move the camera; on top of it every key can be reassigned, and the
 * result exported and imported as a small JSON file.
 */

export type KeymapPreset = 'magicavoxel' | 'blockbench' | 'blender';

export interface KeymapDefinition {
  readonly title: string;
  /** One line about the mouse, shown under the preset choice. */
  readonly mouseNote: string;
  readonly mouse: MouseLayout;
  /** Keys that differ from the actions' own defaults (those follow MagicaVoxel). */
  readonly keys: Readonly<Record<string, readonly string[]>>;
}

export const KEYMAPS: Readonly<Record<KeymapPreset, KeymapDefinition>> = {
  magicavoxel: {
    title: 'MagicaVoxel',
    mouseNote: 'Right button — orbit, middle — pan, wheel — zoom',
    mouse: { orbit: [{ button: 2 }], pan: [{ button: 1 }], zoom: [] },
    keys: {},
  },
  blockbench: {
    title: 'Blockbench',
    mouseNote: 'Right button — orbit, middle or Shift + right — pan, wheel — zoom',
    mouse: { orbit: [{ button: 2 }], pan: [{ button: 1 }, { button: 2, shift: true }], zoom: [] },
    keys: {
      'edit.duplicate': ['Ctrl+KeyD'],
      'select.none': ['Ctrl+Shift+KeyA'],
      'tool.move': ['KeyV'],
      'tool.brush': ['KeyB'],
      'tool.box': ['Shift+KeyB'],
    },
  },
  blender: {
    title: 'Blender',
    mouseNote: 'Middle button — orbit, Shift + middle — pan, Ctrl + middle or wheel — zoom',
    mouse: {
      orbit: [{ button: 1 }, { button: 2 }],
      pan: [{ button: 1, shift: true }],
      zoom: [{ button: 1, ctrl: true }],
    },
    keys: {
      'app.commands': ['F3', 'Ctrl+KeyK'],
      'edit.redo': ['Ctrl+Shift+KeyZ'],
      'edit.delete': ['KeyX', 'Delete'],
      'edit.duplicate': ['Shift+KeyD'],
      'camera.fit': ['NumpadDecimal', 'KeyF'],
      'select.all': ['KeyA'],
      'select.none': ['Alt+KeyA'],
      'action.add': ['Shift+KeyA'],
      'action.erase': ['Shift+KeyE'],
      'tool.face': ['KeyE'],
      'tool.move': ['KeyG'],
      'tool.select-rect': ['KeyB'],
      'tool.box': ['Shift+KeyB'],
    },
  },
};

export const KEYMAP_PRESETS = Object.keys(KEYMAPS) as KeymapPreset[];

/** The person's layout: a preset and their own keys for some actions (an empty list: no key). */
export interface KeymapSettings {
  preset: KeymapPreset;
  overrides: Readonly<Record<string, readonly string[]>>;
}

export const DEFAULT_KEYMAP: KeymapSettings = { preset: 'magicavoxel', overrides: {} };

interface Bindable {
  readonly id: string;
  readonly keys?: readonly string[];
}

/**
 * Every action's keys under a layout, most important first: the person's own keys, then the
 * preset, then the defaults. A key taken by an earlier entry is dropped from the later ones, so
 * assigning a key takes it away from whatever had it.
 */
export function keymapEntries(
  actions: readonly Bindable[],
  settings: KeymapSettings,
): [string, readonly string[]][] {
  const preset = KEYMAPS[settings.preset].keys;
  const own: [string, readonly string[]][] = [];
  const fromPreset: [string, readonly string[]][] = [];
  const rest: [string, readonly string[]][] = [];
  for (const a of actions) {
    const mine = settings.overrides[a.id];
    if (mine) own.push([a.id, mine]);
    else if (preset[a.id]) fromPreset.push([a.id, preset[a.id]!]);
    else rest.push([a.id, a.keys ?? []]);
  }
  return [...own, ...fromPreset, ...rest];
}

/**
 * Gives `combo` to an action: its keys become `keys`, and any other action holding one of them
 * loses it (also recorded as an override, so the change survives a reload).
 */
export function assignKeys(
  settings: KeymapSettings,
  actionId: string,
  keys: readonly string[],
  current: (id: string) => readonly string[],
  holders: (combo: string) => string | undefined,
): KeymapSettings {
  const normal = [...new Set(keys.map(normalizeCombo))];
  const overrides: Record<string, readonly string[]> = {
    ...settings.overrides,
    [actionId]: normal,
  };
  for (const combo of normal) {
    const holder = holders(combo);
    if (holder && holder !== actionId) {
      overrides[holder] = (overrides[holder] ?? current(holder)).filter((c) => c !== combo);
    }
  }
  return { ...settings, overrides };
}

/** Back to what the preset says for one action. */
export function resetKeys(settings: KeymapSettings, actionId: string): KeymapSettings {
  const { [actionId]: _, ...overrides } = settings.overrides;
  return { ...settings, overrides };
}

const FORMAT = 'voxels-keymap';

/** The layout as a file to share or keep. */
export function exportKeymap(settings: KeymapSettings): string {
  return `${JSON.stringify({ format: FORMAT, version: 1, preset: settings.preset, keys: settings.overrides }, null, 2)}\n`;
}

/** Reads an exported layout; throws with a message for people on anything else. */
export function importKeymap(text: string): KeymapSettings {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This is not a key layout file: not JSON');
  }
  const d = data as { format?: unknown; preset?: unknown; keys?: unknown };
  if (d.format !== FORMAT) throw new Error('This is not a key layout file');
  return sanitizeKeymap({ preset: d.preset, overrides: d.keys } as Partial<KeymapSettings>);
}

/** Keeps only what makes sense: a known preset, lists of key combinations. */
export function sanitizeKeymap(raw: Partial<KeymapSettings> | null | undefined): KeymapSettings {
  const preset = KEYMAP_PRESETS.includes(raw?.preset as KeymapPreset)
    ? (raw!.preset as KeymapPreset)
    : DEFAULT_KEYMAP.preset;
  const overrides: Record<string, readonly string[]> = {};
  const source = raw?.overrides;
  if (source && typeof source === 'object') {
    for (const [id, keys] of Object.entries(source)) {
      if (!Array.isArray(keys)) continue;
      const combos = keys.filter((k): k is string => typeof k === 'string' && /^[\w+]+$/.test(k));
      overrides[id] = combos.map(normalizeCombo);
    }
  }
  return { preset, overrides };
}
