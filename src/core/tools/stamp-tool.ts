import {
  CHUNK_SIZE,
  CHUNK_VOLUME,
  FACE_NORMALS,
  indexX,
  indexY,
  indexZ,
  keyX,
  keyY,
  keyZ,
} from '../coords';
import { colouredCellsOperation, type EditAction, type Operation } from '../operation';
import { composeOrientation, findOrientation, orientCell } from '../orientation';
import type { PickSource } from '../picking';
import { isHidden, isLocked } from '../scene';
import type { VoxelVolume } from '../volume';
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
 * The stamp (stamp, brush from the selection): a piece of voxels taken from the
 * selection or an object, put down with a click or laid along a stroke like a brush of that
 * shape. The piece grows out of the face it is put on (its up turns to the face normal), can be
 * turned and mirrored, and keeps its own colours or takes the current one.
 */

/** A piece to stamp: x, y, z, colour quads relative to its anchor (the middle of its bottom). */
export interface Pattern {
  readonly name: string;
  readonly cells: Int32Array;
  readonly size: readonly [number, number, number];
}

const dense = new Uint16Array(CHUNK_VOLUME);

/** The voxels of a volume as a pattern, or null when it is empty. */
export function patternFromVolume(volume: VoxelVolume, name: string): Pattern | null {
  const b = volume.getBounds();
  if (!b) return null;
  const ax = Math.floor((b.minX + b.maxX) / 2);
  const az = Math.floor((b.minZ + b.maxZ) / 2);
  const out: number[] = [];
  for (const [key, chunk] of volume.chunks()) {
    chunk.decodeInto(dense);
    const ox = keyX(key) * CHUNK_SIZE;
    const oy = keyY(key) * CHUNK_SIZE;
    const oz = keyZ(key) * CHUNK_SIZE;
    for (let i = 0; i < CHUNK_VOLUME; i++) {
      const v = dense[i]!;
      if (v === 0) continue;
      out.push(ox + indexX(i) - ax, oy + indexY(i) - b.minY, oz + indexZ(i) - az, v);
    }
  }
  return {
    name,
    cells: Int32Array.from(out),
    size: [b.maxX - b.minX + 1, b.maxY - b.minY + 1, b.maxZ - b.minZ + 1],
  };
}

/** Turns that bring the pattern's up (+Y) onto each face normal, by face index. */
const UP_TO_FACE: readonly number[] = FACE_NORMALS.map((n) => {
  const [x, y, z] = n;
  // Row-major rotations taking +Y to the normal.
  const m =
    y === 1
      ? [1, 0, 0, 0, 1, 0, 0, 0, 1]
      : y === -1
        ? [1, 0, 0, 0, -1, 0, 0, 0, -1]
        : x === 1
          ? [0, 1, 0, -1, 0, 0, 0, 0, 1]
          : x === -1
            ? [0, -1, 0, 1, 0, 0, 0, 0, 1]
            : z === 1
              ? [1, 0, 0, 0, 0, -1, 0, 1, 0]
              : [1, 0, 0, 0, 0, 1, 0, -1, 0];
  return findOrientation(m)!;
});

/** The face index whose normal points the other way. */
const opposite = (face: number) => face ^ 1;

/**
 * The pattern's cells put at `target` (its anchor cell lands there), turned by `orientation`
 * about the anchor; colours as in the pattern, or all `color` when given.
 */
export function placePattern(
  pattern: Pattern,
  target: readonly number[],
  orientation: number,
  color: number | null,
): number[] {
  const [bx, by, bz] = orientCell(orientation, 0, 0, 0);
  const c = pattern.cells;
  const out = new Array<number>(c.length);
  for (let i = 0; i < c.length; i += 4) {
    const [x, y, z] = orientCell(orientation, c[i]!, c[i + 1]!, c[i + 2]!);
    out[i] = target[0]! + x - bx;
    out[i + 1] = target[1]! + y - by;
    out[i + 2] = target[2]! + z - bz;
    out[i + 3] = color ?? c[i + 3]!;
  }
  return out;
}

export class StampTool implements Tool {
  readonly id = 'stamp';
  readonly cursor = 'crosshair';
  /** What is stamped; set from the selection or an object. */
  pattern: Pattern | null = null;

  private tx: VoxelTransaction | null = null;
  private base: PickSource | null = null;
  private action: EditAction = 'add';
  private hover: ToolHit | null = null;
  private lastCell: string | null = null;
  private lastStamp: [number, number, number] | null = null;

  handle(e: ToolEvent, ctx: ToolContext): void {
    switch (e.phase) {
      case 'hover':
        this.updateHover(e, ctx);
        break;
      case 'down':
        this.begin(e, ctx);
        break;
      case 'move':
        if (this.tx) this.stampAt(e.x, e.y, ctx);
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
      sink.faceOutline(ctx.object, hit.x, hit.y, hit.z, hit.face, [1, 0.62, 0.26, 1]);
  }

  deactivate(ctx: ToolContext): void {
    this.finish(ctx, true);
    this.hover = null;
    ctx.preview(null);
  }

  settingsChanged(ctx: ToolContext): void {
    this.showPreview(ctx);
  }

  /** The stamp for a hit: where it goes and which way it faces. */
  operation(hit: ToolHit, action: EditAction, ctx: ToolContext): Operation | null {
    const p = this.pattern;
    if (!p) return null;
    const s = ctx.settings;
    // Adding grows out of the face; erasing and painting reach into the model.
    const target = action === 'add' ? brushTarget(hit, 'add') : [hit.x, hit.y, hit.z];
    if (!target) return null;
    const face = hit.onPlane ? 2 : hit.face;
    const up = s.stampAlign ? (action === 'add' ? face : opposite(face)) : action === 'add' ? 2 : 3;
    const orientation = composeOrientation(UP_TO_FACE[up]!, s.stampTurn);
    const color = s.stampOwnColor ? null : s.color;
    return colouredCellsOperation(action, placePattern(p, target, orientation, color));
  }

  private updateHover(e: ToolEvent, ctx: ToolContext): void {
    this.hover = Number.isFinite(e.x) ? ctx.pick(ctx.rayAt(e.x, e.y)) : null;
    this.action = effectiveAction(ctx.settings.action, e.shift);
    this.showPreview(ctx);
  }

  private showPreview(ctx: ToolContext): void {
    const hit = this.hover;
    if (!this.pattern) {
      ctx.preview(null);
      ctx.hint('No stamp: select voxels and press “Stamp from the selection”');
      return;
    }
    ctx.preview(hit && !this.tx ? this.operation(hit, this.action, ctx) : null);
    ctx.hint(hit ? `Stamp “${this.pattern.name}” · click to place, drag to paint with it` : null);
    ctx.requestRender();
  }

  private begin(e: ToolEvent, ctx: ToolContext): void {
    const object = ctx.object;
    if (!this.pattern) {
      this.showPreview(ctx);
      return;
    }
    if (!object || isLocked(object) || isHidden(object)) {
      ctx.hint(object ? 'The object is locked or hidden' : 'No object to edit');
      return;
    }
    this.action = effectiveAction(ctx.settings.action, e.shift);
    const tx = new VoxelTransaction();
    this.tx = tx;
    // Like the brush, the stroke picks against the model as it was, so stamps do not pile up.
    this.base = { volume: tx.baseOf(object), bounds: object.volume.getBounds() };
    this.lastCell = null;
    this.lastStamp = null;
    this.hover = null;
    ctx.preview(null);
    ctx.setLive(true);
    this.stampAt(e.x, e.y, ctx);
  }

  private stampAt(x: number, y: number, ctx: ToolContext): void {
    const tx = this.tx;
    if (!tx || !this.base || !this.pattern) return;
    const hit = ctx.pick(ctx.rayAt(x, y), this.base);
    if (!hit) return;
    const key = `${hit.x},${hit.y},${hit.z},${hit.face}`;
    if (key === this.lastCell) return;
    // Spread out: the next stamp only once the pointer is a whole piece away from the last.
    if (ctx.settings.stampSpacing === 'apart' && this.lastStamp) {
      const gap = Math.max(this.pattern.size[0], this.pattern.size[2]);
      const d = Math.max(...[hit.x, hit.y, hit.z].map((v, i) => Math.abs(v - this.lastStamp![i]!)));
      if (d < gap) return;
    }
    const op = this.operation(hit, this.action, ctx);
    if (!op) return;
    this.lastCell = key;
    this.lastStamp = [hit.x, hit.y, hit.z];
    ctx.apply(op, tx);
    ctx.requestRender();
  }

  private finish(ctx: ToolContext, keep: boolean): void {
    const tx = this.tx;
    if (!tx) return;
    this.tx = null;
    this.base = null;
    if (keep) ctx.commit(tx, 'Stamp');
    else tx.cancel();
    ctx.setLive(false);
    ctx.requestRender();
  }
}
