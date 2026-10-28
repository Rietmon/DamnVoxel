/** The part of `Worker` the pool uses; tests pass a fake. */
export interface WorkerLike {
  postMessage(message: unknown, options?: { transfer?: Transferable[] }): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  terminate(): void;
}

/** Every request carries an id; the worker answers with the same id. */
export interface PoolMessage {
  id: number;
}

interface Job<Res> {
  message: PoolMessage;
  transfer: Transferable[];
  resolve: (result: Res) => void;
  reject: (error: unknown) => void;
}

/** Default pool size: leave one core to the main thread, at most four workers, at least one. */
export function defaultPoolSize(hardwareConcurrency: number | undefined): number {
  return Math.max(1, Math.min((hardwareConcurrency ?? 2) - 1, 4));
}

/**
 * Fixed set of workers with a FIFO queue. One job per worker at a time, so a slow job never
 * holds up results that are ready elsewhere. Data moves as transferables; nothing is shared.
 */
export class WorkerPool<Req extends PoolMessage, Res extends PoolMessage> {
  private readonly idle: WorkerLike[] = [];
  private readonly running = new Map<WorkerLike, Job<Res>>();
  private readonly queue: Job<Res>[] = [];
  private readonly all: WorkerLike[] = [];

  constructor(factory: () => WorkerLike, size: number) {
    for (let i = 0; i < size; i++) {
      const worker = factory();
      worker.onmessage = (event) => this.finish(worker, event.data as Res, null);
      worker.onerror = (error) => this.finish(worker, null, error);
      this.all.push(worker);
      this.idle.push(worker);
    }
  }

  get size(): number {
    return this.all.length;
  }

  /** Jobs waiting for a worker plus jobs being worked on. */
  get pending(): number {
    return this.queue.length + this.running.size;
  }

  run(message: Req, transfer: Transferable[] = []): Promise<Res> {
    return new Promise<Res>((resolve, reject) => {
      this.queue.push({ message, transfer, resolve, reject });
      this.pump();
    });
  }

  terminate(): void {
    for (const worker of this.all) worker.terminate();
    const error = new Error('Worker pool terminated');
    for (const job of [...this.queue, ...this.running.values()]) job.reject(error);
    this.queue.length = 0;
    this.running.clear();
    this.idle.length = 0;
  }

  private pump(): void {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const worker = this.idle.pop()!;
      const job = this.queue.shift()!;
      this.running.set(worker, job);
      worker.postMessage(job.message, { transfer: job.transfer });
    }
  }

  private finish(worker: WorkerLike, result: Res | null, error: unknown): void {
    const job = this.running.get(worker);
    if (!job) return;
    this.running.delete(worker);
    this.idle.push(worker);
    if (result) job.resolve(result);
    else job.reject(error);
    this.pump();
  }
}
