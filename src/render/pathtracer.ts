import type { Camera } from './camera';
import { type GL, Program } from './gl';
import { PALETTE_TEXTURE_SIZE } from './palette-texture';
import type { MaterialRow, RenderSettings, SceneGrid } from './render-settings';

export {
  DEFAULT_RENDER,
  type MaterialRow,
  type RenderSettings,
  type SceneGrid,
} from './render-settings';

/**
 * Progressive path tracing of the voxel scene (docs/rendering.md, “Path tracing”), like the
 * Render tab of MagicaVoxel. The visible voxels are baked into one 3D texture of palette ids; a
 * fragment shader walks rays through it cell by cell (DDA), bounces them off MagicaVoxel
 * materials, lights them by the sun and the sky, and adds one sample per pixel per pass into a
 * half-float target. The image is the average of the passes.
 *
 * Each picture keeps its own samples (an Accumulation): the render view, the render window over
 * the editing view and a frame being saved run side by side on one scene.
 */

const VERTEX = /* glsl */ `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

const TRACE = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp usampler3D;

uniform usampler3D uGrid;
uniform ivec3 uGridSize;
uniform vec3 uGridMin;
uniform sampler2D uPalette;
uniform sampler2D uMaterial;
uniform sampler2D uMaterial2;
uniform mat4 uInvViewProj;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamForward;
uniform bool uOrtho;
uniform vec2 uResolution;
uniform vec2 uOffset;
uniform vec2 uFull;
uniform uint uFrame;
uniform int uBounces;
uniform vec3 uSunDir;
uniform vec3 uSun;
uniform float uSunCos;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform bool uGround;
uniform float uGroundY;
uniform vec3 uGroundColor;
uniform float uFog;
uniform vec3 uFogColor;
uniform float uAperture;
uniform float uFocus;
uniform bool uUseEnv;
uniform sampler2D uEnv;
uniform float uEnvStrength;
uniform bool uCutout;
uniform bool uPixelated;

out vec4 outColor;

uint seed;
uint pcg(uint v) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
float rand() {
  seed = pcg(seed);
  return float(seed) / 4294967296.0;
}

vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }

uint idAt(ivec3 c) {
  if (any(lessThan(c, ivec3(0))) || any(greaterThanEqual(c, uGridSize))) return 0u;
  return texelFetch(uGrid, c, 0).r;
}

ivec2 texelOf(uint id) { return ivec2(int(id & 255u), int(id >> 8u)); }

/** The first cell along a ray that is not \`inside\` (0: the first filled cell). */
bool march(vec3 ro, vec3 rd, uint inside, float tLimit, out float tHit, out vec3 n, out uint id) {
  vec3 p = ro - uGridMin;
  // No zero components: an axis-parallel ray would make inf · 0.
  vec3 d = vec3(abs(rd.x) < 1e-8 ? 1e-8 : rd.x, abs(rd.y) < 1e-8 ? 1e-8 : rd.y, abs(rd.z) < 1e-8 ? 1e-8 : rd.z);
  vec3 inv = 1.0 / d;
  vec3 t0 = (vec3(0.0) - p) * inv;
  vec3 t1 = (vec3(uGridSize) - p) * inv;
  vec3 tmin = min(t0, t1);
  vec3 tmax = max(t0, t1);
  float enter = max(max(tmin.x, tmin.y), tmin.z);
  float exit = min(min(tmax.x, tmax.y), tmax.z);
  if (exit < max(enter, 0.0)) return false;
  float t = max(enter, 0.0);
  vec3 q = p + rd * (t + 1e-4);
  ivec3 cell = clamp(ivec3(floor(q)), ivec3(0), uGridSize - 1);
  ivec3 stepv = ivec3(sign(d));
  vec3 delta = abs(inv);
  vec3 next = (vec3(cell) + max(vec3(stepv), 0.0) - p) * inv;
  n = enter > 0.0 ? -vec3(stepv) * vec3(equal(tmin, vec3(enter))) : vec3(0.0);
  int steps = uGridSize.x + uGridSize.y + uGridSize.z;
  for (int i = 0; i < 2048; i++) {
    if (i >= steps || t > tLimit) break;
    uint v = idAt(cell);
    bool stop = inside == 0u ? v != 0u : v != inside;
    if (stop && (inside != 0u || t > 0.0 || enter > 0.0 || i > 0)) {
      tHit = t;
      id = v;
      return true;
    }
    if (next.x < next.y && next.x < next.z) {
      t = next.x; next.x += delta.x; cell.x += stepv.x; n = vec3(-float(stepv.x), 0.0, 0.0);
    } else if (next.y < next.z) {
      t = next.y; next.y += delta.y; cell.y += stepv.y; n = vec3(0.0, -float(stepv.y), 0.0);
    } else {
      t = next.z; next.z += delta.z; cell.z += stepv.z; n = vec3(0.0, 0.0, -float(stepv.z));
    }
    if (any(lessThan(cell, ivec3(0))) || any(greaterThanEqual(cell, uGridSize))) {
      if (inside != 0u) { tHit = t; id = 0u; return true; }
      return false;
    }
  }
  return false;
}

vec3 sky(vec3 rd, bool direct) {
  vec3 c;
  if (uUseEnv) {
    vec2 uv = vec2(atan(rd.x, -rd.z) / 6.2831853 + 0.5, acos(clamp(rd.y, -1.0, 1.0)) / 3.1415927);
    c = texture(uEnv, uv).rgb * uEnvStrength;
  } else {
    float h = max(rd.y, 0.0);
    c = mix(uHorizon, uZenith, pow(h, 0.45));
    if (rd.y < 0.0) c = uHorizon * 0.6;
  }
  if (direct && dot(rd, uSunDir) > uSunCos) c += uSun * 40.0;
  return c;
}

vec3 cosineDir(vec3 n) {
  float a = rand() * 6.2831853;
  float r = sqrt(rand());
  vec3 t = normalize(abs(n.y) < 0.99 ? cross(n, vec3(0.0, 1.0, 0.0)) : cross(n, vec3(1.0, 0.0, 0.0)));
  vec3 b = cross(n, t);
  return normalize(t * cos(a) * r + b * sin(a) * r + n * sqrt(max(0.0, 1.0 - r * r)));
}

vec3 jitterSun() {
  vec3 t = normalize(cross(uSunDir, abs(uSunDir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 b = cross(uSunDir, t);
  float spread = sqrt(max(0.0, 1.0 - uSunCos * uSunCos));
  float a = rand() * 6.2831853;
  float r = sqrt(rand()) * spread;
  return normalize(uSunDir + t * cos(a) * r + b * sin(a) * r);
}

/** Whether anything blocks the way from p towards l (voxels or the ground). */
bool shadowed(vec3 p, vec3 l) {
  float th; vec3 nn; uint id;
  return march(p, l, 0u, 1e9, th, nn, id);
}

void main() {
  vec2 pixel = gl_FragCoord.xy + uOffset;
  seed = uint(pixel.x) * 1973u + uint(pixel.y) * 9277u + uFrame * 26699u;
  seed = pcg(seed);
  vec2 ndc = (pixel + (uPixelated ? vec2(0.5) : vec2(rand(), rand()))) / uFull * 2.0 - 1.0;
  vec4 a = uInvViewProj * vec4(ndc, -1.0, 1.0);
  vec4 b = uInvViewProj * vec4(ndc, 1.0, 1.0);
  vec3 ro = a.xyz / a.w;
  vec3 rd = normalize(b.xyz / b.w - ro);
  if (uAperture > 0.0 && !uOrtho) {
    vec3 focal = ro + rd * (uFocus / max(dot(rd, uCamForward), 1e-3));
    float ang = rand() * 6.2831853;
    float r = sqrt(rand()) * uAperture;
    ro += uCamRight * cos(ang) * r + uCamUp * sin(ang) * r;
    rd = normalize(focal - ro);
  }

  vec3 radiance = vec3(0.0);
  vec3 throughput = vec3(1.0);
  bool specular = true;
  float coverage = 0.0;
  uint inside = 0u;
  float iorInside = 1.0;
  for (int bounce = 0; bounce <= 8; bounce++) {
    if (bounce > uBounces) break;
    float tHit = 1e9; vec3 n; uint id = 0u;
    bool hit = march(ro, rd, inside, 1e9, tHit, n, id);
    bool ground = false;
    if (uGround && inside == 0u && rd.y < -1e-5) {
      float tg = (uGroundY - ro.y) / rd.y;
      if (tg > 1e-4 && (!hit || tg < tHit)) {
        hit = true; ground = true; tHit = tg; n = vec3(0.0, 1.0, 0.0);
      }
    }
    if (uFog > 0.0 && inside == 0u) {
      float d = hit ? tHit : 400.0;
      float tr = exp(-uFog * d);
      radiance += throughput * (1.0 - tr) * uFogColor * (uZenith + uHorizon) * 0.5;
      throughput *= tr;
    }
    if (!hit) {
      radiance += throughput * sky(rd, specular);
      break;
    }
    if (bounce == 0 && !(ground && uCutout)) coverage = 1.0;
    vec3 p = ro + rd * tHit;
    if (inside != 0u && id == 0u) {
      // Leaving glass: refract out (or reflect back in, past the critical angle).
      vec3 nn = -n;
      float eta = iorInside;
      vec3 refr = refract(rd, -nn, eta);
      if (dot(refr, refr) < 1e-6) {
        rd = reflect(rd, -nn);
        ro = p - nn * 1e-3 + rd * 1e-3;
      } else {
        rd = normalize(refr);
        ro = p + nn * 1e-3 + rd * 1e-3;
        inside = 0u;
      }
      continue;
    }
    vec3 albedo;
    vec4 m = vec4(0.0, 0.9, 0.0, 0.0);
    float ior = 1.5;
    if (ground) {
      albedo = uGroundColor;
    } else {
      albedo = toLinear(texelFetch(uPalette, texelOf(id), 0).rgb);
      m = texelFetch(uMaterial, texelOf(id), 0);
      ior = texelFetch(uMaterial2, texelOf(id), 0).r;
    }
    if (m.a > 0.0) radiance += throughput * albedo * m.a * 4.0;
    float r = rand();
    if (r < m.b) {
      // Glass: Fresnel picks reflection or refraction into the voxel.
      float cosi = clamp(-dot(rd, n), 0.0, 1.0);
      float f0 = pow((1.0 - ior) / (1.0 + ior), 2.0);
      float fresnel = f0 + (1.0 - f0) * pow(1.0 - cosi, 5.0);
      if (rand() < fresnel) {
        rd = reflect(rd, n);
        ro = p + n * 1e-3;
      } else {
        rd = normalize(refract(rd, n, 1.0 / ior));
        ro = p - n * 1e-3;
        inside = id;
        iorInside = ior;
        throughput *= albedo;
      }
      specular = true;
      continue;
    }
    if (r < m.b + (1.0 - m.b) * m.r) {
      // Metal: a mirror blurred by roughness.
      vec3 refl = reflect(rd, n);
      rd = normalize(mix(refl, cosineDir(n), m.g * m.g));
      if (dot(rd, n) <= 0.0) rd = refl;
      ro = p + n * 1e-3;
      throughput *= albedo;
      specular = m.g < 0.2;
      continue;
    }
    // Diffuse: the sun directly, then a bounce.
    vec3 l = jitterSun();
    float ndl = dot(n, l);
    if (ndl > 0.0 && !shadowed(p + n * 1e-3, l)) radiance += throughput * albedo * uSun * ndl;
    rd = cosineDir(n);
    ro = p + n * 1e-3;
    throughput *= albedo;
    specular = false;
    if (bounce >= 2) {
      float keep = clamp(max(throughput.r, max(throughput.g, throughput.b)), 0.05, 1.0);
      if (rand() > keep) break;
      throughput /= keep;
    }
  }
  // A cut-out picture keeps light only where the model is: the colour stays premultiplied.
  if (uCutout) radiance *= coverage;
  outColor = vec4(min(radiance, vec3(30.0)), coverage);
}
`;

/** Average of the samples, exposed, tone mapped (ACES), with optional bloom; to sRGB. */
const DISPLAY = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uAccum;
uniform sampler2D uBloom;
uniform float uSamples;
uniform float uExposure;
uniform float uBloomStrength;
uniform bool uDenoise;
uniform bool uAces;
uniform bool uTransparent;
uniform bool uStraight;
uniform vec3 uBackground;
uniform vec2 uOrigin;
out vec4 outColor;

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

vec4 avg(ivec2 p) {
  return texelFetch(uAccum, p, 0) / max(uSamples, 1.0);
}

void main() {
  vec2 frag = gl_FragCoord.xy - uOrigin;
  ivec2 p = ivec2(frag);
  vec4 c = avg(p);
  if (uDenoise) {
    // Edge-aware blur: neighbours count less the more their brightness differs.
    vec3 sum = c.rgb;
    float w = 1.0;
    float l0 = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
    float sigma = 0.15 + 2.0 / sqrt(max(uSamples, 1.0));
    for (int y = -2; y <= 2; y++)
      for (int x = -2; x <= 2; x++) {
        if (x == 0 && y == 0) continue;
        vec3 s = avg(p + ivec2(x, y) * 2).rgb;
        float d = dot(s, vec3(0.2126, 0.7152, 0.0722)) - l0;
        float k = exp(-(d * d) / (sigma * sigma) - float(x * x + y * y) / 8.0);
        sum += s * k;
        w += k;
      }
    c.rgb = sum / w;
  }
  if (uBloomStrength > 0.0) c.rgb += texture(uBloom, frag / vec2(textureSize(uAccum, 0))).rgb * uBloomStrength;
  // A cut-out picture holds premultiplied colour: tone map the colour itself.
  if (uTransparent) c.rgb = c.a > 0.0 ? c.rgb / c.a : vec3(0.0);
  vec3 exposed = c.rgb * uExposure;
  vec3 mapped = pow(uAces ? aces(exposed) : clamp(exposed, 0.0, 1.0), vec3(1.0 / 2.2));
  if (!uTransparent) outColor = vec4(mapped, 1.0);
  else if (uStraight) outColor = vec4(mapped, c.a);
  else {
    // On screen, transparency shows as a checkerboard of the background.
    vec2 q = floor(frag / 8.0);
    vec3 other = mix(uBackground, vec3(1.0) - uBackground, 0.12);
    vec3 checker = mod(q.x + q.y, 2.0) < 1.0 ? uBackground : other;
    outColor = vec4(mix(checker, mapped, c.a), 1.0);
  }
}
`;

/** Bright parts, blurred along one axis (run twice: across, then down). */
const BLOOM = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uSource;
uniform vec2 uTarget;
uniform vec2 uStep;
uniform float uSamples;
uniform bool uThreshold;
out vec4 outColor;
void main() {
  vec2 size = vec2(textureSize(uSource, 0));
  vec2 uv = gl_FragCoord.xy / uTarget;
  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  for (int i = -6; i <= 6; i++) {
    float w = exp(-float(i * i) / 18.0);
    vec3 s = texture(uSource, uv + uStep * float(i) / size).rgb;
    if (uThreshold) s = max(s / max(uSamples, 1.0) - 1.0, 0.0);
    sum += s * w;
    wsum += w;
  }
  outColor = vec4(sum / wsum, 1.0);
}
`;

interface Target {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
}

/** The samples of one picture. Made by PathTracer.accumulation(); starts over on its own when the scene changes. */
export interface Accumulation {
  /** Samples per pixel so far. */
  samples: number;
  /** The scene version the samples belong to. */
  version: number;
  accum: Target | null;
  bloomA: Target | null;
  bloomB: Target | null;
}

/** Where a picture goes. */
export interface TraceOutput {
  framebuffer: WebGLFramebuffer | null;
  /** Corner in the framebuffer, device pixels from the bottom left (default 0, 0). */
  x?: number;
  y?: number;
  /** The colour under transparent parts on screen (a checkerboard of it). */
  background: [number, number, number];
  /** Straight alpha for saving, instead of the on-screen checkerboard. */
  straight?: boolean;
  /** The picture is a piece of a larger frame: where it sits and the frame's size. */
  tile?: { x: number; y: number; width: number; height: number };
}

export class PathTracer {
  private readonly trace: Program;
  private readonly display: Program;
  private readonly bloomProgram: Program;
  private readonly vao: WebGLVertexArrayObject | null;
  private readonly grid: WebGLTexture;
  private readonly material: WebGLTexture;
  private readonly material2: WebGLTexture;
  private env: WebGLTexture | null = null;
  private readonly pictures = new Set<Accumulation>();
  /** Bumped whenever the scene changes: every picture starts over. */
  private version = 0;
  private gridSize: [number, number, number] = [1, 1, 1];
  private gridMin: [number, number, number] = [0, 0, 0];
  private frameSeed = 0;
  /** Supported: float render targets are needed for accumulation. */
  readonly supported: boolean;

  constructor(private readonly gl: GL) {
    this.supported = gl.getExtension('EXT_color_buffer_float') !== null;
    this.trace = new Program(gl, VERTEX, TRACE, 'pathtrace');
    this.display = new Program(gl, VERTEX, DISPLAY, 'pathtrace-display');
    this.bloomProgram = new Program(gl, VERTEX, BLOOM, 'pathtrace-bloom');
    this.vao = gl.createVertexArray();
    this.grid = gl.createTexture()!;
    this.material = gl.createTexture()!;
    this.material2 = gl.createTexture()!;
    for (const [tex, format, type, internal] of [
      [this.material, gl.RGBA, gl.FLOAT, gl.RGBA32F],
      [this.material2, gl.RED, gl.FLOAT, gl.R32F],
    ] as const) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        internal,
        PALETTE_TEXTURE_SIZE,
        PALETTE_TEXTURE_SIZE,
        0,
        format,
        type,
        null,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    }
    this.setGrid({ min: [0, 0, 0], size: [1, 1, 1], cells: new Uint16Array(1) });
  }

  /** Uploads the scene's cells; the image starts over. */
  setGrid(grid: SceneGrid): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_3D, this.grid);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);
    gl.texImage3D(
      gl.TEXTURE_3D,
      0,
      gl.R16UI,
      grid.size[0],
      grid.size[1],
      grid.size[2],
      0,
      gl.RED_INTEGER,
      gl.UNSIGNED_SHORT,
      grid.cells,
    );
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_3D, null);
    this.gridSize = grid.size;
    this.gridMin = grid.min;
    this.reset();
  }

  /** Material terms of every palette id. */
  setMaterials(rows: readonly MaterialRow[]): void {
    const gl = this.gl;
    const n = PALETTE_TEXTURE_SIZE * PALETTE_TEXTURE_SIZE;
    const a = new Float32Array(n * 4);
    const b = new Float32Array(n);
    rows.forEach((m, id) => {
      a.set([m.metallic, m.roughness, m.transmission, m.emission], id * 4);
      b[id] = m.ior;
    });
    gl.bindTexture(gl.TEXTURE_2D, this.material);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      PALETTE_TEXTURE_SIZE,
      PALETTE_TEXTURE_SIZE,
      gl.RGBA,
      gl.FLOAT,
      a,
    );
    gl.bindTexture(gl.TEXTURE_2D, this.material2);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      PALETTE_TEXTURE_SIZE,
      PALETTE_TEXTURE_SIZE,
      gl.RED,
      gl.FLOAT,
      b,
    );
    this.reset();
  }

  /** An HDR environment (equirectangular, linear RGB floats), or null for the plain sky. */
  setEnvironment(image: { width: number; height: number; data: Float32Array } | null): void {
    const gl = this.gl;
    if (!image) {
      if (this.env) gl.deleteTexture(this.env);
      this.env = null;
      this.reset();
      return;
    }
    this.env ??= gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.env);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGB16F,
      image.width,
      image.height,
      0,
      gl.RGB,
      gl.FLOAT,
      image.data,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.reset();
  }

  get hasEnvironment(): boolean {
    return this.env !== null;
  }

  /** The scene changed: every picture starts over when it is next drawn. */
  private reset(): void {
    this.version++;
  }

  /** A new picture with no samples. */
  accumulation(): Accumulation {
    const a: Accumulation = {
      samples: 0,
      version: this.version,
      accum: null,
      bloomA: null,
      bloomB: null,
    };
    this.pictures.add(a);
    return a;
  }

  /** Starts a picture over (its camera or the light changed). */
  restart(a: Accumulation): void {
    a.samples = 0;
    a.version = this.version;
    if (a.accum) {
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, a.accum.framebuffer);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
  }

  /** Frees a picture's targets. */
  release(a: Accumulation): void {
    for (const t of [a.accum, a.bloomA, a.bloomB]) if (t) this.dropTarget(t);
    a.accum = a.bloomA = a.bloomB = null;
    a.samples = 0;
    this.pictures.delete(a);
  }

  private dropTarget(t: Target): void {
    this.gl.deleteFramebuffer(t.framebuffer);
    this.gl.deleteTexture(t.texture);
  }

  private target(old: Target | null, width: number, height: number): Target {
    const gl = this.gl;
    if (old && old.width === width && old.height === height) return old;
    if (old) this.dropTarget(old);
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { framebuffer, texture, width, height };
  }

  /**
   * Adds `passes` samples per pixel for a camera into a picture (sized `width` × `height`),
   * then draws its average to the output. A different size or a changed scene starts it over.
   */
  render(
    a: Accumulation,
    camera: Camera,
    s: RenderSettings,
    palette: WebGLTexture,
    width: number,
    height: number,
    passes: number,
    output: TraceOutput,
  ): void {
    const gl = this.gl;
    const resized = !a.accum || a.accum.width !== width || a.accum.height !== height;
    a.accum = this.target(a.accum, width, height);
    if (resized || a.version !== this.version) this.restart(a);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.vao);
    const todo = Math.max(0, Math.min(passes, s.samples - a.samples));
    if (todo > 0) {
      const p = this.trace;
      p.use();
      gl.bindFramebuffer(gl.FRAMEBUFFER, a.accum.framebuffer);
      gl.viewport(0, 0, width, height);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      this.bindScene(p, camera, s, palette, width, height, output.tile);
      for (let i = 0; i < todo; i++) {
        gl.uniform1ui(p.uniform('uFrame'), this.frameSeed++);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        a.samples++;
      }
      gl.disable(gl.BLEND);
    }
    // Bloom: the bright part, blurred across and down at half size.
    if (s.bloom > 0) {
      const hw = Math.max(1, width >> 1);
      const hh = Math.max(1, height >> 1);
      a.bloomA = this.target(a.bloomA, hw, hh);
      a.bloomB = this.target(a.bloomB, hw, hh);
      const b = this.bloomProgram;
      b.use();
      gl.uniform1f(b.uniform('uSamples'), a.samples);
      gl.uniform1i(b.uniform('uSource'), 4);
      gl.activeTexture(gl.TEXTURE4);
      for (const [from, to, step, threshold] of [
        [a.accum, a.bloomA, [1, 0], true],
        [a.bloomA, a.bloomB, [0, 1], false],
      ] as const) {
        gl.bindTexture(gl.TEXTURE_2D, from.texture);
        gl.bindFramebuffer(gl.FRAMEBUFFER, to.framebuffer);
        gl.viewport(0, 0, hw, hh);
        gl.uniform2f(b.uniform('uStep'), step[0] * (threshold ? 2 : 1), step[1]);
        gl.uniform1i(b.uniform('uThreshold'), threshold ? 1 : 0);
        gl.uniform2f(b.uniform('uTarget'), hw, hh);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    }
    const d = this.display;
    d.use();
    gl.bindFramebuffer(gl.FRAMEBUFFER, output.framebuffer);
    const x = output.x ?? 0;
    const y = output.y ?? 0;
    gl.viewport(x, y, width, height);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, a.accum.texture);
    gl.uniform1i(d.uniform('uAccum'), 4);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, a.bloomB?.texture ?? a.accum.texture);
    gl.uniform1i(d.uniform('uBloom'), 5);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform2f(d.uniform('uOrigin'), x, y);
    gl.uniform1i(d.uniform('uStraight'), output.straight ? 1 : 0);
    gl.uniform1f(d.uniform('uSamples'), a.samples);
    gl.uniform1f(d.uniform('uExposure'), s.exposure);
    gl.uniform1f(d.uniform('uBloomStrength'), s.bloom);
    gl.uniform1i(d.uniform('uDenoise'), s.denoise ? 1 : 0);
    gl.uniform1i(d.uniform('uAces'), s.tonemap === 'aces' ? 1 : 0);
    gl.uniform1i(d.uniform('uTransparent'), s.transparent ? 1 : 0);
    gl.uniform3f(d.uniform('uBackground'), ...output.background);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
  }

  private bindScene(
    p: Program,
    camera: Camera,
    s: RenderSettings,
    palette: WebGLTexture,
    width: number,
    height: number,
    tile: TraceOutput['tile'],
  ): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, palette);
    gl.uniform1i(p.uniform('uPalette'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.grid);
    gl.uniform1i(p.uniform('uGrid'), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.material);
    gl.uniform1i(p.uniform('uMaterial'), 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.material2);
    gl.uniform1i(p.uniform('uMaterial2'), 3);
    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D, this.env ?? this.material2);
    gl.uniform1i(p.uniform('uEnv'), 6);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform3i(p.uniform('uGridSize'), ...this.gridSize);
    gl.uniform3f(p.uniform('uGridMin'), ...this.gridMin);
    gl.uniformMatrix4fv(p.uniform('uInvViewProj'), false, camera.invViewProj);
    const f = camera.forward();
    const up: [number, number, number] = [0, 1, 0];
    const right = normalize(cross(f, up));
    gl.uniform3f(p.uniform('uCamForward'), ...f);
    gl.uniform3f(p.uniform('uCamRight'), ...right);
    gl.uniform3f(p.uniform('uCamUp'), ...cross(right, f));
    gl.uniform1i(p.uniform('uOrtho'), camera.projection === 'orthographic' ? 1 : 0);
    gl.uniform2f(p.uniform('uResolution'), width, height);
    gl.uniform2f(p.uniform('uFull'), tile?.width ?? width, tile?.height ?? height);
    gl.uniform2f(p.uniform('uOffset'), tile?.x ?? 0, tile?.y ?? 0);
    gl.uniform1i(p.uniform('uBounces'), s.bounces);
    const yaw = (s.sunYaw * Math.PI) / 180;
    const pitch = (s.sunPitch * Math.PI) / 180;
    gl.uniform3f(
      p.uniform('uSunDir'),
      Math.cos(pitch) * Math.sin(yaw),
      Math.sin(pitch),
      Math.cos(pitch) * Math.cos(yaw),
    );
    const sun = s.sunStrength;
    gl.uniform3f(p.uniform('uSun'), sun, sun * 0.95, sun * 0.88);
    gl.uniform1f(p.uniform('uSunCos'), Math.cos((s.sunSize * Math.PI) / 180));
    const sky = s.skyStrength;
    gl.uniform3f(p.uniform('uZenith'), ...linear(s.skyZenith, sky));
    gl.uniform3f(p.uniform('uHorizon'), ...linear(s.skyHorizon, sky));
    gl.uniform1i(p.uniform('uGround'), s.ground ? 1 : 0);
    // The ground is under the lowest voxel (the grid has one empty layer below it).
    gl.uniform1f(p.uniform('uGroundY'), this.gridMin[1] + 1);
    gl.uniform3f(p.uniform('uGroundColor'), ...linear(s.groundColor, 1));
    gl.uniform1f(p.uniform('uFog'), s.fog);
    gl.uniform3f(p.uniform('uFogColor'), ...linear(s.fogColor, 1));
    gl.uniform1f(p.uniform('uAperture'), s.aperture);
    gl.uniform1f(p.uniform('uFocus'), s.focus);
    gl.uniform1i(p.uniform('uUseEnv'), this.env ? 1 : 0);
    gl.uniform1f(p.uniform('uEnvStrength'), sky);
    gl.uniform1i(p.uniform('uCutout'), s.transparent ? 1 : 0);
    gl.uniform1i(p.uniform('uPixelated'), s.pixelated ? 1 : 0);
  }

  dispose(): void {
    const gl = this.gl;
    this.trace.dispose();
    this.display.dispose();
    this.bloomProgram.dispose();
    gl.deleteVertexArray(this.vao);
    gl.deleteTexture(this.grid);
    gl.deleteTexture(this.material);
    gl.deleteTexture(this.material2);
    if (this.env) gl.deleteTexture(this.env);
    for (const a of [...this.pictures]) this.release(a);
  }
}

function linear(hex: string, k: number): [number, number, number] {
  const n = /^#[0-9a-f]{6}$/i.test(hex) ? Number.parseInt(hex.slice(1), 16) : 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map(
    (v) => v ** 2.2 * k,
  ) as [number, number, number];
}

const cross = (a: readonly number[], b: readonly number[]): [number, number, number] => [
  a[1]! * b[2]! - a[2]! * b[1]!,
  a[2]! * b[0]! - a[0]! * b[2]!,
  a[0]! * b[1]! - a[1]! * b[0]!,
];

function normalize(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
