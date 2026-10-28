import { keyX, keyY, keyZ } from '../core/coords';
import { buildPadded, createPaddedBuffer } from '../core/padded';
import type { VoxelObject } from '../core/scene';
import type { LocalClip } from '../core/slice';
import { meshChunk, meshScratch } from '../kernels/mesher';

/** Where finished meshes go: the GPU store in the app, a fake in tests. */
export interface MeshSink {
  upload(object: VoxelObject, key: number, vertices: Uint32Array, quads: number): void;
  remove(object: VoxelObject, key: number): void;
  removeObject(object: VoxelObject): void;
}

/** Meshes off the main thread (the worker pool). */
export interface AsyncMesher {
  /** Jobs in flight that keep it busy without piling up stale work. */
  readonly capacity: number;
  mesh(padded: Uint16Array): Promise<{ vertices: Uint32Array; quads: number; padded: Uint16Array }>;
}

/** Lower is sooner. */
export type MeshPriority = (object: VoxelObject, key: number) => number;

/**
 * Decides where and when each stale chunk is meshed.
 *
 * - Urgent chunks (under the brush, small edits) are meshed in the main thread in the same
 *   frame, so the stroke shows up within one frame.
 * - The rest go to the worker pool, nearest first, a few at a time.
 * - Every request gets a version; a result for an older version is dropped, so a slow job can
 *   never overwrite a newer mesh.
 * - Without workers the rest is meshed in the main thread within a time budget per frame.
 */
export class MeshScheduler {
  private readonly versions = new Map<VoxelObject, Map<number, number>>();
  private readonly urgent = new Map<VoxelObject, Set<number>>();
  private readonly waiting = new Map<VoxelObject, Set<number>>();
  private readonly spare: Uint16Array[] = [];
  private readonly syncPadded = createPaddedBuffer();
  private inFlight = 0;
  private counter = 0;
  private disposed = false;

  constructor(
    private readonly sink: MeshSink,
    private readonly async: AsyncMesher | null,
    /** Called when a worker result arrives, so the caller can schedule a frame. */
    private readonly onAsyncResult: () => void,
  ) {}

  /** The view slice as each object sees it: hidden cells are meshed as empty. */
  clipFor: (object: VoxelObject) => LocalClip | null = () => null;

  /** True while anything is waiting or being meshed. */
  get busy(): boolean {
    return this.inFlight > 0 || this.urgent.size > 0 || this.waiting.size > 0;
  }

  get inFlightCount(): number {
    return this.inFlight;
  }

  invalidate(object: VoxelObject, keys: Iterable<number>, urgent: boolean): void {
    let versions = this.versions.get(object);
    if (!versions) {
      versions = new Map();
      this.versions.set(object, versions);
    }
    const target = urgent ? this.urgent : this.waiting;
    let set = target.get(object);
    if (!set) {
      set = new Set();
      target.set(object, set);
    }
    const waiting = urgent ? this.waiting.get(object) : undefined;
    for (const key of keys) {
      versions.set(key, ++this.counter);
      set.add(key);
      waiting?.delete(key);
    }
    if (set.size === 0) target.delete(object);
    if (waiting?.size === 0) this.waiting.delete(object);
  }

  /** Stops delivering results: the GPU store they would go to is gone. */
  dispose(): void {
    this.disposed = true;
    this.versions.clear();
    this.urgent.clear();
    this.waiting.clear();
  }

  /** The object left the scene: drop its work and its meshes. */
  forget(object: VoxelObject): void {
    this.versions.delete(object);
    this.urgent.delete(object);
    this.waiting.delete(object);
    this.sink.removeObject(object);
  }

  /**
   * Meshes urgent chunks now, then dispatches waiting ones to workers, or meshes them here
   * until `budgetMs` is spent when there are no workers.
   */
  update(budgetMs: number, priority?: MeshPriority): void {
    for (const [object, keys] of this.urgent) {
      for (const key of keys) this.meshNow(object, key);
    }
    this.urgent.clear();

    if (this.async) {
      while (this.inFlight < this.async.capacity) {
        const next = this.takeNext(priority);
        if (!next) break;
        this.dispatch(next.object, next.key);
      }
      return;
    }
    const start = performance.now();
    while (performance.now() - start < budgetMs) {
      const next = this.takeNext(priority);
      if (!next) break;
      this.meshNow(next.object, next.key);
    }
  }

  private takeNext(priority?: MeshPriority): { object: VoxelObject; key: number } | null {
    let best: { object: VoxelObject; key: number } | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const [object, keys] of this.waiting) {
      for (const key of keys) {
        if (!priority) {
          best = { object, key };
          break;
        }
        const score = priority(object, key);
        if (score < bestScore) {
          bestScore = score;
          best = { object, key };
        }
      }
      if (best && !priority) break;
    }
    if (best) {
      const keys = this.waiting.get(best.object)!;
      keys.delete(best.key);
      if (keys.size === 0) this.waiting.delete(best.object);
    }
    return best;
  }

  private meshNow(object: VoxelObject, key: number): void {
    this.versions.get(object)?.delete(key);
    const clip = this.clipFor(object);
    if (!buildPadded(object.volume, keyX(key), keyY(key), keyZ(key), this.syncPadded, clip)) {
      this.sink.remove(object, key);
      return;
    }
    const out = meshScratch();
    this.sink.upload(object, key, out, meshChunk(this.syncPadded, out));
  }

  private dispatch(object: VoxelObject, key: number): void {
    const version = this.versions.get(object)?.get(key);
    if (version === undefined) return;
    const padded = this.spare.pop() ?? createPaddedBuffer();
    if (
      !buildPadded(object.volume, keyX(key), keyY(key), keyZ(key), padded, this.clipFor(object))
    ) {
      this.spare.push(padded);
      this.versions.get(object)?.delete(key);
      this.sink.remove(object, key);
      return;
    }
    this.inFlight++;
    this.async!.mesh(padded).then(
      (result) => {
        this.inFlight--;
        if (this.disposed) return;
        this.spare.push(result.padded);
        const versions = this.versions.get(object);
        if (versions?.get(key) === version) {
          versions.delete(key);
          this.sink.upload(object, key, result.vertices, result.quads);
        }
        this.onAsyncResult();
      },
      () => {
        // A worker failed: mesh this chunk here instead of losing it.
        this.inFlight--;
        if (this.versions.get(object)?.get(key) === version) this.invalidate(object, [key], true);
        this.onAsyncResult();
      },
    );
  }
}
