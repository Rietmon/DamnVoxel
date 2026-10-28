import { FACE_NORMALS } from '../coords';
import { cellsOperation, type EditAction } from '../operation';
import { isHidden, isLocked } from '../scene';
import { VoxelTransaction } from '../voxel-edit';
import { COLOR_FIELD } from './adjust';
import { brushTarget } from './brush';
import { bezierPoints, curveCells, type P3, simplify, splinePoints } from './curve';
import {
  effectiveAction,
  type OverlaySink,
  type Tool,
  type ToolContext,
  type ToolEvent,
  type ToolHit,
} from './tool';

export type CurveMode = 'arc' | 'stroke';

export const CURVE_TITLES: Record<CurveMode, string> = { arc: 'Arc', stroke: 'Spline' };

/** How the curve was laid out, kept so “Adjust” can rebuild it. */
interface Layout {
  mode: CurveMode;
  points: P3[];
  /** The way the arc bows: the start face's normal. */
  normal: P3;
}

/**
 * The curve tool: drag from A to B for an arc that bows out of the surface, or draw a stroke
 * that becomes a smooth spline. It is a line of voxels as thick as the brush, applied on
 * release; the bend, the smoothing, the thickness and the colour can be changed afterwards.
 */
export class CurveTool implements Tool {
  readonly id = 'curve';
  readonly cursor = 'crosshair';
  private layout: Layout | null = null;
  private hover: ToolHit | null = null;
  private action: EditAction = 'add';

  handle(e: ToolEvent, ctx: ToolContext): void {
    switch (e.phase) {
      case 'hover':
        this.hover = Number.isFinite(e.x) ? ctx.pick(ctx.rayAt(e.x, e.y)) : null;
        ctx.hint(
          ctx.settings.curveMode === 'arc'
            ? 'Arc: drag from the start to the end'
            : 'Spline: draw a line, it will be smoothed',
        );
        ctx.requestRender();
        break;
      case 'down':
        this.begin(e, ctx);
        break;
      case 'move':
        this.extend(e, ctx);
        break;
      case 'up':
        this.apply(ctx);
        break;
      case 'cancel':
        this.layout = null;
        ctx.preview(null);
        break;
    }
  }

  key(code: string, ctx: ToolContext): boolean {
    if (code !== 'Escape' || !this.layout) return false;
    this.layout = null;
    ctx.preview(null);
    return true;
  }

  overlay(sink: OverlaySink, ctx: ToolContext): void {
    const hit = this.hover;
    if (hit && !this.layout && ctx.object)
      sink.faceOutline(ctx.object, hit.x, hit.y, hit.z, hit.face, [1, 0.62, 0.26, 1]);
  }

  deactivate(ctx: ToolContext): void {
    this.layout = null;
    this.hover = null;
    ctx.preview(null);
  }

  private pointAt(hit: ToolHit | null): P3 | null {
    if (!hit) return null;
    const c =
      this.action === 'add' ? brushTarget(hit, 'add') : hit.onPlane ? null : [hit.x, hit.y, hit.z];
    return c ? [c[0]! + 0.5, c[1]! + 0.5, c[2]! + 0.5] : null;
  }

  private begin(e: ToolEvent, ctx: ToolContext): void {
    this.action = effectiveAction(ctx.settings.action, e.shift);
    const hit = ctx.pick(ctx.rayAt(e.x, e.y));
    const p = this.pointAt(hit);
    if (!p || !hit) return;
    const n = FACE_NORMALS[hit.onPlane ? 2 : hit.face]!;
    this.layout = { mode: ctx.settings.curveMode, points: [p], normal: [n[0], n[1], n[2]] };
    this.preview(ctx);
  }

  private extend(e: ToolEvent, ctx: ToolContext): void {
    const l = this.layout;
    if (!l) {
      this.handle({ ...e, phase: 'hover' }, ctx);
      return;
    }
    const p = this.pointAt(ctx.pick(ctx.rayAt(e.x, e.y)));
    if (!p) return;
    const last = l.points.at(-1)!;
    if (p.every((v, i) => v === last[i])) return;
    if (l.mode === 'arc') l.points = [l.points[0]!, p];
    else l.points.push(p);
    this.preview(ctx);
  }

  /** Cells for a layout with the given numbers. */
  private cells(l: Layout, thickness: number, bend: number, smooth: number): number[] {
    const pts = l.points;
    if (pts.length < 2) return curveCells(pts, thickness);
    if (l.mode === 'arc') {
      const [a, b] = [pts[0]!, pts.at(-1)!];
      const mid: P3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      // A quadratic Bézier reaches half way to its control point: double the bend.
      const control: P3 = [0, 1, 2].map((i) => mid[i]! + l.normal[i]! * bend * 2) as P3;
      return curveCells(bezierPoints(a, control, b), thickness);
    }
    return curveCells(splinePoints(simplify(pts, smooth)), thickness);
  }

  /** The bend an arc gets by default: a quarter of its span. */
  private defaultBend(l: Layout): number {
    const [a, b] = [l.points[0]!, l.points.at(-1)!];
    return Math.round(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / 4);
  }

  private preview(ctx: ToolContext): void {
    const l = this.layout;
    if (!l) return;
    const cells = this.cells(l, ctx.settings.brushSize, this.defaultBend(l), 1.5);
    ctx.preview(cellsOperation(this.action, ctx.settings.color, cells));
    ctx.requestRender();
  }

  private apply(ctx: ToolContext): void {
    const l = this.layout;
    this.layout = null;
    ctx.preview(null);
    const object = ctx.object;
    if (!l || !object || l.points.length < 2) return;
    if (isLocked(object) || isHidden(object)) {
      ctx.hint('The object is locked or hidden');
      return;
    }
    const action = this.action;
    const values = {
      thickness: ctx.settings.brushSize,
      bend: this.defaultBend(l),
      smooth: 1.5,
      color: ctx.settings.color,
    };
    const op = (v: Record<string, number>) =>
      cellsOperation(action, v.color!, this.cells(l, v.thickness!, v.bend!, v.smooth!));
    const tx = new VoxelTransaction();
    ctx.apply(op(values), tx);
    const label = l.mode === 'arc' ? 'Arc' : 'Spline';
    ctx.commit(tx, label);
    ctx.offerAdjustment({
      title: label,
      object,
      fields: [
        { key: 'thickness', label: 'Thickness', min: 1, max: 32 },
        l.mode === 'arc'
          ? { key: 'bend', label: 'Bend', min: -128, max: 128 }
          : { key: 'smooth', label: 'Smoothing', min: 0, max: 20 },
        COLOR_FIELD,
      ],
      values,
      label: () => label,
      operation: op,
    });
    ctx.requestRender();
  }
}
