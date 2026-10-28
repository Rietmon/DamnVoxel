import { MAX_BRUSH_SIZE } from '../core/tools/stamp';
import type { ToolSettings } from '../core/tools/tool';
import { DEFAULT_VIEW } from '../render/renderer';
import type { Editor } from './editor';
import { vetExport } from './export-settings';
import { exportKeymap, importKeymap } from './keymaps';
import { vetMeshImport } from './mesh-import-settings';
import { persist } from './persist';
import { vetPictures } from './pictures';
import { vetSequence } from './render-sequence';
import type { Writable } from './store';
import { familyOf } from './tool-families';
import { clampSideWidth } from './ui-state';

/** A store of one plain value seen as `{ value }`, so it can be persisted like the others. */
function boxed<T>(store: Writable<T>): Writable<{ value: T }> {
  return {
    subscribe: (run) => store.subscribe((value) => run({ value })),
    get: () => ({ value: store.get() }),
    set: (box) => store.set(box.value),
    update: (fn) => store.set(fn({ value: store.get() }).value),
  };
}

const oneOf = <T>(value: T, options: readonly NoInfer<T>[], fallback: NoInfer<T>): T =>
  options.includes(value) ? value : fallback;

/**
 * Remembers the interface between visits: panel width and folded sections, view options,
 * brush and selection settings, the tool, recent commands and the one-finger camera mode
 * (the interface is remembered). The document itself is not here: that is
 * autosave. Returns a function that stops and writes what is pending.
 */
export function rememberPreferences(editor: Editor): () => void {
  const tools = editor.tools;
  const stops = [
    persist(editor.ui, 'ui', {
      allowed: (u) => ({
        sideWidth: clampSideWidth(u.sideWidth),
        folded: u.folded.filter((f) =>
          ['palette', 'scene', 'layers', 'refs', 'assets'].includes(f),
        ),
        hidden: u.hidden,
        theme: oneOf(u.theme, ['dark', 'light', 'auto'], 'dark'),
        timeline: u.timeline === true,
        lastTool: Object.fromEntries(
          Object.entries(u.lastTool).filter(([family, id]) => familyOf(id)?.id === family),
        ),
      }),
    }),
    persist(editor.view, 'view', {
      allowed: (v) => ({
        ...v,
        shading: oneOf(v.shading, ['lit', 'flat', 'clay'], DEFAULT_VIEW.shading),
        lightYaw: ((v.lightYaw % 360) + 360) % 360,
        lightPitch: Math.max(5, Math.min(90, v.lightPitch)),
        lightStrength: Math.max(0, Math.min(2, v.lightStrength)),
      }),
    }),
    persist(tools.settingsStore, 'tools', {
      // The colour, action, stroke lock and mirror belong to the moment, not to the person.
      pick: (s): Partial<ToolSettings> => ({
        brushSize: s.brushSize,
        brushShape: s.brushShape,
        brushMode: s.brushMode,
        pressureSize: s.pressureSize,
        stampOwnColor: s.stampOwnColor,
        stampAlign: s.stampAlign,
        stampSpacing: s.stampSpacing,
        fillMode: s.fillMode,
        curveMode: s.curveMode,
        ropeKind: s.ropeKind,
        ropeSlack: s.ropeSlack,
        ropeThickness: s.ropeThickness,
        shadeBy: s.shadeBy,
        paintPattern: s.paintPattern,
        patternScale: s.patternScale,
        gradientAxis: s.gradientAxis,
        sdfShape: s.sdfShape,
        sdfBlend: s.sdfBlend,
        sculptMode: s.sculptMode,
        sculptDirection: s.sculptDirection,
        sculptUseColor: s.sculptUseColor,
        faceByColor: s.faceByColor,
        selectMode: s.selectMode,
        regionMode: s.regionMode,
      }),
      allowed: (s) => ({
        ...s,
        brushSize: Math.max(1, Math.min(MAX_BRUSH_SIZE, Math.round(s.brushSize))),
        brushShape: oneOf(s.brushShape, ['cube', 'sphere'], 'cube'),
        brushMode: oneOf(s.brushMode, ['volume', 'plane', 'surface'], 'volume'),
        pressureSize: s.pressureSize !== false,
        stampSpacing: oneOf(s.stampSpacing, ['dense', 'apart'], 'dense'),
        fillMode: oneOf(s.fillMode, ['color', 'layer', 'outline'], 'color'),
        curveMode: oneOf(s.curveMode, ['arc', 'stroke'], 'arc'),
        ropeKind: oneOf(s.ropeKind, ['rope', 'chain', 'cable'], 'rope'),
        ropeSlack: Math.max(1, Math.min(3, s.ropeSlack)),
        ropeThickness: Math.max(1, Math.min(16, s.ropeThickness)),
        shadeBy: oneOf(s.shadeBy, ['palette', 'hsl'], 'palette'),
        paintPattern: oneOf(
          s.paintPattern,
          ['solid', 'gradient', 'random', 'perlin', 'worley', 'voronoi', 'splatter'],
          'solid',
        ),
        patternScale: Math.max(1, Math.min(64, s.patternScale)),
        gradientAxis: oneOf(s.gradientAxis, [0, 1, 2], 1),
        sdfShape: oneOf(s.sdfShape, ['sphere', 'box', 'stroke'], 'sphere'),
        sdfBlend: Math.max(0, Math.min(16, s.sdfBlend)),
        sculptMode: oneOf(s.sculptMode, ['grow', 'erode', 'smooth', 'bumps', 'flatten'], 'grow'),
        sculptDirection: oneOf(s.sculptDirection, ['normal', 'up', 'all'], 'normal'),
        selectMode: oneOf(s.selectMode, ['replace', 'add', 'subtract', 'intersect'], 'replace'),
        regionMode: oneOf(s.regionMode, ['volume', 'face', 'color'], 'volume'),
      }),
    }),
    persist(boxed(tools.activeToolId), 'tool', {
      allowed: (b) => (tools.hasTool(b.value) ? b : { value: 'brush' }),
    }),
    persist(boxed(editor.recentActions), 'recent', {
      allowed: (b) => ({ value: b.value.filter((id) => editor.actions.get(id)).slice(0, 8) }),
    }),
    persist(boxed(editor.cameraOnlyTouch), 'touch-camera'),
    persist(editor.frameSize, 'render-frame', {
      allowed: (f) => ({
        width: Math.max(16, Math.min(8192, Math.round(f.width) || 1920)),
        height: Math.max(16, Math.min(8192, Math.round(f.height) || 1080)),
      }),
    }),
    persist(boxed(editor.renderWindow), 'render-window'),
    persist(editor.sequence, 'render-sequence', { allowed: vetSequence }),
    persist(editor.exportSettings, 'export', { allowed: vetExport }),
    persist(editor.pictureSettings, 'pictures', { allowed: vetPictures }),
    persist(editor.meshImportSettings, 'mesh-import', { allowed: vetMeshImport }),
    persist(editor.renderSettings, 'render', {
      allowed: (s) => ({
        ...s,
        bounces: Math.max(1, Math.min(8, Math.round(s.bounces))),
        samples: Math.max(1, Math.min(8192, Math.round(s.samples))),
      }),
    }),
    // Kept in the export format: the same reader vets both.
    persist(
      {
        subscribe: (run) => editor.keymap.subscribe((k) => run({ value: exportKeymap(k) })),
        get: () => ({ value: exportKeymap(editor.keymap.get()) }),
        set: (box) => {
          try {
            editor.keymap.set(importKeymap(box.value));
          } catch {
            // Not a layout: keep the default.
          }
        },
        update: () => {},
      },
      'keymap',
    ),
  ];
  return () => {
    for (const stop of stops) stop();
  };
}
