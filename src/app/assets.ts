import type { VoxelClip } from '../core/clipboard';
import { parseClip, serializeClip } from '../core/clipboard';
import { blue, green, red } from '../core/color';
import { CHUNK_SIZE, CHUNK_VOLUME, indexX, indexY, indexZ, keyX, keyY, keyZ } from '../core/coords';
import { writable } from './store';

/**
 * The asset library: pieces saved once and put into any
 * document later — as an object or as the stamp. They live in the browser (IndexedDB), apart
 * from documents, with their colours, so they come out right in another palette.
 */

export interface Asset {
  readonly id: string;
  name: string;
  readonly savedAt: number;
  /** The voxels and their colours, as the clipboard keeps them. */
  readonly clip: string;
  /** A small isometric picture, a data URL. */
  readonly thumb: string;
  readonly voxels: number;
}

export interface AssetStore {
  list(): Promise<Asset[]>;
  put(asset: Asset): Promise<void>;
  remove(id: string): Promise<void>;
}

const dense = new Uint16Array(CHUNK_VOLUME);

/**
 * An isometric picture of a clip: every voxel's three visible faces, drawn back to front, the
 * top lighter and the sides darker, scaled to fit.
 */
export function drawThumbnail(clip: VoxelClip, size = 96): string {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) return '';
  const cells: number[] = [];
  for (const [key, chunk] of clip.volume.chunks()) {
    chunk.decodeInto(dense);
    const ox = keyX(key) * CHUNK_SIZE;
    const oy = keyY(key) * CHUNK_SIZE;
    const oz = keyZ(key) * CHUNK_SIZE;
    for (let i = 0; i < CHUNK_VOLUME; i++) {
      const v = dense[i]!;
      // Only voxels that can show: some face open. Deep ones never reach the picture.
      if (v) cells.push(ox + indexX(i), oy + indexY(i), oz + indexZ(i), v);
    }
  }
  if (cells.length === 0) return canvas.toDataURL('image/png');
  // Back to front: farther (smaller x + z, lower y) first.
  const order = Array.from({ length: cells.length / 4 }, (_, i) => i).sort((a, b) => {
    const da = cells[a * 4]! + cells[a * 4 + 2]! + cells[a * 4 + 1]!;
    const db = cells[b * 4]! + cells[b * 4 + 2]! + cells[b * 4 + 1]!;
    return da - db;
  });
  const sx = (x: number, z: number) => x - z;
  const sy = (x: number, y: number, z: number) => (x + z) / 2 - y;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < cells.length; i += 4) {
    const [x, y, z] = [cells[i]!, cells[i + 1]!, cells[i + 2]!];
    minX = Math.min(minX, sx(x, z + 1));
    maxX = Math.max(maxX, sx(x + 1, z));
    minY = Math.min(minY, sy(x, y + 1, z));
    maxY = Math.max(maxY, sy(x + 1, y, z + 1));
  }
  const scale = (size * 0.9) / Math.max(maxX - minX, maxY - minY, 1);
  const ox = (size - (maxX - minX) * scale) / 2 - minX * scale;
  const oy = (size - (maxY - minY) * scale) / 2 - minY * scale;
  const p = (x: number, y: number, z: number): [number, number] => [
    ox + sx(x, z) * scale,
    oy + sy(x, y, z) * scale,
  ];
  const shade = (c: number, k: number) =>
    `rgb(${Math.round(red(c) * k)} ${Math.round(green(c) * k)} ${Math.round(blue(c) * k)})`;
  const face = (pts: [number, number][], fill: string) => {
    g.beginPath();
    g.moveTo(...pts[0]!);
    for (const q of pts.slice(1)) g.lineTo(...q);
    g.closePath();
    g.fillStyle = fill;
    g.fill();
  };
  for (const i of order) {
    const [x, y, z, id] = [cells[i * 4]!, cells[i * 4 + 1]!, cells[i * 4 + 2]!, cells[i * 4 + 3]!];
    const c = clip.colors.get(id) ?? 0xffcccccc;
    // Top, then the two sides facing the viewer (+x and +z).
    face(
      [p(x, y + 1, z), p(x + 1, y + 1, z), p(x + 1, y + 1, z + 1), p(x, y + 1, z + 1)],
      shade(c, 1),
    );
    face(
      [p(x + 1, y, z), p(x + 1, y + 1, z), p(x + 1, y + 1, z + 1), p(x + 1, y, z + 1)],
      shade(c, 0.78),
    );
    face(
      [p(x, y, z + 1), p(x + 1, y, z + 1), p(x + 1, y + 1, z + 1), p(x, y + 1, z + 1)],
      shade(c, 0.62),
    );
  }
  return canvas.toDataURL('image/png');
}

/** A new asset from a clip. */
export function makeAsset(name: string, clip: VoxelClip): Asset {
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    savedAt: Date.now(),
    clip: serializeClip(clip),
    thumb: drawThumbnail(clip),
    voxels: clip.volume.voxelCount,
  };
}

export function assetClip(asset: Asset): VoxelClip | null {
  return parseClip(asset.clip);
}

/** The library in IndexedDB; null where the browser has none. */
export function indexedDbAssets(): AssetStore | null {
  if (typeof indexedDB === 'undefined') return null;
  let db: Promise<IDBDatabase> | null = null;
  const open = () => {
    db ??= new Promise((resolve, reject) => {
      const request = indexedDB.open('voxels-assets', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('assets', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return db;
  };
  const run = async <T>(mode: IDBTransactionMode, body: (s: IDBObjectStore) => IDBRequest<T>) => {
    const database = await open();
    return new Promise<T>((resolve, reject) => {
      const tx = database.transaction('assets', mode);
      const request = body(tx.objectStore('assets'));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  };
  return {
    async list() {
      const all = (await run('readonly', (s) => s.getAll())) as Asset[];
      return all.sort((a, b) => b.savedAt - a.savedAt);
    },
    async put(asset) {
      await run('readwrite', (s) => s.put(asset));
    },
    async remove(id) {
      await run('readwrite', (s) => s.delete(id));
    },
  };
}

/** The library as the interface sees it: a list kept in step with storage. */
export class AssetLibrary {
  readonly assets = writable<Asset[]>([]);
  /** Changes made here: a slow first load must not undo a save made meanwhile. */
  private changes = 0;

  constructor(private readonly store: AssetStore | null) {
    void this.refresh();
  }

  get available(): boolean {
    return this.store !== null;
  }

  async refresh(): Promise<void> {
    if (!this.store) return;
    try {
      const before = this.changes;
      const list = await this.store.list();
      if (this.changes === before) this.assets.set(list);
    } catch {
      // Blocked storage: the library stays empty.
    }
  }

  async save(asset: Asset): Promise<void> {
    this.changes++;
    this.assets.update((list) => [asset, ...list]);
    await this.store?.put(asset);
  }

  async rename(id: string, name: string): Promise<void> {
    const asset = this.assets.get().find((a) => a.id === id);
    if (!asset) return;
    this.changes++;
    const renamed = { ...asset, name };
    this.assets.update((list) => list.map((a) => (a.id === id ? renamed : a)));
    await this.store?.put(renamed);
  }

  async remove(id: string): Promise<void> {
    this.changes++;
    this.assets.update((list) => list.filter((a) => a.id !== id));
    await this.store?.remove(id);
  }
}
