import { describe, expect, it } from 'vitest';
import { ActionRegistry } from './actions';
import { clipboardActions } from './clipboard-actions';
import { editorActions } from './default-actions';
import type { Editor } from './editor';
import { fileActions } from './files';
import { modelActions } from './model-actions';
import { paletteActions } from './palette-actions';
import { sceneActions } from './scene-actions';
import { selectionActions } from './selection-actions';
import { toolActions } from './tool-actions';

/** Stands in for any object: every property and every call returns itself. */
function anything(): unknown {
  const proxy: unknown = new Proxy(() => {}, { get: () => proxy, apply: () => proxy });
  return proxy;
}

describe('editor actions', () => {
  it('register without id or shortcut conflicts', () => {
    const editor = anything() as Editor;
    const registry = new ActionRegistry();
    expect(() =>
      registry.register(
        ...editorActions(editor),
        ...toolActions(editor),
        ...selectionActions(editor),
        ...clipboardActions(editor),
        ...sceneActions(editor),
        ...paletteActions(editor),
        ...fileActions(editor),
        ...modelActions(editor),
      ),
    ).not.toThrow();
    const ids = registry.all().map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of registry.all()) {
      expect(a.title.length, a.id).toBeGreaterThan(0);
      expect(a.group.length, a.id).toBeGreaterThan(0);
    }
  });
});
