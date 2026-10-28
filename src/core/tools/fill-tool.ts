import { faceAxis } from '../coords';
import { enclosedCells, floodVoxels } from '../fill';
import { cellsOperation, type EditAction, type Operation } from '../operation';
import { isHidden, isLocked } from '../scene';
import { VoxelTransaction } from '../voxel-edit';
import { brushTarget } from './brush';
import {
  effectiveAction,
  type OverlaySink,
  type Tool,
  type ToolContext,
  type ToolEvent,
  type ToolHit,
} from './tool';

/**
 * What a fill click takes: voxels of the clicked colour joined to it through the model or only
 * in the clicked layer, or the empty inside of an outline drawn in a layer.
 */
export type FillMode = 'color' | 'layer' | 'outline';

export const FILL_TITLES: Record<FillMode, string> = {
  color: 'Connected by color',
  layer: 'On the plane',
  outline: 'Inside the outline',
};

const LABELS: Record<EditAction, string> = {
  add: 'Fill',
  erase: 'Erase by fill',
  paint: 'Fill',
};

/**
 * The fill tool: one click recolours (or with erase, removes) a connected region of one colour,
 * or fills a closed outline in a layer. Hover shows exactly what the click will change.
 */
export class FillTool implements Tool {
  readonly id = 'fill';
  readonly cursor = 'crosshair';
  private hover: ToolHit | null = null;
  private action: EditAction = 'paint';

  handle(e: ToolEvent, ctx: ToolContext): void {
    if (e.phase === 'hover' || e.phase === 'move') {
      this.hover = Number.isFinite(e.x) ? ctx.pick(ctx.rayAt(e.x, e.y)) : null;
      this.action = effectiveAction(ctx.settings.action, e.shift);
      this.showPreview(ctx);
    } else if (e.phase === 'up') {
      this.apply(ctx);
    }
  }

  overlay(sink: OverlaySink, ctx: ToolContext): void {
    const hit = this.hover;
    if (hit && ctx.object)
      sink.faceOutline(ctx.object, hit.x, hit.y, hit.z, hit.face, [1, 0.62, 0.26, 1]);
  }

  deactivate(ctx: ToolContext): void {
    this.hover = null;
    ctx.preview(null);
  }

  settingsChanged(ctx: ToolContext): void {
    this.showPreview(ctx);
  }

  /** The edit a click on `hit` makes, or null with a reason. */
  operation(hit: ToolHit, action: EditAction, ctx: ToolContext): Operation | string {
    const object = ctx.object;
    if (!object) return 'No object';
    const v = object.volume;
    const mode = ctx.settings.fillMode;
    const color = ctx.settings.color;
    if (mode === 'outline') {
      const box = v.getBounds();
      const target = brushTarget(hit, 'add');
      if (!box || !target) return 'Draw a closed outline and click inside';
      const cells = enclosedCells(v, target, faceAxis(hit.face), box);
      if (!cells) return 'The outline is not closed: the fill would leak out';
      return cellsOperation('add', color, cells);
    }
    if (hit.onPlane) return 'Click a voxel';
    const cells = floodVoxels(v, [hit.x, hit.y, hit.z], {
      layerAxis: mode === 'layer' ? faceAxis(hit.face) : null,
    });
    if (!cells) return 'The area is too large';
    return cellsOperation(action === 'erase' ? 'erase' : 'paint', color, cells);
  }

  private showPreview(ctx: ToolContext): void {
    const hit = this.hover;
    if (!hit) {
      ctx.preview(null);
      ctx.hint(null);
      return;
    }
    const op = this.operation(hit, this.action, ctx);
    if (typeof op === 'string') {
      ctx.preview(null);
      ctx.hint(op);
    } else {
      ctx.preview(op, op.action === 'erase' ? 'erase' : op.action === 'add' ? 'add' : 'paint');
      ctx.hint(`${FILL_TITLES[ctx.settings.fillMode]} · Shift — erase`);
    }
    ctx.requestRender();
  }

  private apply(ctx: ToolContext): void {
    const hit = this.hover;
    const object = ctx.object;
    if (!hit || !object) return;
    if (isLocked(object) || isHidden(object)) {
      ctx.hint('The object is locked or hidden');
      return;
    }
    const op = this.operation(hit, this.action, ctx);
    if (typeof op === 'string') {
      ctx.hint(op);
      return;
    }
    const tx = new VoxelTransaction();
    ctx.apply(op, tx);
    ctx.commit(tx, LABELS[op.action]);
    ctx.preview(null);
    ctx.requestRender();
  }
}
