import type { VoxelDocument } from '../core/document';
import type { VoxChunk } from '../formats/vox-chunks';

/**
 * Palette row notes ↔ the NOTE chunk: one name per row of eight colours in panel order. The
 * chunk stays where it was in the file and is rewritten only when the notes change.
 */

type NoteChunk = Extract<VoxChunk, { id: 'NOTE' }>;

const isNote = (c: VoxChunk): c is NoteChunk => c.id === 'NOTE' && 'names' in c;

export function readNotes(doc: VoxelDocument, kept: readonly VoxChunk[]): void {
  const note = kept.find(isNote);
  if (note) doc.palette.notes = [...note.names];
}

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** The kept chunks with the NOTE brought up to date (added at the end when new). */
export function writeNotes(doc: VoxelDocument, kept: readonly VoxChunk[]): VoxChunk[] {
  const notes = doc.palette.notes;
  const has = notes.some((n) => n !== '');
  const out: VoxChunk[] = [];
  let written = false;
  for (const c of kept) {
    if (!isNote(c)) {
      out.push(c);
      continue;
    }
    written = true;
    if (same(c.names, notes)) out.push(c);
    else if (has || notes.length > 0) out.push({ id: 'NOTE', names: [...notes] });
  }
  if (!written && has) out.push({ id: 'NOTE', names: [...notes] });
  return out;
}
