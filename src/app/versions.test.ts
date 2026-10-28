import { describe, expect, it } from 'vitest';
import {
  hashBytes,
  memoryVersions,
  VersionHistory,
  type VersionInfo,
  versionsToDrop,
} from './versions';

const info = (
  id: number,
  name: string,
  savedAt: number,
  reason: VersionInfo['reason'],
  size = 10,
) => ({ id, name, savedAt, reason, size, voxels: 1, hash: id, thumb: '' }) as VersionInfo;

describe('version history', () => {
  it('keeps a state once, and new states each time', async () => {
    const h = new VersionHistory(memoryVersions());
    const a = new Uint8Array([1, 2, 3]);
    expect(await h.record('House', a, 'save', 3, '', 1)).toBe(true);
    expect(await h.record('House', a.slice(), 'auto', 3, '', 2)).toBe(false);
    expect(await h.record('Garden', a, 'save', 3, '', 3)).toBe(true);
    expect(await h.record('House', new Uint8Array([1, 2, 4]), 'manual', 3, '', 4)).toBe(true);
    const list = h.versions.get();
    expect(list.map((v) => [v.name, v.reason])).toEqual([
      ['House', 'manual'],
      ['Garden', 'save'],
      ['House', 'save'],
    ]);
    expect(await h.bytes(list[2]!.id)).toEqual(a);
  });

  it('drops automatic versions first, then the oldest', () => {
    const list = [
      info(1, 'a', 1, 'save'),
      info(2, 'a', 2, 'auto'),
      info(3, 'a', 3, 'auto'),
      info(4, 'a', 4, 'manual'),
      info(5, 'b', 5, 'save'),
    ];
    expect(versionsToDrop(list, { perDocument: 3, totalBytes: 1000 })).toEqual([2]);
    expect(versionsToDrop(list, { perDocument: 2, totalBytes: 1000 }).sort()).toEqual([2, 3]);
    // Room for two: the autos go, then the oldest saved one.
    expect(versionsToDrop(list, { perDocument: 9, totalBytes: 20 }).sort()).toEqual([1, 2, 3]);
  });

  it('prunes as it records', async () => {
    const h = new VersionHistory(memoryVersions(), { perDocument: 2, totalBytes: 1e9 });
    for (let i = 0; i < 5; i++) await h.record('a', new Uint8Array([i]), 'auto', 1, '', i);
    expect(h.versions.get().map((v) => v.savedAt)).toEqual([4, 3]);
  });

  it('hashes bytes', () => {
    expect(hashBytes(new Uint8Array([1, 2]))).not.toBe(hashBytes(new Uint8Array([2, 1])));
    expect(hashBytes(new Uint8Array(0))).toBe(0x811c9dc5);
  });
});
