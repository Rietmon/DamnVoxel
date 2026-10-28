import { CHUNK_SIZE, keyX, keyY, keyZ } from '../core/coords';
import type { VoxelObject } from '../core/scene';
import { MAX_QUADS, QUAD_WORDS } from '../kernels/mesher';
import { BufferPool, createVertexArray, type GL, type PooledBuffer, QuadIndexBuffer } from './gl';

/** GPU mesh of one chunk. Positions are relative to the chunk origin. */
export interface ChunkMesh {
  readonly key: number;
  /** Chunk origin in object-local voxels. */
  readonly origin: readonly [number, number, number];
  readonly vao: WebGLVertexArrayObject;
  vbo: PooledBuffer;
  quads: number;
}

/**
 * GPU meshes of all chunks of all objects. Uploads reuse pooled buffers; one shared index
 * buffer sized for the worst chunk serves every mesh.
 */
export class ChunkMeshStore {
  private readonly objects = new Map<VoxelObject, Map<number, ChunkMesh>>();
  private readonly vertexPool: BufferPool;
  private readonly indices: QuadIndexBuffer;
  private gpuBytes = 0;

  constructor(private readonly gl: GL) {
    this.vertexPool = new BufferPool(gl, gl.ARRAY_BUFFER);
    this.indices = new QuadIndexBuffer(gl);
    this.indices.ensure(MAX_QUADS);
  }

  /** Bytes of vertex data on the GPU, for diagnostics. */
  get vertexBytes(): number {
    return this.gpuBytes;
  }

  meshesOf(object: VoxelObject): ReadonlyMap<number, ChunkMesh> | undefined {
    return this.objects.get(object);
  }

  trackedObjects(): IterableIterator<VoxelObject> {
    return this.objects.keys();
  }

  /** Replaces the mesh of a chunk; zero quads removes it. `vertices` holds `quads` quads. */
  upload(object: VoxelObject, key: number, vertices: Uint32Array, quads: number): void {
    if (quads === 0) {
      this.remove(object, key);
      return;
    }
    const gl = this.gl;
    const bytes = quads * QUAD_WORDS * 4;
    let meshes = this.objects.get(object);
    if (!meshes) {
      meshes = new Map();
      this.objects.set(object, meshes);
    }
    let mesh = meshes.get(key);
    if (!mesh) {
      const vao = createVertexArray(gl);
      const vbo = this.vertexPool.acquire(bytes);
      mesh = {
        key,
        origin: [keyX(key) * CHUNK_SIZE, keyY(key) * CHUNK_SIZE, keyZ(key) * CHUNK_SIZE],
        vao,
        vbo,
        quads: 0,
      };
      meshes.set(key, mesh);
      this.gpuBytes += vbo.capacity;
      this.bindVertexArray(mesh);
    } else if (mesh.vbo.capacity < bytes) {
      this.gpuBytes -= mesh.vbo.capacity;
      this.vertexPool.release(mesh.vbo);
      mesh.vbo = this.vertexPool.acquire(bytes);
      this.gpuBytes += mesh.vbo.capacity;
      this.bindVertexArray(mesh);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices, 0, quads * QUAD_WORDS);
    mesh.quads = quads;
  }

  remove(object: VoxelObject, key: number): void {
    const meshes = this.objects.get(object);
    const mesh = meshes?.get(key);
    if (!meshes || !mesh) return;
    this.free(mesh);
    meshes.delete(key);
    if (meshes.size === 0) this.objects.delete(object);
  }

  removeObject(object: VoxelObject): void {
    const meshes = this.objects.get(object);
    if (!meshes) return;
    for (const mesh of meshes.values()) this.free(mesh);
    this.objects.delete(object);
  }

  /** Draws one mesh; the program and its uniforms must be set already. */
  draw(mesh: ChunkMesh): void {
    const gl = this.gl;
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, mesh.quads * 6, gl.UNSIGNED_INT, 0);
  }

  dispose(): void {
    for (const object of [...this.objects.keys()]) this.removeObject(object);
    this.vertexPool.dispose();
    this.indices.dispose();
  }

  private bindVertexArray(mesh: ChunkMesh): void {
    const gl = this.gl;
    gl.bindVertexArray(mesh.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo.buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribIPointer(0, 2, gl.UNSIGNED_INT, 8, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indices.ensure(MAX_QUADS));
    gl.bindVertexArray(null);
  }

  private free(mesh: ChunkMesh): void {
    this.gl.deleteVertexArray(mesh.vao);
    this.gpuBytes -= mesh.vbo.capacity;
    this.vertexPool.release(mesh.vbo);
  }
}
