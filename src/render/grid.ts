import type { Camera } from './camera';
import { type GL, Program } from './gl';

const GRID_VERTEX = /* glsl */ `#version 300 es
precision highp float;

uniform mat4 uViewProj;
uniform vec2 uCenter;
uniform float uRadius;

out vec3 vWorld;

void main() {
  // A square on y = 0 from four vertices: (−1, −1), (1, −1), (−1, 1), (1, 1).
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;
  vec2 p = uCenter + corner * uRadius;
  vWorld = vec3(p.x, 0.0, p.y);
  gl_Position = uViewProj * vec4(vWorld, 1.0);
}
`;

const GRID_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;

in vec3 vWorld;

uniform vec2 uCenter;
uniform float uRadius;
uniform float uMajor;
uniform bool uLines;
uniform bool uFloor;
/** Line colour, sRGB: white on a dark background, dark on a light one. */
uniform vec3 uColor;

out vec4 outColor;

/** Coverage of grid lines with spacing 'step' at point p, about one pixel wide. */
float lines(vec2 p, float step) {
  vec2 coord = p / step;
  vec2 fw = max(fwidth(coord), vec2(1e-5));
  vec2 d = abs(fract(coord - 0.5) - 0.5) / fw;
  return 1.0 - min(min(d.x, d.y), 1.0);
}

void main() {
  vec2 p = vWorld.xz;
  float edgeFade = 1.0 - smoothstep(uRadius * 0.55, uRadius, length(p - uCenter));
  // World units per pixel: when lines crowd closer than a few pixels they fade out.
  float density = max(fwidth(p.x), fwidth(p.y));
  float minor = lines(p, 1.0) * (1.0 - smoothstep(0.12, 0.3, density));
  float major = lines(p, uMajor) * (1.0 - smoothstep(0.12 * uMajor, 0.3 * uMajor, density));

  float alpha = uFloor ? 0.035 : 0.0;
  if (uLines) alpha = max(alpha, max(minor * 0.07, major * 0.16));
  alpha *= edgeFade;
  if (alpha <= 0.002) discard;
  outColor = vec4(uColor * alpha, alpha);
}
`;

/** The construction grid and floor on y = 0, drawn after the opaque meshes. */
export class GridRenderer {
  private readonly program: Program;
  private readonly vao: WebGLVertexArrayObject | null;

  constructor(private readonly gl: GL) {
    this.program = new Program(gl, GRID_VERTEX, GRID_FRAGMENT, 'grid');
    // WebGL2 needs a bound VAO even with no attributes.
    this.vao = gl.createVertexArray();
  }

  draw(
    camera: Camera,
    lines: boolean,
    floor: boolean,
    major: number,
    color: readonly [number, number, number] = [1, 1, 1],
  ): void {
    if (!lines && !floor) return;
    const gl = this.gl;
    const p = this.program;
    const radius = Math.max(64, camera.distance * 3);
    // Snap the centre to the major step so lines do not swim while the camera moves.
    const cx = Math.round(camera.target[0] / major) * major;
    const cz = Math.round(camera.target[2] / major) * major;
    p.use();
    gl.uniformMatrix4fv(p.uniform('uViewProj'), false, camera.viewProj);
    gl.uniform2f(p.uniform('uCenter'), cx, cz);
    gl.uniform1f(p.uniform('uRadius'), radius);
    gl.uniform1f(p.uniform('uMajor'), major);
    gl.uniform1i(p.uniform('uLines'), lines ? 1 : 0);
    gl.uniform1i(p.uniform('uFloor'), floor ? 1 : 0);
    gl.uniform3f(p.uniform('uColor'), color[0], color[1], color[2]);
    gl.enable(gl.BLEND);
    // Premultiplied alpha.
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    // Behind faces that lie on y = 0, so the bottom of a model never flickers with the grid.
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1, 4);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
  }

  dispose(): void {
    this.gl.deleteVertexArray(this.vao);
    this.program.dispose();
  }
}
