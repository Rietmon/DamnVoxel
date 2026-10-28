import { FACE_NORMALS, faceAxis, faceSign } from '../coords';
import { cellsOperation, type EditAction, type Operation } from '../operation';
import type { PickSource } from '../picking';
import { isHidden, isLocked, worldTransform } from '../scene';
import { dirToLocal, worldToLocal } from '../transform';
import type { VolumeReader } from '../volume';
import { VoxelTransaction } from '../voxel-edit';
import { stampCells } from './stamp';
import {
  effectiveAction,
  type OverlaySink,
  pressedSize,
  type Tool,
  type ToolContext,
  type ToolEvent,
  type ToolHit,
  type ToolSettings,
} from './tool';

/** Screen distance between interpolated stamps of a fast stroke, CSS pixels. */
const STROKE_STEP_PX = 1;

const ACTION_LABELS: Record<EditAction, string> = {
  add: 'Add',
  erase: 'Erase',
  paint: 'Paint',
};

const OUTLINE = [1, 0.62, 0.26, 1];

/**
 * The cell a brush works on for a hit: add goes into the empty cell in front of the face,
 * erase and paint work on the voxel itself (nothing on the construction plane).
 */
export function brushTarget(hit: ToolHit, action: EditAction): [number, number, number] | null {
  if (action === 'add') {
    const n = FACE_NORMALS[hit.face]!;
    return [hit.x + n[0], hit.y + n[1], hit.z + n[2]];
  }
  return hit.onPlane ? null : [hit.x, hit.y, hit.z];
}

/** The brush stamp for a hit with the current brush settings. */
export function brushStamp(
  hit: ToolHit,
  action: EditAction,
  settings: ToolSettings,
  reader: VolumeReader,
): Operation | null {
  const target = brushTarget(hit, action);
  if (!target) return null;
  const cells = stampCells(target, hit.face, hit.point, stampOptions(settings, action), reader);
  return cellsOperation(action, settings.color, clipToPlane(cells, hit));
}

/**
 * The construction plane is a floor, not a wall: a stamp started on it keeps to the side of
 * the plane the camera is on.
 */
function clipToPlane(cells: number[], hit: ToolHit): number[] {
  if (!hit.onPlane) return cells;
  const axis = faceAxis(hit.face);
  const sign = faceSign(hit.face);
  // The first free layer is one step from the virtual floor cell along the normal.
  const floor = hit[axis === 0 ? 'x' : axis === 1 ? 'y' : 'z'] + sign;
  const out: number[] = [];
  for (let i = 0; i < cells.length; i += 3) {
    if ((cells[i + axis]! - floor) * sign >= 0) out.push(cells[i]!, cells[i + 1]!, cells[i + 2]!);
  }
  return out;
}

function stampOptions(settings: ToolSettings, action: EditAction, size = settings.brushSize) {
  return { shape: settings.brushShape, mode: settings.brushMode, size, action };
}

/**
 * Voxel brush: hover shows the future voxels, a press starts a stroke that writes into the
 * document at once (the stroke must show up within the frame) and the whole stroke becomes one
 * history step. The stroke picks against the object as it was before the stroke, so voxels it
 * adds do not pile up towards the camera. Fast pointer moves are filled in on screen so the
 * stroke has no gaps.
 */
export class BrushTool implements Tool {
  readonly id = 'brush';
  readonly cursor = 'crosshair';

  private tx: VoxelTransaction | null = null;
  private base: PickSource | null = null;
  private action: EditAction = 'add';
  private last: { x: number; y: number; pressure: number } | null = null;
  private lastTarget: { cell: [number, number, number]; face: number; size: number } | null = null;
  /** The first stamp of the stroke: what a plane or axis lock holds on to. */
  private anchor: { cell: [number, number, number]; face: number } | null = null;
  private hover: ToolHit | null = null;
  /** What the shown preview was built from; the same key means the same ghost. */
  private previewKey = '';

  handle(e: ToolEvent, ctx: ToolContext): void {
    switch (e.phase) {
      case 'hover':
        this.updateHover(e, ctx);
        break;
      case 'down':
        this.begin(e, ctx);
        break;
      case 'move':
        if (this.tx) this.continueStroke(e, ctx);
        else this.updateHover(e, ctx);
        break;
      case 'up':
        this.finish(ctx, true);
        this.updateHover(e, ctx);
        break;
      case 'cancel':
        this.finish(ctx, false);
        break;
    }
  }

  key(code: string, ctx: ToolContext): boolean {
    if (code === 'Escape' && this.tx) {
      this.finish(ctx, false);
      return true;
    }
    return false;
  }

  overlay(sink: OverlaySink, ctx: ToolContext): void {
    const hit = this.hover;
    if (hit && !this.tx && ctx.object)
      sink.faceOutline(ctx.object, hit.x, hit.y, hit.z, hit.face, OUTLINE);
  }

  deactivate(ctx: ToolContext): void {
    this.finish(ctx, true);
    this.hover = null;
    this.previewKey = '';
    ctx.preview(null);
  }

  settingsChanged(ctx: ToolContext): void {
    this.refreshPreview(ctx, false);
  }

  private updateHover(e: ToolEvent, ctx: ToolContext): void {
    this.hover = Number.isFinite(e.x) ? ctx.pick(ctx.rayAt(e.x, e.y)) : null;
    this.action = effectiveAction(ctx.settings.action, e.shift);
    this.refreshPreview(ctx, e.shift);
  }

  private refreshPreview(ctx: ToolContext, shift: boolean): void {
    const object = ctx.object;
    if (object && (isLocked(object) || isHidden(object))) {
      this.previewKey = '';
      ctx.preview(null);
      ctx.hint('The object is locked or hidden: editing is unavailable');
      return;
    }
    const action = effectiveAction(ctx.settings.action, shift);
    const hit = this.hover;
    // A big brush is expensive to rebuild: skip it while nothing that shapes it changed.
    const s = ctx.settings;
    const key =
      hit && object
        ? [
            action,
            brushTarget(hit, action),
            hit.face,
            hit.onPlane,
            s.brushSize % 2 === 0 ? hit.point.map((v) => v - Math.floor(v) >= 0.5) : '',
            s.brushShape,
            s.brushMode,
            s.brushSize,
            s.color,
            object.id,
            object.volume.revision,
          ].join('|')
        : '';
    if (key !== this.previewKey) {
      this.previewKey = key;
      ctx.preview(hit && object ? brushStamp(hit, action, s, object.volume) : null);
    }
    ctx.hint(
      this.hover
        ? `${ACTION_LABELS[action]} · Shift — ${action === 'erase' ? 'add' : 'erase'}`
        : null,
    );
    ctx.requestRender();
  }

  private begin(e: ToolEvent, ctx: ToolContext): void {
    const object = ctx.object;
    if (!object || isLocked(object) || isHidden(object)) {
      ctx.hint(object ? 'The object is locked or hidden' : 'No object to edit');
      return;
    }
    this.finish(ctx, true);
    this.action = effectiveAction(ctx.settings.action, e.shift);
    const tx = new VoxelTransaction();
    this.tx = tx;
    this.base = { volume: tx.baseOf(object), bounds: object.volume.getBounds() };
    this.last = { x: e.x, y: e.y, pressure: e.pressure };
    this.lastTarget = null;
    this.anchor = null;
    this.hover = null;
    this.previewKey = '';
    ctx.preview(null);
    ctx.setLive(true);
    this.stampAt(e.x, e.y, e.pressure, ctx);
  }

  private continueStroke(e: ToolEvent, ctx: ToolContext): void {
    for (const s of e.samples) {
      const from = this.last ?? s;
      const distance = Math.hypot(s.x - from.x, s.y - from.y);
      const steps = Math.max(1, Math.ceil(distance / STROKE_STEP_PX));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        this.stampAt(
          from.x + (s.x - from.x) * t,
          from.y + (s.y - from.y) * t,
          from.pressure + (s.pressure - from.pressure) * t,
          ctx,
        );
      }
      this.last = { x: s.x, y: s.y, pressure: s.pressure };
    }
  }

  /**
   * Where a locked stroke goes under a viewport point: the cell of the anchor's plane or axis
   * nearest to the pointer ray. Null without a lock or anchor, or when the ray runs parallel.
   */
  private lockedHit(x: number, y: number, ctx: ToolContext): ToolHit | null {
    const anchor = this.anchor;
    const lock = ctx.settings.lock;
    const object = ctx.object;
    if (!anchor || lock === 'none' || !object) return null;
    const ray = ctx.rayAt(x, y);
    const o = worldToLocal(worldTransform(object), ...ray.origin);
    const d = dirToLocal(worldTransform(object), ...ray.dir);
    const cell: [number, number, number] = [...anchor.cell];
    let point: [number, number, number];
    if (lock === 'plane') {
      const axis = faceAxis(anchor.face);
      if (Math.abs(d[axis]!) < 1e-6) return null;
      const t = (cell[axis]! + 0.5 - o[axis]!) / d[axis]!;
      if (t < 0) return null;
      point = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
      for (let a = 0; a < 3; a++) if (a !== axis) cell[a] = Math.floor(point[a]!);
    } else {
      // The point of the axis line nearest to the ray.
      const a = lock === 'x' ? 0 : lock === 'y' ? 1 : 2;
      const p0 = cell.map((v) => v + 0.5);
      const w = [p0[0]! - o[0], p0[1]! - o[1], p0[2]! - o[2]];
      const b = d[a]!;
      const c = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
      const denom = c - b * b;
      if (Math.abs(denom) < 1e-6) return null;
      const dw = d[0] * w[0]! + d[1] * w[1]! + d[2] * w[2]!;
      const s = (b * dw - c * w[a]!) / denom;
      cell[a] = Math.floor(p0[a]! + s);
      point = [cell[0] + 0.5, cell[1] + 0.5, cell[2] + 0.5];
    }
    // As a hit: the cell behind the target along the anchor face, so brushTarget lands on it.
    const n = FACE_NORMALS[anchor.face]!;
    const behind = this.action === 'add' ? [cell[0] - n[0], cell[1] - n[1], cell[2] - n[2]] : cell;
    return {
      object,
      x: behind[0]!,
      y: behind[1]!,
      z: behind[2]!,
      face: anchor.face,
      t: 0,
      value: 0,
      onPlane: false,
      point,
    };
  }

  private stampAt(x: number, y: number, pressure: number, ctx: ToolContext): void {
    if (!this.tx || !this.base) return;
    // A locked stroke follows its plane or axis once the first stamp is down.
    const locked = this.anchor !== null && ctx.settings.lock !== 'none';
    const hit = locked ? this.lockedHit(x, y, ctx) : ctx.pick(ctx.rayAt(x, y), this.base);
    if (!hit) return;
    const target = brushTarget(hit, this.action);
    if (!target) return;
    if (!this.anchor) this.anchor = { cell: target, face: hit.face };
    const last = this.lastTarget;
    const settings = ctx.settings;
    const size = pressedSize(settings, pressure);
    // Consecutive samples over the same cell stamp once (unless pressing harder grew the brush).
    if (last?.cell.every((v, i) => v === target[i]) && size <= last.size) return;
    const options = stampOptions(settings, this.action, size);
    const centers: number[][] = [];
    // On a surface seen at a grazing angle one pixel can skip voxels: stamp along the straight
    // line between two stamps on the same face, as densely as the brush needs.
    if (last && last.face === hit.face) {
      const span = Math.max(...target.map((v, i) => Math.abs(v - last.cell[i]!)));
      const step = Math.max(1, Math.floor(size / 2));
      for (let k = step; k < span; k += step) {
        centers.push(
          target.map((v, i) => Math.round(last.cell[i]! + ((v - last.cell[i]!) * k) / span)),
        );
      }
    }
    centers.push(target);
    const cells: number[] = [];
    for (const c of centers)
      cells.push(...stampCells(c, hit.face, hit.point, options, this.base.volume));
    this.lastTarget = { cell: target, face: hit.face, size };
    ctx.apply(cellsOperation(this.action, settings.color, clipToPlane(cells, hit)), this.tx);
    ctx.requestRender();
  }

  private finish(ctx: ToolContext, keep: boolean): void {
    const tx = this.tx;
    if (!tx) return;
    this.tx = null;
    this.base = null;
    this.last = null;
    if (keep) ctx.commit(tx, ACTION_LABELS[this.action]);
    else tx.cancel();
    ctx.setLive(false);
    ctx.requestRender();
  }
}
