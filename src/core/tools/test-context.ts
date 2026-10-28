import { VoxelDocument } from '../document';
import type { Command } from '../history';
import { applyModifiers, type Modifier } from '../modifiers';
import { executeOperation, type Operation } from '../operation';
import { type PickSource, pickConstructionPlane, pickVoxel } from '../picking';
import { buildGhost } from '../preview';
import type { VoxelObject } from '../scene';
import { type SelectionMask, selectionToVolume } from '../selection';
import type { SelectionTransaction } from '../selection-edit';
import { VoxelVolume } from '../volume';
import { VoxelTransaction } from '../voxel-edit';
import type { Adjustment } from './adjust';
import type { Floating } from './move';
import type { ScreenProjector } from './select-regions';
import {
  DEFAULT_TOOL_SETTINGS,
  type GhostMode,
  type OverlaySink,
  type ToolContext,
  type ToolEvent,
  type ToolHit,
  type ToolRay,
  type ToolSettings,
  toolHit,
  type Vec3,
} from './tool';

/**
 * A ToolContext for tests: the camera looks straight down, one screen pixel is one voxel, so
 * screen (x, y) is world column (x, z). Everything else is the real core.
 */
export class TestContext implements ToolContext {
  readonly doc = VoxelDocument.createEmpty();
  readonly object: VoxelObject = this.doc.scene.objects()[0]!;
  settings: ToolSettings = { ...DEFAULT_TOOL_SETTINGS, color: 5 };
  readonly ghost = new VoxelVolume();
  ghostMode: GhostMode | null = null;
  live = false;
  lastHint: string | null = null;
  /** The modifier chain, as the editor builds it from settings. */
  modifiers: Modifier[] = [];
  /** Height the camera looks down from. */
  eyeHeight = 100;
  /** Screen scale: pixels per voxel. */
  pixelsPerVoxel = 1;

  rayAt(x: number, y: number): ToolRay {
    const s = this.pixelsPerVoxel;
    return { origin: [(x + 0.5) / s, this.eyeHeight, (y + 0.5) / s], dir: [0, -1, 0], x, y };
  }

  /**
   * Like a camera tilted a little towards −Z: one voxel of height moves a point one pixel up the
   * screen, so drags along a vertical normal can be measured.
   */
  project(p: readonly number[]): [number, number] {
    const s = this.pixelsPerVoxel;
    return [p[0]! * s - 0.5, (p[2]! - p[1]!) * s - 0.5];
  }

  pick(ray: ToolRay, source?: PickSource): ToolHit | null {
    const hit = pickVoxel([this.object], ray.origin, ray.dir, source ? () => source : undefined);
    if (hit) return toolHit(hit, ray, false);
    const plane = pickConstructionPlane(this.object, ray.origin, ray.dir);
    return plane ? toolHit(plane, ray, true) : null;
  }

  preview(op: Operation | null, mode?: GhostMode): void {
    if (!op) {
      this.ghost.clear();
      this.ghostMode = null;
      return;
    }
    const modified = applyModifiers(op, this.modifiers);
    this.ghostMode = mode ?? buildGhost(modified, this.object.volume, this.ghost);
    if (mode) buildGhost(modified, this.object.volume, this.ghost);
  }

  screenProjector(): ScreenProjector {
    return (x, y, z, out) => {
      const [sx, sy] = this.project([x, y, z]);
      out[0] = sx;
      out[1] = sy;
      return true;
    };
  }

  previewSelection(region: SelectionMask | null, subtract = false): void {
    if (!region) {
      this.ghost.clear();
      this.ghostMode = null;
      return;
    }
    selectionToVolume(region, this.ghost);
    this.ghostMode = subtract ? 'erase' : 'select';
  }

  commitSelection(tx: SelectionTransaction, label: string): void {
    const cmd = tx.commit(label);
    if (cmd) this.doc.history.push(cmd);
  }

  floating: Floating | null = null;

  pushCommand(command: Command): void {
    this.doc.history.push(command);
  }

  revertLast(command: Command): boolean {
    if (this.doc.history.last !== command) return false;
    this.doc.history.undo();
    return true;
  }

  setFloating(floating: Floating | null): void {
    this.floating = floating;
  }

  setLive(live: boolean): void {
    this.live = live;
  }

  apply(op: Operation, tx: VoxelTransaction): void {
    executeOperation(applyModifiers(op, this.modifiers), {
      get: (x, y, z) => this.object.volume.get(x, y, z),
      set: (x, y, z, v) => {
        tx.set(this.object, x, y, z, v);
      },
    });
  }

  commit(tx: VoxelTransaction, label: string): void {
    const cmd = tx.commit(label);
    if (cmd) this.doc.history.push(cmd);
  }

  /** Ropes a tool asked for. */
  ropes: [Vec3, Vec3][] = [];

  makeRope(a: Vec3, b: Vec3): void {
    this.ropes.push([a, b]);
  }

  /** The last adjustment a tool offered. */
  adjustment: Adjustment | null = null;

  offerAdjustment(adjustment: Adjustment): void {
    this.adjustment = adjustment;
  }

  /** Redoes the last step with other numbers, as the app does. */
  adjust(values: Record<string, number>): void {
    const a = this.adjustment!;
    this.doc.history.undo();
    const tx = new VoxelTransaction();
    this.apply(a.operation(values), tx);
    this.commit(tx, a.label(values));
  }

  setColor(id: number): void {
    this.settings = { ...this.settings, color: id };
  }

  hint(text: string | null): void {
    this.lastHint = text;
  }

  requestRender(): void {}

  /** A tool event at a screen point. */
  event(
    phase: ToolEvent['phase'],
    x: number,
    y: number,
    extra: Partial<ToolEvent> = {},
  ): ToolEvent {
    const pressure = extra.pressure ?? 1;
    return {
      phase,
      x,
      y,
      samples: [{ x, y, pressure }],
      pressure,
      button: 'primary',
      shift: false,
      ctrl: false,
      alt: false,
      ...extra,
    };
  }

  /** Filled cells of the object as "x,y,z" strings, sorted. */
  cells(): string[] {
    const out: string[] = [];
    const b = this.object.volume.getBounds();
    if (!b) return out;
    for (let y = b.minY; y <= b.maxY; y++)
      for (let z = b.minZ; z <= b.maxZ; z++)
        for (let x = b.minX; x <= b.maxX; x++)
          if (this.object.volume.get(x, y, z)) out.push(`${x},${y},${z}`);
    return out;
  }

  newTransaction(): VoxelTransaction {
    return new VoxelTransaction();
  }
}

/** An overlay sink that counts what a tool draws, by kind. */
export class RecordingSink implements OverlaySink {
  readonly calls: Record<string, number> = {};
  readonly paths: { points: readonly [number, number][]; closed: boolean }[] = [];

  private count(kind: string): void {
    this.calls[kind] = (this.calls[kind] ?? 0) + 1;
  }

  line(): void {
    this.count('line');
  }

  faceOutline(): void {
    this.count('faceOutline');
  }

  cellBox(): void {
    this.count('cellBox');
  }

  handle(): void {
    this.count('handle');
  }

  screenPath(points: readonly [number, number][], closed: boolean): void {
    this.count('screenPath');
    this.paths.push({ points, closed });
  }
}
