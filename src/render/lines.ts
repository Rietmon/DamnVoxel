import { createStaticBuffer, createVertexArray, type GL, Program } from './gl';
import type { Mat4, Vec3 } from './math';

/** Floats per line instance: start xyz, end xyz, rgba, width in CSS pixels. */
const STRIDE = 11;

const LINE_VERTEX = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec3 aStart;
layout(location = 2) in vec3 aEnd;
layout(location = 3) in vec4 aColor;
layout(location = 4) in float aWidth;

uniform mat4 uViewProj;
uniform vec2 uViewport;
uniform float uPixelRatio;

out vec4 vColor;

void main() {
  vec4 a = uViewProj * vec4(aStart, 1.0);
  vec4 b = uViewProj * vec4(aEnd, 1.0);
  // Clip the segment against the near plane so lines through the camera stay correct.
  const float EPS = 1e-4;
  if (a.w < EPS && b.w < EPS) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vColor = vec4(0.0);
    return;
  }
  if (a.w < EPS) a = mix(a, b, (EPS - a.w) / (b.w - a.w));
  if (b.w < EPS) b = mix(b, a, (EPS - b.w) / (a.w - b.w));
  vec2 sa = a.xy / a.w * uViewport * 0.5;
  vec2 sb = b.xy / b.w * uViewport * 0.5;
  vec2 dir = sb - sa;
  float len = length(dir);
  dir = len > 1e-5 ? dir / len : vec2(1.0, 0.0);
  vec2 normal = vec2(-dir.y, dir.x);
  vec4 p = mix(a, b, aCorner.x);
  vec2 offset = normal * aCorner.y * aWidth * uPixelRatio * 0.5;
  p.xy += offset / (uViewport * 0.5) * p.w;
  gl_Position = p;
  vColor = aColor;
}
`;

const LINE_FRAGMENT = /* glsl */ `#version 300 es
precision mediump float;
in vec4 vColor;
uniform float uAlpha;
out vec4 outColor;
void main() {
  outColor = vec4(vColor.rgb, vColor.a * uAlpha);
}
`;

/** Collects line segments for one draw. Colours are 0…1 RGBA. */
export class LineBatch {
  private data = new Float32Array(STRIDE * 64);
  count = 0;

  clear(): void {
    this.count = 0;
  }

  add(a: Readonly<Vec3>, b: Readonly<Vec3>, color: readonly number[], width = 1.5): void {
    if ((this.count + 1) * STRIDE > this.data.length) {
      const grown = new Float32Array(this.data.length * 2);
      grown.set(this.data);
      this.data = grown;
    }
    const o = this.count * STRIDE;
    const d = this.data;
    d[o] = a[0];
    d[o + 1] = a[1];
    d[o + 2] = a[2];
    d[o + 3] = b[0];
    d[o + 4] = b[1];
    d[o + 5] = b[2];
    d[o + 6] = color[0]!;
    d[o + 7] = color[1]!;
    d[o + 8] = color[2]!;
    d[o + 9] = color[3] ?? 1;
    d[o + 10] = width;
    this.count++;
  }

  /** Twelve edges of an axis-aligned box given by two opposite corners. */
  addBox(min: Readonly<Vec3>, max: Readonly<Vec3>, color: readonly number[], width = 1.5): void {
    const [x0, y0, z0] = min;
    const [x1, y1, z1] = max;
    for (const [y, z] of [
      [y0, z0],
      [y1, z0],
      [y0, z1],
      [y1, z1],
    ] as const)
      this.add([x0, y, z], [x1, y, z], color, width);
    for (const [x, z] of [
      [x0, z0],
      [x1, z0],
      [x0, z1],
      [x1, z1],
    ] as const)
      this.add([x, y0, z], [x, y1, z], color, width);
    for (const [x, y] of [
      [x0, y0],
      [x1, y0],
      [x0, y1],
      [x1, y1],
    ] as const)
      this.add([x, y, z0], [x, y, z1], color, width);
  }

  get buffer(): Float32Array {
    return this.data.subarray(0, this.count * STRIDE);
  }
}

/** Draws line batches as screen-space quads of constant pixel width, one instance per line. */
export class LineRenderer {
  private readonly program: Program;
  private readonly vao: WebGLVertexArrayObject;
  private readonly instances: WebGLBuffer;
  private readonly corners: WebGLBuffer;
  private capacity = 0;

  constructor(private readonly gl: GL) {
    this.program = new Program(gl, LINE_VERTEX, LINE_FRAGMENT, 'lines');
    this.vao = createVertexArray(gl);
    gl.bindVertexArray(this.vao);
    this.corners = createStaticBuffer(
      gl,
      gl.ARRAY_BUFFER,
      new Float32Array([0, -1, 1, -1, 1, 1, 0, -1, 1, 1, 0, 1]),
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    const instances = gl.createBuffer();
    if (!instances) throw new Error('Cannot create a GL buffer');
    this.instances = instances;
    gl.bindBuffer(gl.ARRAY_BUFFER, instances);
    const bytes = STRIDE * 4;
    const attribs: [number, number, number][] = [
      [1, 3, 0],
      [2, 3, 12],
      [3, 4, 24],
      [4, 1, 40],
    ];
    for (const [loc, size, offset] of attribs) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, bytes, offset);
      gl.vertexAttribDivisor(loc, 1);
    }
    gl.bindVertexArray(null);
  }

  /** Draws with blending; `alpha` scales every line, for the faint pass through geometry. */
  draw(
    batch: LineBatch,
    viewProj: Mat4,
    width: number,
    height: number,
    pixelRatio: number,
    alpha = 1,
  ): void {
    if (batch.count === 0) return;
    const gl = this.gl;
    const data = batch.buffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
    if (data.byteLength > this.capacity) {
      this.capacity = data.byteLength * 2;
      gl.bufferData(gl.ARRAY_BUFFER, this.capacity, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
    const p = this.program;
    p.use();
    gl.uniformMatrix4fv(p.uniform('uViewProj'), false, viewProj);
    gl.uniform2f(p.uniform('uViewport'), width, height);
    gl.uniform1f(p.uniform('uPixelRatio'), pixelRatio);
    gl.uniform1f(p.uniform('uAlpha'), alpha);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(false);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, batch.count);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteBuffer(this.instances);
    gl.deleteBuffer(this.corners);
    gl.deleteVertexArray(this.vao);
    this.program.dispose();
  }
}
