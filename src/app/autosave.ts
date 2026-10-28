/** One document of unsaved work. */
export interface AutosaveDocument {
  /** The document as .vox bytes: the lossless writer the editor already trusts. */
  bytes: Uint8Array;
  /** The document name at the time. */
  name: string;
}

/** One saved state of unsaved work: every open document that is not in a file. */
export interface AutosaveEntry {
  documents: AutosaveDocument[];
  /** Milliseconds since the epoch. */
  savedAt: number;
}

/** Where autosaves live; IndexedDB in the browser, a map in tests. */
export interface AutosaveStorage {
  load(): Promise<AutosaveEntry | null>;
  save(entry: AutosaveEntry): Promise<void>;
  clear(): Promise<void>;
}

/** What the autosave needs from the editor. */
export interface AutosaveSource {
  /** True while the document differs from its file. */
  isModified(): boolean;
  /** The document now, as an entry. */
  snapshot(): AutosaveEntry;
  /** Called after every change of the document or its saved state. */
  onChange(listener: () => void): () => void;
}

/**
 * Keeps unsaved work safe: a little after the last change the document goes to storage, and
 * once it is saved (or undone back to the saved state) the copy is dropped, so a copy found at
 * start always means work that never reached a file.
 */
export class Autosave {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stop: (() => void) | null = null;
  private writing: Promise<void> = Promise.resolve();
  /** Something changed since the last write. */
  private dirty = false;

  constructor(
    private readonly source: AutosaveSource,
    private readonly storage: AutosaveStorage,
    private readonly delayMs = 2000,
  ) {}

  /** Starts watching; any copy in storage is replaced by the current state from now on. */
  start(): void {
    if (this.stop) return;
    this.stop = this.source.onChange(() => this.changed());
    this.changed();
  }

  /** Stops watching, writing what is pending first. */
  async dispose(): Promise<void> {
    this.stop?.();
    this.stop = null;
    await this.flush();
  }

  /** Writes now if something is pending: the tab is being hidden or closed. */
  flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.dirty) this.write();
    return this.writing;
  }

  private changed(): void {
    this.dirty = true;
    if (!this.source.isModified()) {
      // Saved, or undone back to the saved state: nothing to keep.
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = null;
      this.dirty = false;
      this.queue(() => this.storage.clear());
      return;
    }
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.write();
    }, this.delayMs);
  }

  private write(): void {
    this.dirty = false;
    if (!this.source.isModified()) return;
    const entry = this.source.snapshot();
    this.queue(() => this.storage.save(entry));
  }

  /** Storage calls run one after another, so a clear never overtakes a save. */
  private queue(task: () => Promise<void>): void {
    this.writing = this.writing.then(task).catch(() => {
      // A full or blocked store: the work stays in memory, nothing else to do.
    });
  }
}

const isDocument = (d: Partial<AutosaveDocument> | undefined): d is AutosaveDocument =>
  !!d && d.bytes instanceof Uint8Array && typeof d.name === 'string';

/**
 * A stored entry, vetted: its documents, or the single document an older version kept.
 * Null when nothing usable is there.
 */
export function readEntry(
  value: Partial<AutosaveEntry> & Partial<AutosaveDocument>,
): AutosaveEntry | null {
  const savedAt = Number(value.savedAt) || 0;
  if (Array.isArray(value.documents)) {
    const documents = value.documents.filter(isDocument);
    return documents.length > 0 ? { documents, savedAt } : null;
  }
  return isDocument(value)
    ? { documents: [{ bytes: value.bytes, name: value.name }], savedAt }
    : null;
}

const DB_NAME = 'voxels';
const STORE = 'autosave';
const KEY = 'current';

/** Autosaves in IndexedDB: one entry, replaced on every save. */
export function indexedDbAutosave(): AutosaveStorage | null {
  if (typeof indexedDB === 'undefined') return null;
  let db: Promise<IDBDatabase> | null = null;
  const open = () => {
    db ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return db;
  };
  const run = async <T>(
    mode: IDBTransactionMode,
    body: (store: IDBObjectStore) => IDBRequest<T>,
  ) => {
    const database = await open();
    return new Promise<T>((resolve, reject) => {
      const tx = database.transaction(STORE, mode);
      const request = body(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  };
  return {
    async load() {
      const value = (await run('readonly', (s) => s.get(KEY))) as
        | (Partial<AutosaveEntry> & Partial<AutosaveDocument>)
        | undefined;
      return value ? readEntry(value) : null;
    },
    async save(entry) {
      await run('readwrite', (s) => s.put(entry, KEY));
    },
    async clear() {
      await run('readwrite', (s) => s.delete(KEY));
    },
  };
}
