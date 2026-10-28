import { createVertexArray, type GL, Program } from './gl';
import type { Mat4, Vec3 } from './math';

/** A translucent quad: four corners in order and an RGBA colour (0…1). */
export interface PlaneQuad {
  corners: [Vec3, Vec3, Vec3, Vec3];
  color: readonly number[];
}

/** Floats per vertex: position, colour, uv. */
const STRIDE = 9;

const VERTEX = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec4 aColor;
layout(location = 2) in vec2 aUV;
uniform mat4 uViewProj;
out vec4 vColor;
out vec2 vUV;
void main() {
  vColor = aColor;
  vUV = aUV;
  gl_Position = uViewProj * vec4(aPosition, 1.0);
}
`;

const FRAGMENT = /* glsl */ `#version 300 es
precision mediump float;
in vec4 vColor;
in vec2 vUV;
out vec4 outColor;
void main() {
  // Soft fill that thickens towards the edges, so the plane reads without hiding the model.
  vec2 d = min(vUV, 1.0 - vUV);
  float edge = 1.0 - smoothstep(0.0, 0.08, min(d.x, d.y));
  outColor = vec4(vColor.rgb, vColor.a * (0.45 + 0.55 * edge));
}
`;

/** Draws translucent planes (mirror planes) with depth test and no depth writes. */
export class PlaneRenderer {
  private readonly program: Program;
  private readonly vao: WebGLVertexArrayObject;
  private readonly buffer: WebGLBuffer;
  private data = new Float32Array(STRIDE * 6 * 3);

  constructor(private readonly gl: GL) {
    this.program = new Program(gl, VERTEX, FRAGMENT, 'planes');
    this.vao = createVertexArray(gl);
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error('Cannot create a GL buffer');
    this.buffer = buffer;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const bytes = STRIDE * 4;
    for (const [loc, size, offset] of [
      [0, 3, 0],
      [1, 4, 12],
      [2, 2, 28],
    ] as const) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, bytes, offset);
    }
    gl.bindVertexArray(null);
  }

  draw(quads: readonly PlaneQuad[], viewProj: Mat4): void {
    if (quads.length === 0) return;
    const gl = this.gl;
    const floats = quads.length * 6 * STRIDE;
    if (this.data.length < floats) this.data = new Float32Array(floats);
    const uv = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    let o = 0;
    for (const q of quads) {
      for (const k of [0, 1, 2, 0, 2, 3]) {
        const p = q.corners[k]!;
        this.data.set(
          [
            p[0],
            p[1],
            p[2],
            q.color[0]!,
            q.color[1]!,
            q.color[2]!,
            q.color[3] ?? 1,
            uv[k]![0]!,
            uv[k]![1]!,
          ],
          o,
        );
        o += STRIDE;
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.subarray(0, floats), gl.DYNAMIC_DRAW);
    this.program.use();
    gl.uniformMatrix4fv(this.program.uniform('uViewProj'), false, viewProj);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, quads.length * 6);
    gl.bindVertexArray(null);
    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  dispose(): void {
    this.gl.deleteBuffer(this.buffer);
    this.gl.deleteVertexArray(this.vao);
    this.program.dispose();
  }
}
