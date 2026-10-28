import { describe, expect, it } from 'vitest';
import { chunkKey } from '../core/coords';
import { Scene, type VoxelObject } from '../core/scene';
import { meshChunk, meshScratch } from '../kernels/mesher';
import { type AsyncMesher, MeshScheduler, type MeshSink } from './mesh-scheduler';

class FakeSink implements MeshSink {
  readonly meshes = new Map<string, number>();
  uploads = 0;

  upload(object: VoxelObject, key: number, _v: Uint32Array, quads: number): void {
    this.uploads++;
    if (quads === 0) this.meshes.delete(`${object.id}:${key}`);
    else this.meshes.set(`${object.id}:${key}`, quads);
  }

  remove(object: VoxelObject, key: number): void {
    this.meshes.delete(`${object.id}:${key}`);
  }

  removeObject(object: VoxelObject): void {
    for (const k of [...this.meshes.keys()])
      if (k.startsWith(`${object.id}:`)) this.meshes.delete(k);
  }
}

/** Holds jobs until the test resolves them, like a worker that answers later. */
class ManualMesher implements AsyncMesher {
  readonly capacity = 2;
  readonly jobs: { padded: Uint16Array; resolve: () => void }[] = [];

  mesh(padded: Uint16Array) {
    return new Promise<{ vertices: Uint32Array; quads: number; padded: Uint16Array }>((resolve) => {
      this.jobs.push({
        padded,
        resolve: () => {
          const out = meshScratch();
          const quads = meshChunk(padded, out);
          resolve({ vertices: out.slice(0, quads * 8), quads, padded });
        },
      });
    });
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(async: AsyncMesher | null) {
  const scene = new Scene();
  const object = scene.createObject('o');
  const sink = new FakeSink();
  let notified = 0;
  const scheduler = new MeshScheduler(sink, async, () => notified++);
  return { object, sink, scheduler, notified: () => notified };
}

describe('MeshScheduler', () => {
  it('meshes urgent chunks in the same update', () => {
    const { object, sink, scheduler } = setup(new ManualMesher());
    object.volume.set(1, 1, 1, 5);
    scheduler.invalidate(object, [chunkKey(0, 0, 0)], true);
    scheduler.update(0);
    expect(sink.meshes.get(`${object.id}:${chunkKey(0, 0, 0)}`)).toBe(6);
    expect(scheduler.busy).toBe(false);
  });

  it('sends the rest to workers, a few at a time', async () => {
    const mesher = new ManualMesher();
    const { object, sink, scheduler, notified } = setup(mesher);
    const keys = [0, 1, 2].map((i) => {
      object.volume.set(i * 32 + 3, 3, 3, 1);
      return chunkKey(i, 0, 0);
    });
    scheduler.invalidate(object, keys, false);
    scheduler.update(0);
    expect(mesher.jobs).toHaveLength(2);
    expect(sink.uploads).toBe(0);
    mesher.jobs[0]!.resolve();
    mesher.jobs[1]!.resolve();
    await tick();
    expect(sink.uploads).toBe(2);
    expect(notified()).toBe(2);
    scheduler.update(0);
    mesher.jobs[2]!.resolve();
    await tick();
    expect(sink.meshes.size).toBe(3);
    expect(scheduler.busy).toBe(false);
  });

  it('drops a result that a newer request made stale', async () => {
    const mesher = new ManualMesher();
    const { object, sink, scheduler } = setup(mesher);
    const key = chunkKey(0, 0, 0);
    object.volume.set(1, 1, 1, 5);
    scheduler.invalidate(object, [key], false);
    scheduler.update(0);
    // The chunk changes while the worker is busy with the old content.
    object.volume.set(10, 10, 10, 5);
    scheduler.invalidate(object, [key], false);
    mesher.jobs[0]!.resolve();
    await tick();
    expect(sink.uploads).toBe(0);
    scheduler.update(0);
    mesher.jobs[1]!.resolve();
    await tick();
    expect(sink.meshes.get(`${object.id}:${key}`)).toBe(12);
  });

  it('lets an urgent remesh win over a slower worker job', async () => {
    const mesher = new ManualMesher();
    const { object, sink, scheduler } = setup(mesher);
    const key = chunkKey(0, 0, 0);
    object.volume.set(1, 1, 1, 5);
    scheduler.invalidate(object, [key], false);
    scheduler.update(0);
    object.volume.set(1, 1, 1, 0);
    object.volume.set(5, 5, 5, 7);
    object.volume.set(6, 5, 5, 7);
    scheduler.invalidate(object, [key], true);
    scheduler.update(0);
    expect(sink.meshes.get(`${object.id}:${key}`)).toBe(6);
    mesher.jobs[0]!.resolve();
    await tick();
    expect(sink.uploads).toBe(1);
  });

  it('meshes in the main thread within the budget when there are no workers', () => {
    const { object, sink, scheduler } = setup(null);
    for (let i = 0; i < 5; i++) object.volume.set(i * 32, 0, 0, 1);
    scheduler.invalidate(
      object,
      [0, 1, 2, 3, 4].map((i) => chunkKey(i, 0, 0)),
      false,
    );
    scheduler.update(1000);
    expect(sink.meshes.size).toBe(5);
    expect(scheduler.busy).toBe(false);
  });

  it('takes the nearest chunk first', () => {
    const mesher = new ManualMesher();
    const { object, scheduler } = setup(mesher);
    for (let i = 0; i < 4; i++) object.volume.set(i * 32, 0, 0, i + 1);
    scheduler.invalidate(
      object,
      [0, 1, 2, 3].map((i) => chunkKey(i, 0, 0)),
      false,
    );
    // Priority: farther along X is sooner.
    scheduler.update(0, (_o, key) => -Math.floor(key / 131072 ** 2));
    const first = mesher.jobs.map((j) => j.padded[1 + 34 + 34 * 34]);
    expect(first).toEqual([4, 3]);
  });

  it('removes meshes of chunks that vanished and of forgotten objects', () => {
    const { object, sink, scheduler } = setup(new ManualMesher());
    object.volume.set(0, 0, 0, 1);
    scheduler.invalidate(object, [chunkKey(0, 0, 0)], true);
    scheduler.update(0);
    object.volume.set(0, 0, 0, 0);
    scheduler.invalidate(object, [chunkKey(0, 0, 0)], false);
    scheduler.update(0);
    expect(sink.meshes.size).toBe(0);
    object.volume.set(0, 0, 0, 1);
    scheduler.invalidate(object, [chunkKey(0, 0, 0)], true);
    scheduler.update(0);
    scheduler.forget(object);
    expect(sink.meshes.size).toBe(0);
    expect(scheduler.busy).toBe(false);
  });
});
