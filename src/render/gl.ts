/**
 * Thin WebGL2 layer: programs with readable compile errors, buffers, vertex arrays and a pool
 * that reuses buffers by capacity. Everything here is recreated after a context loss, so nothing
 * outside the renderer keeps GL objects.
 */

export type GL = WebGL2RenderingContext;

export class ShaderError extends Error {}

/** Puts line numbers in front of the source so driver messages ("0:12: …") are easy to follow. */
function numbered(source: string): string {
  return source
    .split('\n')
    .map((line, i) => `${String(i + 1).padStart(4)}: ${line}`)
    .join('\n');
}

function compile(gl: GL, type: number, source: string, name: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new ShaderError(`${name}: cannot create shader`);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(shader) ?? '';
    gl.deleteShader(shader);
    const kind = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment';
    throw new ShaderError(`${name} (${kind}) failed to compile:\n${log}\n${numbered(source)}`);
  }
  return shader;
}

/** A linked program with cached uniform locations. Attributes use `layout(location = N)`. */
export class Program {
  readonly program: WebGLProgram;
  private readonly uniforms = new Map<string, WebGLUniformLocation | null>();

  constructor(
    private readonly gl: GL,
    vertex: string,
    fragment: string,
    readonly name: string,
  ) {
    const vs = compile(gl, gl.VERTEX_SHADER, vertex, name);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fragment, name);
    const program = gl.createProgram();
    if (!program) throw new ShaderError(`${name}: cannot create program`);
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
      const log = gl.getProgramInfoLog(program) ?? '';
      gl.deleteProgram(program);
      throw new ShaderError(`${name} failed to link:\n${log}`);
    }
    this.program = program;
  }

  use(): void {
    this.gl.useProgram(this.program);
  }

  /** Uniform location, or null when the driver optimised the uniform away. */
  uniform(name: string): WebGLUniformLocation | null {
    let loc = this.uniforms.get(name);
    if (loc === undefined) {
      loc = this.gl.getUniformLocation(this.program, name);
      this.uniforms.set(name, loc);
    }
    return loc;
  }

  dispose(): void {
    this.gl.deleteProgram(this.program);
  }
}

export interface PooledBuffer {
  readonly buffer: WebGLBuffer;
  /** Allocated size in bytes. */
  readonly capacity: number;
}

/** Smallest power of two ≥ bytes, at least 1 KB: few distinct sizes, so buffers reuse well. */
export function bucketSize(bytes: number): number {
  return Math.max(1024, 2 ** Math.ceil(Math.log2(Math.max(1, bytes))));
}

/**
 * Reuses GL buffers by capacity bucket. Chunk meshes come and go all the time; allocating
 * fresh buffers for each makes drivers stutter on phones.
 */
export class BufferPool {
  private readonly free = new Map<number, WebGLBuffer[]>();
  private freeBytes = 0;

  constructor(
    private readonly gl: GL,
    private readonly target: number,
    /** Free buffers above this total are deleted instead of kept. */
    private readonly keepBytes = 32 * 1024 * 1024,
  ) {}

  /** A buffer with room for `bytes`, contents undefined. Leaves it bound to the target. */
  acquire(bytes: number): PooledBuffer {
    const capacity = bucketSize(bytes);
    const list = this.free.get(capacity);
    const gl = this.gl;
    const reused = list?.pop();
    if (reused) {
      this.freeBytes -= capacity;
      gl.bindBuffer(this.target, reused);
      return { buffer: reused, capacity };
    }
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error('Cannot create a GL buffer');
    gl.bindBuffer(this.target, buffer);
    gl.bufferData(this.target, capacity, gl.DYNAMIC_DRAW);
    return { buffer, capacity };
  }

  release(pooled: PooledBuffer): void {
    if (this.freeBytes + pooled.capacity > this.keepBytes) {
      this.gl.deleteBuffer(pooled.buffer);
      return;
    }
    let list = this.free.get(pooled.capacity);
    if (!list) {
      list = [];
      this.free.set(pooled.capacity, list);
    }
    list.push(pooled.buffer);
    this.freeBytes += pooled.capacity;
  }

  dispose(): void {
    for (const list of this.free.values()) for (const b of list) this.gl.deleteBuffer(b);
    this.free.clear();
    this.freeBytes = 0;
  }
}

export function createVertexArray(gl: GL): WebGLVertexArrayObject {
  const vao = gl.createVertexArray();
  if (!vao) throw new Error('Cannot create a vertex array');
  return vao;
}

export function createStaticBuffer(gl: GL, target: number, data: ArrayBufferView): WebGLBuffer {
  const buffer = gl.createBuffer();
  if (!buffer) throw new Error('Cannot create a GL buffer');
  gl.bindBuffer(target, buffer);
  gl.bufferData(target, data, gl.STATIC_DRAW);
  return buffer;
}

/**
 * Index buffer for quads drawn as two triangles (0, 1, 2) and (0, 2, 3), shared by every mesh
 * made of quads. Grows on demand; bind it into a VAO after `ensure`.
 */
export class QuadIndexBuffer {
  /** Changes when the buffer is replaced: VAOs that bound the old one must rebind. */
  generation = 0;
  private buffer: WebGLBuffer | null = null;
  private quads = 0;

  constructor(private readonly gl: GL) {}

  /** Makes room for `quads` quads and returns the buffer. */
  ensure(quads: number): WebGLBuffer {
    if (this.buffer && quads <= this.quads) return this.buffer;
    const count = Math.max(4096, 2 ** Math.ceil(Math.log2(quads)));
    const indices = new Uint32Array(count * 6);
    for (let q = 0, i = 0; q < count; q++, i += 6) {
      const v = q * 4;
      indices[i] = v;
      indices[i + 1] = v + 1;
      indices[i + 2] = v + 2;
      indices[i + 3] = v;
      indices[i + 4] = v + 2;
      indices[i + 5] = v + 3;
    }
    if (this.buffer) this.gl.deleteBuffer(this.buffer);
    this.buffer = createStaticBuffer(this.gl, this.gl.ELEMENT_ARRAY_BUFFER, indices);
    this.quads = count;
    this.generation++;
    return this.buffer;
  }

  dispose(): void {
    if (this.buffer) this.gl.deleteBuffer(this.buffer);
    this.buffer = null;
    this.quads = 0;
  }
}
