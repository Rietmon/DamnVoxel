import { describe, expect, it, vi } from 'vitest';
import { type KeyValueStore, mergeKnown, persist } from './persist';
import { writable } from './store';

class MapStorage implements KeyValueStore {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

const DEFAULTS = { width: 300, folded: [] as string[], grid: true, nested: { a: 1, b: 'x' } };

describe('persisted settings', () => {
  it('takes only known keys of the right type from saved data', () => {
    expect(
      mergeKnown(DEFAULTS, {
        width: 420,
        folded: ['palette', 5],
        grid: 'yes',
        extra: 1,
        nested: { a: 2, b: 3 },
      }),
    ).toEqual({ width: 420, folded: [], grid: true, nested: { a: 2, b: 'x' } });
    expect(mergeKnown(DEFAULTS, { folded: ['scene'] }).folded).toEqual(['scene']);
    expect(mergeKnown(DEFAULTS, null)).toEqual(DEFAULTS);
    expect(mergeKnown(DEFAULTS, [1, 2])).toEqual(DEFAULTS);
  });

  it('loads at once and saves after changes settle', () => {
    vi.useFakeTimers();
    const storage = new MapStorage();
    storage.setItem('voxels:ui', JSON.stringify({ width: 400 }));
    const store = writable({ ...DEFAULTS });
    const stop = persist(store, 'ui', { storage, delayMs: 100 });
    expect(store.get().width).toBe(400);
    store.update((s) => ({ ...s, width: 410 }));
    store.update((s) => ({ ...s, width: 420 }));
    expect(JSON.parse(storage.getItem('voxels:ui')!).width).toBe(400);
    vi.advanceTimersByTime(150);
    expect(JSON.parse(storage.getItem('voxels:ui')!).width).toBe(420);
    // Stopping writes a pending change at once.
    store.update((s) => ({ ...s, grid: false }));
    stop();
    expect(JSON.parse(storage.getItem('voxels:ui')!).grid).toBe(false);
    vi.useRealTimers();
  });

  it('keeps only what is picked and vets loaded values', () => {
    vi.useFakeTimers();
    const storage = new MapStorage();
    storage.setItem('voxels:tools', JSON.stringify({ width: 9999 }));
    const store = writable({ ...DEFAULTS });
    persist(store, 'tools', {
      storage,
      delayMs: 0,
      pick: (s) => ({ width: s.width }),
      allowed: (s) => ({ ...s, width: Math.min(s.width, 560) }),
    });
    expect(store.get().width).toBe(560);
    store.update((s) => ({ ...s, grid: false }));
    vi.runAllTimers();
    expect(JSON.parse(storage.getItem('voxels:tools')!)).toEqual({ width: 560 });
    vi.useRealTimers();
  });

  it('works in memory when storage is missing, broken or full', () => {
    const store = writable({ ...DEFAULTS });
    expect(() => persist(store, 'x', { storage: null })()).not.toThrow();
    const broken: KeyValueStore = {
      getItem: () => '{not json',
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    vi.useFakeTimers();
    persist(store, 'x', { storage: broken, delayMs: 0 });
    store.update((s) => ({ ...s, width: 1 }));
    expect(() => vi.runAllTimers()).not.toThrow();
    expect(store.get().width).toBe(1);
    vi.useRealTimers();
  });
});
