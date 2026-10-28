import {
  duplicateEntries,
  PaletteEntriesCommand,
  paletteGradient,
  rampOf,
  stepInRamp,
} from '../core/palette-edit';
import type { Action } from './actions';
import type { Editor } from './editor';

/** Palette commands on the selected entries (or the current colour). */
export function paletteActions(editor: Editor): Action[] {
  const targets = () => {
    const selected = editor.paletteSelection.get();
    return selected.length > 0 ? selected : [editor.tools.settings.color];
  };
  /** Moves the current colour along its ramp or across ramps, and says where it landed. */
  const step = (by: number, across: boolean) => () => {
    const palette = editor.doc.palette;
    const id = stepInRamp(palette, editor.tools.settings.color, by, across);
    editor.tools.setColor(id);
    editor.selectColors([id], id);
    const row = Math.floor(palette.displayOrder().indexOf(id) / 8);
    const note = palette.notes[row];
    if (note) editor.toast(`${note}: color ${id}`);
  };
  return [
    {
      id: 'palette.rampNext',
      title: 'Next color in the ramp',
      group: 'Palette',
      keys: ['Period'],
      repeat: true,
      run: step(1, false),
    },
    {
      id: 'palette.rampPrev',
      title: 'Previous color in the ramp',
      group: 'Palette',
      keys: ['Comma'],
      repeat: true,
      run: step(-1, false),
    },
    {
      id: 'palette.rampDown',
      title: 'Same place in the next ramp',
      group: 'Palette',
      keys: ['Shift+Period'],
      repeat: true,
      run: step(1, true),
    },
    {
      id: 'palette.rampUp',
      title: 'Same place in the previous ramp',
      group: 'Palette',
      keys: ['Shift+Comma'],
      repeat: true,
      run: step(-1, true),
    },
    {
      id: 'palette.selectRamp',
      title: 'Select the ramp of the current color',
      group: 'Palette',
      run: () => {
        const ramp = rampOf(editor.doc.palette, editor.tools.settings.color);
        editor.selectColors(ramp, editor.tools.settings.color);
      },
    },
    {
      id: 'palette.duplicate',
      title: 'Duplicate colors',
      group: 'Palette',
      run: () => {
        const copies = duplicateEntries(editor.doc, targets());
        if (copies === null) editor.toast('No free colors: the model uses all of them');
        else if (copies.length > 0) editor.selectColors(copies, copies[0]!);
      },
    },
    {
      id: 'palette.gradient',
      title: 'Gradient between the end colors',
      group: 'Palette',
      run: () => {
        if (!paletteGradient(editor.doc, editor.paletteSelection.get()))
          editor.toast('Select three colors or more');
      },
      enabled: () => editor.paletteSelection.get().length >= 3,
    },
  ];
}

/**
 * Sets palette colours. Edits with `merge` while one gesture lasts (a slider drag, typing a
 * number) become one step of history; call `doc.history.closeMerge()` when it ends.
 */
export function setPaletteColors(
  editor: Editor,
  ids: readonly number[],
  colors: readonly number[],
  merge: boolean,
): void {
  const palette = editor.doc.palette;
  if (ids.every((id, i) => palette.color(id) === colors[i])) return;
  const entries = ids.map((id, i) => ({ ...palette.entry(id), color: colors[i]! }));
  editor.doc.history.execute(new PaletteEntriesCommand('Color', palette, ids, entries), { merge });
}
