import type { ProgramInput, ProgramResult } from '../kernels/program';

/** What a run reports when it did not finish: stopped by a newer run or by the time limit. */
function stopped(message: string): ProgramResult {
  return {
    positions: new Int32Array(0),
    colors: new Uint8Array(0),
    params: [],
    log: [],
    error: { message, line: null },
    ms: 0,
  };
}

/**
 * Shape programs in a worker of their own (docs/programs.md): one run at a time, the newest
 * wins, and a program that runs past the limit is stopped by ending the worker — a loop that
 * never ends cannot hang the editor. Where workers are missing (tests) it runs in place.
 */
export class ProgramWorker {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending: { id: number; resolve: (r: ProgramResult) => void; timer: number } | null = null;

  run(input: ProgramInput, timeoutMs = 5000): Promise<ProgramResult> {
    // The engine itself lives in the worker; without workers it loads here.
    if (typeof Worker === 'undefined')
      return import('../kernels/program').then(({ runProgram }) => runProgram(input));
    if (this.pending) {
      // The worker is busy with an older program: end it, it may never return.
      this.finish(stopped('Stopped: a new version started'));
      this.reset();
    }
    const worker = this.ensure();
    const id = this.nextId++;
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        this.finish(stopped(`The program ran longer than ${timeoutMs / 1000} s and was stopped`));
        this.reset();
      }, timeoutMs);
      this.pending = { id, resolve, timer };
      worker.postMessage({ id, input });
    });
  }

  private ensure(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./program.worker.ts', import.meta.url), {
      type: 'module',
      name: 'program',
    });
    worker.onmessage = (e: MessageEvent<{ id: number; result: ProgramResult }>) => {
      if (this.pending?.id === e.data.id) this.finish(e.data.result);
    };
    this.worker = worker;
    return worker;
  }

  private finish(result: ProgramResult): void {
    const p = this.pending;
    if (!p) return;
    clearTimeout(p.timer);
    this.pending = null;
    p.resolve(result);
  }

  private reset(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  dispose(): void {
    this.finish(stopped('Stopped'));
    this.reset();
  }
}
