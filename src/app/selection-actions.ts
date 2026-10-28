import { quarterTurn, reflection } from '../core/orientation';
import { SelectionMask } from '../core/selection';
import {
  colorRegion,
  type EditMask,
  filledRegion,
  grownRegion,
  invertedRegion,
  SelectionTransaction,
  type SelectMode,
  selectedColors,
  shrunkRegion,
} from '../core/selection-edit';
import type { Action } from './actions';
import type { Editor } from './editor';

const MODE_TITLES: Record<SelectMode, string> = {
  replace: 'replace',
  add: 'add',
  subtract: 'subtract',
  intersect: 'intersect',
};

/** Selection commands on the active object: all, none, invert, grow, shrink, default mode. */
export function selectionActions(editor: Editor): Action[] {
  const replaceWith = (label: string, build: () => SelectionMask) => () => {
    const object = editor.activeObject.get();
    if (!object) return;
    const tx = new SelectionTransaction(object);
    tx.combine(build(), 'replace');
    const command = tx.commit(label);
    if (command) {
      editor.doc.history.push(command);
      editor.doc.notifySelection(object);
      editor.requestFrame();
    }
  };
  const object = () => editor.activeObject.get()!;
  const hasObject = () => editor.activeObject.get() !== null;
  const hasSelection = () => !(editor.activeObject.get()?.selection.isEmpty ?? true);
  const modes: SelectMode[] = ['replace', 'add', 'subtract', 'intersect'];
  /** The colours to select by: the palette selection, or the current colour. */
  const pickedColors = () => {
    const selected = editor.paletteSelection.get();
    return new Set(selected.length > 0 ? selected : [editor.tools.settings.color]);
  };
  const MASKS: { mask: EditMask; title: string; toast: string }[] = [
    { mask: 'all', title: 'Edit everywhere', toast: 'Edit everywhere' },
    {
      mask: 'inside',
      title: 'Edit only inside the selection',
      toast: 'Edit only inside the selection',
    },
    {
      mask: 'outside',
      title: 'Edit only outside the selection',
      toast: 'Edit only outside the selection',
    },
  ];
  return [
    {
      id: 'select.saveSet',
      title: 'Remember the selection as a set',
      group: 'Selection',
      keys: ['Ctrl+Alt+KeyS'],
      run: () => editor.saveSelectionSet(),
      enabled: hasSelection,
    },
    {
      id: 'select.toObject',
      title: 'Move the selection into a new object',
      group: 'Selection',
      keys: ['Ctrl+Shift+KeyE'],
      run: () => editor.extractSelection(),
      enabled: hasSelection,
    },
    {
      id: 'select.toLayer',
      title: 'Move the selection into an object on a new layer',
      group: 'Selection',
      run: () => editor.extractSelectionToLayer(),
      enabled: hasSelection,
    },
    {
      id: 'select.byColors',
      title: 'Select the voxels of the chosen colors',
      group: 'Selection',
      keys: ['Alt+KeyC'],
      run: replaceWith('Select by colors', () => colorRegion(object(), pickedColors())),
      enabled: hasObject,
    },
    {
      id: 'palette.fromSelection',
      title: 'Choose the selection’s colors in the palette',
      group: 'Palette',
      run: () => {
        const colors = selectedColors(object());
        editor.paletteSelection.set(colors);
        if (colors[0]) editor.tools.updateSettings({ color: colors[0] });
        editor.toast(`Colors chosen in the palette: ${colors.length}`);
      },
      enabled: hasSelection,
    },
    ...MASKS.map(
      ({ mask, title, toast }): Action => ({
        id: `select.mask.${mask}`,
        title,
        group: 'Selection',
        run: () => {
          editor.tools.updateSettings({ editMask: mask });
          editor.toast(
            mask !== 'all' && !hasSelection() ? `${toast} — but there is no selection yet` : toast,
          );
        },
        checked: () => editor.tools.settings.editMask === mask,
      }),
    ),
    {
      id: 'select.all',
      title: 'Select all',
      group: 'Selection',
      keys: ['Ctrl+KeyA'],
      run: replaceWith('Select all', () => filledRegion(object())),
      enabled: hasObject,
    },
    {
      id: 'select.none',
      title: 'Deselect',
      group: 'Selection',
      keys: ['Ctrl+KeyD'],
      run: replaceWith('Deselect', () => new SelectionMask()),
      enabled: hasSelection,
    },
    {
      id: 'select.invert',
      title: 'Invert selection',
      group: 'Selection',
      keys: ['Ctrl+KeyI'],
      run: replaceWith('Invert selection', () => invertedRegion(object())),
      enabled: hasObject,
    },
    {
      id: 'select.grow',
      title: 'Grow selection',
      group: 'Selection',
      keys: ['Ctrl+BracketRight'],
      repeat: true,
      run: replaceWith('Grow selection', () => grownRegion(object())),
      enabled: hasSelection,
    },
    {
      id: 'select.shrink',
      title: 'Shrink selection',
      group: 'Selection',
      keys: ['Ctrl+BracketLeft'],
      repeat: true,
      run: replaceWith('Shrink selection', () => shrunkRegion(object())),
      enabled: hasSelection,
    },
    ...(
      [
        ['piece.turnY', 'Turn selection around Y', quarterTurn(1)],
        ['piece.turnYBack', 'Turn selection around Y back', quarterTurn(1, true)],
        ['piece.turnX', 'Turn selection around X', quarterTurn(0)],
        ['piece.turnZ', 'Turn selection around Z', quarterTurn(2)],
        ['piece.flipX', 'Flip selection on X', reflection(0)],
        ['piece.flipY', 'Flip selection on Y', reflection(1)],
        ['piece.flipZ', 'Flip selection on Z', reflection(2)],
      ] as const
    ).map(
      ([id, title, orientation]): Action => ({
        id,
        title,
        group: 'Selection',
        run: () => editor.tools.orientSelection(orientation),
        enabled: hasObject,
      }),
    ),
    {
      id: 'select.mode',
      title: 'Selection mode without keys: replace / add / subtract / intersect',
      group: 'Selection',
      run: () => {
        const tools = editor.tools;
        const selectMode = modes[(modes.indexOf(tools.settings.selectMode) + 1) % modes.length]!;
        tools.updateSettings({ selectMode });
        editor.toast(`Selection: ${MODE_TITLES[selectMode]}`);
      },
    },
  ];
}
