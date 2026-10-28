import { type MirrorSettings, mirrorCenterOf, toggleKeel } from '../core/mirror';
import type { EditAction } from '../core/operation';
import { composeOrientation, quarterTurn, reflection } from '../core/orientation';
import { PATTERN_TITLES, type PaintPattern, SHADE_TITLES } from '../core/paint';
import { MAX_BRUSH_SIZE } from '../core/tools/stamp';
import type { BrushMode, StrokeLock } from '../core/tools/tool';
import type { Action } from './actions';
import type { Editor } from './editor';

const ACTIONS: { action: EditAction; title: string; key: string }[] = [
  { action: 'add', title: 'Action: add', key: 'KeyA' },
  { action: 'erase', title: 'Action: erase', key: 'KeyE' },
  { action: 'paint', title: 'Action: paint', key: 'KeyP' },
];

const MODES: BrushMode[] = ['volume', 'plane', 'surface'];
const MODE_TITLES: Record<BrushMode, string> = {
  volume: 'volume',
  plane: 'plane',
  surface: 'surface',
};

/** Tool and brush actions: what the brush does, which tool is active, brush options. */
export function toolActions(editor: Editor): Action[] {
  const tools = editor.tools;
  const setSize = (size: number) => {
    const brushSize = Math.max(1, Math.min(MAX_BRUSH_SIZE, size));
    tools.updateSettings({ brushSize });
    editor.toast(`Brush size: ${brushSize}`);
  };
  const actions: Action[] = ACTIONS.map(
    ({ action, title, key }): Action => ({
      id: `action.${action}`,
      title,
      group: 'Drawing',
      keys: [key],
      run: () => tools.updateSettings({ action }),
      checked: () => tools.settings.action === action,
    }),
  );
  const tool = (id: string, title: string, key?: string): Action => ({
    id: `tool.${id}`,
    title,
    group: 'Tools',
    keys: key ? [key] : undefined,
    run: () => tools.setTool(id),
    checked: () => tools.activeToolId.get() === id,
  });
  actions.push(
    tool('brush', 'Brush', 'KeyV'),
    tool('stamp', 'Stamp', 'Shift+KeyV'),
    tool('sculpt', 'Sculpt', 'KeyG'),
    tool('face', 'Face: extrude / push', 'KeyX'),
    tool('box', 'Box', 'KeyB'),
    tool('line', 'Line', 'KeyL'),
    tool('curve', 'Curve', 'KeyJ'),
    tool('rope', 'Rope, chain, cable', 'Shift+KeyJ'),
    tool('rect', 'Rectangle', 'KeyR'),
    tool('ellipse', 'Ellipse', 'KeyO'),
    tool('sphere', 'Sphere', 'KeyS'),
    tool('cylinder', 'Cylinder', 'KeyC'),
    tool('cone', 'Cone'),
    tool('pyramid', 'Pyramid'),
    tool('torus', 'Torus'),
    tool('stairs', 'Stairs'),
    tool('arch', 'Arch'),
    tool('sdf', 'Smooth shapes (SDF)', 'Shift+KeyS'),
    tool('pipette', 'Eyedropper', 'KeyI'),
    tool('replace', 'Replace color', 'Shift+KeyP'),
    tool('fill', 'Fill', 'Shift+KeyF'),
    tool('select-rect', 'Rectangle select', 'KeyM'),
    tool('select-lasso', 'Lasso select', 'KeyK'),
    tool('select-box', 'Box select', 'KeyU'),
    tool('select-region', 'Magic wand', 'KeyW'),
    tool('move', 'Move selection', 'KeyT'),
    {
      id: 'select.regionMode',
      title: 'Magic wand: volume / face / color',
      group: 'Selection',
      keys: ['Alt+KeyW'],
      run: () => {
        const order = ['volume', 'face', 'color'] as const;
        const regionMode = order[(order.indexOf(tools.settings.regionMode) + 1) % order.length]!;
        tools.updateSettings({ regionMode });
        editor.toast(
          `Wand: ${regionMode === 'volume' ? 'connected volume' : regionMode === 'face' ? 'face' : 'color'}`,
        );
      },
    },
    {
      id: 'face.byColor',
      title: 'Face: one color only',
      group: 'Tools',
      keys: ['Shift+KeyX'],
      run: () => {
        const faceByColor = !tools.settings.faceByColor;
        tools.updateSettings({ faceByColor });
        editor.toast(faceByColor ? 'Face: by color' : 'Face: by shape');
      },
      checked: () => tools.settings.faceByColor,
    },
  );
  for (let n = 1; n <= 9; n++) {
    actions.push({
      id: `brush.size${n}`,
      title: `Brush size ${n}`,
      group: 'Brush',
      keys: [`Digit${n}`],
      run: () => setSize(n),
      checked: () => tools.settings.brushSize === n,
    });
  }
  actions.push(
    {
      id: 'brush.smaller',
      title: 'Smaller brush',
      group: 'Brush',
      keys: ['BracketLeft'],
      repeat: true,
      run: () => setSize(tools.settings.brushSize - 1),
    },
    {
      id: 'brush.bigger',
      title: 'Larger brush',
      group: 'Brush',
      keys: ['BracketRight'],
      repeat: true,
      run: () => setSize(tools.settings.brushSize + 1),
    },
    {
      id: 'brush.shape',
      title: 'Brush: cube / sphere',
      group: 'Brush',
      keys: ['KeyQ'],
      run: () => {
        const brushShape = tools.settings.brushShape === 'cube' ? 'sphere' : 'cube';
        tools.updateSettings({ brushShape });
        editor.toast(brushShape === 'cube' ? 'Brush: cube' : 'Brush: sphere');
      },
      checked: () => tools.settings.brushShape === 'sphere',
    },
    {
      id: 'brush.mode',
      title: 'Brush: volume / plane / surface',
      group: 'Brush',
      keys: ['Shift+KeyQ'],
      run: () => {
        const brushMode = MODES[(MODES.indexOf(tools.settings.brushMode) + 1) % MODES.length]!;
        tools.updateSettings({ brushMode });
        editor.toast(`Brush mode: ${MODE_TITLES[brushMode]}`);
      },
    },
  );
  const turnStamp = (by: number, title: string) => {
    tools.updateSettings({ stampTurn: composeOrientation(by, tools.settings.stampTurn) });
    editor.toast(title);
  };
  actions.push(
    {
      id: 'stamp.fromSelection',
      title: 'Stamp from the selection (or the whole object)',
      group: 'Stamp',
      keys: ['Alt+KeyB'],
      run: () => editor.makeStamp(),
      enabled: () => editor.activeObject.get() !== null,
    },
    {
      id: 'stamp.turnLeft',
      title: 'Stamp: turn left',
      group: 'Stamp',
      run: () => turnStamp(quarterTurn(1), 'Stamp turned left'),
    },
    {
      id: 'stamp.turnRight',
      title: 'Stamp: turn right',
      group: 'Stamp',
      run: () => turnStamp(quarterTurn(1, true), 'Stamp turned right'),
    },
    {
      id: 'stamp.flip',
      title: 'Stamp: flip',
      group: 'Stamp',
      run: () => turnStamp(reflection(0), 'Stamp flipped'),
    },
  );
  actions.push(
    {
      id: 'paint.lock',
      title: 'Color lock: change only voxels of the chosen colors',
      group: 'Painting',
      keys: ['Alt+KeyL'],
      run: () => {
        if (tools.settings.colorLock.length > 0) {
          tools.updateSettings({ colorLock: [] });
          editor.toast('Color lock off');
          return;
        }
        const selected = editor.paletteSelection.get();
        const colorLock = selected.length > 0 ? [...selected] : [tools.settings.color];
        tools.updateSettings({ colorLock });
        editor.toast(`Color lock: only over ${colorLock.join(', ')}`);
      },
      checked: () => tools.settings.colorLock.length > 0,
    },
    ...(['none', 'lighter', 'darker', 'warmer', 'cooler'] as const).map(
      (shade): Action => ({
        id: `paint.shade.${shade}`,
        title:
          shade === 'none'
            ? 'Painting: plain color'
            : `Painting: ${SHADE_TITLES[shade].toLowerCase()}`,
        group: 'Painting',
        run: () => tools.updateSettings(shade === 'none' ? { shade } : { shade, action: 'paint' }),
        checked: () => tools.settings.shade === shade,
      }),
    ),
    ...(Object.keys(PATTERN_TITLES) as PaintPattern[]).map(
      (pattern): Action => ({
        id: `paint.pattern.${pattern}`,
        title: `Pattern: ${PATTERN_TITLES[pattern].toLowerCase()}`,
        group: 'Painting',
        run: () => tools.updateSettings({ paintPattern: pattern }),
        checked: () => tools.settings.paintPattern === pattern,
      }),
    ),
  );
  const LOCKS: { lock: StrokeLock; title: string; key: string; toast: string }[] = [
    {
      lock: 'plane',
      title: 'Stroke on the plane of the first touch',
      key: 'Alt+KeyP',
      toast: 'on the plane',
    },
    { lock: 'x', title: 'Stroke along the X axis', key: 'Alt+KeyX', toast: 'along X' },
    { lock: 'y', title: 'Stroke along the Y axis', key: 'Alt+KeyY', toast: 'along Y' },
    { lock: 'z', title: 'Stroke along the Z axis', key: 'Alt+KeyZ', toast: 'along Z' },
  ];
  for (const { lock, title, key, toast } of LOCKS) {
    actions.push({
      id: `brush.lock.${lock}`,
      title,
      group: 'Brush',
      keys: [key],
      run: () => {
        const next = tools.settings.lock === lock ? 'none' : lock;
        tools.updateSettings({ lock: next });
        editor.toast(next === 'none' ? 'Free stroke' : `Stroke ${toast}`);
      },
      checked: () => tools.settings.lock === lock,
    });
  }
  const mirror = (patch: (m: MirrorSettings) => Partial<MirrorSettings>) =>
    tools.updateSettings({ mirror: { ...tools.settings.mirror, ...patch(tools.settings.mirror) } });
  for (const [axis, key] of [
    ['x', 'Shift+Digit1'],
    ['y', 'Shift+Digit2'],
    ['z', 'Shift+Digit3'],
  ] as const) {
    actions.push({
      id: `mirror.${axis}`,
      title: `Mirror on ${axis.toUpperCase()}`,
      group: 'Mirror',
      keys: [key],
      run: () => {
        mirror((m) => ({ [axis]: !m[axis] }));
        editor.toast(
          `Mirror on ${axis.toUpperCase()}: ${tools.settings.mirror[axis] ? 'on' : 'off'}`,
        );
      },
      checked: () => tools.settings.mirror[axis],
    });
  }
  actions.push(
    {
      id: 'mirror.keel',
      title: 'Mirror: through a voxel center / between voxels',
      group: 'Mirror',
      keys: ['Shift+KeyM'],
      run: () => {
        mirror((m) => ({ center2: m.center2.map(toggleKeel) as MirrorSettings['center2'] }));
        const odd = tools.settings.mirror.center2[0] % 2 !== 0;
        editor.toast(odd ? 'Mirror through a voxel center' : 'Mirror between voxels');
      },
    },
    {
      id: 'mirror.center',
      title: 'Mirror at the model center',
      group: 'Mirror',
      keys: ['Alt+KeyM'],
      run: () => {
        const box = editor.activeObject.get()?.volume.getBounds();
        if (box) mirror(() => ({ center2: mirrorCenterOf(box) }));
      },
    },
    {
      id: 'mirror.selection',
      title: 'Mirror at the selection center',
      group: 'Mirror',
      keys: ['Alt+Shift+KeyM'],
      run: () => {
        const box = editor.activeObject.get()?.selection.getBounds();
        if (!box) {
          editor.toast('No selection: the mirror stays where it was');
          return;
        }
        mirror(() => ({ center2: mirrorCenterOf(box) }));
        editor.toast('Mirror at the selection center');
      },
      enabled: () => !(editor.activeObject.get()?.selection.isEmpty ?? true),
    },
    {
      id: 'mirror.origin',
      title: 'Mirror at the origin',
      group: 'Mirror',
      run: () => mirror(() => ({ center2: [0, 0, 0] })),
    },
  );
  return actions;
}
