import { describe, expect, it } from 'vitest';
import { defaultPoolSize, type WorkerLike, WorkerPool } from './pool';

/** Answers after the test calls `respond`; can be told to fail. */
class FakeWorker implements WorkerLike {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  inbox: { id: number; value: number }[] = [];
  terminated = false;

  postMessage(message: unknown): void {
    this.inbox.push(message as { id: number; value: number });
  }

  respond(): void {
    const m = this.inbox.shift()!;
    this.onmessage?.({ data: { id: m.id, value: m.value * 2 } });
  }

  fail(): void {
    this.inbox.shift();
    this.onerror?.(new Error('boom'));
  }

  terminate(): void {
    this.terminated = true;
  }
}

function setup(size: number) {
  const workers: FakeWorker[] = [];
  const pool = new WorkerPool<{ id: number; value: number }, { id: number; value: number }>(() => {
    const w = new FakeWorker();
    workers.push(w);
    return w;
  }, size);
  return { pool, workers };
}

describe('WorkerPool', () => {
  it('runs one job per worker and queues the rest', async () => {
    const { pool, workers } = setup(2);
    const results = [1, 2, 3].map((value) => pool.run({ id: value, value }));
    expect(workers.map((w) => w.inbox.length)).toEqual([1, 1]);
    expect(pool.pending).toBe(3);
    workers[1]!.respond();
    expect(workers[1]!.inbox.length).toBe(1);
    workers[0]!.respond();
    workers[1]!.respond();
    expect((await Promise.all(results)).map((r) => r.value)).toEqual([2, 4, 6]);
    expect(pool.pending).toBe(0);
  });

  it('rejects a failed job and keeps the worker usable', async () => {
    const { pool, workers } = setup(1);
    const failed = pool.run({ id: 1, value: 1 });
    const next = pool.run({ id: 2, value: 5 });
    workers[0]!.fail();
    await expect(failed).rejects.toThrow('boom');
    workers[0]!.respond();
    expect((await next).value).toBe(10);
  });

  it('rejects everything on terminate', async () => {
    const { pool, workers } = setup(1);
    const a = pool.run({ id: 1, value: 1 });
    const b = pool.run({ id: 2, value: 2 });
    pool.terminate();
    await expect(a).rejects.toThrow();
    await expect(b).rejects.toThrow();
    expect(workers[0]!.terminated).toBe(true);
  });

  it('sizes itself to leave a core for the main thread', () => {
    expect(defaultPoolSize(undefined)).toBe(1);
    expect(defaultPoolSize(1)).toBe(1);
    expect(defaultPoolSize(4)).toBe(3);
    expect(defaultPoolSize(16)).toBe(4);
  });
});
