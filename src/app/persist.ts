import type { Writable } from './store';

/** The part of Web Storage this module needs; tests pass a map. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Prefix of every key, so the editor's entries are easy to find and clear. */
const PREFIX = 'voxels:';

/**
 * Values of `saved` for the keys `defaults` has, where the type matches: an entry written by an
 * older version, or edited by hand, cannot put something unexpected into the editor. Arrays
 * must hold the same type of items as the default (or the default must be empty: strings).
 */
export function mergeKnown<T extends object>(defaults: T, saved: unknown): T {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return { ...defaults };
  const out = { ...defaults } as Record<string, unknown>;
  for (const [key, value] of Object.entries(defaults)) {
    const candidate = (saved as Record<string, unknown>)[key];
    if (candidate === undefined) continue;
    if (Array.isArray(value)) {
      const sample = value[0];
      const ok =
        Array.isArray(candidate) &&
        candidate.every((c) =>
          sample === undefined ? typeof c === 'string' : typeof c === typeof sample,
        );
      if (ok) out[key] = candidate;
    } else if (value !== null && typeof value === 'object') {
      out[key] = mergeKnown(value, candidate);
    } else if (typeof candidate === typeof value) {
      out[key] = candidate;
    }
  }
  return out as T;
}

/**
 * Keeps a store in browser storage under a name: loads it now, saves it after every change
 * (a little later, once a drag settles). Storage may be missing or full (a private window, a
 * blocked site): the store then simply works in memory. `pick` chooses what is worth keeping,
 * `allowed` vets each loaded value (an option that no longer exists).
 */
export function persist<T extends object>(
  store: Writable<T>,
  name: string,
  options: {
    storage?: KeyValueStore | null;
    pick?: (value: T) => Partial<T>;
    allowed?: (value: T) => T;
    delayMs?: number;
  } = {},
): () => void {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  if (!storage) return () => {};
  const key = PREFIX + name;
  try {
    const text = storage.getItem(key);
    if (text) {
      const merged = mergeKnown(store.get(), JSON.parse(text));
      store.set(options.allowed ? options.allowed(merged) : merged);
    }
  } catch {
    // Unreadable or unparsable: keep the defaults.
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = () => {
    timer = null;
    try {
      const value = store.get();
      storage.setItem(key, JSON.stringify(options.pick ? options.pick(value) : value));
    } catch {
      // Full or blocked storage: the setting lives until the page closes.
    }
  };
  let first = true;
  const unsubscribe = store.subscribe(() => {
    // The first call is the current value, just loaded.
    if (first) {
      first = false;
      return;
    }
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(save, options.delayMs ?? 300);
  });
  return () => {
    unsubscribe();
    if (timer !== null) {
      clearTimeout(timer);
      save();
    }
  };
}

function defaultStorage(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
