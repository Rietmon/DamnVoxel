import type { Camera } from './camera';
import { type GL, Program } from './gl';

/**
 * Silhouette outline (docs/rendering.md, “Outline”): the models are drawn into an offscreen
 * colour + depth target, then copied to the screen with a line wherever depth jumps — around the
 * silhouette and along creases. Flat faces never get a line: the test is on the second
 * difference of window depth, which is zero across any plane in perspective and orthographic
 * views alike. The copy writes depth too, so what is drawn after it (ghosts, grid, lines) is
 * still hidden behind the models.
 */

const VERTEX = /* glsl */ `#version 300 es
void main() {
  // One triangle over the whole screen.
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

const FRAGMENT = /* glsl */ `#version 300 es
precision highp float;

uniform sampler2D uColor;
uniform sampler2D uDepth;
uniform float uNear;
uniform float uFar;
uniform bool uOrtho;
/** Line thickness in device pixels. */
uniform float uStep;
uniform vec3 uInk;

out vec4 outColor;

/** World distance along the view ray that a step in window depth stands for, near depth d. */
float worldPerDepth(float d) {
  if (uOrtho) return uFar - uNear;
  float z = uNear * uFar / (uFar - d * (uFar - uNear));
  return z * z * (uFar - uNear) / (uNear * uFar);
}

float depthAt(ivec2 p) {
  ivec2 size = textureSize(uDepth, 0);
  return texelFetch(uDepth, clamp(p, ivec2(0), size - 1), 0).r;
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 color = texelFetch(uColor, p, 0);
  float d = depthAt(p);
  int s = int(uStep);
  float l = depthAt(p + ivec2(-s, 0));
  float r = depthAt(p + ivec2(s, 0));
  float b = depthAt(p + ivec2(0, -s));
  float t = depthAt(p + ivec2(0, s));
  float nearest = min(d, min(min(l, r), min(b, t)));
  float scale = worldPerDepth(nearest);
  // Second differences: zero on a plane, large at a fold or an outer edge.
  float bend = max(abs(l + r - 2.0 * d), abs(b + t - 2.0 * d)) * scale;
  float edge = smoothstep(0.06, 0.25, bend);
  // Where nothing was drawn the target is clear: only the line covers the background there.
  float alpha = max(color.a, edge);
  outColor = vec4(mix(color.rgb * color.a, uInk, edge), alpha);
  gl_FragDepth = edge > 0.0 ? nearest : d;
}
`;

export class OutlinePass {
  private readonly program: Program;
  private readonly framebuffer: WebGLFramebuffer;
  private readonly color: WebGLTexture;
  private readonly depth: WebGLTexture;
  private readonly vao: WebGLVertexArrayObject | null;
  private width = 0;
  private height = 0;

  constructor(private readonly gl: GL) {
    this.program = new Program(gl, VERTEX, FRAGMENT, 'outline');
    this.framebuffer = gl.createFramebuffer()!;
    this.color = gl.createTexture()!;
    this.depth = gl.createTexture()!;
    this.vao = gl.createVertexArray();
  }

  /** Draws into the offscreen target from now on (cleared by the caller). */
  begin(width: number, height: number): void {
    const gl = this.gl;
    if (width !== this.width || height !== this.height) this.allocate(width, height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
  }

  /** Back to the screen: the picture with its outline, and its depth. */
  finish(camera: Camera, ink: readonly [number, number, number], pixelRatio: number): void {
    const gl = this.gl;
    const p = this.program;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    p.use();
    // Units 1 and 2: unit 0 holds the palette the chunk shader keeps using afterwards.
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.color);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.depth);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(p.uniform('uColor'), 1);
    gl.uniform1i(p.uniform('uDepth'), 2);
    const [near, far] = camera.clipRange();
    gl.uniform1f(p.uniform('uNear'), near);
    gl.uniform1f(p.uniform('uFar'), far);
    gl.uniform1i(p.uniform('uOrtho'), camera.projection === 'orthographic' ? 1 : 0);
    gl.uniform1f(p.uniform('uStep'), Math.max(1, Math.round(pixelRatio)));
    gl.uniform3f(p.uniform('uInk'), ink[0], ink[1], ink[2]);
    gl.depthFunc(gl.ALWAYS);
    gl.disable(gl.CULL_FACE);
    // Premultiplied over what the screen already has (the background and its picture).
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
  }

  private allocate(width: number, height: number): void {
    const gl = this.gl;
    this.width = width;
    this.height = height;
    gl.bindTexture(gl.TEXTURE_2D, this.color);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, this.depth);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.DEPTH_COMPONENT24,
      width,
      height,
      0,
      gl.DEPTH_COMPONENT,
      gl.UNSIGNED_INT,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.color, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depth, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  dispose(): void {
    const gl = this.gl;
    this.program.dispose();
    gl.deleteFramebuffer(this.framebuffer);
    gl.deleteTexture(this.color);
    gl.deleteTexture(this.depth);
    gl.deleteVertexArray(this.vao);
  }
}
