import type { Vec3i } from '../coords';
import type { PickSource } from '../picking';
import { isHidden, isLocked } from '../scene';
import { VoxelTransaction } from '../voxel-edit';
import { SCULPT_TITLES, type SculptMode, type SculptOptions, sculpt } from './sculpt';
import type { OverlaySink, Tool, ToolContext, ToolEvent, ToolHit } from './tool';

/** Shift flips growing and eroding, as it flips adding and erasing for the brush. */
function effectiveMode(mode: SculptMode, shift: boolean): SculptMode {
  if (!shift) return mode;
  return mode === 'grow' ? 'erode' : mode === 'erode' ? 'grow' : mode;
}

/**
 * The sculpt tool: a ball of the brush size moved over the model reshapes its surface (see
 * core/tools/sculpt.ts). A stroke reads the model as it was before it began, so it adds or takes
 * at most one layer; another stroke goes further.
 */
export class SculptTool implements Tool {
  readonly id = 'sculpt';
  readonly cursor = 'crosshair';

  private tx: VoxelTransaction | null = null;
  private base: PickSource | null = null;
  private first: ToolHit | null = null;
  private mode: SculptMode = 'grow';
  private hover: ToolHit | null = null;
  private lastCell = '';

  handle(e: ToolEvent, ctx: ToolContext): void {
    switch (e.phase) {
      case 'hover':
        this.updateHover(e, ctx);
        break;
      case 'down':
        this.begin(e, ctx);
        break;
      case 'move':
        if (this.tx) this.pass(e.x, e.y, ctx);
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
    const object = ctx.object;
    if (!hit || this.tx || !object || hit.onPlane) return;
    // The ball's reach on the surface.
    const r = Math.floor(ctx.settings.brushSize / 2);
    sink.cellBox(
      object,
      [hit.x - r, hit.y - r, hit.z - r],
      [hit.x + r, hit.y + r, hit.z + r],
      [1, 0.62, 0.26, 0.8],
      1,
    );
  }

  deactivate(ctx: ToolContext): void {
    this.finish(ctx, true);
    this.hover = null;
    ctx.preview(null);
  }

  settingsChanged(ctx: ToolContext): void {
    this.showPreview(ctx);
  }

  private options(first: ToolHit, ctx: ToolContext): SculptOptions {
    const s = ctx.settings;
    return {
      mode: this.mode,
      size: s.brushSize,
      direction: s.sculptDirection,
      face: first.face,
      anchor: [first.x, first.y, first.z],
      color: s.sculptUseColor ? s.color : null,
    };
  }

  private updateHover(e: ToolEvent, ctx: ToolContext): void {
    const hit = Number.isFinite(e.x) ? ctx.pick(ctx.rayAt(e.x, e.y)) : null;
    this.hover = hit && !hit.onPlane ? hit : null;
    this.mode = effectiveMode(ctx.settings.sculptMode, e.shift);
    this.showPreview(ctx);
  }

  private showPreview(ctx: ToolContext): void {
    const hit = this.hover;
    const object = ctx.object;
    if (!hit || !object || this.tx) {
      ctx.preview(null);
      ctx.hint(hit ? null : 'Sculpt: hover over the model');
      return;
    }
    const edit = sculpt(object.volume, [hit.x, hit.y, hit.z], this.options(hit, ctx));
    // Show what goes away when nothing comes in (erosion), else what comes in.
    const adds = this.mode === 'erode' || this.mode === 'flatten' ? null : edit.add;
    ctx.preview(adds ?? edit.erase, adds ? 'add' : 'erase');
    ctx.hint(`${SCULPT_TITLES[this.mode]} · Shift — reverse · [ ] — size`);
    ctx.requestRender();
  }

  private begin(e: ToolEvent, ctx: ToolContext): void {
    const object = ctx.object;
    if (!object || isLocked(object) || isHidden(object)) {
      ctx.hint(object ? 'The object is locked or hidden' : 'No object to edit');
      return;
    }
    this.mode = effectiveMode(ctx.settings.sculptMode, e.shift);
    const tx = new VoxelTransaction();
    this.tx = tx;
    this.base = { volume: tx.baseOf(object), bounds: object.volume.getBounds() };
    this.first = null;
    this.lastCell = '';
    ctx.preview(null);
    ctx.setLive(true);
    this.pass(e.x, e.y, ctx);
  }

  private pass(x: number, y: number, ctx: ToolContext): void {
    const tx = this.tx;
    const base = this.base;
    if (!tx || !base) return;
    const hit = ctx.pick(ctx.rayAt(x, y), base);
    if (!hit || hit.onPlane) return;
    const key = `${hit.x},${hit.y},${hit.z}`;
    if (key === this.lastCell) return;
    this.lastCell = key;
    this.first ??= hit;
    const center: Vec3i = [hit.x, hit.y, hit.z];
    const edit = sculpt(base.volume, center, this.options(this.first, ctx));
    ctx.apply(edit.erase, tx);
    ctx.apply(edit.add, tx);
    ctx.requestRender();
  }

  private finish(ctx: ToolContext, keep: boolean): void {
    const tx = this.tx;
    if (!tx) return;
    this.tx = null;
    this.base = null;
    if (keep) ctx.commit(tx, SCULPT_TITLES[this.mode]);
    else tx.cancel();
    ctx.setLive(false);
    ctx.requestRender();
  }
}
