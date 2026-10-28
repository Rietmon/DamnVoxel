import { FACE_NORMALS, faceAxis } from '../coords';
import { colouredCellsOperation, type EditAction, type Operation } from '../operation';
import { isHidden, isLocked, worldTransform } from '../scene';
import { localToWorld } from '../transform';
import type { VolumeReader } from '../volume';
import { VoxelTransaction } from '../voxel-edit';
import { COLOR_FIELD } from './adjust';
import {
  effectiveAction,
  type OverlaySink,
  type Tool,
  type ToolContext,
  type ToolEvent,
  type ToolHit,
} from './tool';

/** Region limit: a face larger than this is cut off (a 1024 × 1024 plane). */
const MAX_REGION = 1 << 20;

/**
 * Voxels whose face `face` is exposed and connected to the start voxel's face within the same
 * plane: the "face" MagicaVoxel's face tool works on. With `byColor` only voxels of the start
 * colour join. Returns flat x, y, z, colour quadruples.
 */
export function faceRegion(
  reader: VolumeReader,
  x: number,
  y: number,
  z: number,
  face: number,
  byColor: boolean,
): number[] {
  const n = FACE_NORMALS[face]!;
  const seed = reader.get(x, y, z);
  if (seed === 0 || reader.get(x + n[0], y + n[1], z + n[2]) !== 0) return [];
  const axis = faceAxis(face);
  const u = (axis + 1) % 3;
  const v = (axis + 2) % 3;
  const steps: number[][] = [];
  for (const [a, s] of [
    [u, 1],
    [u, -1],
    [v, 1],
    [v, -1],
  ] as const) {
    const d = [0, 0, 0];
    d[a] = s;
    steps.push(d);
  }
  const seen = new Set<string>();
  const out: number[] = [];
  const queue: number[][] = [[x, y, z]];
  seen.add(`${x},${y},${z}`);
  while (queue.length > 0 && out.length < MAX_REGION * 4) {
    const c = queue.pop()!;
    const value = reader.get(c[0]!, c[1]!, c[2]!);
    out.push(c[0]!, c[1]!, c[2]!, value);
    for (const d of steps) {
      const nx = c[0]! + d[0]!;
      const ny = c[1]! + d[1]!;
      const nz = c[2]! + d[2]!;
      const key = `${nx},${ny},${nz}`;
      if (seen.has(key)) continue;
      const nv = reader.get(nx, ny, nz);
      if (nv === 0 || (byColor && nv !== seed)) continue;
      if (reader.get(nx + n[0], ny + n[1], nz + n[2]) !== 0) continue;
      seen.add(key);
      queue.push([nx, ny, nz]);
    }
  }
  return out;
}

/**
 * The edit of a face region moved `depth` layers along its normal: positive extrudes new
 * layers in the colour of each face voxel, negative presses the region in. Paint recolours the
 * region whatever the depth.
 */
export function faceOperation(
  region: number[],
  face: number,
  depth: number,
  action: EditAction,
  color: number,
): Operation {
  const n = FACE_NORMALS[face]!;
  const cells: number[] = [];
  if (action === 'paint') {
    for (let i = 0; i < region.length; i += 4)
      cells.push(region[i]!, region[i + 1]!, region[i + 2]!, color);
    return colouredCellsOperation('paint', cells);
  }
  if (depth > 0) {
    for (let i = 0; i < region.length; i += 4)
      for (let k = 1; k <= depth; k++) {
        cells.push(
          region[i]! + n[0] * k,
          region[i + 1]! + n[1] * k,
          region[i + 2]! + n[2] * k,
          region[i + 3]!,
        );
      }
    return colouredCellsOperation('add', cells);
  }
  for (let i = 0; i < region.length; i += 4)
    for (let k = 0; k < -depth; k++) {
      cells.push(region[i]! - n[0] * k, region[i + 1]! - n[1] * k, region[i + 2]! - n[2] * k, 0);
    }
  return colouredCellsOperation('erase', cells);
}

const OUTLINE = [1, 0.62, 0.26, 1];

interface Drag {
  hit: ToolHit;
  region: number[];
  action: EditAction;
  startX: number;
  startY: number;
  /** Screen pixels per voxel along the face normal. */
  normalScreen: [number, number];
  depth: number;
}

/**
 * Face tool: works on a whole flat face at once. Dragging along the face normal extrudes it
 * (outwards) or presses it in (inwards); a click without a drag extrudes or presses by one
 * layer depending on the action; paint recolours the face. Extruded layers keep the colour of
 * the voxels they grow from.
 */
export class FaceTool implements Tool {
  readonly id = 'face';
  readonly cursor = 'crosshair';

  private hover: ToolHit | null = null;
  private drag: Drag | null = null;
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
        if (this.drag) this.dragTo(e, ctx);
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
    if (code === 'Escape' && this.drag) {
      this.finish(ctx, false);
      return true;
    }
    return false;
  }

  overlay(sink: OverlaySink, ctx: ToolContext): void {
    const hit = this.drag?.hit ?? this.hover;
    if (hit && ctx.object && !hit.onPlane)
      sink.faceOutline(ctx.object, hit.x, hit.y, hit.z, hit.face, OUTLINE);
  }

  deactivate(ctx: ToolContext): void {
    this.finish(ctx, false);
    this.hover = null;
    this.previewKey = '';
    ctx.preview(null);
  }

  settingsChanged(ctx: ToolContext): void {
    this.previewKey = '';
    this.showHoverPreview(ctx, false);
  }

  private region(hit: ToolHit, ctx: ToolContext): number[] {
    const object = ctx.object;
    if (!object || hit.onPlane) return [];
    return faceRegion(object.volume, hit.x, hit.y, hit.z, hit.face, ctx.settings.faceByColor);
  }

  private updateHover(e: ToolEvent, ctx: ToolContext): void {
    this.hover = Number.isFinite(e.x) ? ctx.pick(ctx.rayAt(e.x, e.y)) : null;
    this.showHoverPreview(ctx, e.shift);
  }

  private showHoverPreview(ctx: ToolContext, shift: boolean): void {
    const object = ctx.object;
    const hit = this.hover;
    const action = effectiveAction(ctx.settings.action, shift);
    if (!object || isLocked(object) || isHidden(object) || !hit || hit.onPlane) {
      if (this.previewKey !== '') ctx.preview(null);
      this.previewKey = '';
      ctx.hint(hit?.onPlane ? 'Face: hover over a voxel' : null);
      return;
    }
    const s = ctx.settings;
    const key = [
      action,
      hit.x,
      hit.y,
      hit.z,
      hit.face,
      s.faceByColor,
      s.color,
      object.volume.revision,
    ].join('|');
    if (key !== this.previewKey) {
      this.previewKey = key;
      const region = this.region(hit, ctx);
      ctx.preview(faceOperation(region, hit.face, action === 'erase' ? -1 : 1, action, s.color));
    }
    ctx.hint(
      action === 'paint'
        ? 'Paint face'
        : 'Drag along the normal: outward to extrude, inward to push. Click for one layer',
    );
    ctx.requestRender();
  }

  private begin(e: ToolEvent, ctx: ToolContext): void {
    const object = ctx.object;
    if (!object || isLocked(object) || isHidden(object)) return;
    const hit = ctx.pick(ctx.rayAt(e.x, e.y));
    if (!hit || hit.onPlane) return;
    const region = this.region(hit, ctx);
    if (region.length === 0) return;
    const action = effectiveAction(ctx.settings.action, e.shift);
    // How the face normal looks on screen: the drag is measured along it.
    const n = FACE_NORMALS[hit.face]!;
    const t = worldTransform(object);
    const p = hit.point;
    const a = ctx.project(localToWorld(t, p[0]!, p[1]!, p[2]!));
    const b = ctx.project(localToWorld(t, p[0]! + n[0], p[1]! + n[1], p[2]! + n[2]));
    this.drag = {
      hit,
      region,
      action,
      startX: e.x,
      startY: e.y,
      normalScreen: a && b ? [b[0] - a[0], b[1] - a[1]] : [0, 0],
      depth: action === 'erase' ? -1 : 1,
    };
    this.hover = null;
    this.previewDrag(ctx);
  }

  private dragTo(e: ToolEvent, ctx: ToolContext): void {
    const drag = this.drag!;
    if (drag.action === 'paint') return;
    const [nx, ny] = drag.normalScreen;
    const len2 = nx * nx + ny * ny;
    if (len2 < 1e-6) return;
    const along = ((e.x - drag.startX) * nx + (e.y - drag.startY) * ny) / len2;
    // A click (no drag) keeps the one-layer default of the action.
    const moved = Math.round(along);
    const depth = moved === 0 ? (drag.action === 'erase' ? -1 : 1) : moved;
    if (depth !== drag.depth) {
      drag.depth = depth;
      this.previewDrag(ctx);
    }
  }

  private previewDrag(ctx: ToolContext): void {
    const d = this.drag!;
    ctx.preview(faceOperation(d.region, d.hit.face, d.depth, d.action, ctx.settings.color));
    ctx.hint(
      d.action === 'paint'
        ? 'Paint face'
        : d.depth > 0
          ? `Extrude by ${d.depth}`
          : `Push by ${-d.depth}`,
    );
    ctx.requestRender();
  }

  private finish(ctx: ToolContext, keep: boolean): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    this.previewKey = '';
    ctx.preview(null);
    if (!keep) return;
    const tx = new VoxelTransaction();
    ctx.apply(
      faceOperation(drag.region, drag.hit.face, drag.depth, drag.action, ctx.settings.color),
      tx,
    );
    const label =
      drag.action === 'paint' ? 'Paint face' : drag.depth > 0 ? 'Extrude face' : 'Push face';
    ctx.commit(tx, label);
    const object = ctx.object;
    if (object) {
      const { region, hit, action } = drag;
      const labelFor = (depth: number) =>
        action === 'paint' ? 'Paint face' : depth > 0 ? 'Extrude face' : 'Push face';
      ctx.offerAdjustment({
        title: label,
        object,
        fields:
          action === 'paint'
            ? [COLOR_FIELD]
            : [{ key: 'depth', label: 'Layers (− push)', min: -256, max: 256 }, COLOR_FIELD],
        values: { depth: drag.depth, color: ctx.settings.color },
        // Zero layers would do nothing: it counts as one, in the direction the drag went.
        operation: (v) =>
          faceOperation(region, hit.face, v.depth || Math.sign(drag.depth), action, v.color!),
        label: (v) => labelFor(v.depth || drag.depth),
      });
    }
    ctx.requestRender();
  }
}
