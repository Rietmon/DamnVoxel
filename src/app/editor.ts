import {
  AnimationSettingsCommand,
  animatedNodes,
  KeyCommand,
  type KeyKind,
  keyAt,
  keyFrames,
  showFrame,
} from '../core/animation';
import { type CameraView, SetCameraSlotCommand } from '../core/cameras';
import { copyVoxels, remapClip } from '../core/clipboard';
import { blue, green, red } from '../core/color';
import { CHUNK_SIZE, keyX, keyY, keyZ } from '../core/coords';
import { VoxelDocument } from '../core/document';
import { extractSelection } from '../core/extract';
import { CompositeCommand } from '../core/history';
import type { Picture } from '../core/image-voxels';
import { stepInRamp } from '../core/palette-edit';
import { type PickSource, pickConstructionPlane, pickVoxel, type VoxelPick } from '../core/picking';
import {
  isHidden,
  isInside,
  type Layer,
  NO_LAYER,
  type SceneNode,
  type Transform,
  type VoxelObject,
  worldTransform,
} from '../core/scene';
import {
  InsertNodeCommand,
  LayerListCommand,
  LayerPropertyCommand,
  linkedCopies,
  NodePropertyCommand,
  worldBounds,
} from '../core/scene-edit';
import { SelectionMask, selectionToVolume } from '../core/selection';
import { SelectionTransaction, type SelectMode } from '../core/selection-edit';
import { clipBox, type LocalClip, sliceClip, sliceKey, type WorldSlice } from '../core/slice';
import { patternFromVolume } from '../core/tools/stamp-tool';
import type { GhostMode, OverlaySink } from '../core/tools/tool';
import { cellToWorld, composeTransform } from '../core/transform';
import { type Box, VoxelVolume } from '../core/volume';
import type { ImportedMesh } from '../formats/mesh-import';
import type { ZipEntry } from '../formats/zip';
import { comboFromEvent } from '../input/hotkeys';
import { isTypingTarget, KeyState } from '../input/keys';
import { PointerInput } from '../input/pointer-input';
import type { CameraGesture, InputSink, Modifiers, ToolPointerEvent } from '../input/types';
import { readVox } from '../io/vox-read';
import { writeVox } from '../io/vox-write';
import type { ProgramError, ProgramParam, ProgramResult } from '../kernels/program';
import { Camera, type Projection } from '../render/camera';
import { CameraController, type CameraState } from '../render/camera-controller';
import { type FrameJob, MAX_FRAME_SIDE } from '../render/frame-job';
import { LineBatch } from '../render/lines';
import type { Vec3 } from '../render/math';
import { addAxes, addFaceOutline, addRuler, type RulerLabel, worldBox } from '../render/overlays';
import type { Accumulation, PathTracer } from '../render/pathtracer';
import { DEFAULT_RENDER, type RenderSettings } from '../render/render-settings';
import { DEFAULT_VIEW, hexToRgb, Renderer, type ViewSettings } from '../render/renderer';
import { MeshWorkers } from '../workers/mesh-client';
import { PhysicsWorker } from '../workers/physics-client';
import { ProgramWorker } from '../workers/program-client';
import { ActionRegistry } from './actions';
import { type Asset, AssetLibrary, assetClip, indexedDbAssets, makeAsset } from './assets';
import { ClipboardService, clipboardActions } from './clipboard-actions';
import { clothVolume, settleCloth } from './cloth';
import { visibleCursor } from './cursors';
import { editorActions } from './default-actions';
import { TabList } from './doc-tabs';
import type { Example } from './examples';
import { DEFAULT_EXPORT, type ExportSettings } from './export-settings';
import { downloadBlob, FileService, fileActions } from './files';
import { DEFAULT_KEYMAP, KEYMAPS, type KeymapSettings, keymapEntries } from './keymaps';
import { DEFAULT_MESH_IMPORT, type MeshImportSettings } from './mesh-import-settings';
import { mirrorQuads } from './mirror-handles';
import { modelActions } from './model-actions';
import { ObjectGizmo } from './object-gizmo';
import { paletteActions } from './palette-actions';
import {
  DEFAULT_PICTURES,
  type PictureSettings,
  pngBlob,
  readPicture,
  worldVolume,
} from './pictures';
import {
  ProgramCommand,
  type ProgramSpec,
  programPalette,
  programSpecs,
  resultVolume,
} from './programs';
import { clampCentre, RADIAL_ITEMS, radialIndex, runRadialItem } from './radial';
import { decodeReference, type Reference, referenceCorners } from './references';
import { lightKey, materialRows, sceneGrid } from './render-scene';
import {
  cameraOf,
  DEFAULT_SEQUENCE,
  type SequenceSettings,
  spriteSheet,
  spriteViews,
  turntableViews,
} from './render-sequence';
import { pixelRatio, ResolutionGovernor } from './resolution';
import {
  ProceduralCommand,
  ROPE_TITLES,
  type RopeSpec,
  ropeSpecs,
  ropeVolume,
  settleRope,
} from './ropes';
import { sceneActions } from './scene-actions';
import { SceneMode } from './scene-mode';
import { selectionActions } from './selection-actions';
import { writable } from './store';
import { type Scheme, schemeOf, withViewColors } from './theme';
import { toolActions } from './tool-actions';
import { ToolController } from './tool-controller';
import { familyOf } from './tool-families';
import { createUiState } from './ui-state';
import {
  AUTO_VERSION_MS,
  indexedDbVersions,
  VersionHistory,
  type VersionInfo,
  type VersionReason,
} from './versions';
import { encodeVideo, videoType } from './video';
import { anglesFor, type Dir, ISOMETRIC } from './view-cube';

/** Outlines of chunks and of the slice. */
const CHUNK_LINE = [0.45, 0.8, 0.95, 0.35];
const SLICE_LINE = [1, 0.62, 0.26, 0.9];

/** Outline of objects selected in scene mode. */
const SELECTED_NODE = [1, 0.62, 0.26, 0.9];

/** Main-thread meshing budget per frame when no worker is available. */
const SYNC_MESH_BUDGET_MS = 6;
/** Edits touching at most this many chunks are meshed in the same frame. */
const URGENT_CHUNK_LIMIT = 8;
/** The view counts as moving for this long after the last motion. */
const MOTION_WINDOW_MS = 120;
/** How often the statistics store is refreshed. */
const STATS_INTERVAL_MS = 250;
/** While editing, the render window takes the document this often, not on every stroke step. */
const RENDER_WINDOW_LAG_MS = 300;

export type EditorMode = 'model' | 'scene';

/** What is under the pointer: a voxel, or a cell on the construction plane (value 0). */
export type Hover = Omit<VoxelPick, 'value'> & { value: number; onPlane: boolean };

export interface FrameStats {
  /** Frames drawn since start; stays put while idle. */
  frames: number;
  /** Frames per second over the last motion, 0 when idle. */
  fps: number;
  /** CPU time of the last frame. */
  cpuMs: number;
  renderScale: number;
  drawCalls: number;
  quads: number;
  culled: number;
  gpuMB: number;
  meshing: boolean;
}

function createMeshWorkers(): MeshWorkers | null {
  try {
    return new MeshWorkers();
  } catch (error) {
    console.warn('Mesh workers are unavailable, meshing in the main thread', error);
    return null;
  }
}

/**
 * Puts the editor together: document, renderer, camera and the frame loop. The UI talks to the
 * editor; the editor never imports the UI.
 *
 * Frames are drawn only on request (docs/architecture.md): input, a camera animation,
 * finished meshes. An idle editor draws nothing.
 */
const AXIS_NAMES = ['X', 'Y', 'Z'] as const;

/** “height: visible up to 5”, “X: visible from −3”. */
export function sliceTitle(slice: WorldSlice): string {
  const along = slice.axis === 1 ? 'height' : AXIS_NAMES[slice.axis];
  return `${along}: visible ${slice.dir > 0 ? 'up to' : 'from'} ${slice.at}`;
}

const sameTransform = (a: Transform, b: Transform) =>
  a.x === b.x && a.y === b.y && a.z === b.z && a.orientation === b.orientation;

/** The camera as panels show it: angles in radians, fov in degrees. */
/** The last run of the open program, as its window shows it. */
export interface ProgramStatus {
  running: boolean;
  error: ProgramError | null;
  log: string[];
  params: ProgramParam[];
  ms: number;
  voxels: number;
}

export interface CameraPose {
  yaw: number;
  pitch: number;
  projection: Projection;
  target: [number, number, number];
  distance: number;
  fov: number;
}

const DEG = Math.PI / 180;

/** What a document tab keeps while another one is shown. */
interface DocTab {
  readonly id: number;
  doc: VoxelDocument;
  name: string;
  /** The file it came from or was saved to, when the browser gives handles (FileService). */
  file: unknown;
  /** Recovered work: not in any file though its history is new. */
  unsavedSinceOpen: boolean;
  mode: EditorMode;
  activeObjectId: number | null;
  /** Where the camera was; null frames the model when the tab is first shown. */
  camera: CameraState | null;
  references: Reference[];
  selectionSets: SelectionSet[];
}

/** A selection kept under a name (in the tab, not in the file). */
export interface SelectionSet {
  readonly id: number;
  readonly objectId: number;
  name: string;
  readonly mask: SelectionMask;
}

/** A tab as the tab bar shows it. */
export interface TabInfo {
  id: number;
  name: string;
  modified: boolean;
}

const UNTITLED = 'Untitled';

export interface RadialState {
  x: number;
  y: number;
  hover: number;
  dragging: boolean;
}

export class Editor {
  readonly camera = new Camera();
  readonly cameraControl = new CameraController(this.camera);
  readonly view = writable<ViewSettings>(DEFAULT_VIEW);
  /** Frame statistics overlay. */
  readonly showStats = writable(false);
  /** The object being edited; its bounds get the measuring box. */
  readonly activeObject = writable<VoxelObject | null>(null);
  /** Nodes picked in the scene tree or the viewport, for scene commands; tree order. */
  readonly selectedNodes = writable<SceneNode[]>([], () => false);
  /**
   * “Model” edits voxels of the active object with tools; “Scene” moves and turns whole
   * objects with the gizmo.
   */
  readonly mode = writable<EditorMode>('model');
  /** Move and turn handles of the selected objects in scene mode. */
  readonly gizmo: ObjectGizmo;
  /** Picking, dragging and keys of scene mode. */
  readonly sceneMode: SceneMode;
  /** Palette entries picked in the panel, for palette commands; ids. */
  readonly paletteSelection = writable<number[]>([], () => false);
  /** Modifiers held now, for the status bar hints. */
  readonly heldModifiers = writable<Modifiers>(
    { shift: false, ctrl: false, alt: false },
    (a, b) => a.shift === b.shift && a.ctrl === b.ctrl && a.alt === b.alt,
  );
  /** The view slice: a cut along a world axis, or null for none. */
  readonly slice = writable<WorldSlice | null>(null, (a, b) => sliceKey(a) === sliceKey(b));
  /** The axis the slice took last, for the next time it is turned on. */
  private sliceAxis: 0 | 1 | 2 = 1;
  /** Panel width, folded sections: the layout the user arranged. */
  readonly ui = createUiState();
  /** The command palette is open. */
  readonly commandsOpen = writable(false);
  /** Control layout: a preset and the person's own keys (app/keymaps.ts). */
  readonly keymap = writable<KeymapSettings>(DEFAULT_KEYMAP);
  /** The keys and mouse window is open. */
  readonly keymapOpen = writable(false);
  /** The layer new objects go on (an id of the shown document's layers). */
  readonly activeLayer = writable(0);
  /** The view shows the path-traced picture instead of the editing view. */
  readonly rendering = writable(false);
  readonly renderSettings = writable<RenderSettings>({ ...DEFAULT_RENDER });
  /** Samples so far, and why the render cannot run (empty scene, too big, no support). */
  readonly renderStatus = writable<{ samples: number; problem: string | null }>({
    samples: 0,
    problem: null,
  });
  /** What the render grid was built from: rebuilt when any of it changes. */
  private renderStamp = '';
  /** Why the scene cannot be rendered, or null. */
  private renderProblem: string | null = null;
  private renderGridAt = 0;
  private renderGridTimer = 0;
  /** The pictures being traced: the render view and the render window. */
  private readonly pictures: { view: TracedPicture | null; window: TracedPicture | null } = {
    view: null,
    window: null,
  };
  /** Passes per frame: grows while frames stay quick, shrinks when they do not. */
  private renderPasses = 1;
  private windowPasses = 1;
  /** A path-traced window over the editing view: the render follows the edits. */
  readonly renderWindow = writable(false);
  readonly renderWindowStatus = writable<{ samples: number; problem: string | null }>({
    samples: 0,
    problem: null,
  });
  /** The view the render window keeps; null follows the editing camera. */
  readonly renderWindowView = writable<CameraView | null>(null);
  /** The window's picture area (its element), measured each frame. */
  private renderWindowElement: HTMLElement | null = null;
  /** Size of saved frames, pixels. */
  readonly frameSize = writable({ width: 1920, height: 1080 });
  /** A series of frames to save: what it makes and how (app/render-sequence.ts). */
  readonly sequence = writable<SequenceSettings>({ ...DEFAULT_SEQUENCE });
  /** Pictures being saved — a frame or a series — and how far along they are. */
  readonly renderJob = writable<{ label: string; progress: number } | null>(null);
  private batch: RenderBatch | null = null;
  private jobPasses = 1;
  /** The animation frame shown (mirrors doc.animation.frame for the interface). */
  readonly animFrame = writable(0);
  readonly playing = writable(false);
  private playHandle = 0;
  /** Ropes and cloth settle here, off the main thread. */
  readonly physics = new PhysicsWorker();
  /** Shape programs run here, stopped when they take too long (docs/programs.md). */
  readonly programs = new ProgramWorker();
  /** The program window: the object whose program is open, 'new' to choose a start, or null. */
  readonly programOpen = writable<VoxelObject | 'new' | null>(null);
  /** The last run of the open program: what it declared, logged and how it ended. */
  readonly programStatus = writable<ProgramStatus>({
    running: false,
    error: null,
    log: [],
    params: [],
    ms: 0,
    voxels: 0,
  });
  private programBuild = 0;
  /** The rope just made: its parameters show until closed, even while another object is edited. */
  readonly lastRope = writable<VoxelObject | null>(null);
  /** Newest rope rebuild: older results arriving late are dropped. */
  private ropeBuild = 0;
  /** Pieces saved for every document (app/assets.ts). */
  readonly assets = new AssetLibrary(indexedDbAssets());
  /** Versions of documents kept in the browser (app/versions.ts). */
  readonly versions = new VersionHistory(indexedDbVersions());
  /** The version history window is open. */
  readonly versionsOpen = writable(false);
  /** Mesh export: its settings, and whether its window is open (app/export.ts). */
  readonly exportSettings = writable<ExportSettings>({ ...DEFAULT_EXPORT });
  readonly exportOpen = writable(false);
  /** When the shown document last got a version (or was opened): automatic ones follow from it. */
  private versionAt = Date.now();
  private versionTimer = 0;
  /** Calls waiting for a picture of the next frame. */
  private viewCaptures: ((url: string) => void)[] = [];
  /** Named selections of the shown document. */
  readonly selectionSets = writable<SelectionSet[]>([], () => false);
  private nextSetId = 1;
  /** Reference pictures of the shown document (app/references.ts). */
  readonly references = writable<Reference[]>([], () => false);
  private nextReferenceId = 1;
  /** The open documents, in tab order, and the one shown. */
  readonly tabs = writable<TabInfo[]>([]);
  readonly activeTab = writable(1);
  private readonly tabList: TabList<DocTab>;
  private nextTabId = 1;
  /** The colour scheme in use: the theme, or the system's for «auto». */
  readonly scheme = writable<Scheme>('dark');
  /** Ids of actions run from the command palette, most recent first. */
  readonly recentActions = writable<string[]>([]);
  /** Name of the open document: its file name, or “Untitled”. */
  readonly docName = writable(UNTITLED);
  /** The document differs from what was last saved (or opened). */
  readonly modified = writable(false);
  /** Bumped on every history change (a new step, undo, redo, save): buttons and title update. */
  readonly historyVersion = writable(0);
  /** Bumped on every palette change: the panel redraws. */
  readonly paletteVersion = writable(0);
  /** Bumped on every change of the scene structure, names or flags: the tree redraws. */
  readonly sceneVersion = writable(0);
  /** Size of the active object's selection, placed over its top on screen. */
  readonly selectionLabel = writable<{ x: number; y: number; text: string } | null>(
    null,
    () => false,
  );
  /** Selected voxels and selection size, for the status bar. */
  readonly selectionInfo = writable<{ count: number; size: [number, number, number] } | null>(null);
  /** Selection rectangles and lassos drawn over the viewport. */
  readonly screenOverlay = writable<{ points: [number, number][]; closed: boolean }[]>(
    [],
    () => false,
  );
  /** Side lengths of the measuring box, positioned on screen. */
  readonly rulerLabels = writable<RulerLabel[]>([], () => false);
  /** True while the browser has taken the WebGL context away. */
  readonly contextLost = writable(false);
  /** Keys held right now; shared by pointer input, tools and shortcuts. */
  readonly keys = new KeyState();
  /** Every action by name, with its shortcuts. */
  readonly actions = new ActionRegistry();
  /** The active tool and its settings. Created last: tools read the stores above. */
  readonly tools: ToolController;
  /** Copy, cut, paste across objects, documents and browser tabs. */
  readonly clipboard: ClipboardService;
  /** New, open, save, save as. */
  readonly files: FileService;
  /** The latest pointer event over the viewport (position, modifiers), for tools and hints. */
  readonly pointer = writable<ToolPointerEvent | null>(null, () => false);
  /** The voxel or construction-plane cell under the pointer. */
  readonly hover = writable<Hover | null>(null, () => false);
  /** A short message at the top of the viewport (what undo just did, for example). */
  readonly notice = writable<{ id: number; text: string } | null>(null);
  /** Touch: one finger moves the camera instead of the tool. */
  readonly cameraOnlyTouch = writable(false);
  /** A pen has been used: pen settings show up, fingers stop drawing. */
  readonly penSeen = writable(false);
  /**
   * The open radial menu: its centre in viewport pixels, the item under the pointer (-1 for
   * none), and whether the finger or pen that opened it is still down (lifting then picks).
   */
  readonly radial = writable<RadialState | null>(null);
  /** Camera orientation and projection, for the view cube. */
  readonly cameraPose = writable<CameraPose>(
    {
      yaw: 0,
      pitch: 0,
      projection: 'perspective',
      target: [0, 0, 0],
      distance: 60,
      fov: 45,
    },
    (a, b) =>
      a.yaw === b.yaw &&
      a.pitch === b.pitch &&
      a.projection === b.projection &&
      a.distance === b.distance &&
      a.fov === b.fov &&
      a.target.every((v, i) => v === b.target[i]),
  );
  readonly stats = writable<FrameStats>({
    frames: 0,
    fps: 0,
    cpuMs: 0,
    renderScale: 1,
    drawCalls: 0,
    quads: 0,
    culled: 0,
    gpuMB: 0,
    meshing: false,
  });

  /**
   * True while a gesture writes into the document live (a brush stroke): its chunks are
   * meshed in the same frame so the stroke never lags behind the pointer.
   */
  strokeActive = false;

  private renderer: Renderer | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private input: PointerInput | null = null;
  private detachKeys: (() => void) | null = null;
  private readonly inputSink: InputSink = {
    tool: (e) => this.handleTool(e),
    camera: (g) => this.handleCamera(g),
    tap: (fingers) => {
      if (fingers === 2) this.undo();
      else if (fingers === 3) this.redo();
      else if (fingers === 4) this.toggleInterface();
    },
    radial: (phase, x, y) => this.radialGesture(phase, x, y),
  };
  private readonly workers = createMeshWorkers();
  private readonly governor = new ResolutionGovernor();
  private frameHandle = 0;
  private noticeId = 0;
  /** Stops listening to the current document. */
  private unbindDocument: (() => void) | null = null;
  private frames = 0;
  private lastFrameAt = 0;
  private lastMotionAt = Number.NEGATIVE_INFINITY;
  private settleTimer = 0;
  private lastStatsAt = 0;
  private intervalAverage = 0;
  private readonly overlay = new LineBatch();
  /** Lines drawn over everything, never hidden by the model: the gizmo. */
  private readonly overlayTop = new LineBatch();
  private fitPending = false;
  private screenPaths: { points: [number, number][]; closed: boolean }[] = [];
  /** Selection bounds are a walk over every selected voxel: computed once per change. */
  private selectionBounds: { object: VoxelObject | null; revision: number; box: Box | null } = {
    object: null,
    revision: -1,
    box: null,
  };
  /** The active object's selection as voxels, drawn as a blue overlay. */
  private readonly selectionOverlay: VoxelObject = {
    kind: 'object',
    id: -2,
    name: 'selection',
    hidden: false,
    locked: true,
    transform: { x: 0, y: 0, z: 0, orientation: 0 },
    parent: null,
    volume: new VoxelVolume(),
    selection: new SelectionMask(),
    layer: NO_LAYER,
  };
  private selectionShown: { object: VoxelObject | null; revision: number } = {
    object: null,
    revision: -1,
  };

  constructor(public doc: VoxelDocument) {
    this.tabList = new TabList(this.newTabRecord(doc, UNTITLED));
    // A rename (saving under a new name) renames the tab.
    this.docName.subscribe((name) => {
      this.tabList.current.name = name;
      this.refreshTabs();
    });
    this.activeObject.set(doc.scene.objects()[0] ?? null);
    this.tools = new ToolController(this);
    this.clipboard = new ClipboardService(this);
    this.files = new FileService(this);
    this.gizmo = new ObjectGizmo(
      () => this.doc,
      this.camera,
      () => this.sceneTargets(),
    );
    this.sceneMode = new SceneMode(this);
    // A family button in the tool rail stands for the last tool used from it.
    this.tools.activeToolId.subscribe((id) => {
      const family = familyOf(id);
      if (!family || family.tools.length < 2 || this.ui.get().lastTool[family.id] === id) return;
      this.ui.update((u) => ({ ...u, lastTool: { ...u.lastTool, [family.id]: id } }));
    });
    this.actions.register(
      ...editorActions(this),
      ...toolActions(this),
      ...selectionActions(this),
      ...clipboardActions(this),
      ...sceneActions(this),
      ...paletteActions(this),
      ...modelActions(this),
      ...fileActions(this),
    );
    this.keymap.subscribe((k) => {
      this.actions.applyKeymap(keymapEntries(this.actions.all(), k));
      if (this.input) this.input.mouse = KEYMAPS[k.preset].mouse;
    });
    this.bindDocument();
    // Shift and friends change what the tool would do: refresh its preview without a move.
    this.keys.onChange(() => {
      this.heldModifiers.set(this.keys.modifiers());
      this.tools.setAlt(this.keys.alt);
      const last = this.pointer.get();
      if (last && last.phase === 'hover')
        this.tools.handlePointer({ ...last, ...this.keys.modifiers() });
    });
    this.view.subscribe(() => this.requestFrame());
    this.references.subscribe(() => this.pushReferences());
    // The theme marks the page (CSS tokens) and colours the viewport.
    const dark =
      typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
    const applyScheme = () => this.scheme.set(schemeOf(this.ui.get().theme, dark?.matches ?? true));
    this.ui.subscribe(applyScheme);
    dark?.addEventListener('change', applyScheme);
    this.scheme.subscribe((s) => {
      if (typeof document !== 'undefined') document.documentElement.dataset.theme = s;
      this.requestFrame();
    });
    this.slice.subscribe(() => this.requestFrame());
    this.cameraOnlyTouch.subscribe((on) => {
      if (this.input) this.input.touch.cameraOnly = on;
    });
    this.activeObject.subscribe(() => this.requestFrame());
  }

  /** What scene commands act on: the selected nodes, or the active object in model mode. */
  sceneTargets(): SceneNode[] {
    const selected = this.selectedNodes.get();
    // In scene mode an empty selection means nothing: a click on empty space lets go.
    if (selected.length > 0 || this.mode.get() === 'scene') return selected;
    const active = this.activeObject.get();
    return active ? [active] : [];
  }

  /** Selects nodes; the last object among them (or inside a group) becomes the active one. */
  selectNodes(nodes: readonly SceneNode[]): void {
    const root = this.doc.scene.root;
    const attached = nodes.filter((n) => n !== root && isInside(n, root));
    this.selectedNodes.set(attached);
    const last = attached.at(-1);
    const object = last?.kind === 'object' ? last : last && firstObject(last);
    if (object) this.setActiveObject(object);
  }

  /** Selects palette entries and makes `current` the drawing colour. */
  selectColors(ids: readonly number[], current: number): void {
    this.paletteSelection.set([...ids]);
    if (this.doc.palette.has(current)) this.tools.updateSettings({ color: current });
  }

  /** Makes an object the one being edited, ending any pending tool work on the previous one. */
  setActiveObject(object: VoxelObject | null): void {
    if (this.activeObject.get() === object) return;
    this.tools.cancelPending();
    this.activeObject.set(object);
  }

  /** After a scene change (delete, undo of a create): forget nodes no longer in the scene. */
  private syncSceneSelection(): void {
    const root = this.doc.scene.root;
    const selected = this.selectedNodes.get();
    const kept = selected.filter((n) => isInside(n, root));
    if (kept.length !== selected.length) this.selectedNodes.set(kept);
    const active = this.activeObject.get();
    this.sceneVersion.update((v) => v + 1);
    if (!active || !isInside(active, root)) {
      const fromSelection = kept
        .map((n) => (n.kind === 'object' ? n : firstObject(n)))
        .find(Boolean);
      this.setActiveObject(fromSelection ?? this.doc.scene.objects()[0] ?? null);
    }
    this.requestFrame();
  }

  /** Starts drawing into a canvas. */
  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    const detachHeld = this.keys.attach(window);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('beforeunload', this.onBeforeUnload);
    const detachClipboard = this.clipboard.attach(window);
    const detachDrop = this.files.attach(window);
    this.detachKeys = () => {
      detachHeld();
      detachClipboard();
      detachDrop();
      window.removeEventListener('keydown', this.onKeyDown);
      window.removeEventListener('beforeunload', this.onBeforeUnload);
    };
    this.input = new PointerInput(canvas, this.inputSink, this.keys);
    this.input.onPen = () => this.penSeen.set(true);
    this.input.mouse = KEYMAPS[this.keymap.get().preset].mouse;
    this.tools.refreshCursor();
    this.input.touch.cameraOnly = this.cameraOnlyTouch.get();
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    this.createRenderer(canvas);
    this.frameCamera();
  }

  detach(): void {
    cancelAnimationFrame(this.frameHandle);
    this.frameHandle = 0;
    clearTimeout(this.settleTimer);
    this.input?.dispose();
    this.input = null;
    this.detachKeys?.();
    this.detachKeys = null;
    this.canvas?.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas?.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.canvas = null;
    this.renderer?.dispose();
    this.renderer = null;
  }

  /** Marks the open document as not in any file yet (recovered work). */
  markUnsaved(): void {
    this.tabList.current.unsavedSinceOpen = true;
    this.updateModified();
  }

  /** The document now matches its file (it was just saved). */
  markSaved(): void {
    this.tabList.current.unsavedSinceOpen = false;
    this.doc.history.markSaved();
    this.updateModified();
  }

  private updateModified(): void {
    this.modified.set(this.isTabModified(this.tabList.current));
    this.refreshTabs();
  }

  private isTabModified(tab: DocTab): boolean {
    return tab.unsavedSinceOpen || tab.doc.history.isModified;
  }

  /** The file of the shown document, for the file service. */
  get file(): unknown {
    return this.tabList.current.file;
  }

  set file(handle: unknown) {
    this.tabList.current.file = handle;
  }

  /** Every document with work that is not in a file: the autosave keeps them. */
  unsavedDocuments(): { doc: VoxelDocument; name: string }[] {
    return this.tabList.all
      .filter((t) => this.isTabModified(t))
      .map((t) => ({ doc: t.doc, name: t.name }));
  }

  private refreshTabs(): void {
    this.tabs.set(
      this.tabList.all.map((t) => ({ id: t.id, name: t.name, modified: this.isTabModified(t) })),
    );
    this.activeTab.set(this.tabList.current.id);
  }

  private newTabRecord(doc: VoxelDocument, name: string): DocTab {
    return {
      id: this.nextTabId++,
      doc,
      name,
      file: null,
      unsavedSinceOpen: false,
      mode: 'model',
      activeObjectId: null,
      camera: null,
      references: [],
      selectionSets: [],
    };
  }

  /** An empty untitled document nobody touched: opening a file may take its place. */
  private isPristine(tab: DocTab): boolean {
    const h = tab.doc.history;
    return (
      tab.file === null &&
      !this.isTabModified(tab) &&
      !h.canUndo &&
      !h.canRedo &&
      tab.doc.scene.objects().every((o) => o.volume.isEmpty)
    );
  }

  /** Remembers how the shown tab looks, before another one is shown. */
  private keepTabState(): void {
    const tab = this.tabList.current;
    tab.references = this.references.get();
    tab.selectionSets = this.selectionSets.get();
    tab.mode = this.mode.get();
    tab.activeObjectId = this.activeObject.get()?.id ?? null;
    const c = this.camera;
    tab.camera = {
      target: [...c.target],
      yaw: c.yaw,
      pitch: c.pitch,
      distance: c.distance,
      projection: c.projection,
    };
  }

  /** Shows another open document. */
  switchTab(id: number): void {
    if (id === this.tabList.current.id || !this.tabList.get(id)) return;
    this.keepTabState();
    this.tabList.select(id);
    this.show(this.tabList.current);
  }

  /** The next or previous tab, around the ends. */
  stepTab(step: number): void {
    this.switchTab(this.tabList.neighbour(step).id);
  }

  /** A new empty document in its own tab. */
  newTab(): void {
    this.open(VoxelDocument.createEmpty(), UNTITLED, true);
  }

  /** Closes a tab, asking first when its work is not saved. The last tab gives way to a new one. */
  closeTab(id = this.tabList.current.id): void {
    const tab = this.tabList.get(id);
    if (!tab) return;
    if (this.isTabModified(tab) && !confirm(`“${tab.name}” is not saved. Close without saving?`))
      return;
    const shown = id === this.tabList.current.id;
    const pictures = shown ? this.references.get() : tab.references;
    // The closed tab's pictures go once the next tab is shown and the renderer let go of them.
    queueMicrotask(() => {
      for (const r of pictures) {
        URL.revokeObjectURL(r.thumb);
        r.image.close();
      }
    });
    if (!this.tabList.remove(id)) {
      // The only tab: a fresh document instead.
      this.tabList.replaceCurrent(this.newTabRecord(VoxelDocument.createEmpty(), UNTITLED));
      this.show(this.tabList.current);
      return;
    }
    if (shown) this.show(this.tabList.current);
    else this.refreshTabs();
  }

  /**
   * Adds a picture as a reference: a plane facing the front, behind the model and as wide as
   * it, half see-through.
   */
  async addReference(file: File): Promise<void> {
    let image: ImageBitmap;
    try {
      image = await decodeReference(file);
    } catch {
      this.toast(`“${file.name}” is not a picture or it is damaged`);
      return;
    }
    const b = this.sceneBounds() ?? { min: [-16, 0, -16], max: [16, 32, 16] };
    const width = Math.max(16, b.max[0] - b.min[0]);
    const height = (width * image.height) / Math.max(1, image.width);
    const reference: Reference = {
      id: this.nextReferenceId++,
      name: file.name.replace(/\.[^.]+$/, '') || 'Picture',
      image,
      thumb: URL.createObjectURL(file),
      mode: 'plane',
      opacity: 0.5,
      visible: true,
      locked: false,
      facing: 'front',
      center: [(b.min[0] + b.max[0]) / 2, b.min[1] + height / 2, b.min[2] - 1],
      size: width,
    };
    this.references.update((list) => [...list, reference]);
    this.toast(`Reference “${reference.name}” added`);
  }

  updateReference(id: number, patch: Partial<Omit<Reference, 'id' | 'image' | 'thumb'>>): void {
    this.references.update((list) =>
      list.map((r) => (r.id === id && (!r.locked || 'locked' in patch) ? { ...r, ...patch } : r)),
    );
  }

  removeReference(id: number): void {
    const gone = this.references.get().find((r) => r.id === id);
    if (!gone) return;
    this.references.update((list) => list.filter((r) => r.id !== id));
    URL.revokeObjectURL(gone.thumb);
    // The renderer has dropped its texture by now; the picture itself can go.
    queueMicrotask(() => gone.image.close());
  }

  /** Hands the visible pictures to the renderer. */
  private pushReferences(): void {
    this.renderer?.setReferences(
      this.references
        .get()
        .filter((r) => r.visible)
        .map((r) => ({
          image: r.image,
          opacity: r.opacity,
          corners: r.mode === 'plane' ? referenceCorners(r) : null,
        })),
    );
    this.requestFrame();
  }

  /** Moves a tab in the tab bar. */
  moveTab(id: number, to: number): void {
    this.tabList.move(id, to);
    this.refreshTabs();
  }

  /** Listens to the document: panels, history state and, once attached, the renderer. */
  private bindDocument(): void {
    const doc = this.doc;
    doc.onPending(() => this.requestFrame());
    const unsubscribe = doc.subscribe((changes) => {
      if (changes.palette) this.paletteVersion.update((v) => v + 1);
      if (changes.history) {
        this.historyVersion.update((v) => v + 1);
        this.updateModified();
        this.tools.checkAdjustment();
        this.scheduleAutoVersion();
      }
      if (changes.scene) this.syncSceneSelection();
      const r = this.renderer;
      if (!r) return;
      if (changes.palette) r.updatePalette(doc.palette);
      if (changes.scene) r.syncObjects(doc.scene.objects());
      for (const [object, keys] of changes.voxels) {
        const urgent = this.strokeActive || keys.length <= URGENT_CHUNK_LIMIT;
        r.invalidate(object, keys, urgent);
        // Linked copies share the voxels: they need the same chunks again.
        for (const twin of linkedCopies(doc.scene, object)) r.invalidate(twin, keys, urgent);
      }
    });
    this.unbindDocument = () => {
      doc.onPending(null);
      unsubscribe();
    };
  }

  /**
   * Opens a document: an opened file, a recovered autosave, a new one. It gets its own tab,
   * unless the shown one is an untouched empty document, which it replaces.
   */
  open(doc: VoxelDocument, name: string, newTab = !this.isPristine(this.tabList.current)): void {
    this.keepTabState();
    const tab = this.newTabRecord(doc, name);
    if (newTab) this.tabList.add(tab);
    else this.tabList.replaceCurrent(tab);
    this.show(tab);
  }

  /**
   * Shows a tab's document. Tools, view and layout stay; the selection is dropped; the mode,
   * the active object and the camera come back as the tab had them.
   */
  private show(tab: DocTab): void {
    const doc = tab.doc;
    // Automatic versions count editing time from here.
    this.versionAt = Date.now();
    clearTimeout(this.versionTimer);
    this.tools.suspend();
    this.gizmo.cancel();
    this.unbindDocument?.();
    this.doc = doc;
    this.bindDocument();
    this.selectedNodes.set([]);
    this.paletteSelection.set([]);
    const objects = doc.scene.objects();
    this.activeObject.set(objects.find((o) => o.id === tab.activeObjectId) ?? objects[0] ?? null);
    this.mode.set(tab.mode);
    this.references.set(tab.references);
    const lastKey = Math.max(0, ...animatedNodes(doc).flatMap((n) => keyFrames(n)));
    if (lastKey > doc.animation.end) doc.animation.end = lastKey;
    this.animFrame.set(doc.animation.frame);
    this.selectionSets.set(tab.selectionSets);
    this.tools.refreshCursor();
    this.docName.set(tab.name);
    this.updateModified();
    for (const version of [this.sceneVersion, this.paletteVersion, this.historyVersion]) {
      version.update((v) => v + 1);
    }
    if (this.canvas && this.renderer) {
      this.renderer.dispose();
      this.createRenderer(this.canvas);
    }
    if (tab.camera) {
      this.cameraControl.stop();
      const c = this.camera;
      c.target = [...tab.camera.target];
      c.yaw = tab.camera.yaw;
      c.pitch = tab.camera.pitch;
      c.distance = tab.camera.distance;
      c.projection = tab.camera.projection ?? c.projection;
      c.update();
      this.requestFrame();
    } else {
      this.frameCamera();
    }
  }

  /** Builds every GPU resource from the document: on attach and after a context loss. */
  private createRenderer(canvas: HTMLCanvasElement): void {
    this.renderer = new Renderer(canvas, this.workers, () => this.requestFrame());
    this.pushReferences();
    this.renderer.updatePalette(this.doc.palette);
    for (const object of this.doc.scene.objects()) {
      // Everything gets meshed from scratch; earlier changes need no second pass.
      object.volume.takeMeshDirty();
    }
    this.renderer.syncObjects(this.doc.scene.objects());
    this.requestFrame();
  }

  /** Leaving with unsaved changes asks first; the autosave keeps them anyway. */
  private readonly onBeforeUnload = (e: BeforeUnloadEvent): void => {
    if (this.unsavedDocuments().length === 0) return;
    e.preventDefault();
    // Older browsers show the prompt only when returnValue is set.
    e.returnValue = '';
  };

  /** Runs the action bound to a key combination. Text fields keep their keys. */
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (isTypingTarget(e.target)) return;
    // Tab belongs to the panels while one of them has focus.
    if (e.code === 'Tab' && e.target !== document.body && !(e.target instanceof HTMLCanvasElement))
      return;
    if (
      this.mode.get() === 'scene' &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      this.sceneMode.key(e.code, e.shiftKey)
    ) {
      e.preventDefault();
      return;
    }
    // The active tool gets the first go at plain keys: Enter, Escape, arrows.
    if (
      this.mode.get() === 'model' &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      this.tools.handleKey(e.code, e.shiftKey)
    ) {
      e.preventDefault();
      return;
    }
    const combo = comboFromEvent(e, /Mac|iPhone|iPad/.test(navigator.platform));
    if (!combo) return;
    const id = this.actions.hotkeys.lookup(combo);
    const action = id ? this.actions.get(id) : undefined;
    if (!action) return;
    if (action.native) {
      // The browser fires its clipboard event right after this keydown; where it does not
      // (Safari without a text selection), run the action directly.
      const seen = this.clipboard.events;
      setTimeout(() => {
        if (this.clipboard.events === seen) this.actions.run(action.id);
      });
      return;
    }
    e.preventDefault();
    if (e.repeat && !action.repeat) return;
    this.actions.run(action.id);
  };

  /**
   * Phones drop WebGL contexts (background, low memory). The document is untouched; stop
   * drawing and wait for the browser to give the context back.
   */
  private readonly onContextLost = (event: Event): void => {
    // Without preventDefault the browser never restores the context.
    event.preventDefault();
    cancelAnimationFrame(this.frameHandle);
    this.frameHandle = 0;
    this.renderer?.dispose();
    this.renderer = null;
    this.rulerLabels.set([]);
    this.contextLost.set(true);
  };

  private readonly onContextRestored = (): void => {
    if (!this.canvas) return;
    this.createRenderer(this.canvas);
    this.contextLost.set(false);
  };

  undo(): void {
    if (this.tools.cancelPending()) {
      this.toast('Move cancelled');
      this.requestFrame();
      return;
    }
    const label = this.doc.history.undoLabel;
    if (this.doc.history.undo()) {
      this.toast(`Undone: ${label}`);
      this.requestFrame();
    } else {
      this.toast('Nothing to undo');
    }
  }

  redo(): void {
    const label = this.doc.history.redoLabel;
    if (this.doc.history.redo()) {
      this.toast(`Redone: ${label}`);
      this.requestFrame();
    } else {
      this.toast('Nothing to redo');
    }
  }

  /** Shows a short message over the viewport. */
  toast(text: string): void {
    this.noticeId++;
    this.notice.set({ id: this.noticeId, text });
  }

  /**
   * The voxel under a viewport point among the objects being edited, or the construction plane
   * of the active object when no voxel is there.
   */
  pickAt(x: number, y: number): Hover | null {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const object = this.activeObject.get();
    if (!object) return null;
    this.camera.update();
    const ray = this.camera.rayAt(x, y);
    const hit = pickVoxel([object], ray.origin, ray.dir, (o) => this.pickSource(o));
    if (hit) return { ...hit, onPlane: false };
    const plane = pickConstructionPlane(object, ray.origin, ray.dir);
    return plane ? { ...plane, value: 0, onPlane: true } : null;
  }

  /**
   * Turns the slice on through the voxel under the pointer (or the middle of the edited object),
   * along the last axis used, or off.
   */
  toggleSlice(): void {
    if (this.slice.get() !== null) {
      this.slice.set(null);
      this.toast('Slice off');
      return;
    }
    this.setSlice({ axis: this.sliceAxis, at: this.sliceStart(this.sliceAxis), dir: 1 });
  }

  /** Where a new slice along an axis goes: the voxel under the pointer, else the middle. */
  private sliceStart(axis: 0 | 1 | 2): number {
    const object = this.activeObject.get();
    const hover = this.hover.get();
    if (object && hover && !hover.onPlane) {
      return cellToWorld(worldTransform(object), hover.x, hover.y, hover.z)[axis]!;
    }
    const b = object ? worldBounds([object]) : null;
    if (!b) return 0;
    const [lo, hi] =
      axis === 0 ? [b.minX, b.maxX] : axis === 1 ? [b.minY, b.maxY] : [b.minZ, b.maxZ];
    return Math.floor((lo + hi) / 2);
  }

  /** The active layer, or the first one when it is gone. */
  currentLayer(): Layer {
    const scene = this.doc.scene;
    return scene.layer(this.activeLayer.get()) ?? scene.layers[0]!;
  }

  setLayerProperty<K extends 'name' | 'hidden' | 'locked'>(
    layer: Layer,
    key: K,
    value: Layer[K],
  ): void {
    if (layer[key] === value) return;
    const labels = {
      name: 'Rename layer',
      hidden: value ? 'Hide layer' : 'Show layer',
      locked: value ? 'Lock layer' : 'Unlock layer',
    };
    this.doc.history.execute(new LayerPropertyCommand(labels[key], layer, key, value));
  }

  /** A new layer after the others; it becomes the active one. */
  addLayer(): Layer {
    const scene = this.doc.scene;
    const layer = scene.createLayer();
    this.doc.history.execute(new LayerListCommand('New layer', layer, scene.layers.length, true));
    this.activeLayer.set(layer.id);
    return layer;
  }

  removeLayer(layer: Layer): void {
    const scene = this.doc.scene;
    if (scene.layers.length < 2) return;
    const index = scene.layers.indexOf(layer);
    const fallback = scene.layers.find((l) => l !== layer)!;
    this.doc.history.execute(new LayerListCommand('Delete layer', layer, index, false, fallback));
    if (this.activeLayer.get() === layer.id) this.activeLayer.set(fallback.id);
  }

  /** Puts the selected scene nodes (or the edited object) on a layer, as one step. */
  moveToLayer(layer: Layer): void {
    const picked = this.selectedNodes.get();
    const active = this.activeObject.get();
    const nodes = (picked.length > 0 ? picked : active ? [active] : []).filter(
      (n) => n.layer !== layer,
    );
    if (nodes.length === 0) return;
    this.doc.history.execute(
      new CompositeCommand(
        `To layer “${layer.name}”`,
        nodes.map((n) => new NodePropertyCommand('To layer', n, 'layer', layer)),
      ),
    );
    this.toast(`To layer “${layer.name}”: ${nodes.length}`);
  }

  /** Moves the selected voxels into a new object on a new layer. */
  extractSelectionToLayer(): void {
    const part = this.extractSelection();
    if (!part) return;
    const layer = this.addLayer();
    this.doc.history.execute(new NodePropertyCommand('To layer', part, 'layer', layer));
  }

  /** Ghost objects of the onion skin, kept while their voxels stay the same. */
  private onionCache = new Map<'onionPrev' | 'onionNext', VoxelObject>();

  /**
   * The edited object as it is on the key frames just before and after the shown one, for the
   * onion skin (only while the timeline is open and the view option is on).
   */
  private onionGhosts(): { object: VoxelObject; mode: GhostMode }[] {
    const object = this.activeObject.get();
    if (
      !object?.keys ||
      !this.ui.get().timeline ||
      !this.view.get().onion ||
      this.mode.get() !== 'model'
    ) {
      this.onionCache.clear();
      return [];
    }
    const frame = this.animFrame.get();
    const frames = keyFrames(object);
    const prev = frames.filter((f) => f < frame).at(-1);
    const next = frames.find((f) => f > frame);
    const out: { object: VoxelObject; mode: GhostMode }[] = [];
    const k = object.keys;
    const at = (f: number) => ({
      volume: keyAt(k.volumes, f) ?? object.volume,
      transform: keyAt(k.transforms, f) ?? object.transform,
    });
    for (const [mode, f] of [
      ['onionPrev', prev],
      ['onionNext', next],
    ] as const) {
      if (f === undefined) {
        this.onionCache.delete(mode);
        continue;
      }
      const { volume, transform } = at(f);
      // What the frame shows now needs no ghost.
      if (volume === object.volume && sameTransform(transform, object.transform)) continue;
      const parent = object.parent ? worldTransform(object.parent) : null;
      const world = parent ? composeTransform(parent, transform) : transform;
      let ghost = this.onionCache.get(mode);
      if (!ghost || ghost.volume !== volume) {
        ghost = {
          kind: 'object',
          id: mode === 'onionPrev' ? -5 : -6,
          name: mode,
          hidden: false,
          locked: true,
          transform: world,
          parent: null,
          volume,
          selection: new SelectionMask(),
          layer: NO_LAYER,
        };
        this.onionCache.set(mode, ghost);
      }
      ghost.transform = world;
      out.push({ object: ghost, mode });
    }
    return out;
  }

  /**
   * Brings the render grid and materials up to the document. Returns why the scene cannot be
   * rendered, or null. While editing (`eager` off, outside the render view) the grid catches
   * up a few times a second; a frame being saved keeps the scene it started with.
   */
  private syncRenderScene(tracer: PathTracer, now: number, eager: boolean): string | null {
    if (!tracer.supported)
      return 'This browser cannot render to float textures: render is unavailable';
    const stamp = [
      this.historyVersion.get(),
      this.sceneVersion.get(),
      this.paletteVersion.get(),
      this.animFrame.get(),
    ].join('|');
    if (stamp === this.renderStamp || this.batch?.job) return this.renderProblem;
    if (!eager && now - this.renderGridAt < RENDER_WINDOW_LAG_MS) {
      clearTimeout(this.renderGridTimer);
      this.renderGridTimer = window.setTimeout(() => this.requestFrame(), RENDER_WINDOW_LAG_MS);
      return this.renderProblem;
    }
    this.renderStamp = stamp;
    this.renderGridAt = now;
    const grid = sceneGrid(this.doc);
    if (grid === 'empty' || grid === 'too-big') {
      this.renderProblem =
        grid === 'empty'
          ? 'The scene is empty'
          : 'The scene is too large to render (up to 64 million cells)';
      return this.renderProblem;
    }
    tracer.setGrid(grid);
    tracer.setMaterials(materialRows(this.doc));
    this.renderProblem = null;
    return null;
  }

  /** A traced picture, made on first use and again after the 3D context is rebuilt. */
  private picture(slot: 'view' | 'window', tracer: PathTracer): TracedPicture {
    let p = this.pictures[slot];
    if (!p || p.tracer !== tracer) {
      p = { tracer, picture: tracer.accumulation(), camera: '', light: '' };
      this.pictures[slot] = p;
    }
    return p;
  }

  /** Starts a picture over when its camera or the light changed (not exposure and the like). */
  private follow(p: TracedPicture, camera: Camera, settings: RenderSettings): void {
    const cam = [...camera.viewProj].map((v) => v.toFixed(5)).join(',');
    const light = lightKey(settings);
    if (cam === p.camera && light === p.light) return;
    p.tracer.restart(p.picture);
    p.camera = cam;
    p.light = light;
  }

  /**
   * One frame of the path-traced view: the grid and materials follow the document, a moved
   * camera or changed settings start the picture over, and samples are added until the target.
   */
  private renderFrame(renderer: Renderer, interval: number, now: number): void {
    // Its code loads on first use; a frame follows when it is there.
    const tracer = renderer.pathTracer();
    if (!tracer) return;
    const problem = this.syncRenderScene(tracer, now, true);
    if (problem) {
      this.renderStatus.set({ samples: 0, problem });
      return;
    }
    const settings = this.renderSettings.get();
    const p = this.picture('view', tracer);
    this.follow(p, this.camera, settings);
    // Keep the interface responsive: more passes while frames are quick.
    this.renderPasses = adaptPasses(this.renderPasses, interval, 16);
    // A frame being saved gets the GPU; the view shows what it has.
    const samples = renderer.renderPathTraced(
      p.picture,
      this.camera,
      settings,
      this.batch ? 0 : this.renderPasses,
      withViewColors(this.view.get(), this.scheme.get()).background,
    );
    this.renderStatus.set({ samples, problem: null });
    if (samples < settings.samples && !this.batch) this.requestFrame();
  }

  /**
   * A small picture of the view as the next frame draws it (a data URL), for version lists.
   * Empty when there is no view or no frame comes soon (a hidden tab).
   */
  captureView(): Promise<string> {
    if (!this.renderer) return Promise.resolve('');
    return new Promise((resolve) => {
      const done = (url: string) => {
        clearTimeout(timer);
        resolve(url);
      };
      const timer = window.setTimeout(() => {
        this.viewCaptures = this.viewCaptures.filter((c) => c !== done);
        resolve('');
      }, 500);
      this.viewCaptures.push(done);
      this.requestFrame();
    });
  }

  /** Right after drawing, while the canvas still holds the frame. */
  private deliverCaptures(canvas: HTMLCanvasElement): void {
    if (this.viewCaptures.length === 0) return;
    const waiting = this.viewCaptures.splice(0);
    const out = document.createElement('canvas');
    out.width = 192;
    out.height = Math.max(1, Math.round((192 * canvas.height) / Math.max(1, canvas.width)));
    out.getContext('2d')?.drawImage(canvas, 0, 0, out.width, out.height);
    const url = out.toDataURL('image/webp', 0.8);
    for (const w of waiting) w(url);
  }

  /** Keeps a version of the shown document (app/versions.ts). */
  async rememberVersion(reason: VersionReason): Promise<void> {
    const doc = this.doc;
    const name = this.docName.get();
    this.versionAt = Date.now();
    clearTimeout(this.versionTimer);
    try {
      const bytes = writeVox(doc);
      const voxels = doc.scene.objects().reduce((s, o) => s + o.volume.voxelCount, 0);
      const thumb = await this.captureView();
      const kept = await this.versions.record(name, bytes, reason, voxels, thumb);
      if (reason === 'manual')
        this.toast(kept ? 'Version saved' : 'This version already exists: nothing changed since');
    } catch {
      if (reason === 'manual') this.toast('Could not save the version');
    }
  }

  /** Every ten minutes of editing, a version — a few seconds after a change, not mid-stroke. */
  private scheduleAutoVersion(): void {
    if (!this.versions.available || !this.isTabModified(this.tabList.current)) return;
    if (Date.now() - this.versionAt < AUTO_VERSION_MS) return;
    clearTimeout(this.versionTimer);
    this.versionTimer = window.setTimeout(() => {
      if (!this.strokeActive) void this.rememberVersion('auto');
    }, 3000);
  }

  /** Opens a version in a tab of its own; the document it came from stays as it is. */
  async openVersion(v: VersionInfo): Promise<void> {
    const bytes = await this.versions.bytes(v.id);
    if (!bytes) {
      this.toast('Version not found');
      return;
    }
    try {
      const when = new Date(v.savedAt).toLocaleString('en-US', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
      this.open(readVox(bytes), `${v.name} — ${when}`, true);
      this.markUnsaved();
      this.versionsOpen.set(false);
    } catch {
      this.toast('The version is damaged');
    }
  }

  /** The view's size in device pixels: a saved frame as sharp as the screen. */
  viewPixelSize(): { width: number; height: number } {
    const c = this.renderer?.canvas;
    const k = window.devicePixelRatio || 1;
    return c
      ? { width: Math.round(c.clientWidth * k), height: Math.round(c.clientHeight * k) }
      : { width: 1920, height: 1080 };
  }

  /** The render window's picture area, or null when it is closed. */
  setRenderWindowElement(element: HTMLElement | null): void {
    this.renderWindowElement = element;
    this.requestFrame();
  }

  /** Opens or closes the path-traced window over the editing view. */
  toggleRenderWindow(open = !this.renderWindow.get()): void {
    this.renderWindow.set(open);
    this.requestFrame();
  }

  /** Keeps the window on the current view while the editing camera moves on, or lets it follow again. */
  pinRenderWindow(pinned: boolean): void {
    this.renderWindowView.set(pinned ? this.currentView() : null);
    this.requestFrame();
  }

  /**
   * The render window, drawn into the canvas over the editing view: a few passes a frame so
   * editing stays quick, the scene taken from the document a few times a second.
   */
  private drawRenderWindow(renderer: Renderer, interval: number, now: number): void {
    const element = this.renderWindowElement;
    if (!this.renderWindow.get() || !element) return;
    const r = element.getBoundingClientRect();
    const c = renderer.canvas.getBoundingClientRect();
    const box = { x: r.left - c.left, y: r.top - c.top, width: r.width, height: r.height };
    if (box.width < 8 || box.height < 8) return;
    const tracer = renderer.pathTracer();
    if (!tracer) return;
    const problem = this.syncRenderScene(tracer, now, false);
    if (problem) {
      this.renderWindowStatus.set({ samples: 0, problem });
      return;
    }
    const settings = this.renderSettings.get();
    const view = this.renderWindowView.get();
    const camera = view
      ? cameraOf(view, box.width, box.height)
      : this.camera.resized(box.width, box.height);
    const p = this.picture('window', tracer);
    this.follow(p, camera, settings);
    this.windowPasses = adaptPasses(this.windowPasses, interval, 6);
    const samples = renderer.renderPathTraced(
      p.picture,
      camera,
      settings,
      this.batch ? 0 : this.windowPasses,
      withViewColors(this.view.get(), this.scheme.get()).background,
      box,
    );
    this.renderWindowStatus.set({ samples, problem: null });
    if (samples < settings.samples && !this.batch) this.requestFrame();
  }

  /** The view a saved picture is taken from: the render window's own, or the camera's. */
  private shotView(): CameraView {
    return (this.rendering.get() ? null : this.renderWindowView.get()) ?? this.currentView();
  }

  /**
   * Saves the render as a PNG of the frame size. It is traced in tiles, a few passes a frame,
   * while editing goes on; the scene is the one at the start.
   */
  saveRenderFrame(): void {
    const size = this.frameSize.get();
    const width = clampSide(size.width);
    const height = clampSide(size.height);
    this.startBatch({
      label: `PNG ${width}×${height}`,
      shots: [{ view: this.shotView(), frame: null, sunYaw: null }],
      width,
      height,
      settings: { ...this.renderSettings.get() },
      finish: async ([pixels]) => {
        if (pixels) await this.savePng(pixels, width, height, `${width}×${height}`);
      },
    });
  }

  /**
   * Saves a series (app/render-sequence.ts): a turntable or the animation as a GIF or a video,
   * or sprites from 4 or 8 sides as a PNG sheet.
   */
  saveRenderSequence(): void {
    const q = this.sequence.get();
    const base = this.renderSettings.get();
    const a = this.doc.animation;
    const frames = Array.from({ length: a.end - a.start + 1 }, (_, i) => a.start + i);
    if (q.kind === 'sprites') {
      const rows = q.animated && animatedNodes(this.doc).length > 0 ? frames : [null];
      const bounds = this.boundsOverFrames(rows);
      if (!bounds) {
        this.toast('The scene is empty');
        return;
      }
      const views = spriteViews(bounds.min, bounds.max, q.directions, q.tilt);
      const size = q.spriteSize;
      this.startBatch({
        label: `Sprites ${q.directions}×${rows.length}`,
        shots: rows.flatMap((frame) =>
          views.map((view) => ({ view, frame, sunYaw: sunFollowing(base, views[0]!, view) })),
        ),
        width: size,
        height: size,
        settings: {
          ...base,
          samples: q.samples,
          transparent: true,
          pixelated: q.pixelated,
          aperture: 0,
        },
        finish: async (images) => {
          const sheet = spriteSheet(images, size, size, q.directions);
          await this.savePng(sheet.pixels, sheet.width, sheet.height, `sprites ${size}px`);
        },
      });
      return;
    }
    const turntable = q.kind === 'turntable';
    if (!turntable && animatedNodes(this.doc).length === 0) {
      this.toast('The document has no animation: keys are set on the timeline');
      return;
    }
    const view = this.shotView();
    const views = turntable ? turntableViews(view, q.frames) : frames.map(() => view);
    const fps = turntable ? q.fps : a.fps;
    const width = q.width;
    const height = q.height;
    const video = q.format === 'video';
    if (video && !videoType()) {
      this.toast('This browser cannot record video: save a GIF');
      return;
    }
    this.startBatch({
      label: `${video ? 'Video' : 'GIF'} · ${views.length} frames`,
      shots: views.map((v, i) => ({
        view: v,
        frame: turntable ? null : frames[i]!,
        sunYaw: turntable && q.lightFollows ? sunFollowing(base, view, v) : null,
      })),
      width,
      height,
      // A video has no alpha: its frames are opaque.
      settings: { ...base, samples: q.samples, transparent: base.transparent && !video },
      finish: async (images) => {
        const what = turntable ? 'turntable' : 'animation';
        if (video) {
          this.toast('Recording video…');
          const out = await encodeVideo(images, width, height, fps);
          if (!out) {
            this.toast('Could not record the video');
            return;
          }
          const name = `${this.docName.get()} ${what}.${out.extension}`;
          downloadBlob(out.blob, name);
          this.toast(`Saved: ${name}`);
          return;
        }
        this.toast('Building the GIF…');
        // Let the toast show before the encoder takes the thread.
        await new Promise((r) => setTimeout(r, 30));
        const { encodeGif } = await import('../formats/gif');
        const gif = encodeGif(
          images.map((pixels) => ({ pixels })),
          { width, height, delay: Math.max(2, Math.round(100 / fps)), dither: true },
        );
        const name = `${this.docName.get()} ${what}.gif`;
        downloadBlob(new Blob([gif as BlobPart], { type: 'image/gif' }), name);
        this.toast(`Saved: ${name}`);
      },
    });
  }

  /** The visible scene's bounds over animation frames (null: the frame shown). */
  private boundsOverFrames(frames: readonly (number | null)[]): { min: Vec3; max: Vec3 } | null {
    const shown = this.animFrame.get();
    let all: { min: Vec3; max: Vec3 } | null = null;
    for (const f of frames) {
      if (f !== null) showFrame(this.doc, f);
      const b = this.sceneBounds();
      if (!b) continue;
      all = all
        ? {
            min: all.min.map((v, i) => Math.min(v, b.min[i]!)) as Vec3,
            max: all.max.map((v, i) => Math.max(v, b.max[i]!)) as Vec3,
          }
        : b;
    }
    if (frames.some((f) => f !== null)) showFrame(this.doc, shown);
    return all;
  }

  private startBatch(b: Omit<RenderBatch, 'index' | 'job' | 'images' | 'frameBefore'>): void {
    if (this.batch || !this.renderer || b.shots.length === 0) return;
    this.batch = { ...b, index: 0, job: null, images: [], frameBefore: this.animFrame.get() };
    this.renderJob.set({ label: b.label, progress: 0 });
    this.requestFrame();
  }

  cancelRenderJob(): void {
    const b = this.batch;
    if (!b) return;
    this.endBatch(b);
    this.toast('Saving cancelled');
  }

  private endBatch(b: RenderBatch): void {
    b.job?.dispose();
    b.job = null;
    this.batch = null;
    this.renderJob.set(null);
    if (b.shots.some((s) => s.frame !== null)) this.goToFrame(b.frameBefore);
    this.requestFrame();
  }

  /** A few passes on the picture being saved; the next shot when it is done; the file at the end. */
  private stepBatch(renderer: Renderer, interval: number, now: number): void {
    const b = this.batch;
    if (!b) return;
    if (!b.job) {
      const shot = b.shots[b.index]!;
      if (shot.frame !== null && shot.frame !== this.animFrame.get()) this.goToFrame(shot.frame);
      const tracer = renderer.pathTracer();
      if (!tracer) return;
      const problem = this.syncRenderScene(tracer, now, true);
      if (problem) {
        this.endBatch(b);
        this.toast(problem);
        return;
      }
      try {
        b.job = renderer.frameJob(
          cameraOf(shot.view, b.width, b.height),
          shot.sunYaw === null ? b.settings : { ...b.settings, sunYaw: shot.sunYaw },
          b.width,
          b.height,
          withViewColors(this.view.get(), this.scheme.get()).background,
        );
      } catch {
        this.endBatch(b);
        this.toast('Not enough memory for a frame this large');
        return;
      }
    }
    const job = b.job;
    if (!job) return;
    this.jobPasses = adaptPasses(this.jobPasses, interval, 32);
    renderer.stepFrameJob(job, this.jobPasses);
    this.renderJob.set({ label: b.label, progress: (b.index + job.progress) / b.shots.length });
    this.requestFrame();
    if (!job.done) return;
    b.images.push(job.pixels);
    job.dispose();
    b.job = null;
    b.index++;
    if (b.index < b.shots.length) return;
    this.endBatch(b);
    b.finish(b.images).catch(() => this.toast('Could not save'));
  }

  private async savePng(
    pixels: Uint8ClampedArray<ArrayBuffer>,
    width: number,
    height: number,
    what: string,
  ): Promise<void> {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext('2d');
    g?.putImageData(new ImageData(pixels, width, height), 0, 0);
    const blob = g ? await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png')) : null;
    if (!blob) {
      this.toast('Could not build the PNG');
      return;
    }
    const name = `${this.docName.get()} ${what}.png`;
    downloadBlob(blob, name);
    this.toast(`Saved: ${name}`);
  }

  /** The sky panorama the render uses, by file name; null for the plain sky. */
  readonly environment = writable<string | null>(null);

  /** Lights the render with an .hdr panorama instead of the plain sky. */
  async loadEnvironment(file: File): Promise<void> {
    try {
      const { parseHdr } = await import('../formats/hdr');
      const image = parseHdr(new Uint8Array(await file.arrayBuffer()));
      const renderer = this.renderer;
      if (!renderer) return;
      (await renderer.loadPathTracer()).setEnvironment(image);
      this.environment.set(file.name);
      this.requestFrame();
    } catch (e) {
      this.toast((e as Error).message);
    }
  }

  clearEnvironment(): void {
    this.renderer?.pathTracer()?.setEnvironment(null);
    this.environment.set(null);
    this.requestFrame();
  }

  /** Depth of field: focus on the voxel under a viewport point (its distance along the view). */
  focusAt(x: number, y: number): void {
    const ray = this.camera.rayAt(x, y);
    const hit = pickVoxel(this.doc.scene.objects(), ray.origin, ray.dir);
    if (!hit) return;
    const f = this.camera.forward();
    const along = hit.t * (ray.dir[0] * f[0] + ray.dir[1] * f[1] + ray.dir[2] * f[2]);
    const eye = this.camera.eye();
    const fromEye = Math.hypot(
      ray.origin[0] - eye[0],
      ray.origin[1] - eye[1],
      ray.origin[2] - eye[2],
    );
    const focus = Math.max(1, Math.round((along + fromEye) * 10) / 10);
    this.renderSettings.update((s) => ({ ...s, focus }));
    this.toast(`Focus: ${focus}`);
  }

  /** Switches the view to the path-traced picture, or back. */
  setRendering(on: boolean): void {
    if (on === this.rendering.get()) return;
    this.rendering.set(on);
    this.requestFrame();
  }

  /** Shows an animation frame: every animated object takes its model and placement there. */
  goToFrame(frame: number): void {
    const f = Math.max(0, Math.round(frame));
    showFrame(this.doc, f);
    this.animFrame.set(f);
    this.requestFrame();
  }

  /** Steps through the range, wrapping (or stopping at the end without looping). */
  stepFrame(by: number): void {
    const a = this.doc.animation;
    const span = a.end - a.start + 1;
    let f = this.animFrame.get() + by;
    if (f > a.end) f = a.loop ? a.start + ((f - a.start) % span) : a.end;
    if (f < a.start) f = a.loop ? a.end - ((a.start - f - 1) % span) : a.start;
    this.goToFrame(f);
  }

  /** Plays the range at its speed, or stops. */
  togglePlay(): void {
    if (this.playing.get()) {
      this.playing.set(false);
      cancelAnimationFrame(this.playHandle);
      return;
    }
    this.playing.set(true);
    let last = performance.now();
    const tick = (now: number) => {
      if (!this.playing.get()) return;
      const a = this.doc.animation;
      if (now - last >= 1000 / Math.max(1, a.fps)) {
        last = now;
        if (!a.loop && this.animFrame.get() >= a.end) {
          this.playing.set(false);
          return;
        }
        this.stepFrame(1);
      }
      this.playHandle = requestAnimationFrame(tick);
    };
    this.playHandle = requestAnimationFrame(tick);
  }

  /** Adds or removes a key of the edited object (or the selected scene nodes) at this frame. */
  setKey(kind: KeyKind, add: boolean): void {
    const frame = this.animFrame.get();
    const picked = this.mode.get() === 'scene' ? this.selectedNodes.get() : [];
    const active = this.activeObject.get();
    const nodes = picked.length > 0 ? picked : active ? [active] : [];
    const targets = nodes.filter((n) => (kind === 'model' ? n.kind === 'object' : true));
    if (targets.length === 0) {
      this.toast('No object for the key');
      return;
    }
    const start = this.doc.animation.start;
    const parts = targets
      .filter(
        (n) =>
          add || (kind === 'model' ? n.keys?.volumes.has(frame) : n.keys?.transforms.has(frame)),
      )
      .map((n) => new KeyCommand(n, frame, kind, add, start));
    if (parts.length === 0) {
      this.toast('There is no such key on this frame');
      return;
    }
    this.doc.history.execute(
      parts.length === 1 ? parts[0]! : new CompositeCommand(parts[0]!.label, parts),
    );
    // A range that does not reach a new key grows to it.
    const a = this.doc.animation;
    if (add && frame > a.end)
      this.doc.history.execute(new AnimationSettingsCommand(this.doc, { end: frame }));
  }

  /** Hangs a rope (or chain, or cable) between two world points as a new procedural object. */
  async createRope(a: Vec3, b: Vec3): Promise<void> {
    const s = this.tools.settings;
    const palette = this.doc.palette;
    const spec: RopeSpec = {
      kind: s.ropeKind,
      a: [...a],
      b: [...b],
      slack: s.ropeSlack,
      thickness: s.ropeThickness,
      color: s.color,
      color2: stepInRamp(palette, s.color, 1),
    };
    this.toast(`${ROPE_TITLES[spec.kind]}: settling…`);
    const doc = this.doc;
    const points = await settleRope(spec, doc.scene, null, this.physics);
    if (doc !== this.doc) return;
    const scene = doc.scene;
    const object = scene.createObject(ROPE_TITLES[spec.kind], ropeVolume(spec, points));
    object.layer = this.currentLayer();
    ropeSpecs.set(object, spec);
    doc.history.execute(
      new InsertNodeCommand(ROPE_TITLES[spec.kind], object, scene.root, scene.root.children.length),
    );
    this.lastRope.set(object);
    this.toast(`${ROPE_TITLES[spec.kind]} is ready — its settings are in the bottom right corner`);
    this.sceneVersion.update((v) => v + 1);
  }

  /**
   * Drapes a sheet over the selected objects (in model mode: over the selection, or the edited
   * object), settled on everything below it; it becomes a new object.
   */
  async drapeCloth(margin = 3): Promise<void> {
    const doc = this.doc;
    const object = this.activeObject.get();
    let box: Box | null = null;
    if (this.mode.get() === 'model' && object && !object.selection.isEmpty) {
      const b = object.selection.getBounds();
      if (b) {
        const t = worldTransform(object);
        const p = cellToWorld(t, b.minX, b.minY, b.minZ);
        const q = cellToWorld(t, b.maxX, b.maxY, b.maxZ);
        box = {
          minX: Math.min(p[0], q[0]),
          minY: Math.min(p[1], q[1]),
          minZ: Math.min(p[2], q[2]),
          maxX: Math.max(p[0], q[0]),
          maxY: Math.max(p[1], q[1]),
          maxZ: Math.max(p[2], q[2]),
        };
      }
    }
    box ??= worldBounds(this.sceneTargets());
    if (!box) {
      this.toast('Nothing to drape over: choose an object or select voxels');
      return;
    }
    this.toast('The cloth is falling…');
    const sheet = await settleCloth(
      { box, margin, color: this.tools.settings.color },
      doc.scene,
      this.physics,
    );
    if (doc !== this.doc) return;
    const scene = doc.scene;
    const cloth = scene.createObject('Cloth', clothVolume(sheet, this.tools.settings.color));
    cloth.layer = this.currentLayer();
    doc.history.execute(
      new InsertNodeCommand('Drape cloth', cloth, scene.root, scene.root.children.length),
    );
    this.toast('The cloth has settled');
  }

  /** Changes a rope's parameters and builds it again (one undo step while numbers change). */
  async updateRope(object: VoxelObject, patch: Partial<RopeSpec>): Promise<void> {
    const before = ropeSpecs.get(object);
    if (!before) return;
    const spec = { ...before, ...patch };
    const build = ++this.ropeBuild;
    const doc = this.doc;
    const points = await settleRope(spec, doc.scene, object, this.physics);
    if (build !== this.ropeBuild || doc !== this.doc) return;
    doc.history.execute(
      new ProceduralCommand(
        object,
        { volume: object.volume, spec: before },
        { volume: ropeVolume(spec, points), spec },
      ),
      { merge: true },
    );
  }

  /** Runs a program with this document's palette; the newest run wins. */
  private async runProgramSpec(spec: ProgramSpec): Promise<ProgramResult | null> {
    const build = ++this.programBuild;
    this.programStatus.update((s) => ({ ...s, running: true }));
    const result = await this.programs.run({
      source: spec.source,
      params: spec.params,
      palette: programPalette(this.doc),
    });
    if (build !== this.programBuild) return null;
    this.programStatus.set({
      running: false,
      error: result.error,
      log: result.log,
      params: result.params,
      ms: result.ms,
      voxels: result.colors.length,
    });
    return result;
  }

  /**
   * A new program object where the camera looks, on the floor: the program runs first, then the
   * object goes in with its voxels — one step. Its window stays open on it.
   */
  async newProgram(source: string, name: string, graph: unknown = null): Promise<void> {
    const doc = this.doc;
    const spec: ProgramSpec = { source, params: {}, graph };
    const result = await this.runProgramSpec(spec);
    if (!result || doc !== this.doc) return;
    const scene = doc.scene;
    const object = scene.createObject(name, resultVolume(result));
    const t = this.camera.target;
    object.transform = { x: Math.round(t[0]), y: 0, z: Math.round(t[2]), orientation: 0 };
    object.layer = this.currentLayer();
    programSpecs.set(object, spec);
    doc.history.execute(
      new InsertNodeCommand(`Program “${name}”`, object, scene.root, scene.root.children.length),
    );
    this.selectNodes([object]);
    this.programOpen.set(object);
  }

  /**
   * Keeps a node program's graph without building: cards moved, or a graph that does not
   * compile yet (its wiring is kept while the person goes on).
   */
  setProgramGraph(object: VoxelObject, graph: unknown): void {
    const spec = programSpecs.get(object);
    if (spec) programSpecs.set(object, { ...spec, graph });
  }

  /** Opens the program of an object (the active one by default). */
  openProgram(object: VoxelObject | null = this.activeObject.get()): void {
    const spec = object ? programSpecs.get(object) : undefined;
    if (!object || !spec) {
      this.programOpen.set('new');
      return;
    }
    this.programOpen.set(object);
    // Run once for the parameters and the log; the voxels are already there.
    void this.runProgramSpec(spec);
  }

  /**
   * Builds a program object again with a changed program or parameters: one step that merges
   * while typing or dragging. A program that fails keeps the voxels it last made.
   */
  async updateProgram(object: VoxelObject, patch: Partial<ProgramSpec>): Promise<void> {
    const before = programSpecs.get(object);
    if (!before) return;
    const spec: ProgramSpec = { ...before, ...patch };
    const doc = this.doc;
    const result = await this.runProgramSpec(spec);
    if (!result || doc !== this.doc || programSpecs.get(object) !== before) return;
    const volume = result.error ? object.volume : resultVolume(result, spec.offset);
    doc.history.execute(
      new ProgramCommand(object, { volume: object.volume, spec: before }, { volume, spec }),
      { merge: true },
    );
  }

  /** Saves the selection of the edited object (all of it without one) into the library. */
  saveAsset(): void {
    const object = this.activeObject.get();
    const clip = object ? copyVoxels(object, this.doc.palette) : null;
    if (!object || !clip) {
      this.toast('Nothing to save: the object is empty');
      return;
    }
    const name = object.selection.isEmpty ? object.name : `${object.name}: part`;
    void this.assets.save(makeAsset(name, clip));
    this.toast(`In the library: “${name}”`);
  }

  /** Puts a library piece into the scene as a new object, standing at the camera's centre. */
  insertAsset(asset: Asset): void {
    const clip = assetClip(asset);
    if (!clip) return;
    if (this.insertVolume(asset.name, remapClip(clip, this.doc.palette), 'Insert from library'))
      this.toast(`Inserted: “${asset.name}”`);
  }

  /**
   * A new object with these voxels where the camera looks, standing on the floor, on the
   * current layer and selected: one undo step. Null for an empty volume.
   */
  private insertVolume(name: string, volume: VoxelVolume, label: string): VoxelObject | null {
    const b = volume.getBounds();
    if (!b) return null;
    const scene = this.doc.scene;
    const object = scene.createObject(name, volume);
    const t = this.camera.target;
    object.transform = {
      x: Math.round(t[0]) - Math.floor((b.minX + b.maxX + 1) / 2),
      y: -b.minY,
      z: Math.round(t[2]) - Math.floor((b.minZ + b.maxZ + 1) / 2),
      orientation: 0,
    };
    object.layer = this.currentLayer();
    this.doc.history.execute(
      new InsertNodeCommand(label, object, scene.root, scene.root.children.length),
    );
    this.selectNodes([object]);
    return object;
  }

  /** The examples window is open. */
  readonly examplesOpen = writable(false);

  /** Opens an example in a tab of its own, framed. */
  openExample(example: Example): void {
    this.open(example.build(), example.title, true);
    this.fitAll();
    this.toast(`Example “${example.title}”`);
  }

  /** Voxelizing meshes: the settings, and the files of the open window (null: closed). */
  readonly meshImportSettings = writable<MeshImportSettings>({ ...DEFAULT_MESH_IMPORT });
  readonly meshImportFiles = writable<File[] | null>(null);

  /**
   * A mesh file (with its companions: .bin, .mtl, textures) as voxels (app/mesh-import.ts): a
   * new document with a palette from the model's colours, or an object in this scene.
   */
  async importMesh(files: readonly File[]): Promise<void> {
    const s = this.meshImportSettings.get();
    this.toast('Voxelizing…');
    // Let the note show before the work takes the thread.
    await new Promise((r) => setTimeout(r, 30));
    let mesh: ImportedMesh;
    try {
      const list = await Promise.all(
        files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })),
      );
      const { readMesh } = await import('../formats/mesh-import');
      mesh = readMesh(list);
    } catch (e) {
      this.toast(e instanceof Error && e.message ? e.message : 'Could not read the model');
      return;
    }
    const pictures = await Promise.all(
      mesh.images.map((img) =>
        img.bytes.length > 0
          ? readPicture(
              new Blob([img.bytes as BlobPart], { type: img.mime }),
              Number.POSITIVE_INFINITY,
            ).catch(() => null)
          : null,
      ),
    );
    const c = this.doc.palette.color(this.tools.settingsStore.get().color);
    const { cellPalette, cellsToVolume, voxelizeMesh } = await import('./mesh-import');
    const cells = voxelizeMesh(mesh, pictures, s, [red(c), green(c), blue(c)]);
    if (cells.cells.size === 0) {
      this.toast('The model gave no voxels');
      return;
    }
    const main = files.find((f) => /\.(glb|gltf|obj|stl)$/i.test(f.name));
    const name = main?.name.replace(/\.[^.]+$/, '') || 'Model';
    if (s.target === 'new') {
      const doc = new VoxelDocument();
      cellPalette(cells).forEach((color, i) => {
        doc.palette.setEntry(i + 1, { ...doc.palette.entry(i + 1), color });
      });
      const object = doc.scene.createObject(name, cellsToVolume(cells, doc.palette));
      object.transform = {
        x: -Math.floor(cells.size[0] / 2),
        y: 0,
        z: -Math.floor(cells.size[2] / 2),
        orientation: 0,
      };
      doc.scene.attach(object, doc.scene.root);
      this.open(doc, name, true);
      this.markUnsaved();
      this.fitAll();
    } else this.insertVolume(name, cellsToVolume(cells, this.doc.palette), 'Voxelize');
    const [sx, sy, sz] = cells.size;
    this.toast(`“${name}”: ${sx}×${sy}×${sz}, ${cells.cells.size.toLocaleString('en-US')} voxels`);
    this.meshImportFiles.set(null);
  }

  /** The picture window's settings, and which of its tabs is open (null: closed). */
  readonly pictureSettings = writable<PictureSettings>({ ...DEFAULT_PICTURES });
  readonly picturesOpen = writable<'import' | 'slices' | null>(null);

  /** A picture as a new object: a plane, a height map or a sheet of slices (app/pictures.ts). */
  async importPicture(file: File): Promise<void> {
    const s = this.pictureSettings.get();
    let pic: Picture;
    try {
      pic = await readPicture(file, s.mode === 'slices' ? Number.POSITIVE_INFINITY : s.maxSide);
    } catch {
      this.toast(`“${file.name}” is not a picture`);
      return;
    }
    const palette = this.doc.palette;
    const { heightmapToVolume, pictureToVolume, slicesToVolume } = await import(
      '../core/image-voxels'
    );
    const volume =
      s.mode === 'plane'
        ? pictureToVolume(pic, palette, s.facing)
        : s.mode === 'heightmap'
          ? heightmapToVolume(
              pic,
              palette,
              s.maxHeight,
              s.oneColor ? this.tools.settingsStore.get().color : null,
            )
          : slicesToVolume(pic, s.sliceWidth, s.sliceDepth, palette);
    const name = file.name.replace(/\.[^.]+$/, '') || 'Picture';
    const object = this.insertVolume(name, volume, 'Import picture');
    if (!object) {
      this.toast('The picture has no opaque pixels');
      return;
    }
    const b = volume.getBounds()!;
    const size = `${b.maxX - b.minX + 1}×${b.maxY - b.minY + 1}×${b.maxZ - b.minZ + 1}`;
    this.toast(`“${name}”: ${size}, ${volume.voxelCount.toLocaleString('en-US')} voxels`);
    this.picturesOpen.set(null);
  }

  /**
   * The active object's layers — or the visible scene's — as PNG: one sheet of slices in a
   * grid, or a PNG per layer in a ZIP. The name carries the slice size, so the sheet reads back.
   */
  async exportSlices(): Promise<void> {
    const s = this.pictureSettings.get();
    const active = this.activeObject.get();
    const volume = s.wholeScene
      ? worldVolume(this.doc.scene.objects().filter((o) => !isHidden(o)))
      : active?.volume;
    const { sheetColumns, volumeSlices } = await import('../core/image-voxels');
    const slices = volume ? volumeSlices(volume, this.doc.palette) : null;
    if (!slices) {
      this.toast(s.wholeScene ? 'The scene is empty' : 'The object has no voxels');
      return;
    }
    const { width, depth, layers } = slices;
    const base = `${this.docName.get()} slices ${width}x${depth}x${layers.length}`;
    if (s.separate) {
      const files: ZipEntry[] = [];
      for (const [y, layer] of layers.entries()) {
        const blob = await pngBlob(layer, width, depth);
        if (blob)
          files.push({
            name: `${base}/${String(y).padStart(3, '0')}.png`,
            data: new Uint8Array(await blob.arrayBuffer()),
          });
      }
      const { zip } = await import('../formats/zip');
      downloadBlob(new Blob([zip(files) as BlobPart]), `${base}.zip`);
    } else {
      const sheet = spriteSheet(layers, width, depth, sheetColumns(layers.length));
      const blob = await pngBlob(sheet.pixels, sheet.width, sheet.height);
      if (!blob) {
        this.toast('Could not build the PNG');
        return;
      }
      downloadBlob(blob, `${base}.png`);
    }
    this.toast(`Slices: ${layers.length}, ${width}×${depth} each`);
    this.picturesOpen.set(null);
  }

  /** Takes a library piece as the stamp. */
  assetAsStamp(asset: Asset): void {
    const clip = assetClip(asset);
    const pattern = clip ? patternFromVolume(remapClip(clip, this.doc.palette), asset.name) : null;
    if (!pattern) return;
    this.tools.setStamp(pattern);
    if (this.mode.get() !== 'model') this.setMode('model');
    this.tools.setTool('stamp');
    this.toast(`Stamp “${asset.name}”`);
  }

  /** Keeps the active object's selection under a name. */
  saveSelectionSet(): void {
    const object = this.activeObject.get();
    if (!object || object.selection.isEmpty) {
      this.toast('Nothing to remember: the selection is empty');
      return;
    }
    const sets = this.selectionSets.get();
    const name = `Set ${sets.filter((s) => s.objectId === object.id).length + 1}`;
    this.selectionSets.set([
      ...sets,
      { id: this.nextSetId++, objectId: object.id, name, mask: object.selection.clone() },
    ]);
    this.toast(`Selection saved: “${name}”`);
  }

  /** Brings a named selection back: replacing the selection, or added to it. */
  restoreSelectionSet(id: number, mode: SelectMode = 'replace'): void {
    const set = this.selectionSets.get().find((s) => s.id === id);
    const object = set ? this.doc.scene.objects().find((o) => o.id === set.objectId) : null;
    if (!set || !object) return;
    if (this.activeObject.get() !== object) this.setActiveObject(object);
    const tx = new SelectionTransaction(object);
    tx.combine(set.mask, mode);
    const command = tx.commit(`Set “${set.name}”`);
    if (command) {
      this.doc.history.push(command);
      this.doc.notifySelection(object);
      this.requestFrame();
    }
  }

  renameSelectionSet(id: number, name: string): void {
    this.selectionSets.update((sets) => sets.map((s) => (s.id === id ? { ...s, name } : s)));
  }

  removeSelectionSet(id: number): void {
    this.selectionSets.update((sets) => sets.filter((s) => s.id !== id));
  }

  /**
   * Moves the selected voxels into a new object in the same place, next to the old one: one
   * undo step. The new object becomes the edited one.
   */
  extractSelection(): VoxelObject | null {
    const object = this.activeObject.get();
    const part = object ? extractSelection(this.doc, object) : null;
    if (!part) {
      this.toast('Select the voxels to move into an object');
      return null;
    }
    this.setActiveObject(part);
    this.toast(`Moved into “${part.name}”: ${part.volume.voxelCount} voxels`);
    return part;
  }

  /** Takes the selected voxels of the active object (all of it without a selection) as the stamp. */
  makeStamp(): void {
    const object = this.activeObject.get();
    if (!object) return;
    const clip = copyVoxels(object, this.doc.palette);
    const name = object.selection.isEmpty ? object.name : `${object.name}: selection`;
    const pattern = clip ? patternFromVolume(clip.volume, name) : null;
    if (!pattern) {
      this.toast('Nothing to stamp: the object is empty');
      return;
    }
    this.tools.setStamp(pattern);
    if (this.mode.get() !== 'model') this.setMode('model');
    this.tools.setTool('stamp');
    this.toast(`Stamp “${name}”: ${pattern.size.join(' × ')}`);
  }

  /** Sets the slice and says where it is. */
  setSlice(slice: WorldSlice | null): void {
    if (slice) this.sliceAxis = slice.axis;
    this.slice.set(slice);
    if (slice) this.toast(`Slice: ${sliceTitle(slice)}`);
  }

  /** Changes the slice's axis (keeping it on, through the middle) or its hidden side. */
  sliceAlong(axis: 0 | 1 | 2): void {
    const s = this.slice.get();
    if (s?.axis === axis) return;
    this.setSlice({ axis, at: this.sliceStart(axis), dir: s?.dir ?? 1 });
  }

  flipSlice(): void {
    const s = this.slice.get();
    if (s) this.setSlice({ ...s, dir: s.dir === 1 ? -1 : 1 });
  }

  /** Moves the slice along its axis by whole voxels. */
  moveSlice(by: number): void {
    const s = this.slice.get();
    if (s) this.setSlice({ ...s, at: s.at + by });
  }

  /** The slice as an object sees it, or null when nothing is cut. */
  clipOf(object: VoxelObject): LocalClip | null {
    const s = this.slice.get();
    return s === null ? null : sliceClip(worldTransform(object), s);
  }

  /** What picking sees of an object: everything below the slice. */
  pickSource(object: VoxelObject, base?: PickSource): PickSource {
    const volume = base?.volume ?? object.volume;
    const bounds = base ? base.bounds : object.volume.getBounds();
    const clip = this.clipOf(object);
    return { volume, bounds: bounds && clip ? clipBox(bounds, clip) : bounds };
  }

  /** Runs an action chosen in the command palette and remembers it as recent. */
  runCommand(id: string): void {
    this.recentActions.update((recent) => [id, ...recent.filter((r) => r !== id)].slice(0, 8));
    this.actions.run(id);
  }

  /** Hides or shows everything but the canvas. */
  /** Opens the radial menu at a viewport point, or under the last pointer position. */
  openRadial(x?: number, y?: number, dragging = false): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const last = this.pointer.get();
    const px = x ?? (last && Number.isFinite(last.x) ? last.x : canvas.clientWidth / 2);
    const py = y ?? (last && Number.isFinite(last.y) ? last.y : canvas.clientHeight / 2);
    const [cx, cy] = clampCentre(px, py, canvas.clientWidth, canvas.clientHeight);
    this.radial.set({ x: cx, y: cy, hover: -1, dragging });
  }

  /** Points at the item in the direction of a viewport point (-1 near the centre). */
  pointRadial(x: number, y: number): void {
    const r = this.radial.get();
    if (!r) return;
    const hover = radialIndex(x - r.x, y - r.y, RADIAL_ITEMS.length);
    if (hover !== r.hover) this.radial.set({ ...r, hover });
  }

  /** Closes the menu and runs an item; -1 just closes. */
  pickRadial(index: number): void {
    this.radial.set(null);
    const item = RADIAL_ITEMS[index];
    if (item) runRadialItem(item, this.actions, this.ui.get().lastTool);
  }

  private radialGesture(phase: 'open' | 'move' | 'up' | 'cancel', x: number, y: number): void {
    if (phase === 'open') {
      this.openRadial(x, y, true);
      return;
    }
    const r = this.radial.get();
    if (!r) return;
    if (phase === 'move') this.pointRadial(x, y);
    else if (phase === 'cancel') this.radial.set(null);
    // Lifted on an item: that is the choice. Lifted in the middle: the menu stays for a tap.
    else if (r.hover >= 0) this.pickRadial(r.hover);
    else this.radial.set({ ...r, dragging: false });
  }

  toggleInterface(): void {
    this.ui.update((u) => ({ ...u, hidden: !u.hidden }));
    this.requestFrame();
  }

  /** Switches between editing voxels and placing objects. */
  setMode(mode: EditorMode): void {
    if (this.mode.get() === mode) return;
    if (mode === 'scene') {
      this.tools.suspend();
      const active = this.activeObject.get();
      if (this.selectedNodes.get().length === 0 && active) this.selectedNodes.set([active]);
    } else this.gizmo.cancel();
    this.mode.set(mode);
    if (mode === 'model') this.tools.refreshCursor();
    else this.setToolCursor('default');
    this.toast(mode === 'scene' ? 'Mode: scene' : 'Mode: model');
    this.requestFrame();
  }

  /** The cursor the active tool wants over the viewport. */
  setToolCursor(cursor: string): void {
    this.input?.setToolCursor(visibleCursor(cursor));
  }

  private handleTool(event: ToolPointerEvent): void {
    this.pointer.set(event);
    // The render view only looks: the camera moves, tools rest; a click sets the focus.
    if (this.rendering.get()) {
      if (event.phase === 'down' && event.button === 'primary' && Number.isFinite(event.x))
        this.focusAt(event.x, event.y);
      return;
    }
    if (this.mode.get() === 'scene') {
      this.sceneMode.pointer(event);
      return;
    }
    if (event.phase === 'hover' || event.phase === 'move') {
      this.hover.set(this.pickAt(event.x, event.y));
    }
    this.tools.handlePointer(event);
  }

  /** The world point of the voxel or plane under a viewport point, if any. */
  surfacePointAt(x: number, y: number): Vec3 | null {
    const hit = this.pickAt(x, y);
    if (!hit) return null;
    const ray = this.camera.rayAt(x, y);
    return [
      ray.origin[0] + ray.dir[0] * hit.t,
      ray.origin[1] + ray.dir[1] * hit.t,
      ray.origin[2] + ray.dir[2] * hit.t,
    ];
  }

  /** The point under (x, y) on the model, or at the depth of the camera target. */
  private zoomAnchorAt(x: number, y: number): Vec3 {
    const surface = this.surfacePointAt(x, y);
    if (surface) return surface;
    const c = this.camera;
    const ray = c.rayAt(x, y);
    const f = c.forward();
    const e = c.eye();
    const depth =
      (c.target[0] - e[0]) * f[0] + (c.target[1] - e[1]) * f[1] + (c.target[2] - e[2]) * f[2];
    const along = ray.dir[0] * f[0] + ray.dir[1] * f[1] + ray.dir[2] * f[2];
    const t = depth / Math.max(along, 1e-6);
    return [
      ray.origin[0] + ray.dir[0] * t,
      ray.origin[1] + ray.dir[1] * t,
      ray.origin[2] + ray.dir[2] * t,
    ];
  }

  private handleCamera(gesture: CameraGesture): void {
    const ctl = this.cameraControl;
    const now = performance.now();
    switch (gesture.kind) {
      case 'start':
        ctl.begin(gesture.mode, this.surfacePointAt(gesture.x, gesture.y));
        break;
      case 'orbit':
        ctl.orbit(gesture.dx, gesture.dy, now);
        break;
      case 'pan':
        ctl.pan(gesture.dx, gesture.dy, now);
        break;
      case 'zoom':
        ctl.zoom(gesture.factor, this.zoomAnchorAt(gesture.x, gesture.y));
        break;
      case 'end':
        ctl.end(now);
        break;
      case 'pivot': {
        const point = this.surfacePointAt(gesture.x, gesture.y);
        if (point) ctl.setPivot(point, now);
        break;
      }
    }
    // The pointer stays put while the view moves: what is under it changes.
    this.hover.set(null);
    this.markMotion();
  }

  /** The viewport changed size; the next frame reads the new size from the canvas. */
  resize(): void {
    this.requestFrame();
  }

  requestFrame(): void {
    if (this.frameHandle || !this.renderer) return;
    this.frameHandle = requestAnimationFrame((now) => this.frame(now));
  }

  /**
   * The view is moving (orbit, pan, zoom, camera animation). Frames drawn while it moves may
   * use a lower resolution; a sharp frame follows when it stops.
   */
  markMotion(): void {
    this.lastMotionAt = performance.now();
    this.requestFrame();
  }

  /** Points the camera at the whole scene on the next frame, once the viewport size is known. */
  frameCamera(): void {
    this.fitPending = true;
    this.requestFrame();
  }

  /** Turns the camera to look along a direction from the view cube (target → eye). */
  viewAlong(dir: Dir): void {
    const c = this.camera;
    const { yaw, pitch } = anglesFor(dir, c.yaw);
    this.cameraControl.animateTo(
      { target: [...c.target], yaw, pitch, distance: c.distance },
      performance.now(),
    );
    this.markMotion();
  }

  /** Orthographic camera at true isometric angles. */
  viewIsometric(): void {
    const c = this.camera;
    this.cameraControl.animateTo(
      { target: [...c.target], ...ISOMETRIC, distance: c.distance, projection: 'orthographic' },
      performance.now(),
    );
    this.markMotion();
  }

  setProjection(projection: Projection): void {
    this.camera.projection = projection;
    this.markMotion();
  }

  toggleProjection(): void {
    this.setProjection(this.camera.projection === 'perspective' ? 'orthographic' : 'perspective');
  }

  /** Smoothly frames the active object, or the whole scene when it is empty. */
  fitActive(): void {
    const object = this.activeObject.get();
    const box = object?.volume.getBounds();
    if (!object || !box) {
      this.fitAll();
      return;
    }
    const w = worldBox(box, worldTransform(object));
    this.animateFit(w.min, w.max);
  }

  /** Smoothly frames a node of the scene tree. */
  focusNode(node: SceneNode): void {
    const box = worldBounds([node]);
    if (!box) return;
    this.animateFit([box.minX, box.minY, box.minZ], [box.maxX + 1, box.maxY + 1, box.maxZ + 1]);
  }

  /** Renames, hides or locks a node as an undoable step. */
  setNodeProperty<K extends 'name' | 'hidden' | 'locked'>(
    node: SceneNode,
    key: K,
    value: SceneNode[K],
  ): void {
    if (node[key] === value) return;
    const labels = {
      name: 'Rename',
      hidden: value ? 'Hide' : 'Show',
      locked: value ? 'Lock' : 'Unlock',
    };
    if (key !== 'name') this.tools.cancelPending();
    this.doc.history.execute(new NodePropertyCommand(labels[key], node, key, value));
  }

  /** Smoothly frames every visible object. */
  fitAll(): void {
    const bounds = this.sceneBounds();
    if (bounds) this.animateFit(bounds.min, bounds.max);
    else this.animateFit([-8, 0, -8], [8, 16, 8]);
  }

  /** The camera now, as a document keeps it in a slot. */
  currentView(): CameraView {
    const c = this.camera;
    return {
      target: [c.target[0], c.target[1], c.target[2]],
      yaw: c.yaw,
      pitch: c.pitch,
      distance: c.distance,
      projection: c.projection,
      fov: c.fovY / DEG,
    };
  }

  /** Remembers the camera in a slot of the document (one undo step). */
  saveCameraSlot(slot: number): void {
    this.doc.history.execute(new SetCameraSlotCommand(slot, this.currentView()));
    this.toast(`Camera ${slot + 1} saved`);
  }

  clearCameraSlot(slot: number): void {
    if (!this.doc.cameras[slot]) return;
    this.doc.history.execute(new SetCameraSlotCommand(slot, null));
  }

  /** Flies to a saved camera. */
  goToCameraSlot(slot: number): void {
    const view = this.doc.cameras[slot];
    if (!view) {
      this.toast(`Camera ${slot + 1} is empty: click it in the View menu to remember it`);
      return;
    }
    this.camera.fovY = view.fov * DEG;
    this.cameraControl.animateTo(
      {
        target: [...view.target],
        yaw: view.yaw,
        pitch: view.pitch,
        distance: view.distance,
        projection: view.projection,
      },
      performance.now(),
    );
    this.markMotion();
  }

  /** Sets the camera by numbers (the numeric camera in the View menu); angles in degrees. */
  setCameraNumbers(patch: {
    x?: number;
    y?: number;
    z?: number;
    yaw?: number;
    pitch?: number;
    distance?: number;
    fov?: number;
    projection?: Projection;
  }): void {
    const c = this.camera;
    this.cameraControl.stop();
    if (patch.x !== undefined) c.target[0] = patch.x;
    if (patch.y !== undefined) c.target[1] = patch.y;
    if (patch.z !== undefined) c.target[2] = patch.z;
    if (patch.yaw !== undefined) c.yaw = patch.yaw * DEG;
    if (patch.pitch !== undefined) c.pitch = Math.max(-89.9, Math.min(89.9, patch.pitch)) * DEG;
    if (patch.distance !== undefined) c.distance = Math.max(0.5, patch.distance);
    if (patch.fov !== undefined) c.fovY = Math.max(5, Math.min(120, patch.fov)) * DEG;
    if (patch.projection !== undefined) c.projection = patch.projection;
    c.update();
    this.markMotion();
  }

  private animateFit(min: Vec3, max: Vec3): void {
    const c = this.camera;
    const radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2;
    this.cameraControl.animateTo(
      {
        target: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
        yaw: c.yaw,
        pitch: c.pitch,
        distance: c.distanceToFit(radius),
      },
      performance.now(),
    );
    this.markMotion();
  }

  private sceneBounds(): { min: Vec3; max: Vec3 } | null {
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const object of this.doc.scene.objects()) {
      const b = object.volume.getBounds();
      if (!b || isHidden(object)) continue;
      const w = worldBox(b, worldTransform(object));
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i]!, w.min[i]!);
        max[i] = Math.max(max[i]!, w.max[i]!);
      }
    }
    return min[0] === Infinity ? null : { min, max };
  }

  /** Frames the scene at once (first frame, opened document). */
  private fitScene(): void {
    const bounds = this.sceneBounds();
    // An empty scene looks at a small working area around the origin.
    const { min, max } = bounds ?? { min: [-8, 0, -8], max: [8, 16, 8] };
    const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    this.camera.fitSphere(
      center,
      Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2,
    );
  }

  /** Rebuilds the selection overlay when the active object or its selection changed. */
  private syncSelectionOverlay(): void {
    const object = this.activeObject.get();
    const revision = object ? object.selection.revision : -1;
    const shown = this.selectionShown;
    if (shown.object === object && shown.revision === revision) return;
    this.selectionShown = { object, revision };
    if (object && !isHidden(object)) {
      this.selectionOverlay.transform = worldTransform(object);
      selectionToVolume(object.selection, this.selectionOverlay.volume);
    } else {
      this.selectionOverlay.volume.clear();
    }
  }

  /** The selection's bounding box and its size label. */
  private addSelectionBox(): void {
    const object = this.activeObject.get();
    const cache = this.selectionBounds;
    if (object !== cache.object || (object && object.selection.revision !== cache.revision)) {
      this.selectionBounds = {
        object,
        revision: object?.selection.revision ?? -1,
        box: object?.selection.getBounds() ?? null,
      };
      const box = this.selectionBounds.box;
      this.selectionInfo.set(
        object && box
          ? {
              count: object.selection.count,
              size: [box.maxX - box.minX + 1, box.maxY - box.minY + 1, box.maxZ - box.minZ + 1],
            }
          : null,
      );
    }
    const box = this.selectionBounds.box;
    if (!object || !box || isHidden(object)) {
      if (this.selectionLabel.get()) this.selectionLabel.set(null);
      return;
    }
    const { min, max } = worldBox(box, worldTransform(object));
    this.overlay.addBox(min, max, [0.45, 0.72, 1, 0.9], 1.25);
    const info = this.selectionInfo.get()!;
    const top = this.camera.project([(min[0] + max[0]) / 2, max[1], (min[2] + max[2]) / 2]);
    this.selectionLabel.set(
      top[2] < -1 || top[2] > 1
        ? null
        : {
            x: top[0],
            y: top[1],
            text: `${info.size.join(' × ')} · ${info.count.toLocaleString('en-US')} voxels`,
          },
    );
  }

  /** Tools draw their outlines and handles through this, in world space. */
  private readonly overlaySink: OverlaySink = {
    line: (a, b, color, width) => this.overlay.add(a, b, color, width),
    faceOutline: (object, x, y, z, face, color) =>
      addFaceOutline(this.overlay, worldTransform(object), x, y, z, face, color),
    cellBox: (object, min, max, color, width) => {
      const w = worldBox(
        { minX: min[0], minY: min[1], minZ: min[2], maxX: max[0], maxY: max[1], maxZ: max[2] },
        worldTransform(object),
      );
      this.overlay.addBox(w.min, w.max, color, width);
    },
    screenPath: (points, closed) => {
      this.screenPaths.push({ points: [...points], closed });
    },
    handle: (p, color, size = 10) => {
      // A square: a short segment across the screen as thick as it is long.
      const c = this.camera;
      const e = c.eye();
      const f = c.forward();
      const depth = Math.max(
        0.01,
        (p[0] - e[0]) * f[0] + (p[1] - e[1]) * f[1] + (p[2] - e[2]) * f[2],
      );
      const perPixel =
        c.projection === 'orthographic'
          ? (2 * c.halfHeightAtTarget()) / Math.max(1, c.height)
          : (2 * depth * Math.tan(c.fovY / 2)) / Math.max(1, c.height);
      const half = (size * perPixel) / 2;
      const r: Vec3 = [Math.cos(c.yaw) * half, 0, -Math.sin(c.yaw) * half];
      this.overlay.add(
        [p[0] - r[0], p[1] - r[1], p[2] - r[2]],
        [p[0] + r[0], p[1] + r[1], p[2] + r[2]],
        color,
        size,
      );
    },
  };

  /** Chunk outlines of the edited object and the line where the slice cuts it. */
  private addViewAids(view: ViewSettings): void {
    const object = this.activeObject.get();
    if (!object || isHidden(object)) return;
    const t = worldTransform(object);
    if (view.chunks) {
      for (const key of object.volume.chunkKeys()) {
        const x = keyX(key) * CHUNK_SIZE;
        const y = keyY(key) * CHUNK_SIZE;
        const z = keyZ(key) * CHUNK_SIZE;
        const w = worldBox(
          {
            minX: x,
            minY: y,
            minZ: z,
            maxX: x + CHUNK_SIZE - 1,
            maxY: y + CHUNK_SIZE - 1,
            maxZ: z + CHUNK_SIZE - 1,
          },
          t,
        );
        this.overlay.addBox(w.min, w.max, CHUNK_LINE, 1);
      }
    }
    const slice = this.slice.get();
    const box = object.volume.getBounds();
    if (slice && box) {
      // The cut drawn as a rectangle around the object, on the plane between kept and hidden.
      const w = worldBox(box, t);
      const a = slice.axis;
      const level = slice.dir > 0 ? slice.at + 1 : slice.at;
      const [u, v] = a === 0 ? [1, 2] : a === 1 ? [0, 2] : [0, 1];
      const pad = 1;
      const point = (pu: number, pv: number): Vec3 => {
        const p: Vec3 = [0, 0, 0];
        p[a] = level;
        p[u] = pu;
        p[v] = pv;
        return p;
      };
      const lo = [w.min[u]! - pad, w.min[v]! - pad];
      const hi = [w.max[u]! + pad, w.max[v]! + pad];
      const corners = [
        point(lo[0]!, lo[1]!),
        point(hi[0]!, lo[1]!),
        point(hi[0]!, hi[1]!),
        point(lo[0]!, hi[1]!),
      ];
      for (let i = 0; i < 4; i++)
        this.overlay.add(corners[i]!, corners[(i + 1) % 4]!, SLICE_LINE, 2);
    }
  }

  private buildOverlay(view: ViewSettings): void {
    const batch = this.overlay;
    batch.clear();
    this.screenPaths = [];
    if (view.axes) addAxes(batch, this.camera);
    this.overlayTop.clear();
    if (this.mode.get() === 'scene') {
      for (const node of this.selectedNodes.get()) {
        const b = worldBounds([node]);
        if (b && !isHidden(node))
          batch.addBox(
            [b.minX, b.minY, b.minZ],
            [b.maxX + 1, b.maxY + 1, b.maxZ + 1],
            SELECTED_NODE,
            2,
          );
      }
      this.gizmo.draw(this.overlayTop);
    } else this.tools.overlay(this.overlaySink);
    this.screenOverlay.set(this.screenPaths);
    this.addSelectionBox();
    this.addViewAids(view);
    const object = this.activeObject.get();
    const box = view.bounds && object && !isHidden(object) ? object.volume.getBounds() : null;
    if (box && object) {
      const { min, max } = worldBox(box, worldTransform(object));
      this.rulerLabels.set(addRuler(batch, this.camera, min, max, hexToRgb(view.gridColor)));
    } else if (this.rulerLabels.get().length > 0) {
      this.rulerLabels.set([]);
    }
  }

  private frame(now: number): void {
    this.frameHandle = 0;
    const renderer = this.renderer;
    if (!renderer) return;
    const start = performance.now();

    const moving = now - this.lastMotionAt < MOTION_WINDOW_MS;
    const interval = now - this.lastFrameAt;
    if (moving && interval < 250) {
      this.governor.sample(interval);
      this.intervalAverage = this.intervalAverage
        ? this.intervalAverage * 0.9 + interval * 0.1
        : interval;
    } else if (!moving) {
      this.governor.settle();
      this.intervalAverage = 0;
    }
    this.lastFrameAt = now;

    if (this.cameraControl.update(now, Math.min(interval, 50))) this.markMotion();
    this.doc.flush();
    // Read the size here rather than trusting the last resize event: the first frame may run
    // before the observer reports anything.
    const width = Math.max(1, renderer.canvas.clientWidth);
    const height = Math.max(1, renderer.canvas.clientHeight);
    renderer.resize(width, height, pixelRatio(window.devicePixelRatio, this.governor.scale));
    this.camera.width = width;
    this.camera.height = height;
    if (this.fitPending) {
      this.fitPending = false;
      this.fitScene();
    }
    this.camera.update();
    const c = this.camera;
    this.cameraPose.set({
      yaw: c.yaw,
      pitch: c.pitch,
      projection: c.projection,
      target: [c.target[0], c.target[1], c.target[2]],
      distance: c.distance,
      fov: c.fovY / DEG,
    });
    this.syncSelectionOverlay();
    const floating = this.tools.floating;
    renderer.setOverlays(floating ? [floating.object] : [], [
      // A floating piece is the selection while it moves: it gets the selection tint itself.
      { object: floating ? floating.object : this.selectionOverlay, mode: 'select' },
      { object: this.tools.ghost, mode: this.mode.get() === 'model' ? this.tools.ghostMode : null },
      ...this.onionGhosts(),
    ]);
    renderer.setSlice(this.slice.get());
    renderer.updateMeshes(this.camera, SYNC_MESH_BUDGET_MS);
    const view = withViewColors(this.view.get(), this.scheme.get());
    this.buildOverlay(view);
    const active = this.activeObject.get();
    const planes =
      active && !isHidden(active) ? mirrorQuads(this.tools.mirrorPlanes(), active) : [];
    this.stepBatch(renderer, interval, now);
    if (this.rendering.get()) {
      this.renderFrame(renderer, interval, now);
      this.deliverCaptures(renderer.canvas);
      this.frames++;
      return;
    }
    const drawn = renderer.render(
      this.camera,
      this.doc.scene.objects(),
      view,
      this.overlay,
      planes,
      this.overlayTop,
      this.mode.get() === 'model' ? active : null,
    );
    this.drawRenderWindow(renderer, interval, now);
    this.deliverCaptures(renderer.canvas);
    this.frames++;

    // Workers call back when they finish; main-thread meshing needs the next frame itself.
    if (renderer.meshing && !this.workers) this.requestFrame();
    if (moving) {
      // Once motion stops, draw one more frame at full resolution.
      clearTimeout(this.settleTimer);
      this.settleTimer = window.setTimeout(() => this.requestFrame(), MOTION_WINDOW_MS + 10);
    }

    if (start - this.lastStatsAt > STATS_INTERVAL_MS || !moving) {
      this.lastStatsAt = start;
      this.stats.set({
        frames: this.frames,
        fps: this.intervalAverage ? Math.round(1000 / this.intervalAverage) : 0,
        cpuMs: performance.now() - start,
        renderScale: this.governor.scale,
        drawCalls: drawn.drawCalls,
        quads: drawn.quads,
        culled: drawn.culled,
        gpuMB: renderer.meshes.vertexBytes / (1024 * 1024),
        meshing: renderer.meshing,
      });
    }
  }
}

/** The first object inside a node, depth first. */
function firstObject(node: SceneNode): VoxelObject | null {
  if (node.kind === 'object') return node;
  for (const child of node.children) {
    const found = firstObject(child);
    if (found) return found;
  }
  return null;
}

/** A path-traced picture and what it was started for. */
interface TracedPicture {
  tracer: PathTracer;
  picture: Accumulation;
  /** The camera and the light it holds samples of. */
  camera: string;
  light: string;
}

/** More passes per frame while frames stay quick, fewer when they do not. */
function adaptPasses(passes: number, interval: number, most: number): number {
  if (interval > 0 && interval < 20) return Math.min(most, passes + 1);
  if (interval > 34) return Math.max(1, passes - 1);
  return passes;
}

/** A side of a saved frame, whole pixels within what the GPU and memory allow. */
function clampSide(n: number): number {
  return Math.max(16, Math.min(MAX_FRAME_SIDE, Math.round(n) || 16));
}

/** Pictures being saved one after another, and what becomes of them. */
interface RenderBatch {
  label: string;
  /** Each picture: its view, the animation frame (null: as shown) and the sun's turn. */
  shots: { view: CameraView; frame: number | null; sunYaw: number | null }[];
  width: number;
  height: number;
  settings: RenderSettings;
  finish: (images: Uint8ClampedArray<ArrayBuffer>[]) => Promise<void>;
  index: number;
  job: FrameJob | null;
  images: Uint8ClampedArray<ArrayBuffer>[];
  /** The animation frame shown before, to come back to. */
  frameBefore: number;
}

/** The sun turned as far as the view: the light stays put relative to the camera. */
function sunFollowing(s: RenderSettings, from: CameraView, to: CameraView): number {
  const turned = s.sunYaw + ((to.yaw - from.yaw) * 180) / Math.PI;
  return ((turned % 360) + 360) % 360;
}
