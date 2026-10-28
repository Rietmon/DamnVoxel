import type { MeshRequest, MeshResponse } from './mesh-protocol';
import { defaultPoolSize, type WorkerLike, WorkerPool } from './pool';

export interface MeshResult {
  vertices: Uint32Array;
  quads: number;
  /** The padded buffer that was sent, returned for reuse. */
  padded: Uint16Array;
}

/** Meshes chunks in a pool of workers. */
export class MeshWorkers {
  private readonly pool: WorkerPool<MeshRequest, MeshResponse>;
  private nextId = 1;

  constructor(size = defaultPoolSize(navigator.hardwareConcurrency)) {
    this.pool = new WorkerPool<MeshRequest, MeshResponse>(
      () =>
        new Worker(new URL('./mesh.worker.ts', import.meta.url), {
          type: 'module',
          name: 'mesh',
        }) as unknown as WorkerLike,
      size,
    );
  }

  /** How many jobs keep every worker busy without piling up stale work. */
  get capacity(): number {
    return this.pool.size * 2;
  }

  get pending(): number {
    return this.pool.pending;
  }

  /** Meshes a padded chunk; the buffer is transferred to the worker and comes back. */
  async mesh(padded: Uint16Array): Promise<MeshResult> {
    const response = await this.pool.run({ id: this.nextId++, padded }, [padded.buffer]);
    return { vertices: response.vertices, quads: response.quads, padded: response.padded };
  }

  terminate(): void {
    this.pool.terminate();
  }
}
