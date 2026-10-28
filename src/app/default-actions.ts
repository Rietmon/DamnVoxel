import { BakeCommand } from '../core/animation';
import type { Shading } from '../render/renderer';

/** View settings as the interface sees them (it may not import the render layer). */
export type { Shading, ViewSettings } from '../render/renderer';

import type { Action } from './actions';
import type { Editor } from './editor';
import type { Dir } from './view-cube';

export const SHADING_TITLES: Record<Shading, string> = {
  lit: 'lit',
  flat: 'flat',
  clay: 'clay',
};

/** Actions of the editor itself: history, camera and view options. Tools add their own. */
export function editorActions(editor: Editor): Action[] {
  const view = (dir: Dir) => () => editor.viewAlong(dir);
  const toggle = (
    id: string,
    title: string,
    key: keyof ReturnType<typeof editor.view.get>,
    keys: string[],
  ): Action => ({
    id,
    title,
    group: 'View',
    keys,
    run: () => editor.view.update((v) => ({ ...v, [key]: !v[key] })),
    checked: () => editor.view.get()[key] === true,
  });

  return [
    {
      id: 'app.commands',
      title: 'All commands',
      group: 'Interface',
      keys: ['Ctrl+KeyK', 'F1'],
      run: () => editor.commandsOpen.update((open) => !open),
    },
    {
      id: 'edit.undo',
      title: 'Undo',
      group: 'Edit',
      keys: ['Ctrl+KeyZ'],
      repeat: true,
      run: () => editor.undo(),
      enabled: () => editor.doc.history.canUndo,
    },
    {
      id: 'edit.redo',
      title: 'Redo',
      group: 'Edit',
      keys: ['Ctrl+Shift+KeyZ', 'Ctrl+KeyY'],
      repeat: true,
      run: () => editor.redo(),
      enabled: () => editor.doc.history.canRedo,
    },
    {
      id: 'camera.fit',
      title: 'Frame model',
      group: 'Camera',
      keys: ['KeyF'],
      run: () => editor.fitActive(),
    },
    {
      id: 'camera.fitAll',
      title: 'Frame whole scene',
      group: 'Camera',
      keys: ['Home'],
      run: () => editor.fitAll(),
    },
    {
      id: 'camera.front',
      title: 'Front view',
      group: 'Camera',
      keys: ['Numpad1', 'Alt+Digit1'],
      run: view([0, 0, 1]),
    },
    {
      id: 'camera.back',
      title: 'Back view',
      group: 'Camera',
      keys: ['Ctrl+Numpad1', 'Alt+Shift+Digit1'],
      run: view([0, 0, -1]),
    },
    {
      id: 'camera.right',
      title: 'Right view',
      group: 'Camera',
      keys: ['Numpad3', 'Alt+Digit3'],
      run: view([1, 0, 0]),
    },
    {
      id: 'camera.left',
      title: 'Left view',
      group: 'Camera',
      keys: ['Ctrl+Numpad3', 'Alt+Shift+Digit3'],
      run: view([-1, 0, 0]),
    },
    {
      id: 'camera.top',
      title: 'Top view',
      group: 'Camera',
      keys: ['Numpad7', 'Alt+Digit7'],
      run: view([0, 1, 0]),
    },
    {
      id: 'camera.bottom',
      title: 'Bottom view',
      group: 'Camera',
      keys: ['Ctrl+Numpad7', 'Alt+Shift+Digit7'],
      run: view([0, -1, 0]),
    },
    {
      id: 'camera.projection',
      title: 'Perspective / orthographic',
      group: 'Camera',
      keys: ['Numpad5', 'Alt+Digit5'],
      run: () => editor.toggleProjection(),
      checked: () => editor.camera.projection === 'orthographic',
    },
    {
      id: 'camera.iso',
      title: 'Isometric',
      group: 'Camera',
      keys: ['Ctrl+Numpad5', 'Alt+Digit0'],
      run: () => editor.viewIsometric(),
    },
    {
      id: 'camera.touchOnly',
      title: 'Touch: one finger moves the camera',
      group: 'Camera',
      run: () => editor.cameraOnlyTouch.update((v) => !v),
      checked: () => editor.cameraOnlyTouch.get(),
    },
    toggle('view.grid', 'Grid', 'grid', ['Shift+KeyG']),
    toggle('view.floor', 'Floor', 'floor', ['Shift+KeyH']),
    toggle('view.axes', 'Axes', 'axes', ['Shift+KeyA']),
    toggle('view.bounds', 'Dimension box', 'bounds', ['Shift+KeyB']),
    toggle('view.ao', 'Corner shading (AO)', 'ao', ['Shift+KeyO']),
    toggle('view.edges', 'Voxel edges', 'edges', ['Shift+KeyE']),
    toggle('view.wireframe', 'Wireframe', 'wireframe', ['Shift+KeyW']),
    toggle('view.outline', 'Silhouette outline', 'outline', ['Shift+KeyK']),
    toggle('view.onion', 'Onion skin (neighbor frames)', 'onion', ['Alt+KeyO']),
    toggle('view.dimOthers', 'Dim other objects', 'dimOthers', ['Shift+KeyD']),
    toggle('view.chunks', 'Chunk borders 32³', 'chunks', ['Shift+KeyC']),
    {
      id: 'view.shading',
      title: 'Shading: lit / flat / clay',
      group: 'View',
      keys: ['Shift+KeyZ'],
      run: () => {
        const order: Shading[] = ['lit', 'flat', 'clay'];
        const shading = order[(order.indexOf(editor.view.get().shading) + 1) % order.length]!;
        editor.view.update((v) => ({ ...v, shading }));
        editor.toast(`Shading: ${SHADING_TITLES[shading]}`);
      },
    },
    ...(['lit', 'flat', 'clay'] as const).map(
      (shading): Action => ({
        id: `view.shading.${shading}`,
        title: `Shading: ${SHADING_TITLES[shading]}`,
        group: 'View',
        keys: shading === 'flat' ? ['Shift+KeyL'] : undefined,
        run: () => editor.view.update((v) => ({ ...v, shading })),
        checked: () => editor.view.get().shading === shading,
      }),
    ),
    {
      id: 'view.slice',
      title: 'Slice: on / off',
      group: 'View',
      keys: ['Alt+KeyS'],
      run: () => editor.toggleSlice(),
      checked: () => editor.slice.get() !== null,
    },
    ...([0, 1, 2] as const).map(
      (axis): Action => ({
        id: `view.slice${'XYZ'[axis]}`,
        title: `Slice along ${'XYZ'[axis]}`,
        group: 'View',
        run: () => editor.sliceAlong(axis),
        checked: () => editor.slice.get()?.axis === axis,
      }),
    ),
    {
      id: 'view.sliceFlip',
      title: 'Slice: hide the other side',
      group: 'View',
      keys: ['Alt+Shift+KeyS'],
      run: () => editor.flipSlice(),
      enabled: () => editor.slice.get() !== null,
    },
    {
      id: 'view.sliceUp',
      title: 'Slice up',
      group: 'View',
      keys: ['Alt+ArrowUp'],
      repeat: true,
      run: () => editor.moveSlice(1),
      enabled: () => editor.slice.get() !== null,
    },
    {
      id: 'view.sliceDown',
      title: 'Slice down',
      group: 'View',
      keys: ['Alt+ArrowDown'],
      repeat: true,
      run: () => editor.moveSlice(-1),
      enabled: () => editor.slice.get() !== null,
    },
    ...Array.from({ length: 10 }, (_, slot): Action[] => [
      {
        id: `camera.slot${slot + 1}`,
        title: `Camera ${slot + 1}`,
        group: 'Camera',
        run: () => editor.goToCameraSlot(slot),
      },
      {
        id: `camera.save${slot + 1}`,
        title: `Remember camera ${slot + 1}`,
        group: 'Camera',
        run: () => editor.saveCameraSlot(slot),
      },
    ]).flat(),
    {
      id: 'app.keymap',
      title: 'Keys and mouse',
      group: 'Interface',
      run: () => editor.keymapOpen.set(true),
    },
    {
      id: 'ui.timeline',
      title: 'Animation: timeline',
      group: 'Animation',
      keys: ['Alt+KeyA'],
      run: () => editor.ui.update((u) => ({ ...u, timeline: !u.timeline })),
      checked: () => editor.ui.get().timeline,
    },
    {
      id: 'anim.play',
      title: 'Play / stop',
      group: 'Animation',
      keys: ['Alt+Slash'],
      run: () => editor.togglePlay(),
      checked: () => editor.playing.get(),
    },
    {
      id: 'anim.next',
      title: 'Next frame',
      group: 'Animation',
      keys: ['Alt+Period'],
      repeat: true,
      run: () => editor.stepFrame(1),
    },
    {
      id: 'anim.prev',
      title: 'Previous frame',
      group: 'Animation',
      keys: ['Alt+Comma'],
      repeat: true,
      run: () => editor.stepFrame(-1),
    },
    {
      id: 'anim.bake',
      title: 'Bake smooth motion into frames',
      group: 'Animation',
      run: () => {
        const bake = new BakeCommand(editor.doc);
        if (bake.empty) editor.toast('Nothing to bake: needs two position keys');
        else editor.doc.history.execute(bake);
      },
    },
    {
      id: 'anim.keyModel',
      title: 'Model frame here (copy of what is visible)',
      group: 'Animation',
      run: () => editor.setKey('model', true),
    },
    {
      id: 'anim.keyPlace',
      title: 'Position key here',
      group: 'Animation',
      run: () => editor.setKey('place', true),
    },
    {
      id: 'anim.deleteModel',
      title: 'Remove the model frame on this frame',
      group: 'Animation',
      run: () => editor.setKey('model', false),
    },
    {
      id: 'anim.deletePlace',
      title: 'Remove the position key on this frame',
      group: 'Animation',
      run: () => editor.setKey('place', false),
    },
    {
      id: 'ui.radial',
      title: 'Radial menu',
      group: 'Interface',
      keys: ['Backquote'],
      run: () => (editor.radial.get() ? editor.pickRadial(-1) : editor.openRadial()),
    },
    {
      id: 'ui.hide',
      title: 'Hide interface',
      group: 'Interface',
      keys: ['Shift+Backslash'],
      run: () => editor.toggleInterface(),
      checked: () => editor.ui.get().hidden,
    },
    {
      id: 'view.stats',
      title: 'Frame statistics',
      group: 'View',
      run: () => editor.showStats.update((v) => !v),
      checked: () => editor.showStats.get(),
    },
    {
      id: 'render.mode',
      title: 'Render: show / back to editing',
      group: 'Render',
      run: () => editor.setRendering(!editor.rendering.get()),
      checked: () => editor.rendering.get(),
    },
    {
      id: 'render.window',
      title: 'Render window over editing',
      group: 'Render',
      run: () => editor.toggleRenderWindow(),
      checked: () => editor.renderWindow.get(),
    },
    {
      id: 'render.save',
      title: 'Save render frame (PNG)',
      group: 'Render',
      run: () => editor.saveRenderFrame(),
    },
    {
      id: 'render.sequence',
      title: 'Save render series: turntable, animation or sprites',
      group: 'Render',
      run: () => editor.saveRenderSequence(),
    },
  ];
}
