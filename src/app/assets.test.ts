import { describe, expect, it } from 'vitest';
import { serializeClip } from '../core/clipboard';
import { VoxelVolume } from '../core/volume';
import { type Asset, AssetLibrary, type AssetStore, assetClip } from './assets';

function memoryStore(): AssetStore & { saved: Map<string, Asset> } {
  const saved = new Map<string, Asset>();
  return {
    saved,
    list: async () => [...saved.values()].sort((a, b) => b.savedAt - a.savedAt),
    put: async (a) => {
      saved.set(a.id, a);
    },
    remove: async (id) => {
      saved.delete(id);
    },
  };
}

function asset(id: string, savedAt: number): Asset {
  const volume = new VoxelVolume();
  volume.set(1, 2, 3, 4);
  return {
    id,
    name: id,
    savedAt,
    clip: serializeClip({ volume, colors: new Map([[4, 0xff0000ff]]) }),
    thumb: '',
    voxels: 1,
  };
}

describe('asset library', () => {
  it('saves, renames and removes, keeping storage in step', async () => {
    const store = memoryStore();
    const library = new AssetLibrary(store);
    await library.save(asset('a', 1));
    await library.save(asset('b', 2));
    expect(library.assets.get().map((a) => a.id)).toEqual(['b', 'a']);
    await library.rename('a', 'Tree');
    expect(store.saved.get('a')!.name).toBe('Tree');
    await library.remove('b');
    expect(store.saved.has('b')).toBe(false);
    const fresh = new AssetLibrary(store);
    await fresh.refresh();
    expect(fresh.assets.get().map((a) => a.name)).toEqual(['Tree']);
  });

  it('keeps the voxels and their colours', () => {
    const clip = assetClip(asset('a', 1))!;
    expect(clip.volume.get(1, 2, 3)).toBe(4);
    expect(clip.colors.get(4)).toBe(0xff0000ff);
  });

  it('works in memory without storage', async () => {
    const library = new AssetLibrary(null);
    expect(library.available).toBe(false);
    await library.save(asset('a', 1));
    expect(library.assets.get()).toHaveLength(1);
  });
});
