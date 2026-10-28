import { writable } from './store';

/**
 * Versions of documents (version history): the whole document as .vox at
 * moments worth coming back to — each save to a file, every ten minutes of editing, and on
 * request. They live in the browser (IndexedDB), apart from the autosave, each with a small
 * picture of the view. The oldest go once a document has too many or all take too much room;
 * automatic ones go before saved and remembered ones.
 */

export type VersionReason = 'save' | 'auto' | 'manual';

export interface VersionInfo {
  id: number;
  /** The document's name at the time. */
  name: string;
  savedAt: number;
  reason: VersionReason;
  /** Size of the .vox, bytes. */
  size: number;
  voxels: number;
  /** FNV-1a of the bytes: the same state is not kept twice in a row. */
  hash: number;
  /** A picture of the view (data URL), or empty. */
  thumb: string;
}

export interface VersionStore {
  /** Every version, any order. */
  list(): Promise<VersionInfo[]>;
  add(info: Omit<VersionInfo, 'id'>, bytes: Uint8Array): Promise<number>;
  bytes(id: number): Promise<Uint8Array | null>;
  remove(ids: readonly number[]): Promise<void>;
}

export const VERSION_LIMITS = { perDocument: 40, totalBytes: 256 * 1024 * 1024 };

/** Editing time between automatic versions. */
export const AUTO_VERSION_MS = 10 * 60 * 1000;

export function hashBytes(b: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i]!, 0x01000193);
  return h >>> 0;
}

/** Automatic versions first, then the rest; oldest first within each. */
const dropOrder = (a: VersionInfo, b: VersionInfo) =>
  Number(a.reason !== 'auto') - Number(b.reason !== 'auto') || a.savedAt - b.savedAt;

/** The versions to delete so each document and all of them fit the limits. */
export function versionsToDrop(list: readonly VersionInfo[], limits = VERSION_LIMITS): number[] {
  const drop = new Set<number>();
  const byName = new Map<string, VersionInfo[]>();
  for (const v of list) byName.set(v.name, [...(byName.get(v.name) ?? []), v]);
  for (const group of byName.values()) {
    const extra = group.length - limits.perDocument;
    if (extra > 0) for (const v of [...group].sort(dropOrder).slice(0, extra)) drop.add(v.id);
  }
  const kept = list.filter((v) => !drop.has(v.id)).sort(dropOrder);
  let total = kept.reduce((s, v) => s + v.size, 0);
  for (const v of kept) {
    if (total <= limits.totalBytes) break;
    drop.add(v.id);
    total -= v.size;
  }
  return [...drop];
}

/** The versions as the interface sees them: newest first, kept in step with storage. */
export class VersionHistory {
  readonly versions = writable<VersionInfo[]>([]);

  constructor(
    private readonly store: VersionStore | null,
    private readonly limits = VERSION_LIMITS,
  ) {
    void this.refresh();
  }

  get available(): boolean {
    return this.store !== null;
  }

  async refresh(): Promise<void> {
    if (!this.store) return;
    try {
      const list = await this.store.list();
      this.versions.set(list.sort((a, b) => b.savedAt - a.savedAt));
    } catch {
      // Blocked storage: no versions.
    }
  }

  /**
   * Keeps a version of a document; false when it is the same as its last one (nothing new to
   * come back to) or there is no storage.
   */
  async record(
    name: string,
    bytes: Uint8Array,
    reason: VersionReason,
    voxels: number,
    thumb: string,
    now = Date.now(),
  ): Promise<boolean> {
    if (!this.store) return false;
    const hash = hashBytes(bytes);
    const last = this.versions.get().find((v) => v.name === name);
    if (last && last.hash === hash && last.size === bytes.length) return false;
    const info = { name, savedAt: now, reason, size: bytes.length, voxels, hash, thumb };
    const id = await this.store.add(info, bytes);
    this.versions.update((list) => [{ ...info, id }, ...list]);
    const drop = versionsToDrop(this.versions.get(), this.limits);
    if (drop.length > 0) await this.remove(drop);
    return true;
  }

  async bytes(id: number): Promise<Uint8Array | null> {
    return (await this.store?.bytes(id)) ?? null;
  }

  async remove(ids: readonly number[]): Promise<void> {
    const gone = new Set(ids);
    this.versions.update((list) => list.filter((v) => !gone.has(v.id)));
    await this.store?.remove(ids);
  }
}

/** Versions in memory: for tests, and where the browser keeps nothing. */
export function memoryVersions(): VersionStore {
  const infos = new Map<number, VersionInfo>();
  const data = new Map<number, Uint8Array>();
  let next = 1;
  return {
    async list() {
      return [...infos.values()];
    },
    async add(info, bytes) {
      const id = next++;
      infos.set(id, { ...info, id });
      data.set(id, bytes.slice());
      return id;
    },
    async bytes(id) {
      return data.get(id) ?? null;
    },
    async remove(ids) {
      for (const id of ids) {
        infos.delete(id);
        data.delete(id);
      }
    },
  };
}

/** Versions in IndexedDB: the list and the bytes apart, so listing reads no documents. */
export function indexedDbVersions(): VersionStore | null {
  if (typeof indexedDB === 'undefined') return null;
  let db: Promise<IDBDatabase> | null = null;
  const open = () => {
    db ??= new Promise((resolve, reject) => {
      const request = indexedDB.open('voxels-versions', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('info', { keyPath: 'id', autoIncrement: true });
        request.result.createObjectStore('bytes');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return db;
  };
  const run = async <T>(
    stores: string[],
    mode: IDBTransactionMode,
    body: (tx: IDBTransaction) => IDBRequest<T> | undefined,
  ): Promise<T | undefined> => {
    const database = await open();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(stores, mode);
      const request = body(tx);
      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  };
  return {
    async list() {
      return ((await run(['info'], 'readonly', (tx) => tx.objectStore('info').getAll())) ??
        []) as VersionInfo[];
    },
    async add(info, bytes) {
      const database = await open();
      return new Promise((resolve, reject) => {
        const tx = database.transaction(['info', 'bytes'], 'readwrite');
        const request = tx.objectStore('info').add(info);
        request.onsuccess = () => tx.objectStore('bytes').put(bytes, request.result);
        tx.oncomplete = () => resolve(request.result as number);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    },
    async bytes(id) {
      const b = await run(['bytes'], 'readonly', (tx) => tx.objectStore('bytes').get(id));
      return b instanceof Uint8Array ? b : null;
    },
    async remove(ids) {
      await run(['info', 'bytes'], 'readwrite', (tx) => {
        for (const id of ids) {
          tx.objectStore('info').delete(id);
          tx.objectStore('bytes').delete(id);
        }
        return undefined;
      });
    },
  };
}
