import { CHUNK_SIZE, keyX, keyY, keyZ } from '../core/coords';
import { applyOrientation, orientationMatrix } from '../core/orientation';
import type { Palette } from '../core/palette';
import { isHidden, type Transform, type VoxelObject, worldTransform } from '../core/scene';
import { sliceClip, sliceKey, type WorldSlice } from '../core/slice';
import type { GhostMode } from '../core/tools/tool';
import type { VoxelVolume } from '../core/volume';
import type { Camera } from './camera';
import { ChunkMeshStore } from './chunk-meshes';
import type { FrameJob } from './frame-job';
import { boxInFrustum, createFrustum, extractFrustum } from './frustum';
import { type GL, Program } from './gl';
import { GridRenderer } from './grid';
import { type LineBatch, LineRenderer } from './lines';
import { type Mat4, mat4 } from './math';
import { type AsyncMesher, MeshScheduler } from './mesh-scheduler';
import { OutlinePass } from './outline';
import { PaletteTexture } from './palette-texture';
import type { Accumulation, PathTracer } from './pathtracer';
import { type PlaneQuad, PlaneRenderer } from './planes';
import { type ReferenceImage, ReferenceRenderer } from './references';
import type { RenderSettings } from './render-settings';
import { CHUNK_FRAGMENT, CHUNK_VERTEX } from './shaders/chunk';

export type Shading = 'lit' | 'flat' | 'clay';

export interface ViewSettings {
  /** lit: light and AO; flat: palette colours as they are; clay: one colour, only the form. */
  shading: Shading;
  /** Direction the light comes from: turn around Y and height, in degrees. */
  lightYaw: number;
  lightPitch: number;
  /** Strength of the directional light, 0…2. */
  lightStrength: number;
  /** In model mode, objects other than the edited one are greyed out. */
  dimOthers: boolean;
  /** Outlines of the 32³ chunks of the edited object. */
  chunks: boolean;
  ao: boolean;
  /** Voxel grid lines on faces. */
  edges: boolean;
  /** Edges of the mesh quads. */
  wireframe: boolean;
  /** Grid lines on y = 0. */
  grid: boolean;
  /** Faint fill of the y = 0 plane. */
  floor: boolean;
  axes: boolean;
  /** Measuring box around the active object. */
  bounds: boolean;
  /** Lines along silhouettes and creases, in the edge colour. */
  outline: boolean;
  /** Animation: the edited object's neighbouring key frames, faint and tinted. */
  onion: boolean;
  /** Viewport colours, #rrggbb; empty follows the theme (the app fills them in before drawing). */
  background: string;
  gridColor: string;
  edgeColor: string;
  selectionColor: string;
}

export interface DrawStats {
  drawCalls: number;
  quads: number;
  /** Chunks skipped because they are outside the view. */
  culled: number;
}

export const DEFAULT_VIEW: ViewSettings = {
  shading: 'lit',
  lightYaw: 52,
  lightPitch: 56,
  lightStrength: 1,
  dimOthers: false,
  chunks: false,
  ao: true,
  edges: false,
  wireframe: false,
  grid: true,
  floor: true,
  axes: true,
  bounds: true,
  outline: false,
  onion: true,
  background: '',
  gridColor: '',
  edgeColor: '',
  selectionColor: '',
};

/** #rrggbb as sRGB components 0…1; black for anything else. */
export function hexToRgb(hex: string): [number, number, number] {
  const n = /^#[0-9a-f]{6}$/i.test(hex) ? Number.parseInt(hex.slice(1), 16) : 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const toLinear = (c: [number, number, number]) =>
  c.map((v) => v ** 2.2) as [number, number, number];

/** Unit vector towards the light from its turn around Y and its height, in degrees. */
export function lightDirection(yaw: number, pitch: number): [number, number, number] {
  const y = (yaw * Math.PI) / 180;
  const p = (pitch * Math.PI) / 180;
  return [Math.cos(p) * Math.sin(y), Math.sin(p), Math.cos(p) * Math.cos(y)];
}

/** Major grid lines every this many voxels. */
const GRID_MAJOR = 8;

/** Column-major model matrix of an object transform. */
export function modelMatrix(t: Transform, out: Mat4 = mat4()): Mat4 {
  const m = orientationMatrix(t.orientation);
  out.fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out[c * 4 + r] = m[r * 3 + c]!;
  out[12] = t.x;
  out[13] = t.y;
  out[14] = t.z;
  out[15] = 1;
  return out;
}

const GHOST_CODES: Record<GhostMode, number> = {
  add: 1,
  erase: 2,
  paint: 3,
  select: 4,
  onionPrev: 5,
  onionNext: 6,
};
/** How far ghost faces stand off the surface, in voxels. */
const GHOST_INFLATE: Record<GhostMode, number> = {
  add: 0,
  erase: 0.03,
  paint: 0.015,
  select: 0.02,
  onionPrev: 0.01,
  onionNext: 0.01,
};

/**
 * Draws the viewport: chunk meshes of every visible object. Owns all GL resources; nothing
 * else holds GL objects, so everything can be rebuilt from the document.
 */
export class Renderer {
  readonly gl: GL;
  readonly meshes: ChunkMeshStore;
  private readonly scheduler: MeshScheduler;
  private readonly chunkProgram: Program;
  private readonly palette: PaletteTexture;
  private readonly grid: GridRenderer;
  private readonly lines: LineRenderer;
  private readonly planes: PlaneRenderer;
  private readonly outline: OutlinePass;
  private readonly references: ReferenceRenderer;
  private tracer: PathTracer | null = null;
  /** The path tracer's code, once loaded (render/tracing.ts). */
  private tracing: typeof import('./tracing') | null = null;
  private tracingLoad: Promise<typeof import('./tracing')> | null = null;
  private referenceImages: readonly ReferenceImage[] = [];
  private readonly objects = new Set<VoxelObject>();
  /** The volume each object was meshed from, to notice when it is swapped for another. */
  private readonly volumes = new Map<VoxelObject, VoxelVolume>();
  /** Translucent overlays drawn over the scene: the tool preview, the selection. */
  private ghosts: { object: VoxelObject; mode: GhostMode | null }[] = [];
  /** Opaque objects outside the scene: a floating piece being moved. */
  private extras: VoxelObject[] = [];
  /** Every object outside the scene whose meshes the renderer keeps. */
  private managed = new Set<VoxelObject>();
  private readonly model = mat4();
  private focus: VoxelObject | null = null;
  private readonly frustum = createFrustum();
  /** The slice, or null for none. */
  private slice: WorldSlice | null = null;
  /** The clip each object was last meshed with, to remesh only those it changed for. */
  private readonly clipKeys = new Map<VoxelObject, string>();

  /**
   * @param asyncMesher worker pool for meshing, or null to mesh in the main thread
   * @param onMeshReady called when a worker delivers a mesh, to schedule a frame
   */
  constructor(
    readonly canvas: HTMLCanvasElement,
    asyncMesher: AsyncMesher | null,
    onMeshReady: () => void,
  ) {
    const gl = canvas.getContext('webgl2', {
      antialias: true,
      alpha: false,
      depth: true,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.chunkProgram = new Program(gl, CHUNK_VERTEX, CHUNK_FRAGMENT, 'chunk');
    this.palette = new PaletteTexture(gl);
    this.meshes = new ChunkMeshStore(gl);
    this.scheduler = new MeshScheduler(this.meshes, asyncMesher, onMeshReady);
    this.wake = onMeshReady;
    this.grid = new GridRenderer(gl);
    this.lines = new LineRenderer(gl);
    this.planes = new PlaneRenderer(gl);
    this.outline = new OutlinePass(gl);
    this.references = new ReferenceRenderer(gl);
  }

  updatePalette(palette: Palette): void {
    this.palette.update(palette);
  }

  /** Marks chunk meshes stale. Urgent ones are rebuilt in this frame, in this thread. */
  invalidate(object: VoxelObject, keys: Iterable<number>, urgent: boolean): void {
    if (this.objects.has(object)) this.scheduler.invalidate(object, keys, urgent);
  }

  /** Follows the scene: meshes objects that appeared, frees objects that left. */
  syncObjects(objects: readonly VoxelObject[]): void {
    const current = new Set(objects);
    for (const object of this.objects) {
      if (!current.has(object)) {
        this.scheduler.forget(object);
        this.objects.delete(object);
        this.volumes.delete(object);
      }
    }
    for (const object of objects) {
      const known = this.volumes.get(object);
      if (this.objects.has(object) && known === object.volume) continue;
      // New, or its voxels were swapped (an animation frame, unlinking, a rebuilt rope).
      if (known) this.scheduler.forget(object);
      this.objects.add(object);
      this.volumes.set(object, object.volume);
      this.scheduler.invalidate(object, object.volume.chunkKeys(), known !== undefined);
    }
  }

  /**
   * Ghost overlays: detached objects drawn translucent over the scene (the tool preview, the
   * selection). Their chunks are always meshed at once — they follow the pointer. Each frame
   * the caller passes the current list and the stale chunks of each.
   */
  setOverlays(
    extras: readonly VoxelObject[],
    ghosts: readonly { object: VoxelObject; mode: GhostMode | null }[],
  ): void {
    const next = new Set<VoxelObject>([...extras, ...ghosts.map((g) => g.object)]);
    for (const old of this.managed) if (!next.has(old)) this.scheduler.forget(old);
    for (const object of next) {
      if (!this.managed.has(object)) {
        object.volume.takeMeshDirty();
        this.scheduler.invalidate(object, object.volume.chunkKeys(), true);
      } else if (object.volume.hasMeshDirty) {
        this.scheduler.invalidate(object, object.volume.takeMeshDirty(), true);
      }
    }
    this.managed = next;
    this.extras = [...extras];
    this.ghosts = [...ghosts];
  }

  /** Schedules a frame (the same call that meshes use). */
  private readonly wake: () => void;

  /**
   * The path tracer, or null while its code loads: the first call starts loading and a frame
   * is asked for when it is there.
   */
  pathTracer(): PathTracer | null {
    if (this.tracer) return this.tracer;
    if (this.tracing) {
      this.tracer = new this.tracing.PathTracer(this.gl);
      return this.tracer;
    }
    void this.loadPathTracer().then(() => this.wake());
    return null;
  }

  /** The path tracer, loading its code first if needed. */
  async loadPathTracer(): Promise<PathTracer> {
    this.tracingLoad ??= import('./tracing');
    this.tracing = await this.tracingLoad;
    this.tracer ??= new this.tracing.PathTracer(this.gl);
    return this.tracer;
  }

  /**
   * Adds samples to a path-traced picture and shows it: over the whole canvas, or in a box of
   * it (CSS pixels from the top left, over what is already drawn). Returns the samples so far.
   */
  renderPathTraced(
    picture: Accumulation,
    camera: Camera,
    settings: RenderSettings,
    passes: number,
    background: string,
    box?: { x: number; y: number; width: number; height: number },
  ): number {
    const t = this.pathTracer();
    if (!t) return 0;
    const canvas = this.canvas;
    let x = 0;
    let y = 0;
    let width = canvas.width;
    let height = canvas.height;
    if (box) {
      const k = canvas.width / Math.max(1, canvas.clientWidth);
      x = Math.round(box.x * k);
      width = Math.max(1, Math.round(box.width * k));
      height = Math.max(1, Math.round(box.height * k));
      y = canvas.height - Math.round(box.y * k) - height;
    }
    t.render(picture, camera, settings, this.palette.texture, width, height, passes, {
      framebuffer: null,
      x,
      y,
      background: hexToRgb(background),
    });
    return picture.samples;
  }

  /** A large frame traced in tiles, a few passes at a time (render/frame-job.ts). */
  frameJob(
    camera: Camera,
    settings: RenderSettings,
    width: number,
    height: number,
    background: string,
  ): FrameJob | null {
    const tracer = this.pathTracer();
    if (!tracer || !this.tracing) return null;
    return new this.tracing.FrameJob(
      this.gl,
      tracer,
      camera,
      settings,
      width,
      height,
      hexToRgb(background),
    );
  }

  /** Adds up to `passes` samples to a frame job. */
  stepFrameJob(job: FrameJob, passes: number): void {
    job.step(this.palette.texture, passes);
  }

  /** The reference pictures to draw from now on. */
  setReferences(images: readonly ReferenceImage[]): void {
    this.referenceImages = images;
    this.references.sync(images);
  }

  /**
   * Hides everything past a world cut (null: nothing). Objects are remeshed with the cut, so the
   * faces along it show and the model reads as solid.
   */
  setSlice(slice: WorldSlice | null): void {
    if (sliceKey(slice) === sliceKey(this.slice)) return;
    this.slice = slice;
    this.scheduler.clipFor =
      slice === null ? () => null : (object) => sliceClip(worldTransform(object), slice);
    this.refreshClips();
  }

  /** Remeshes the objects whose clip changed: the slice moved, or the object did. */
  private refreshClips(): void {
    for (const object of [...this.objects, ...this.managed]) {
      const clip = this.scheduler.clipFor(object);
      const key = clip ? `${clip.axis},${clip.sign},${clip.limit}` : '';
      if ((this.clipKeys.get(object) ?? '') === key) continue;
      this.clipKeys.set(object, key);
      this.scheduler.invalidate(object, object.volume.chunkKeys(), this.managed.has(object));
    }
  }

  /** True while meshes are being built. */
  get meshing(): boolean {
    return this.scheduler.busy;
  }

  /**
   * Builds stale meshes: urgent ones now, the rest in workers (nearest to the camera target
   * first) or here within the budget.
   */
  updateMeshes(camera: Camera, budgetMs: number): void {
    if (this.slice !== null) this.refreshClips();
    const [tx, ty, tz] = camera.target;
    const half = CHUNK_SIZE / 2;
    this.scheduler.update(budgetMs, (object, key) => {
      const t = worldTransform(object);
      const [x, y, z] = applyOrientation(
        t.orientation,
        keyX(key) * CHUNK_SIZE + half,
        keyY(key) * CHUNK_SIZE + half,
        keyZ(key) * CHUNK_SIZE + half,
      );
      return (x + t.x - tx) ** 2 + (y + t.y - ty) ** 2 + (z + t.z - tz) ** 2;
    });
  }

  /** Resizes the drawing buffer; returns true when the size changed. */
  resize(cssWidth: number, cssHeight: number, pixelRatio: number): boolean {
    const w = Math.max(1, Math.round(cssWidth * pixelRatio));
    const h = Math.max(1, Math.round(cssHeight * pixelRatio));
    if (this.canvas.width === w && this.canvas.height === h) return false;
    this.canvas.width = w;
    this.canvas.height = h;
    return true;
  }

  /**
   * Draws a frame: opaque meshes, then the grid, then overlay lines twice — faintly through
   * geometry and fully where visible — and last the lines that stay on top (the gizmo).
   */
  render(
    camera: Camera,
    objects: readonly VoxelObject[],
    view: ViewSettings,
    overlay: LineBatch,
    planes: readonly PlaneQuad[] = [],
    onTop: LineBatch | null = null,
    focus: VoxelObject | null = null,
  ): DrawStats {
    const gl = this.gl;
    this.focus = view.dimOthers ? focus : null;
    const stats: DrawStats = { drawCalls: 0, quads: 0, culled: 0 };
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const background = hexToRgb(view.background);
    gl.clearColor(...background, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.references.drawBackgrounds(this.referenceImages, this.canvas.width, this.canvas.height);
    // With an outline the models go offscreen first; the outline copies them back. Its target
    // starts see-through, so the background (and a picture on it) shows around the models.
    if (view.outline) {
      this.outline.begin(this.canvas.width, this.canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    const p = this.chunkProgram;
    p.use();
    gl.uniformMatrix4fv(p.uniform('uViewProj'), false, camera.viewProj);
    gl.uniform1i(
      p.uniform('uShading'),
      view.shading === 'flat' ? 1 : view.shading === 'clay' ? 2 : 0,
    );
    gl.uniform1f(p.uniform('uLightStrength'), view.lightStrength);
    gl.uniform1f(p.uniform('uDim'), 0);
    gl.uniform1i(p.uniform('uUseAO'), view.ao ? 1 : 0);
    gl.uniform1i(p.uniform('uEdges'), view.edges ? 1 : 0);
    gl.uniform1i(p.uniform('uWireframe'), view.wireframe ? 1 : 0);
    gl.uniform3f(p.uniform('uBackdrop'), ...toLinear(background));
    gl.uniform3f(p.uniform('uEdgeColor'), ...toLinear(hexToRgb(view.edgeColor)));
    gl.uniform3f(p.uniform('uSelectionColor'), ...toLinear(hexToRgb(view.selectionColor)));
    gl.uniform3f(p.uniform('uLightDir'), ...lightDirection(view.lightYaw, view.lightPitch));
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.palette.texture);
    gl.uniform1i(p.uniform('uPalette'), 0);

    extractFrustum(camera.viewProj, this.frustum);
    gl.uniform1i(p.uniform('uGhost'), 0);
    gl.uniform1f(p.uniform('uInflate'), 0);
    this.drawObjects(objects, stats);
    gl.uniform1f(p.uniform('uDim'), 0);
    this.focus = null;
    this.drawObjects(this.extras, stats);
    gl.frontFace(gl.CCW);
    if (view.outline) {
      const ratio = this.canvas.width / Math.max(1, camera.width);
      this.outline.finish(camera, hexToRgb(view.edgeColor), ratio);
      p.use();
    }

    for (const { object, mode } of this.ghosts) {
      if (!mode || object.volume.isEmpty) continue;
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.uniform1i(p.uniform('uGhost'), GHOST_CODES[mode]);
      gl.uniform1f(p.uniform('uInflate'), GHOST_INFLATE[mode]);
      this.drawObjects([object], stats);
      gl.uniform1i(p.uniform('uGhost'), 0);
      gl.uniform1f(p.uniform('uInflate'), 0);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.frontFace(gl.CCW);
    }
    gl.bindVertexArray(null);

    this.references.drawPlanes(this.referenceImages, camera.viewProj);
    this.planes.draw(planes, camera.viewProj);
    this.grid.draw(camera, view.grid, view.floor, GRID_MAJOR, hexToRgb(view.gridColor));
    const ratio = this.canvas.width / Math.max(1, camera.width);
    gl.disable(gl.DEPTH_TEST);
    this.lines.draw(overlay, camera.viewProj, this.canvas.width, this.canvas.height, ratio, 0.22);
    gl.enable(gl.DEPTH_TEST);
    this.lines.draw(overlay, camera.viewProj, this.canvas.width, this.canvas.height, ratio, 1);
    if (onTop) {
      gl.disable(gl.DEPTH_TEST);
      this.lines.draw(onTop, camera.viewProj, this.canvas.width, this.canvas.height, ratio, 1);
      gl.enable(gl.DEPTH_TEST);
    }
    return stats;
  }

  private drawObjects(objects: readonly VoxelObject[], stats: DrawStats): void {
    const gl = this.gl;
    const p = this.chunkProgram;
    for (const object of objects) {
      if (isHidden(object)) continue;
      const meshes = this.meshes.meshesOf(object);
      if (!meshes) continue;
      if (this.focus) gl.uniform1f(p.uniform('uDim'), object === this.focus ? 0 : 1);
      const t = worldTransform(object);
      modelMatrix(t, this.model);
      gl.uniformMatrix4fv(p.uniform('uModel'), false, this.model);
      // A reflection flips triangle winding.
      gl.frontFace(isMirrored(this.model) ? gl.CW : gl.CCW);
      for (const mesh of meshes.values()) {
        const [ox, oy, oz] = mesh.origin;
        // An axis-aligned orientation maps the chunk box onto a box spanned by its two corners.
        const a = applyOrientation(t.orientation, ox, oy, oz);
        const b = applyOrientation(
          t.orientation,
          ox + CHUNK_SIZE,
          oy + CHUNK_SIZE,
          oz + CHUNK_SIZE,
        );
        if (
          !boxInFrustum(
            this.frustum,
            Math.min(a[0], b[0]) + t.x,
            Math.min(a[1], b[1]) + t.y,
            Math.min(a[2], b[2]) + t.z,
            Math.max(a[0], b[0]) + t.x,
            Math.max(a[1], b[1]) + t.y,
            Math.max(a[2], b[2]) + t.z,
          )
        ) {
          stats.culled++;
          continue;
        }
        gl.uniform3f(p.uniform('uChunkOrigin'), ox, oy, oz);
        this.meshes.draw(mesh);
        stats.drawCalls++;
        stats.quads += mesh.quads;
      }
    }
  }

  /** Frees every GL resource. Safe after a context loss: deletes on a lost context do nothing. */
  dispose(): void {
    this.scheduler.dispose();
    this.planes.dispose();
    this.outline.dispose();
    this.references.dispose();
    this.tracer?.dispose();
    this.lines.dispose();
    this.grid.dispose();
    this.meshes.dispose();
    this.palette.dispose();
    this.chunkProgram.dispose();
  }
}

function isMirrored(m: Mat4): boolean {
  const det =
    m[0]! * (m[5]! * m[10]! - m[9]! * m[6]!) -
    m[4]! * (m[1]! * m[10]! - m[9]! * m[2]!) +
    m[8]! * (m[1]! * m[6]! - m[5]! * m[2]!);
  return det < 0;
}
