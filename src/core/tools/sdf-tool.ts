import type { Command } from '../history';
import { cellsOperation, type EditAction } from '../operation';
import { isHidden, isLocked, type VoxelObject, worldTransform } from '../scene';
import { localToWorld } from '../transform';
import { VoxelTransaction } from '../voxel-edit';
import { brushTarget } from './brush';
import { type SdfPrimitive, type Vec3, voxelizeSdf } from './sdf';
import {
  effectiveAction,
  type OverlaySink,
  type Tool,
  type ToolContext,
  type ToolEvent,
  type ToolHit,
} from './tool';

export type SdfShape = 'sphere' | 'box' | 'stroke';

export const SDF_TITLES: Record<SdfShape, string> = {
  sphere: 'Ball',
  box: 'Rounded box',
  stroke: 'Stroke',
};

/**
 * SDF brushes (core/tools/sdf.ts). A drag from the model puts a shape: a ball or a rounded box
 * as large as the drag, or a tube along the stroke as thick as the brush. Shapes made one after
 * another melt into each other: each new one replaces the previous step with the blend of all
 * of them, until Enter, Escape or another tool ends the session.
 */
export class SdfTool implements Tool {
  readonly id = 'sdf';
  readonly cursor = 'crosshair';

  private session: {
    object: VoxelObject;
    action: EditAction;
    shapes: SdfPrimitive[];
    command: Command | null;
    /** Begun on the construction plane: nothing goes below this layer, as with the brush. */
    floor: number | null;
  } | null = null;
  private drag: {
    start: Vec3;
    /** Screen pixels per voxel near the start: drag lengths become sizes. */
    pixels: number;
    x: number;
    y: number;
    shapes: SdfPrimitive[];
    last: Vec3;
  } | null = null;
  private hover: ToolHit | null = null;
  private action: EditAction = 'add';

  handle(e: ToolEvent, ctx: ToolContext): void {
    switch (e.phase) {
      case 'hover':
        this.hover = Number.isFinite(e.x) ? ctx.pick(ctx.rayAt(e.x, e.y)) : null;
        this.action = effectiveAction(ctx.settings.action, e.shift);
        ctx.hint(
          this.session
            ? 'SDF: new shapes will melt into the previous ones · Enter — finish'
            : 'SDF: drag from the model for a shape; several in a row melt together',
        );
        ctx.requestRender();
        break;
      case 'down':
        this.begin(e, ctx);
        break;
      case 'move':
        this.update(e, ctx);
        break;
      case 'up':
        this.commit(ctx);
        break;
      case 'cancel':
        this.drag = null;
        ctx.preview(null);
        break;
    }
  }

  key(code: string, ctx: ToolContext): boolean {
    if ((code === 'Enter' || code === 'Escape') && (this.session || this.drag)) {
      this.drag = null;
      this.session = null;
      ctx.preview(null);
      ctx.hint('SDF: shapes finished');
      return true;
    }
    return false;
  }

  overlay(sink: OverlaySink, ctx: ToolContext): void {
    const hit = this.hover;
    if (hit && !this.drag && ctx.object)
      sink.faceOutline(ctx.object, hit.x, hit.y, hit.z, hit.face, [1, 0.62, 0.26, 1]);
  }

  deactivate(ctx: ToolContext): void {
    this.drag = null;
    this.session = null;
    this.hover = null;
    ctx.preview(null);
  }

  settingsChanged(ctx: ToolContext): void {
    if (this.drag) this.showPreview(ctx);
  }

  private centre(hit: ToolHit, action: EditAction): Vec3 | null {
    const cell =
      action === 'add' ? brushTarget(hit, 'add') : hit.onPlane ? null : [hit.x, hit.y, hit.z];
    return cell ? [cell[0]! + 0.5, cell[1]! + 0.5, cell[2]! + 0.5] : null;
  }

  private begin(e: ToolEvent, ctx: ToolContext): void {
    const object = ctx.object;
    if (!object || isLocked(object) || isHidden(object)) {
      ctx.hint(object ? 'The object is locked or hidden' : 'No object to edit');
      return;
    }
    const action = effectiveAction(ctx.settings.action, e.shift);
    const hit = ctx.pick(ctx.rayAt(e.x, e.y));
    const start = hit ? this.centre(hit, action) : null;
    if (!start) return;
    // Still the same blend: this object, this action, and its step is the last one.
    const s = this.session;
    if (!s || s.object !== object || s.action !== action || ctx.doc.history.last !== s.command) {
      this.session = { object, action, shapes: [], command: null, floor: null };
    }
    if (hit?.onPlane && this.session!.shapes.length === 0)
      this.session!.floor = Math.floor(start[1]);
    this.action = action;
    this.drag = {
      start,
      pixels: this.pixelsPerVoxel(start, ctx),
      x: e.x,
      y: e.y,
      shapes: [],
      last: start,
    };
    this.update(e, ctx);
  }

  /** How many screen pixels one voxel spans near a local point. */
  private pixelsPerVoxel(p: Vec3, ctx: ToolContext): number {
    const object = ctx.object;
    if (!object) return 1;
    const t = worldTransform(object);
    const o = ctx.project(localToWorld(t, ...p));
    if (!o) return 1;
    let best = 0;
    for (let a = 0; a < 3; a++) {
      const q: Vec3 = [...p];
      q[a] = q[a]! + 1;
      const s = ctx.project(localToWorld(t, ...q));
      if (s) best = Math.max(best, Math.hypot(s[0] - o[0], s[1] - o[1]));
    }
    return Math.max(best, 1e-3);
  }

  private update(e: ToolEvent, ctx: ToolContext): void {
    const drag = this.drag;
    if (!drag) return;
    const shape = ctx.settings.sdfShape;
    const size = Math.max(1, Math.hypot(e.x - drag.x, e.y - drag.y) / drag.pixels);
    const round = Math.max(0.5, ctx.settings.sdfBlend / 2);
    if (shape === 'sphere') {
      drag.shapes = [{ kind: 'sphere', c: drag.start, r: Math.max(0.5, size) }];
    } else if (shape === 'box') {
      const h = Math.max(0.5, size);
      drag.shapes = [{ kind: 'box', c: drag.start, h: [h, h, h], round: Math.min(round, h) }];
    } else {
      // A tube: a new segment once the pointer has moved half a radius along the surface.
      const r = Math.max(0.5, ctx.settings.brushSize / 2);
      const hit = Number.isFinite(e.x) ? ctx.pick(ctx.rayAt(e.x, e.y)) : null;
      const p = hit ? this.centre(hit, this.action) : null;
      if (drag.shapes.length === 0) drag.shapes.push({ kind: 'sphere', c: drag.start, r });
      if (p && Math.hypot(p[0] - drag.last[0], p[1] - drag.last[1], p[2] - drag.last[2]) >= r / 2) {
        drag.shapes.push({ kind: 'capsule', a: drag.last, b: p, r });
        drag.last = p;
      }
    }
    this.showPreview(ctx);
  }

  /** The blend of the session's shapes and the dragged ones, kept above the floor. */
  private cells(ctx: ToolContext): number[] | null {
    const all = [...(this.session?.shapes ?? []), ...(this.drag?.shapes ?? [])];
    const cells = voxelizeSdf(all, ctx.settings.sdfBlend);
    const floor = this.session?.floor ?? null;
    if (!cells || floor === null) return cells;
    const out: number[] = [];
    for (let i = 0; i < cells.length; i += 3)
      if (cells[i + 1]! >= floor) out.push(cells[i]!, cells[i + 1]!, cells[i + 2]!);
    return out;
  }

  private showPreview(ctx: ToolContext): void {
    const object = ctx.object;
    const cells = this.cells(ctx);
    if (!object || !cells) {
      ctx.preview(null);
      if (!cells) ctx.hint('SDF: the shape is too large');
      return;
    }
    // Only what changes: new cells for add, filled ones for erase.
    const add = this.action === 'add';
    const changed: number[] = [];
    for (let i = 0; i < cells.length; i += 3) {
      const filled = object.volume.get(cells[i]!, cells[i + 1]!, cells[i + 2]!) !== 0;
      if (filled !== add) changed.push(cells[i]!, cells[i + 1]!, cells[i + 2]!);
    }
    ctx.preview(cellsOperation(this.action, ctx.settings.color, changed), add ? 'add' : 'erase');
    ctx.requestRender();
  }

  private commit(ctx: ToolContext): void {
    const drag = this.drag;
    const session = this.session;
    this.drag = null;
    ctx.preview(null);
    if (!drag || !session) return;
    this.drag = drag;
    const cells = this.cells(ctx);
    this.drag = null;
    if (!cells) {
      ctx.hint('SDF: the shape is too large');
      return;
    }
    // The blend so far is replaced by the blend with the new shape: one step in history.
    if (session.command) ctx.revertLast(session.command);
    const tx = new VoxelTransaction();
    ctx.apply(cellsOperation(session.action, ctx.settings.color, cells), tx);
    ctx.commit(tx, 'SDF');
    session.shapes = [...session.shapes, ...drag.shapes];
    session.command = ctx.doc.history.last;
    ctx.requestRender();
  }
}
