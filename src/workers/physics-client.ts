import { type SimInput, simulate } from '../kernels/verlet';

/**
 * Runs particle simulations off the main thread (ropes, cloth): one worker, started on first
 * use. Where workers are missing (tests, old browsers) it runs in place.
 */
export class PhysicsWorker {
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly waiting = new Map<number, (positions: Float32Array) => void>();

  run(input: SimInput): Promise<Float32Array> {
    if (typeof Worker === 'undefined') return Promise.resolve(simulate(input));
    if (!this.worker) {
      this.worker = new Worker(new URL('./physics.worker.ts', import.meta.url), {
        type: 'module',
        name: 'physics',
      });
      this.worker.onmessage = (e: MessageEvent<{ id: number; positions: Float32Array }>) => {
        this.waiting.get(e.data.id)?.(e.data.positions);
        this.waiting.delete(e.data.id);
      };
    }
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.worker!.postMessage({ id, input }, [input.positions.buffer]);
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
