import { createVertexArray, type GL, Program } from './gl';
import type { Mat4, Vec3 } from './math';

/** A reference picture as the renderer draws it (app/references.ts decides the rest). */
export interface ReferenceImage {
  readonly image: ImageBitmap;
  readonly opacity: number;
  /** null: behind everything, fitted to the viewport; corners: a plane in the scene. */
  readonly corners: readonly [Vec3, Vec3, Vec3, Vec3] | null;
}

const VERTEX = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec2 aUV;
uniform mat4 uViewProj;
/** Background: positions are already in clip space. */
uniform bool uScreen;
out vec2 vUV;
void main() {
  vUV = aUV;
  gl_Position = uScreen ? vec4(aPosition.xy, 1.0, 1.0) : uViewProj * vec4(aPosition, 1.0);
}
`;

const FRAGMENT = /* glsl */ `#version 300 es
precision mediump float;
uniform sampler2D uImage;
uniform float uOpacity;
in vec2 vUV;
out vec4 outColor;
void main() {
  vec4 c = texture(uImage, vUV);
  float a = c.a * uOpacity;
  outColor = vec4(c.rgb * a, a);
}
`;

/** Draws reference pictures: backgrounds before the scene, planes among it. */
export class ReferenceRenderer {
  private readonly program: Program;
  private readonly vao: WebGLVertexArrayObject;
  private readonly buffer: WebGLBuffer;
  private readonly textures = new Map<ImageBitmap, WebGLTexture>();
  private readonly data = new Float32Array(4 * 5);

  constructor(private readonly gl: GL) {
    this.program = new Program(gl, VERTEX, FRAGMENT, 'reference');
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error('Cannot create a GL buffer');
    this.buffer = buffer;
    this.vao = createVertexArray(gl);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    gl.bindVertexArray(null);
  }

  /** Keeps textures for these pictures and frees the rest. */
  sync(images: readonly ReferenceImage[]): void {
    const wanted = new Set(images.map((r) => r.image));
    for (const [image, texture] of this.textures) {
      if (!wanted.has(image)) {
        this.gl.deleteTexture(texture);
        this.textures.delete(image);
      }
    }
  }

  /** Pictures fitted inside the viewport, behind everything. */
  drawBackgrounds(images: readonly ReferenceImage[], width: number, height: number): void {
    const list = images.filter((r) => r.corners === null && r.opacity > 0);
    if (list.length === 0) return;
    const gl = this.gl;
    this.begin(false);
    gl.disable(gl.DEPTH_TEST);
    for (const r of list) {
      // Contain: the whole picture shows, centred.
      const imageAspect = r.image.width / Math.max(1, r.image.height);
      const viewAspect = width / Math.max(1, height);
      const sx = imageAspect > viewAspect ? 1 : imageAspect / viewAspect;
      const sy = imageAspect > viewAspect ? viewAspect / imageAspect : 1;
      this.quad(
        [
          [-sx, sy, 0],
          [sx, sy, 0],
          [sx, -sy, 0],
          [-sx, -sy, 0],
        ],
        r,
      );
    }
    gl.enable(gl.DEPTH_TEST);
    this.end();
  }

  /** Pictures on planes in the scene: hidden behind the model, never hiding it. */
  drawPlanes(images: readonly ReferenceImage[], viewProj: Mat4): void {
    const list = images.filter((r) => r.corners !== null && r.opacity > 0);
    if (list.length === 0) return;
    this.begin(true);
    this.gl.uniformMatrix4fv(this.program.uniform('uViewProj'), false, viewProj);
    for (const r of list) this.quad(r.corners!, r);
    this.end();
  }

  private begin(scene: boolean): void {
    const gl = this.gl;
    this.program.use();
    gl.uniform1i(this.program.uniform('uScreen'), scene ? 0 : 1);
    gl.uniform1i(this.program.uniform('uImage'), 3);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.vao);
  }

  private end(): void {
    const gl = this.gl;
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
  }

  private quad(corners: readonly Vec3[], r: ReferenceImage): void {
    const gl = this.gl;
    const uv = [0, 0, 1, 0, 1, 1, 0, 1];
    for (let i = 0; i < 4; i++) {
      this.data.set(corners[i]!, i * 5);
      this.data[i * 5 + 3] = uv[i * 2]!;
      this.data[i * 5 + 4] = uv[i * 2 + 1]!;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.data, gl.DYNAMIC_DRAW);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.texture(r.image));
    gl.uniform1f(this.program.uniform('uOpacity'), r.opacity);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
  }

  private texture(image: ImageBitmap): WebGLTexture {
    let texture = this.textures.get(image);
    if (texture) return texture;
    const gl = this.gl;
    texture = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.textures.set(image, texture);
    return texture;
  }

  dispose(): void {
    const gl = this.gl;
    for (const texture of this.textures.values()) gl.deleteTexture(texture);
    this.textures.clear();
    gl.deleteBuffer(this.buffer);
    gl.deleteVertexArray(this.vao);
    this.program.dispose();
  }
}
