import type { Command } from '../core/history';
import { mirrorModifier } from '../core/mirror';
import { applyModifiers, type Modifier } from '../core/modifiers';
import { executeOperation, type Operation } from '../core/operation';
import {
  colorLockModifier,
  type PatternOptions,
  patternModifier,
  rampAround,
  shadeModifier,
} from '../core/paint';
import { type PickSource, pickConstructionPlane, pickVoxel } from '../core/picking';
import { buildGhost } from '../core/preview';
import { isHidden, NO_LAYER, type VoxelObject, worldTransform } from '../core/scene';
import { SelectionMask, selectionToVolume } from '../core/selection';
import { type SelectionTransaction, selectionMaskModifier } from '../core/selection-edit';
import { sliceModifier } from '../core/slice';
import type { AdjustField, Adjustment } from '../core/tools/adjust';
import { BrushTool } from '../core/tools/brush';
import { PIPETTE_CURSOR, PipetteTool, ReplaceTool } from '../core/tools/color-tools';
import { CurveTool } from '../core/tools/curve-tool';
import { FaceTool } from '../core/tools/face';
import { FillTool } from '../core/tools/fill-tool';
import { type Floating, MoveTool } from '../core/tools/move';
import { RopeTool } from '../core/tools/rope-tool';
import { SculptTool } from '../core/tools/sculpt-tool';
import { SdfTool } from '../core/tools/sdf-tool';
import type { ScreenProjector } from '../core/tools/select-regions';
import { BoxSelectTool, RegionSelectTool, ScreenSelectTool } from '../core/tools/select-tools';
import { ShapeTool } from '../core/tools/shape-tool';
import type { ShapeKind } from '../core/tools/shapes';
import { type Pattern, StampTool } from '../core/tools/stamp-tool';
import {
  DEFAULT_TOOL_SETTINGS,
  type GhostMode,
  type OverlaySink,
  type Tool,
  type ToolContext,
  type ToolEvent,
  type ToolHit,
  type ToolRay,
  type ToolSettings,
  toolHit,
  type Vec3,
} from '../core/tools/tool';
import { localToWorld } from '../core/transform';
import { type VolumeReader, VoxelVolume } from '../core/volume';
import { VoxelTransaction } from '../core/voxel-edit';
import type { ToolPointerEvent } from '../input/types';
import { mat4, multiply } from '../render/math';
import { modelMatrix } from '../render/renderer';
import type { Editor } from './editor';
import { MIRROR_COLORS, type MirrorPlane, mirrorPlanes } from './mirror-handles';
import { writable } from './store';

/** A mirror handle is grabbed within this many pixels. */
const MIRROR_HANDLE_RADIUS = 14;

interface MirrorDrag {
  axis: number;
  start2: number;
  startX: number;
  startY: number;
  /** Screen pixels per voxel along the plane normal. */
  dir: [number, number];
}

/**
 * Runs the active tool: turns pointer events into tool events with rays, and gives tools the
 * services they need (picking, preview ghost, transactions, history). Implements ToolContext.
 */
export class ToolController implements ToolContext {
  readonly settingsStore = writable<ToolSettings>({ ...DEFAULT_TOOL_SETTINGS });
  readonly activeToolId = writable('brush');
  /** A piece floats in the move tool (a paste waiting to be placed, or a drag). */
  readonly holding = writable(false);
  /** What the tool would do now, for the status bar. */
  readonly hintText = writable<string | null>(null);
  /** The preview of the next edit: a detached object drawn as a translucent ghost. */
  readonly ghost: VoxelObject = {
    kind: 'object',
    id: -1,
    name: 'preview',
    hidden: false,
    locked: true,
    transform: { x: 0, y: 0, z: 0, orientation: 0 },
    parent: null,
    volume: new VoxelVolume(),
    selection: new SelectionMask(),
    layer: NO_LAYER,
  };
  ghostMode: GhostMode | null = null;

  private readonly tools = new Map<string, Tool>();
  /** The stamp, whose piece is set from outside (the selection, an object). */
  readonly stamp = new StampTool();
  /** The stamp's piece, for the context bar. */
  readonly stampInfo = writable<{ name: string; size: readonly number[] } | null>(null);
  /** An Alt + press is a pipette pick: the rest of that gesture goes nowhere. */
  private pipetteGesture = false;
  private mirrorDrag: MirrorDrag | null = null;
  private altHeld = false;

  constructor(private readonly editor: Editor) {
    const shapes: ShapeKind[] = [
      'box',
      'line',
      'rect',
      'ellipse',
      'sphere',
      'cylinder',
      'cone',
      'pyramid',
      'torus',
      'stairs',
      'arch',
    ];
    for (const tool of [
      new BrushTool(),
      this.stamp,
      new SculptTool(),
      new FaceTool(),
      ...shapes.map((k) => new ShapeTool(k)),
      new SdfTool(),
      new RopeTool(),
      new CurveTool(),
      new PipetteTool(),
      new ReplaceTool(),
      new FillTool(),
      new ScreenSelectTool('rect'),
      new ScreenSelectTool('lasso'),
      new BoxSelectTool(),
      new RegionSelectTool(),
      new MoveTool(),
    ]) {
      this.tools.set(tool.id, tool);
    }
    this.settingsStore.subscribe(() => this.tool.settingsChanged?.(this));
  }

  get tool(): Tool {
    return this.tools.get(this.activeToolId.get())!;
  }

  // --- ToolContext ---

  get doc() {
    return this.editor.doc;
  }

  get object(): VoxelObject | null {
    return this.editor.activeObject.get();
  }

  get settings(): ToolSettings {
    return this.settingsStore.get();
  }

  rayAt(x: number, y: number): ToolRay {
    const camera = this.editor.camera;
    camera.update();
    const ray = camera.rayAt(x, y);
    return { origin: ray.origin, dir: ray.dir, x, y };
  }

  project(world: readonly number[]): [number, number] | null {
    const camera = this.editor.camera;
    camera.update();
    const s = camera.project([world[0]!, world[1]!, world[2]!]);
    return s[2] < -1 || s[2] > 1 ? null : [s[0], s[1]];
  }

  pick(ray: ToolRay, source?: PickSource): ToolHit | null {
    const object = this.object;
    if (!object) return null;
    const hit = pickVoxel([object], ray.origin, ray.dir, (o) => this.editor.pickSource(o, source));
    if (hit) return toolHit(hit, ray, false);
    const plane = pickConstructionPlane(object, ray.origin, ray.dir);
    return plane ? toolHit(plane, ray, true) : null;
  }

  preview(op: Operation | null, mode?: GhostMode): void {
    const object = this.object;
    if (!op || !object) {
      if (!this.ghost.volume.isEmpty) this.ghost.volume.clear();
      this.ghostMode = null;
    } else {
      this.ghost.transform = worldTransform(object);
      const action = buildGhost(
        applyModifiers(op, this.modifiers()),
        object.volume,
        this.ghost.volume,
      );
      this.ghostMode = mode ?? action;
    }
    this.editor.requestFrame();
  }

  screenProjector(): ScreenProjector | null {
    const object = this.object;
    if (!object) return null;
    const camera = this.editor.camera;
    camera.update();
    const m = multiply(mat4(), camera.viewProj, modelMatrix(worldTransform(object)));
    const w = camera.width;
    const h = camera.height;
    return (x, y, z, out) => {
      const cw = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
      const cx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
      const cy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
      const inv = 1 / (Math.abs(cw) < 1e-9 ? 1e-9 : cw);
      out[0] = (cx * inv * 0.5 + 0.5) * w;
      out[1] = (0.5 - cy * inv * 0.5) * h;
      return cw > 0;
    };
  }

  previewSelection(region: SelectionMask | null, subtract = false): void {
    const object = this.object;
    if (!region || !object) {
      if (!this.ghost.volume.isEmpty) this.ghost.volume.clear();
      this.ghostMode = null;
    } else {
      this.ghost.transform = worldTransform(object);
      selectionToVolume(region, this.ghost.volume);
      this.ghostMode = subtract ? 'erase' : 'select';
    }
    this.editor.requestFrame();
  }

  commitSelection(tx: SelectionTransaction, label: string): void {
    const command = tx.commit(label);
    if (command) {
      this.doc.history.push(command);
      this.doc.notifySelection(tx.object);
    }
    this.editor.requestFrame();
  }

  /** The floating piece the move tool carries, drawn in place of the selection. */
  floating: Floating | null = null;

  pushCommand(command: Command): void {
    this.doc.history.push(command);
    if (this.object) this.doc.notifySelection(this.object);
    this.editor.requestFrame();
  }

  revertLast(command: Command): boolean {
    if (this.doc.history.last !== command) return false;
    this.doc.history.undo();
    if (this.object) this.doc.notifySelection(this.object);
    return true;
  }

  setFloating(floating: Floating | null): void {
    this.floating = floating;
    this.holding.set(floating !== null);
    this.editor.requestFrame();
  }

  /** Puts the tool aside (scene mode): finishes its work and clears its previews. */
  suspend(): void {
    this.tool.deactivate?.(this);
    this.preview(null);
    this.previewSelection(null);
    this.hint(null);
  }

  /** Lets the tool drop unfinished work before an undo; true when it did. */
  cancelPending(): boolean {
    return this.tool.cancelPending?.(this) ?? false;
  }

  setLive(live: boolean): void {
    this.editor.strokeActive = live;
  }

  apply(op: Operation, tx: VoxelTransaction, object = this.object): void {
    if (!object) return;
    // Shades and locks read the model as it was before the gesture.
    executeOperation(applyModifiers(op, this.modifiers(tx.baseOf(object), object)), {
      get: (x, y, z) => object.volume.get(x, y, z),
      set: (x, y, z, value) => {
        tx.set(object, x, y, z, value);
      },
    });
  }

  commit(tx: VoxelTransaction, label: string): void {
    const command = tx.commit(label);
    if (command) this.doc.history.push(command);
  }

  /**
   * The step a tool offered to redo with other numbers: valid while the history's last step is
   * `command` (or, after an adjustment that changed nothing, still `below`).
   */
  private lastAdjustment: {
    adjustment: Adjustment;
    command: Command | null;
    below: Command | null;
  } | null = null;
  /** What the «adjust last» panel shows: the step's title, fields and current numbers. */
  readonly adjustment = writable<{
    title: string;
    fields: readonly AdjustField[];
    values: Readonly<Record<string, number>>;
  } | null>(null, () => false);

  makeRope(a: Vec3, b: Vec3): void {
    void this.editor.createRope(a, b);
  }

  offerAdjustment(adjustment: Adjustment): void {
    const command = this.doc.history.last;
    if (!command) return;
    this.lastAdjustment = { adjustment, command, below: null };
    this.adjustment.set({
      title: adjustment.title,
      fields: adjustment.fields,
      values: adjustment.values,
    });
  }

  /** Drops the panel once its step is no longer the last one (undo, another edit). */
  checkAdjustment(): void {
    const a = this.lastAdjustment;
    if (!a) return;
    const last = this.doc.history.last;
    if (last === (a.command ?? a.below)) return;
    this.lastAdjustment = null;
    this.adjustment.set(null);
  }

  /** Redoes the adjustable step with one number changed. */
  adjust(key: string, value: number): void {
    const a = this.lastAdjustment;
    if (!a) return;
    const history = this.doc.history;
    if (history.last !== (a.command ?? a.below)) {
      this.checkAdjustment();
      return;
    }
    const values = { ...a.adjustment.values, [key]: value };
    if (a.command) {
      history.undo();
      a.below = history.last;
    }
    let command: Command | null;
    if (a.adjustment.run) {
      command = a.adjustment.run(values);
    } else {
      const tx = new VoxelTransaction();
      this.apply(a.adjustment.operation(values), tx, a.adjustment.object);
      command = tx.commit(a.adjustment.label(values));
    }
    if (command) history.push(command);
    a.command = command;
    a.adjustment = { ...a.adjustment, values };
    this.adjustment.set({ title: a.adjustment.title, fields: a.adjustment.fields, values });
    this.editor.requestFrame();
  }

  /** Sets what the stamp puts down. */
  setStamp(pattern: Pattern): void {
    this.stamp.pattern = pattern;
    this.stampInfo.set({ name: pattern.name, size: pattern.size });
    this.tool.settingsChanged?.(this);
  }

  setColor(id: number): void {
    if (id === this.settings.color) return;
    this.settingsStore.update((s) => ({ ...s, color: id }));
    this.editor.toast(`Color ${id}`);
  }

  hint(text: string | null): void {
    this.hintText.set(text);
  }

  requestRender(): void {
    this.editor.requestFrame();
  }

  /** The modifier chain every operation goes through: mirror, then the selection mask. */
  modifiers(reader: VolumeReader | null = null, object = this.object): Modifier[] {
    const s = this.settings;
    const base = reader ?? object?.volume ?? null;
    const palette = this.doc.palette;
    return [
      mirrorModifier(s.mirror),
      // After the mirror: mirrored cells get the pattern and shade of where they land.
      patternModifier(object ? this.patternOptions(object) : null),
      base
        ? shadeModifier(base, palette, s.shade === 'none' ? null : s.shade, s.shadeBy)
        : (op) => op,
      base && s.colorLock.length > 0 ? colorLockModifier(base, new Set(s.colorLock)) : (op) => op,
      object && s.editMask !== 'all'
        ? selectionMaskModifier(object.selection, s.editMask)
        : (op) => op,
      // Last: mirrored copies above the slice are dropped too.
      sliceModifier(object ? this.editor.clipOf(object) : null),
    ];
  }

  /** The ramp a pattern paints with: the palette selection, or colours around the current one. */
  paintRamp(): number[] {
    const palette = this.doc.palette;
    const selected = this.editor.paletteSelection.get();
    if (selected.length >= 2) {
      const order = palette.displayOrder();
      return [...selected].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    }
    return rampAround(palette, this.settings.color);
  }

  private patternOptions(object: VoxelObject): PatternOptions | null {
    const s = this.settings;
    if (s.paintPattern === 'solid') return null;
    const b = object.volume.getBounds();
    const [from, to] = !b
      ? [0, 32]
      : s.gradientAxis === 0
        ? [b.minX, b.maxX]
        : s.gradientAxis === 1
          ? [b.minY, b.maxY]
          : [b.minZ, b.maxZ];
    return {
      pattern: s.paintPattern,
      colors:
        s.paintPattern === 'splatter' ? rampAround(this.doc.palette, s.color, 1) : this.paintRamp(),
      scale: s.patternScale,
      axis: s.gradientAxis,
      from,
      to,
    };
  }

  // --- Editor side ---

  hasTool(id: string): boolean {
    return this.tools.has(id);
  }

  setTool(id: string): void {
    // Picking a tool means editing voxels.
    if (this.tools.has(id)) this.editor.setMode('model');
    if (!this.tools.has(id) || id === this.activeToolId.get()) return;
    this.tool.deactivate?.(this);
    this.activeToolId.set(id);
    this.refreshCursor();
  }

  /** The tool's cursor, or the eyedropper while Alt turns a click into a pipette pick. */
  refreshCursor(): void {
    this.editor.setToolCursor(
      this.altHeld && this.tool.id !== 'pipette' ? PIPETTE_CURSOR : this.tool.cursor,
    );
  }

  /** Alt pressed or released over the viewport. */
  setAlt(alt: boolean): void {
    if (alt === this.altHeld) return;
    this.altHeld = alt;
    this.refreshCursor();
  }

  updateSettings(patch: Partial<ToolSettings>): void {
    this.settingsStore.update((s) => ({ ...s, ...patch }));
  }

  /** Planes of the live mirror for the active object, in its local space. */
  mirrorPlanes(): MirrorPlane[] {
    const object = this.object;
    return object ? mirrorPlanes(this.settings.mirror, object.volume.getBounds()) : [];
  }

  private mirrorHandleAt(x: number, y: number): MirrorPlane | null {
    const object = this.object;
    if (!object || !Number.isFinite(x)) return null;
    let best: MirrorPlane | null = null;
    let bestDistance = MIRROR_HANDLE_RADIUS;
    for (const plane of this.mirrorPlanes()) {
      const s = this.project(localToWorld(worldTransform(object), ...plane.centre));
      if (!s) continue;
      const d = Math.hypot(s[0] - x, s[1] - y);
      if (d <= bestDistance) {
        bestDistance = d;
        best = plane;
      }
    }
    return best;
  }

  /** Drags a mirror plane along its axis in half-voxel steps (keel and gap positions alike). */
  private handleMirrorDrag(e: ToolPointerEvent): boolean {
    const drag = this.mirrorDrag;
    if (drag) {
      if (e.phase === 'move') {
        const [dx, dy] = drag.dir;
        const len2 = dx * dx + dy * dy;
        if (len2 > 1e-6) {
          const along = ((e.x - drag.startX) * dx + (e.y - drag.startY) * dy) / len2;
          const center2 = [...this.settings.mirror.center2] as [number, number, number];
          center2[drag.axis] = drag.start2 + Math.round(along * 2);
          this.updateSettings({ mirror: { ...this.settings.mirror, center2 } });
          this.hint(`Mirror plane: ${center2[drag.axis]! / 2}`);
        }
      } else if (e.phase === 'up' || e.phase === 'cancel') {
        this.mirrorDrag = null;
        this.hint(null);
      }
      return true;
    }
    const object = this.object;
    const plane = this.mirrorHandleAt(e.x, e.y);
    if (e.phase === 'hover') {
      this.editor.setToolCursor(plane ? 'move' : this.altHeld ? PIPETTE_CURSOR : this.tool.cursor);
      return false;
    }
    if (e.phase !== 'down' || e.button !== 'primary' || e.alt || !plane || !object) return false;
    const n = [0, 0, 0];
    n[plane.axis] = 1;
    const a = this.project(localToWorld(worldTransform(object), ...plane.centre));
    const b = this.project(
      localToWorld(
        worldTransform(object),
        plane.centre[0] + n[0]!,
        plane.centre[1] + n[1]!,
        plane.centre[2] + n[2]!,
      ),
    );
    this.mirrorDrag = {
      axis: plane.axis,
      start2: this.settings.mirror.center2[plane.axis]!,
      startX: e.x,
      startY: e.y,
      dir: a && b ? [b[0] - a[0], b[1] - a[1]] : [0, 0],
    };
    return true;
  }

  handlePointer(e: ToolPointerEvent): void {
    if (this.handleMirrorDrag(e)) return;
    // Alt + click picks a colour in every drawing tool, as in MagicaVoxel. Selection tools use
    // Alt to subtract.
    if (
      e.phase === 'down' &&
      e.alt &&
      !e.ctrl &&
      e.button === 'primary' &&
      !this.tool.id.startsWith('select') &&
      this.tool.id !== 'move'
    ) {
      const hit = Number.isFinite(e.x) ? this.pick(this.rayAt(e.x, e.y)) : null;
      if (hit && !hit.onPlane) this.setColor(hit.value);
      this.pipetteGesture = true;
      return;
    }
    if (this.pipetteGesture) {
      if (e.phase === 'up' || e.phase === 'cancel') this.pipetteGesture = false;
      return;
    }
    // Only a pen's pressure means anything; the secondary button is the Shift of a pen.
    const pen = e.pointerType === 'pen';
    const event: ToolEvent = {
      phase: e.phase,
      x: e.x,
      y: e.y,
      samples: pen ? e.samples : e.samples.map((s) => ({ ...s, pressure: 1 })),
      pressure: pen ? e.pressure : 1,
      button: e.button,
      shift: e.shift !== (e.button === 'secondary'),
      ctrl: e.ctrl,
      alt: e.alt,
    };
    this.tool.handle(event, this);
  }

  /** Keys the tool may want first (Enter, Escape, arrows); true when used. */
  handleKey(code: string, shift = false): boolean {
    return this.tool.key?.(code, this, shift) ?? false;
  }

  /** Turns or mirrors the selection with the move tool, so it can still be placed. */
  orientSelection(orientation: number): void {
    this.setTool('move');
    const tool = this.tool;
    if (tool instanceof MoveTool) tool.orient(this, orientation);
  }

  overlay(sink: OverlaySink): void {
    this.tool.overlay?.(sink, this);
    const object = this.object;
    if (!object || isHidden(object)) return;
    for (const plane of this.mirrorPlanes()) {
      const color = [...MIRROR_COLORS[plane.axis]!.slice(0, 3), 1];
      const w = plane.corners.map((c) => localToWorld(worldTransform(object), ...c));
      for (let i = 0; i < 4; i++) sink.line(w[i]!, w[(i + 1) % 4]!, color, 1.25);
      sink.handle(localToWorld(worldTransform(object), ...plane.centre), color, 12);
    }
  }
}
