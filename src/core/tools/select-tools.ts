import { SelectionMask } from '../selection';
import { SelectionTransaction, type SelectMode, selectModeOf } from '../selection-edit';
import { boxRegion, clickRegion, insidePolygon, screenRegion } from './select-regions';
import type { Cell } from './shapes';
import type { OverlaySink, Tool, ToolContext, ToolEvent, ToolHit } from './tool';

export const SELECT_LABELS: Record<SelectMode, string> = {
  replace: 'Select',
  add: 'Add to selection',
  subtract: 'Subtract from selection',
  intersect: 'Intersect selection',
};

const MODE_HINT = 'Shift — add, Alt — subtract, Shift+Alt — intersect';
const OUTLINE = [0.45, 0.72, 1, 1];
/** A drag shorter than this is a click. */
const CLICK_PX = 3;

/** Combines a region into the active object's selection as one history step. */
export function commitRegion(ctx: ToolContext, region: SelectionMask, mode: SelectMode): void {
  const object = ctx.object;
  if (!object) return;
  const tx = new SelectionTransaction(object);
  tx.combine(region, mode);
  ctx.commitSelection(tx, SELECT_LABELS[mode]);
}

/** The voxel under a point as a one-voxel region (empty over air: a click there deselects). */
function pointRegion(e: ToolEvent, ctx: ToolContext): SelectionMask {
  const region = new SelectionMask();
  const hit = ctx.pick(ctx.rayAt(e.x, e.y));
  if (hit && !hit.onPlane) region.set(hit.x, hit.y, hit.z, true);
  return region;
}

/** Rectangle or lasso on screen: selects every filled voxel inside, through the whole depth. */
export class ScreenSelectTool implements Tool {
  readonly id: string;
  readonly cursor = 'crosshair';
  private points: [number, number][] = [];
  private mode: SelectMode = 'replace';

  constructor(readonly shape: 'rect' | 'lasso') {
    this.id = shape === 'rect' ? 'select-rect' : 'select-lasso';
  }

  handle(e: ToolEvent, ctx: ToolContext): void {
    switch (e.phase) {
      case 'hover':
        ctx.hint(`${this.shape === 'rect' ? 'Rectangle' : 'Lasso'} on screen · ${MODE_HINT}`);
        return;
      case 'down':
        this.points = [[e.x, e.y]];
        this.mode = selectModeOf(e.shift, e.alt, ctx.settings.selectMode);
        return;
      case 'move': {
        if (this.points.length === 0) return;
        if (this.shape === 'rect') this.points = [this.points[0]!, [e.x, e.y]];
        else {
          const last = this.points.at(-1)!;
          if (Math.hypot(e.x - last[0], e.y - last[1]) >= 2) this.points.push([e.x, e.y]);
        }
        ctx.requestRender();
        return;
      }
      case 'up':
        // Escape may have dropped the drag already.
        if (this.points.length > 0) this.finish(e, ctx);
        return;
      case 'cancel':
        this.points = [];
        ctx.requestRender();
        return;
    }
  }

  key(code: string, ctx: ToolContext): boolean {
    if (code !== 'Escape' || this.points.length === 0) return false;
    this.points = [];
    ctx.requestRender();
    return true;
  }

  overlay(sink: OverlaySink): void {
    if (this.points.length < 2) return;
    sink.screenPath(this.outline(), true);
  }

  private outline(): [number, number][] {
    if (this.shape === 'lasso') return this.points;
    // A click has a start point only: a rectangle of zero size.
    const [x0, y0] = this.points[0]!;
    const [x1, y1] = this.points[1] ?? this.points[0]!;
    return [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ];
  }

  private finish(e: ToolEvent, ctx: ToolContext): void {
    const points = this.outline();
    this.points = [];
    ctx.requestRender();
    const object = ctx.object;
    const project = ctx.screenProjector();
    if (!object || !project) return;
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const box: [number, number, number, number] = [
      Math.min(...xs),
      Math.min(...ys),
      Math.max(...xs),
      Math.max(...ys),
    ];
    if (box[2] - box[0] < CLICK_PX && box[3] - box[1] < CLICK_PX) {
      commitRegion(ctx, pointRegion(e, ctx), this.mode);
      return;
    }
    const inside =
      this.shape === 'rect'
        ? (x: number, y: number) => x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3]
        : (x: number, y: number) => insidePolygon(points, x, y);
    commitRegion(ctx, screenRegion(object, project, inside, box), this.mode);
  }
}

/** A 3D box between two voxels picked on the model: selects the filled voxels inside. */
export class BoxSelectTool implements Tool {
  readonly id = 'select-box';
  readonly cursor = 'crosshair';
  private a: Cell | null = null;
  private b: Cell | null = null;
  private mode: SelectMode = 'replace';

  handle(e: ToolEvent, ctx: ToolContext): void {
    switch (e.phase) {
      case 'hover':
        ctx.hint(`Box select: from voxel to voxel · ${MODE_HINT}`);
        return;
      case 'down': {
        const hit = ctx.pick(ctx.rayAt(e.x, e.y));
        if (!hit) return;
        this.a = this.b = cellOf(hit);
        this.mode = selectModeOf(e.shift, e.alt, ctx.settings.selectMode);
        this.preview(ctx);
        return;
      }
      case 'move': {
        if (!this.a) return;
        const hit = ctx.pick(ctx.rayAt(e.x, e.y));
        if (hit) this.b = cellOf(hit);
        this.preview(ctx);
        return;
      }
      case 'up': {
        const box = this.box();
        this.a = this.b = null;
        ctx.previewSelection(null);
        if (box && ctx.object) commitRegion(ctx, boxRegion(ctx.object, box[0], box[1]), this.mode);
        return;
      }
      case 'cancel':
        this.a = this.b = null;
        ctx.previewSelection(null);
        return;
    }
  }

  key(code: string, ctx: ToolContext): boolean {
    if (code !== 'Escape' || !this.a) return false;
    this.a = this.b = null;
    ctx.previewSelection(null);
    return true;
  }

  overlay(sink: OverlaySink, ctx: ToolContext): void {
    const box = this.box();
    if (box && ctx.object) sink.cellBox(ctx.object, box[0], box[1], OUTLINE, 1.5);
  }

  private box(): [Cell, Cell] | null {
    const { a, b } = this;
    if (!a || !b) return null;
    return [
      [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])],
      [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])],
    ];
  }

  private preview(ctx: ToolContext): void {
    const box = this.box();
    if (!box || !ctx.object) return;
    ctx.previewSelection(boxRegion(ctx.object, box[0], box[1]), this.mode === 'subtract');
    ctx.requestRender();
  }
}

/** A cell for a box corner: the voxel hit, or the floor cell above the construction plane. */
function cellOf(hit: ToolHit): Cell {
  if (!hit.onPlane) return [hit.x, hit.y, hit.z];
  return [hit.x, hit.y + 1, hit.z];
}

/** Click to select a connected solid, a flat face or a patch of one colour (magic wand). */
export class RegionSelectTool implements Tool {
  readonly id = 'select-region';
  readonly cursor = 'crosshair';
  private previewKey = '';

  handle(e: ToolEvent, ctx: ToolContext): void {
    const object = ctx.object;
    if (!object) return;
    if (e.phase === 'hover' || e.phase === 'move') {
      const hit = Number.isFinite(e.x) ? ctx.pick(ctx.rayAt(e.x, e.y)) : null;
      const mode = ctx.settings.regionMode;
      const key =
        hit && !hit.onPlane
          ? [
              hit.x,
              hit.y,
              hit.z,
              mode === 'face' ? hit.face : '',
              mode,
              object.volume.revision,
            ].join('|')
          : '';
      if (key !== this.previewKey) {
        this.previewKey = key;
        ctx.previewSelection(
          hit && key ? clickRegion(object, hit.x, hit.y, hit.z, hit.face, mode) : null,
        );
      }
      const what = mode === 'volume' ? 'connected volume' : mode === 'face' ? 'face' : 'color';
      ctx.hint(`Magic wand: ${what} · ${MODE_HINT}`);
      ctx.requestRender();
      return;
    }
    if (e.phase !== 'down') return;
    const hit = ctx.pick(ctx.rayAt(e.x, e.y));
    const region =
      hit && !hit.onPlane
        ? clickRegion(object, hit.x, hit.y, hit.z, hit.face, ctx.settings.regionMode)
        : new SelectionMask();
    this.previewKey = '';
    ctx.previewSelection(null);
    commitRegion(ctx, region, selectModeOf(e.shift, e.alt, ctx.settings.selectMode));
  }

  settingsChanged(ctx: ToolContext): void {
    this.previewKey = '';
    ctx.previewSelection(null);
  }

  deactivate(ctx: ToolContext): void {
    this.previewKey = '';
    ctx.previewSelection(null);
  }
}
