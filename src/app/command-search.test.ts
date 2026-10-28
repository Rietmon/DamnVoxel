import { describe, expect, it } from 'vitest';
import type { Action } from './actions';
import { searchActions } from './command-search';

const action = (id: string, title: string, group = 'Edit'): Action => ({
  id,
  title,
  group,
  run: () => {},
});

const ACTIONS = [
  action('edit.undo', 'Undo'),
  action('camera.front', 'Front view', 'Camera'),
  action('mirror.x', 'Mirror on X', 'Mirror'),
  action('select.all', 'Select all', 'Selection'),
  action('scene.delete', 'Delete object', 'Scene'),
  action('palette.gradient', 'Gradient between the end colors', 'Palette'),
];
const keys: Record<string, string> = { 'edit.undo': 'Ctrl+Z', 'select.all': 'Ctrl+A' };
const shortcut = (id: string) => keys[id] ?? null;
const ids = (list: Action[]) => list.map((a) => a.id);

describe('command search', () => {
  it('lists everything for an empty query, recent actions first', () => {
    expect(ids(searchActions(ACTIONS, '  ', shortcut))).toEqual(ids(ACTIONS));
    const recent = ['mirror.x', 'scene.delete'];
    expect(ids(searchActions(ACTIONS, '', shortcut, recent)).slice(0, 3)).toEqual([
      'mirror.x',
      'scene.delete',
      'edit.undo',
    ]);
  });

  it('matches every word in title, group or shortcut, ignoring case', () => {
    expect(ids(searchActions(ACTIONS, 'mirr x', shortcut))).toEqual(['mirror.x']);
    expect(ids(searchActions(ACTIONS, 'camera', shortcut))).toEqual(['camera.front']);
    expect(ids(searchActions(ACTIONS, 'ctrl+a', shortcut))).toEqual(['select.all']);
    expect(ids(searchActions(ACTIONS, 'SELECT ALL', shortcut))).toEqual(['select.all']);
    expect(searchActions(ACTIONS, 'no such thing', shortcut)).toEqual([]);
  });

  it('puts titles that start with the query before ones that only contain it', () => {
    const list = [
      action('a', 'Color from palette'),
      action('b', 'Replace color'),
      action('c', 'Colors'),
    ];
    expect(ids(searchActions(list, 'color', shortcut))).toEqual(['a', 'c', 'b']);
    expect(ids(searchActions(ACTIONS, 'color', shortcut))).toEqual(['palette.gradient']);
  });
});
