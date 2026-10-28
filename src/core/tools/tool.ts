import type { VoxelDocument } from '../document';
import type { Command } from '../history';
import { DEFAULT_MIRROR, type MirrorSettings } from '../mirror';
import type { EditAction, Operation } from '../operation';
import type { PaintPattern, Shade, ShadeSource } from '../paint';
import type { PickSource, VoxelPick } from '../picking';
import { type VoxelObject, worldTransform } from '../scene';
import type { SelectionMask } from '../selection';
import type { EditMask, SelectionTransaction, SelectMode } from '../selection-edit';
import { worldToLocal } from '../transform';
import type { VoxelTransaction } from '../voxel-edit';
import type { Adjustment } from './adjust';
import type { CurveMode } from './curve-tool';
import type { FillMode } from './fill-tool';
import type { Floating } from './move';
import type { SculptDirection, SculptMode } from './sculpt';
import type { SdfShape } from './sdf-tool';
import type { RegionMode, ScreenProjector } from './select-regions';

/**
 * Tools are state machines over device-independent events (docs/architecture.md,
 * "Tools"). They live in core: no DOM, no WebGL, tested in Node with synthetic rays.
 */

export type Vec3 = [number, number, number];

/** A world-space ray through a viewport point. */
export interface ToolRay {
  origin: Vec3;
  /** Unit length. */
  dir: Vec3;
  /** The viewport point, CSS pixels. */
  x: number;
  y: number;
}

export interface ToolEvent {
  phase: 'hover' | 'down' | 'move' | 'up' | 'cancel';
  x: number;
  y: number;
  /** Viewport points since the previous event, the last one is (x, y). */
  samples: { x: number; y: number; pressure: number }[];
  /** 0…1: a pen's pressure; 1 for a mouse or a finger. */
  pressure: number;
  /** Secondary (pen barrel button, a finger held during a pen stroke) arrives as Shift too. */
  button: 'primary' | 'secondary';
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

/** What is under a ray: a voxel, or the construction plane acting as a floor (value 0). */
export interface ToolHit extends Omit<VoxelPick, 'value'> {
  value: number;
  onPlane: boolean;
  /** The exact hit point in object-local coordinates (on the hit face). */
  point: Vec3;
}

/** Builds a ToolHit: adds the local hit point to a pick. */
export function toolHit(
  pick: Omit<VoxelPick, 'value'> & { value?: number },
  ray: ToolRay,
  onPlane: boolean,
): ToolHit {
  const w: Vec3 = [
    ray.origin[0] + ray.dir[0] * pick.t,
    ray.origin[1] + ray.dir[1] * pick.t,
    ray.origin[2] + ray.dir[2] * pick.t,
  ];
  const point = worldToLocal(worldTransform(pick.object), w[0], w[1], w[2]);
  return { ...pick, value: pick.value ?? 0, onPlane, point };
}

export type BrushShape = 'cube' | 'sphere';
/** Volume: a 3D blob; plane: a flat stamp across the face; surface: only the surface layer. */
export type BrushMode = 'volume' | 'plane' | 'surface';

/**
 * Where a stroke may go after its first stamp: anywhere on the model, on the plane of the first
 * hit (it continues in the air, like drawing on glass), or along one axis through the first cell.
 */
export type StrokeLock = 'none' | 'plane' | 'x' | 'y' | 'z';

export interface ToolSettings {
  action: EditAction;
  /** Current palette id for add and paint. */
  color: number;
  brushShape: BrushShape;
  brushMode: BrushMode;
  /** Brush size in voxels, 1…64. */
  brushSize: number;
  /** Pen pressure scales the brush: a light touch draws small, full pressure — brushSize. */
  pressureSize: boolean;
  /** Face tool: the face region also stops at a different colour. */
  faceByColor: boolean;
  lock: StrokeLock;
  /** Live mirror of every operation, in the active object's space. */
  mirror: MirrorSettings;
  /** Selection mode without modifiers (touch screens switch it with buttons). */
  selectMode: SelectMode;
  /** What a magic-wand click selects. */
  regionMode: RegionMode;
  /** Stamp: the piece keeps its own colours (else all in the current colour). */
  stampOwnColor: boolean;
  /** Stamp: the piece stands up from the face it is put on (else always upright). */
  stampAlign: boolean;
  /** Stamp: the turn and mirror of the piece, an orientation index. */
  stampTurn: number;
  /** Stamp: a stroke lays pieces touching (dense) or one piece apart. */
  stampSpacing: 'dense' | 'apart';
  /** Edits only inside the selection, only outside it, or anywhere. */
  editMask: EditMask;
  /** Colours whose voxels paint and erase may change; empty: any (core/paint.ts). */
  colorLock: readonly number[];
  /** Paint shades each voxel instead of laying the colour. */
  shade: Shade | 'none';
  shadeBy: ShadeSource;
  /** How added and painted voxels get their colours: one, or a pattern over a ramp. */
  paintPattern: PaintPattern;
  /** Noise and cell size of a pattern, voxels. */
  patternScale: number;
  gradientAxis: 0 | 1 | 2;
  /** Rope tool: what a new rope is, how loose and how thick. */
  ropeKind: 'rope' | 'chain' | 'cable';
  ropeSlack: number;
  ropeThickness: number;
  /** Curve: an arc from a drag, or a smoothed freehand spline. */
  curveMode: CurveMode;
  /** SDF brush: the shape a drag makes. */
  sdfShape: SdfShape;
  /** SDF brush: how far shapes melt into each other, voxels (0: a hard join). */
  sdfBlend: number;
  /** Fill: what a click takes (core/tools/fill-tool.ts). */
  fillMode: FillMode;
  sculptMode: SculptMode;
  sculptDirection: SculptDirection;
  /** Sculpt: new voxels take the current colour (else the colour of their neighbours). */
  sculptUseColor: boolean;
}

export const DEFAULT_TOOL_SETTINGS: ToolSettings = {
  action: 'add',
  color: 1,
  brushShape: 'cube',
  brushMode: 'volume',
  brushSize: 1,
  pressureSize: true,
  faceByColor: false,
  lock: 'none',
  mirror: DEFAULT_MIRROR,
  selectMode: 'replace',
  regionMode: 'volume',
  stampOwnColor: true,
  stampAlign: true,
  stampTurn: 0,
  stampSpacing: 'dense',
  editMask: 'all',
  colorLock: [],
  shade: 'none',
  shadeBy: 'palette',
  paintPattern: 'solid',
  patternScale: 6,
  gradientAxis: 1,
  ropeKind: 'rope',
  ropeSlack: 1.15,
  ropeThickness: 2,
  curveMode: 'arc',
  sdfShape: 'sphere',
  sdfBlend: 4,
  fillMode: 'color',
  sculptMode: 'grow',
  sculptDirection: 'normal',
  sculptUseColor: false,
};

/** What the preview ghost means: drawn in the colour it will get, red for erase. */
export type GhostMode = 'add' | 'erase' | 'paint' | 'select' | 'onionPrev' | 'onionNext';

/** Lines, outlines and handles a tool wants drawn this frame, in world space. */
export interface OverlaySink {
  line(a: Vec3, b: Vec3, color: readonly number[], width?: number): void;
  /** Outline of one face of a voxel of an object. */
  faceOutline(
    object: VoxelObject,
    x: number,
    y: number,
    z: number,
    face: number,
    color: readonly number[],
  ): void;
  /** Outline of a box of voxels of an object (bounds inclusive). */
  cellBox(
    object: VoxelObject,
    min: Vec3,
    max: Vec3,
    color: readonly number[],
    width?: number,
  ): void;
  /** A square handle of `size` CSS pixels at a world point. */
  handle(p: Vec3, color: readonly number[], size?: number): void;
  /** A path on the screen (selection rectangle, lasso), viewport pixels. */
  screenPath(points: readonly [number, number][], closed: boolean): void;
}

/** Services a tool gets from the editor. */
export interface ToolContext {
  readonly doc: VoxelDocument;
  /** The object being edited, or null when there is none. */
  readonly object: VoxelObject | null;
  readonly settings: ToolSettings;
  rayAt(x: number, y: number): ToolRay;
  /** Viewport point of a world point, CSS pixels; null when it is behind the camera. */
  project(world: readonly number[]): [number, number] | null;
  /** The voxel under a ray in the active object, or the construction plane. */
  pick(ray: ToolRay, source?: PickSource): ToolHit | null;
  /** Shows what an operation would do as a ghost; null hides it. */
  preview(op: Operation | null, mode?: GhostMode): void;
  /** Projects active-object points to the viewport, or null without an object. */
  screenProjector(): ScreenProjector | null;
  /** Shows a region as the selection would get it (red when it would be subtracted). */
  previewSelection(region: SelectionMask | null, subtract?: boolean): void;
  /** Ends a selection change as one history step. */
  commitSelection(tx: SelectionTransaction, label: string): void;
  /** Records a command whose effect is already in the document. */
  pushCommand(command: Command): void;
  /** Undoes `command` if it is still the last step (a tool redoing its own step); true if so. */
  revertLast(command: Command): boolean;
  /** Shows a floating piece of voxels in place of the selection, or nothing. */
  setFloating(floating: Floating | null): void;
  /** A live gesture writes into the document: its chunks get meshed within the frame. */
  setLive(live: boolean): void;
  /** Applies an operation to the active object through the modifiers, into a transaction. */
  apply(op: Operation, tx: VoxelTransaction): void;
  /** Ends a transaction as one history step; nothing happens when it changed nothing. */
  commit(tx: VoxelTransaction, label: string): void;
  /** Hangs a rope between two world points (the editor settles it and adds the object). */
  makeRope(a: Vec3, b: Vec3): void;
  /** The step just committed can be redone with other numbers (core/tools/adjust.ts). */
  offerAdjustment(adjustment: Adjustment): void;
  /** Picks a palette colour (pipette). */
  setColor(id: number): void;
  /** A one-line hint about what the tool does now, for the status bar; null clears it. */
  hint(text: string | null): void;
  requestRender(): void;
}

export interface Tool {
  readonly id: string;
  /** CSS cursor over the viewport. */
  readonly cursor: string;
  handle(event: ToolEvent, ctx: ToolContext): void;
  /** Enter, Escape, arrows… Returns true when the tool used the key. */
  key?(code: string, ctx: ToolContext, shift?: boolean): boolean;
  overlay?(sink: OverlaySink, ctx: ToolContext): void;
  /** The tool is being switched away from: finish or drop pending work. */
  deactivate?(ctx: ToolContext): void;
  /** Settings changed (size, shape, action): refresh the preview. */
  settingsChanged?(ctx: ToolContext): void;
  /** Drops unfinished work instead of an undo (a floating piece); true when there was some. */
  cancelPending?(ctx: ToolContext): boolean;
}

/** The brush size for a pressure: never below 1, full size at full pressure. */
export function pressedSize(settings: ToolSettings, pressure: number): number {
  if (!settings.pressureSize) return settings.brushSize;
  const p = Math.max(0, Math.min(1, pressure));
  return Math.max(1, Math.round(settings.brushSize * p));
}

/** Effective action: Shift turns add into erase and erase into add (MagicaVoxel). */
export function effectiveAction(action: EditAction, shift: boolean): EditAction {
  if (!shift) return action;
  if (action === 'add') return 'erase';
  if (action === 'erase') return 'add';
  return action;
}
