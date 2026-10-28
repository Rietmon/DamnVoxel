import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Autosave,
  type AutosaveEntry,
  type AutosaveSource,
  type AutosaveStorage,
  readEntry,
} from './autosave';

class MemoryStorage implements AutosaveStorage {
  entry: AutosaveEntry | null = null;
  saves = 0;
  fail = false;
  async load() {
    return this.entry;
  }
  async save(entry: AutosaveEntry) {
    if (this.fail) throw new Error('QuotaExceededError');
    this.saves++;
    this.entry = entry;
  }
  async clear() {
    this.entry = null;
  }
}

/** A document stand-in: a counter as content, modified until marked saved. */
function source() {
  let content = 0;
  let saved = 0;
  const listeners = new Set<() => void>();
  const s: AutosaveSource & { edit(): void; save(): void } = {
    isModified: () => content !== saved,
    snapshot: () => ({ documents: [{ bytes: Uint8Array.of(content), name: 'doc' }], savedAt: 1 }),
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    edit() {
      content++;
      for (const l of listeners) l();
    },
    save() {
      saved = content;
      for (const l of listeners) l();
    },
  };
  return s;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('autosave', () => {
  it('writes a while after the last change, once for a burst of edits', async () => {
    vi.useFakeTimers();
    const doc = source();
    const storage = new MemoryStorage();
    const autosave = new Autosave(doc, storage, 1000);
    autosave.start();
    doc.edit();
    vi.advanceTimersByTime(600);
    doc.edit();
    vi.advanceTimersByTime(600);
    expect(storage.saves).toBe(0);
    vi.advanceTimersByTime(500);
    await autosave.flush();
    expect(storage.saves).toBe(1);
    expect([...storage.entry!.documents[0]!.bytes]).toEqual([2]);
  });

  it('writes at once on flush, and drops the copy once the work is saved', async () => {
    vi.useFakeTimers();
    const doc = source();
    const storage = new MemoryStorage();
    const autosave = new Autosave(doc, storage, 1000);
    autosave.start();
    doc.edit();
    await autosave.flush();
    expect(storage.entry).not.toBeNull();
    doc.save();
    await autosave.flush();
    expect(storage.entry).toBeNull();
    // Nothing pending: flush does not write.
    await autosave.flush();
    expect(storage.saves).toBe(1);
  });

  it('starts by replacing an old copy only when there is unsaved work', async () => {
    const storage = new MemoryStorage();
    storage.entry = { documents: [{ bytes: Uint8Array.of(9), name: 'old' }], savedAt: 0 };
    const clean = new Autosave(source(), storage, 1000);
    clean.start();
    await clean.dispose();
    expect(storage.entry).toBeNull();
  });

  it('keeps working when storage refuses', async () => {
    vi.useFakeTimers();
    const doc = source();
    const storage = new MemoryStorage();
    storage.fail = true;
    const autosave = new Autosave(doc, storage, 10);
    autosave.start();
    doc.edit();
    await expect(autosave.flush()).resolves.toBeUndefined();
    storage.fail = false;
    doc.edit();
    await autosave.dispose();
    expect([...storage.entry!.documents[0]!.bytes]).toEqual([2]);
  });
});

describe('stored entries', () => {
  it('reads several documents, and the single one older versions kept', () => {
    const bytes = Uint8Array.of(1);
    expect(
      readEntry({ documents: [{ bytes, name: 'a' }, { name: 'bad' } as never], savedAt: 5 }),
    ).toEqual({ documents: [{ bytes, name: 'a' }], savedAt: 5 });
    expect(readEntry({ bytes, name: 'old', savedAt: 3 })).toEqual({
      documents: [{ bytes, name: 'old' }],
      savedAt: 3,
    });
    expect(readEntry({ documents: [] })).toBeNull();
    expect(readEntry({ name: 'x' })).toBeNull();
  });
});
