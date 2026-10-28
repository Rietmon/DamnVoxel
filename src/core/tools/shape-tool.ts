import { faceAxis, faceSign } from '../coords';
import { cellsOperation, type EditAction, type Operation } from '../operation';
import { isHidden, isLocked, worldTransform } from '../scene';
import { dirToLocal, localToWorld, worldToLocal } from '../transform';
import { VoxelTransaction } from '../voxel-edit';
import { type AdjustField, COLOR_FIELD } from './adjust';
import { brushTarget } from './brush';
import {
  type Cell,
  type CellBox,
  lineCells,
  type ShapeFrame,
  type ShapeKind,
  shapeCells,
} from './shapes';
import { stampCells } from './stamp';
import {
  effectiveAction,
  type OverlaySink,
  type Tool,
  type ToolContext,
  type ToolEvent,
  type ToolHit,
  type Vec3,
} from './tool';

export const SHAPE_LABELS: Record<ShapeKind, string> = {
  box: 'Box',
  line: 'Line',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  sphere: 'Sphere',
  cylinder: 'Cylinder',
  cone: 'Cone',
  pyramid: 'Pyramid',
  torus: 'Torus',
  stairs: 'Stairs',
  arch: 'Arch',
};

/** Shapes with a height along the base normal; the others stay one layer thick. */
const SOLID: ReadonlySet<ShapeKind> = new Set([
  'box',
  'sphere',
  'cylinder',
  'cone',
  'pyramid',
  'torus',
  'stairs',
  'arch',
]);

/**
 * The height a solid starts with from its base, until Ctrl pulls it: round ones as tall as they
 * are wide, a pyramid half that, a torus a third of its narrower side, stairs at 45°, an arch
 * three quarters of its span. A box stays one layer.
 */
function autoHeight(kind: ShapeKind, widths: number[]): number | null {
  const wide = Math.max(...widths);
  switch (kind) {
    case 'sphere':
    case 'cylinder':
    case 'cone':
    case 'stairs':
      return wide;
    case 'pyramid':
      return Math.ceil(wide / 2);
    case 'torus':
      return Math.max(1, Math.round(Math.min(...widths) / 3));
    case 'arch':
      return Math.max(2, Math.round(wide * 0.75));
    default:
      return null;
  }
}

const OUTLINE_COLOR = [1, 0.62, 0.26, 1];
const FRAME_COLOR = [1, 1, 1, 0.55];

interface Shape {
  action: EditAction;
  /** Normal axis of the base plane. */
  axis: number;
  /** Direction the height grows: out of the surface for add, into it otherwise. */
  sign: 1 | -1;
  /** Base layer along the axis. */
  layer: number;
  /** Footprint corners (for a line: its two ends, anywhere). */
  a: Cell;
  b: Cell;
  /** Layers along the normal, ≥ 1. */
  height: number;
  /** Ctrl pulled the height: round solids no longer follow their base. */
  heightSet: boolean;
  /** Face the line ends were picked on, for thick lines. */
  face: number;
  /** The cell the layout started from: the centre of a symmetric (Alt) layout. */
  start: Cell;
}

interface Drag {
  /** Ctrl turned the drag into a height pull: where that began and the height then. */
  heightFrom: { x: number; y: number; height: number } | null;
  /** Screen pixels per voxel along the base normal. */
  normalScreen: [number, number];
  /** The previous pointer position: a height pull starts there, losing no movement. */
  last: [number, number];
}

/**
 * Shape tools (box, line, rect, ellipse, sphere, cylinder). Drag on a face or the construction
 * plane to lay out the base; holding Ctrl while dragging pulls the height of a box, sphere or
 * cylinder instead. Releasing applies the shape at once: there is never a half-made shape
 * waiting for another click or for Enter. Escape during the drag drops it.
 */
export class ShapeTool implements Tool {
  readonly id: string;
  readonly cursor = 'crosshair';

  private shape: Shape | null = null;
  private drag: Drag | null = null;
  private hover: ToolHit | null = null;

  constructor(readonly kind: ShapeKind) {
    this.id = kind;
  }

  handle(e: ToolEvent, ctx: ToolContext): void {
    switch (e.phase) {
      case 'hover':
        this.hoverAt(e, ctx);
        break;
      case 'down':
        this.press(e, ctx);
        break;
      case 'move':
        this.move(e, ctx);
        break;
      case 'up':
        this.apply(ctx);
        break;
      case 'cancel':
        this.cancel(ctx);
        break;
    }
  }

  key(code: string, ctx: ToolContext): boolean {
    if (code !== 'Escape' || !this.shape) return false;
    this.cancel(ctx);
    return true;
  }

  deactivate(ctx: ToolContext): void {
    this.cancel(ctx);
    this.hover = null;
  }

  settingsChanged(ctx: ToolContext): void {
    if (this.shape) this.preview(ctx);
  }

  overlay(sink: OverlaySink, ctx: ToolContext): void {
    const object = ctx.object;
    if (!object) return;
    const shape = this.shape;
    if (!shape) {
      const hit = this.hover;
      if (hit) sink.faceOutline(object, hit.x, hit.y, hit.z, hit.face, OUTLINE_COLOR);
      return;
    }
    const box = this.box(shape);
    sink.cellBox(object, box.min, box.max, FRAME_COLOR, 1);
  }

  // --- Geometry ---

  /** The height the shape gets: what Ctrl pulled, or as tall as the base for round solids. */
  private height(s: Shape): number {
    const w = [0, 1, 2].filter((a) => a !== s.axis).map((a) => Math.abs(s.a[a]! - s.b[a]!) + 1);
    const auto = autoHeight(this.kind, w);
    return s.heightSet || auto === null ? s.height : auto;
  }

  /** How the solid stands: its base side, and for stairs the way they climb (as dragged). */
  private frame(s: Shape): ShapeFrame {
    const [ua, va] = [0, 1, 2].filter((k) => k !== s.axis) as [number, number];
    const wide = Math.abs(s.b[ua]! - s.a[ua]!) >= Math.abs(s.b[va]! - s.a[va]!) ? ua : va;
    return {
      axis: s.axis,
      baseAtMin: s.sign > 0,
      rise: { axis: wide, sign: s.b[wide]! >= s.a[wide]! ? 1 : -1 },
    };
  }

  private box(s: Shape): CellBox {
    const min: Cell = [
      Math.min(s.a[0], s.b[0]),
      Math.min(s.a[1], s.b[1]),
      Math.min(s.a[2], s.b[2]),
    ];
    const max: Cell = [
      Math.max(s.a[0], s.b[0]),
      Math.max(s.a[1], s.b[1]),
      Math.max(s.a[2], s.b[2]),
    ];
    if (this.kind === 'line') return { min, max };
    const far = s.layer + s.sign * (this.height(s) - 1);
    min[s.axis] = Math.min(s.layer, far);
    max[s.axis] = Math.max(s.layer, far);
    return { min, max };
  }

  private cells(s: Shape, ctx: Pick<ToolContext, 'settings' | 'object'>): number[] {
    if (this.kind !== 'line') return shapeCells(this.kind, this.box(s), s.axis, this.frame(s));
    const line = lineCells(s.a, s.b);
    const size = ctx.settings.brushSize;
    if (size <= 1 || !ctx.object) return line;
    // A thick line: the brush stamped along it.
    const out: number[] = [];
    const options = {
      shape: ctx.settings.brushShape,
      mode: 'volume' as const,
      size,
      action: s.action,
    };
    for (let i = 0; i < line.length; i += 3) {
      const c = [line[i]!, line[i + 1]!, line[i + 2]!];
      out.push(
        ...stampCells(
          c,
          s.face,
          [c[0]! + 0.5, c[1]! + 0.5, c[2]! + 0.5],
          options,
          ctx.object.volume,
        ),
      );
    }
    return out;
  }

  private operation(s: Shape, ctx: ToolContext): Operation {
    return cellsOperation(s.action, ctx.settings.color, this.cells(s, ctx));
  }

  /** The cell under the pointer on the base plane of the shape. */
  private cellOnBase(x: number, y: number, s: Shape, ctx: ToolContext): Cell | null {
    const object = ctx.object;
    if (!object) return null;
    const ray = ctx.rayAt(x, y);
    const o = worldToLocal(worldTransform(object), ...ray.origin);
    const d = dirToLocal(worldTransform(object), ...ray.dir);
    if (Math.abs(d[s.axis]!) < 1e-6) return null;
    const t = (s.layer + 0.5 - o[s.axis]!) / d[s.axis]!;
    if (t < 0) return null;
    const cell = [0, 0, 0].map((_, i) => Math.floor(o[i]! + d[i]! * t)) as Cell;
    cell[s.axis] = s.layer;
    return cell;
  }

  // --- Gestures ---

  private hoverAt(e: ToolEvent, ctx: ToolContext): void {
    if (this.shape) return;
    this.hover = Number.isFinite(e.x) ? ctx.pick(ctx.rayAt(e.x, e.y)) : null;
    ctx.hint(this.hover ? this.idleHint() : null);
    ctx.requestRender();
  }

  private idleHint(): string {
    return SOLID.has(this.kind)
      ? `${SHAPE_LABELS[this.kind]}: drag for the base, with Ctrl — height`
      : `${SHAPE_LABELS[this.kind]}: drag to draw`;
  }

  private press(e: ToolEvent, ctx: ToolContext): void {
    const object = ctx.object;
    if (!object || isLocked(object) || isHidden(object) || e.button !== 'primary') return;
    const hit = ctx.pick(ctx.rayAt(e.x, e.y));
    if (!hit) return;
    const action = effectiveAction(ctx.settings.action, e.shift);
    const target = brushTarget(hit, action);
    if (!target) return;
    const axis = faceAxis(hit.face);
    const outward = faceSign(hit.face);
    const sign = action === 'add' ? outward : (-outward as 1 | -1);
    this.shape = {
      action,
      axis,
      sign,
      layer: target[axis]!,
      a: [...target],
      b: [...target],
      height: 1,
      heightSet: false,
      face: hit.face,
      start: [...target],
    };
    // How one voxel of height looks on screen, for pulling the height with Ctrl.
    const t = worldTransform(object);
    const p: Vec3 = [target[0] + 0.5, target[1] + 0.5, target[2] + 0.5];
    const q: Vec3 = [...p];
    q[axis] += sign;
    const a = ctx.project(localToWorld(t, ...p));
    const b = ctx.project(localToWorld(t, ...q));
    this.drag = {
      heightFrom: null,
      normalScreen: a && b ? [b[0] - a[0], b[1] - a[1]] : [0, 0],
      last: [e.x, e.y],
    };
    this.hover = null;
    this.preview(ctx);
  }

  private move(e: ToolEvent, ctx: ToolContext): void {
    const s = this.shape;
    const drag = this.drag;
    if (!s || !drag) {
      this.hoverAt(e, ctx);
      return;
    }
    if (e.ctrl && !e.alt && SOLID.has(this.kind)) {
      // Ctrl: the base stays, the drag pulls the height along the normal.
      drag.heightFrom ??= { x: drag.last[0], y: drag.last[1], height: this.height(s) };
      const [nx, ny] = drag.normalScreen;
      const len2 = nx * nx + ny * ny;
      if (len2 > 1e-6) {
        const along = ((e.x - drag.heightFrom.x) * nx + (e.y - drag.heightFrom.y) * ny) / len2;
        s.height = Math.max(1, drag.heightFrom.height + Math.round(along));
        s.heightSet = true;
      }
    } else {
      drag.heightFrom = null;
      if (this.kind === 'line') {
        // Line ends follow the model surface.
        const hit = ctx.pick(ctx.rayAt(e.x, e.y));
        const target = hit ? brushTarget(hit, s.action) : null;
        if (target) s.b = target as Cell;
      } else {
        const cell = this.cellOnBase(e.x, e.y, s, ctx);
        if (cell) {
          s.b = cell;
          // Alt lays the base out symmetrically around the start cell: odd sizes; with Ctrl
          // around the start cell's corner: even sizes.
          s.a = e.alt ? mirrored(cell, s.start, s.axis, e.ctrl) : [...s.start];
        }
      }
    }
    drag.last = [e.x, e.y];
    this.preview(ctx);
  }

  private preview(ctx: ToolContext): void {
    const s = this.shape;
    ctx.preview(s ? this.operation(s, ctx) : null);
    if (s) {
      const box = this.box(s);
      const size = [0, 1, 2].map((a) => box.max[a]! - box.min[a]! + 1).join(' × ');
      const more = SOLID.has(this.kind) ? ' · Ctrl — height' : '';
      ctx.hint(`${SHAPE_LABELS[this.kind]} ${size}${more} · Esc — cancel`);
    }
    ctx.requestRender();
  }

  /** Release: the shape goes into the model as one step. */
  private apply(ctx: ToolContext): void {
    const s = this.shape;
    this.shape = null;
    this.drag = null;
    ctx.preview(null);
    ctx.hint(null);
    if (!s) return;
    s.height = this.height(s);
    const tx = new VoxelTransaction();
    ctx.apply(this.operation(s, ctx), tx);
    ctx.commit(tx, SHAPE_LABELS[this.kind]);
    this.offerAdjustment(s, ctx);
    ctx.requestRender();
  }

  /**
   * Offers the shape's numbers: the corner and size of its box (a line: its two ends) and the
   * colour; a thick line keeps the brush it was drawn with.
   */
  private offerAdjustment(s: Shape, ctx: ToolContext): void {
    const object = ctx.object;
    if (!object) return;
    const kind = this.kind;
    const label = SHAPE_LABELS[kind];
    const action = s.action;
    const color = ctx.settings.color;
    if (kind === 'line') {
      const brush = { ...ctx.settings };
      const fields: AdjustField[] = ['x1', 'y1', 'z1', 'x2', 'y2', 'z2'].map((key) => ({
        key,
        label: key.toUpperCase(),
      }));
      ctx.offerAdjustment({
        title: label,
        object,
        fields: [...fields, COLOR_FIELD],
        values: { x1: s.a[0], y1: s.a[1], z1: s.a[2], x2: s.b[0], y2: s.b[1], z2: s.b[2], color },
        label: () => label,
        operation: (v) => {
          const line: Shape = { ...s, a: [v.x1!, v.y1!, v.z1!], b: [v.x2!, v.y2!, v.z2!] };
          const cells = this.cells(line, { object, settings: brush });
          return cellsOperation(action, v.color!, cells);
        },
      });
      return;
    }
    const box = this.box(s);
    const axis = s.axis;
    const frame = this.frame(s);
    const size = (a: number) => box.max[a]! - box.min[a]! + 1;
    ctx.offerAdjustment({
      title: label,
      object,
      fields: [
        { key: 'x', label: 'X' },
        { key: 'y', label: 'Y' },
        { key: 'z', label: 'Z' },
        { key: 'w', label: 'Width', min: 1, max: 1024 },
        { key: 'h', label: 'Height', min: 1, max: 1024 },
        { key: 'd', label: 'Depth', min: 1, max: 1024 },
        COLOR_FIELD,
      ],
      values: {
        x: box.min[0],
        y: box.min[1],
        z: box.min[2],
        w: size(0),
        h: size(1),
        d: size(2),
        color,
      },
      label: () => label,
      operation: (v) => {
        const min: Cell = [v.x!, v.y!, v.z!];
        const max: Cell = [v.x! + v.w! - 1, v.y! + v.h! - 1, v.z! + v.d! - 1];
        return cellsOperation(
          action,
          v.color!,
          shapeCells(kind as Exclude<ShapeKind, 'line'>, { min, max }, axis, frame),
        );
      },
    });
  }

  private cancel(ctx: ToolContext): void {
    this.shape = null;
    this.drag = null;
    ctx.preview(null);
    ctx.hint(null);
    ctx.requestRender();
  }
}

/**
 * The opposite corner of a base laid out symmetrically around `start`: around its centre
 * (odd size) or, with `even`, around its corner on the side of the pointer (even size).
 */
function mirrored(b: Cell, start: Cell, axis: number, even: boolean): Cell {
  const a: Cell = [...start];
  for (let k = 0; k < 3; k++) {
    if (k === axis) continue;
    if (!even) a[k] = 2 * start[k]! - b[k]!;
    else a[k] = b[k]! >= start[k]! ? 2 * start[k]! - b[k]! - 1 : 2 * start[k]! - b[k]! + 1;
  }
  return a;
}
