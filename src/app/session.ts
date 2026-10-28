import { readVox } from '../io/vox-read';
import { writeVox } from '../io/vox-write';
import {
  Autosave,
  type AutosaveEntry,
  type AutosaveSource,
  type AutosaveStorage,
} from './autosave';
import type { Editor } from './editor';
import { writable } from './store';

/** Work found in storage at start that never reached a file, waiting for the user's word. */
export const recovery = writable<{ entry: AutosaveEntry; restore(): void; discard(): void } | null>(
  null,
);

/** The editor as the autosave sees it. */
export function autosaveSource(editor: Editor): AutosaveSource {
  return {
    isModified: () => editor.unsavedDocuments().length > 0,
    snapshot: () => ({
      documents: editor.unsavedDocuments().map(({ doc, name }) => ({ bytes: writeVox(doc), name })),
      savedAt: Date.now(),
    }),
    onChange(listener) {
      // Skip the first call of each subscription: it is the current value, not a change.
      const skipFirst = () => {
        let first = true;
        return () => {
          if (first) first = false;
          else listener();
        };
      };
      const a = editor.historyVersion.subscribe(skipFirst());
      const b = editor.modified.subscribe(skipFirst());
      // Closing or switching tabs changes what is unsaved.
      const c = editor.tabs.subscribe(skipFirst());
      return () => {
        a();
        b();
        c();
      };
    },
  };
}

/**
 * Autosave with crash recovery. A copy left by an earlier visit is offered first; autosave
 * starts only after the answer, so the new empty document never overwrites that work.
 */
export async function startAutosave(editor: Editor, storage: AutosaveStorage): Promise<Autosave> {
  const autosave = new Autosave(autosaveSource(editor), storage);
  const flush = () => {
    void autosave.flush();
  };
  // Phones kill hidden tabs without warning: hiding is the last safe moment.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', flush);

  let found: AutosaveEntry | null = null;
  try {
    found = await storage.load();
  } catch {
    found = null;
  }
  if (!found) {
    autosave.start();
    return autosave;
  }
  const entry = found;
  recovery.set({
    entry,
    restore() {
      recovery.set(null);
      let restored = 0;
      for (const d of entry.documents) {
        try {
          editor.open(readVox(d.bytes), d.name);
          // The work is back, but it is still not in any file.
          editor.markUnsaved();
          restored++;
        } catch {
          editor.toast(`The copy of “${d.name}” is damaged and could not be opened`);
        }
      }
      if (restored > 0)
        editor.toast(restored > 1 ? `Documents restored: ${restored}` : 'Work restored');
      autosave.start();
    },
    discard() {
      recovery.set(null);
      void storage.clear();
      autosave.start();
    },
  });
  return autosave;
}
