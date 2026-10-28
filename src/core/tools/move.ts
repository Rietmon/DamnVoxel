import { Chunk } from '../chunk';
import { CHUNK_SIZE, CHUNK_VOLUME, faceAxis, keyX, keyY, keyZ } from '../coords';
import { type Command, CompositeCommand } from '../history';
import {
  applyOrientation,
  composeOrientation,
  IDENTITY_ORIENTATION,
  quarterTurn,
  reflection,
} from '../orientation';
import {
  isHidden,
  isLocked,
  NO_LAYER,
  type Transform,
  type VoxelObject,
  worldTransform,
} from '../scene';
import { SelectionMask } from '../selection';
import { SelectionTransaction } from '../selection-edit';
import { dirToLocal, localToWorld, worldToLocal } from '../transform';
import { VoxelVolume } from '../volume';
import { VoxelTransaction } from '../voxel-edit';
import type { OverlaySink, Tool, ToolContext, ToolEvent, Vec3 } from './tool';

/** Voxels lifted out of an object, moving as one piece until they are dropped. */
export interface Floating {
  /** The object the voxels came from and go back into. */
  readonly target: VoxelObject;
  /** A detached object drawn in place of the voxels: its volume holds them at their original
   * local positions, its transform carries the offset. */
  readonly object: VoxelObject;
  /** Integer offset in the target's local space. */
  offset: Vec3;
  /** Voxels were copied, not cut: the source stays (duplicate, paste). */
  readonly copy: boolean;
  /** History label of the drop. */
  readonly label: string;
  /** The lifted voxels as they were, and how they are turned now about `pivot2`. */
  readonly source: VoxelVolume;
  orientation: number;
  /** Doubled centre of the lifted voxels' bounds: turns are about this fixed point. */
  readonly pivot2: [number, number, number];
  readonly tx: VoxelTransaction;
  readonly selection: SelectionTransaction;
}

const dense = new Uint16Array(CHUNK_VOLUME);
const lifted = new Uint16Array(CHUNK_VOLUME);

/** Transform of the floating piece: the target's, moved by the offset in the target's space. */
export function floatingTransform(target: Transform, offset: Vec3): Transform {
  const o = applyOrientation(target.orientation, offset[0], offset[1], offset[2]);
  return {
    x: target.x + o[0],
    y: target.y + o[1],
    z: target.z + o[2],
    orientation: target.orientation,
  };
}

/**
 * Lifts the selected voxels of an object (all of them without a selection) into a floating
 * piece, chunk by chunk. A copy leaves the source in place. The source chunks are written
 * through a transaction, so drop or cancel ends it as one step or nothing.
 */
export function liftSelection(
  target: VoxelObject,
  copy: boolean,
  label = copy ? 'Copy' : 'Move',
): Floating {
  const volume = new VoxelVolume();
  const mask = target.selection.isEmpty ? null : target.selection;
  const keys = mask ? [...mask.chunkKeys()] : [...target.volume.chunkKeys()];
  const cut = new Map<number, Chunk>();
  for (const key of keys) {
    const chunk = target.volume.getChunk(key);
    if (!chunk) continue;
    chunk.decodeInto(dense);
    lifted.fill(0);
    const bits = mask?.getChunk(key);
    let any = false;
    for (let i = 0; i < CHUNK_VOLUME; i++) {
      if (dense[i] === 0) continue;
      if (bits && (bits[i >>> 5]! & (1 << (i & 31))) === 0) continue;
      lifted[i] = dense[i]!;
      dense[i] = 0;
      any = true;
    }
    if (!any) continue;
    volume.putChunk(key, Chunk.fromDense(lifted));
    if (!copy) cut.set(key, Chunk.fromDense(dense));
  }
  const floating = floatingPiece(target, volume, copy, label);
  for (const [key, chunk] of cut) floating.tx.putChunk(target, key, chunk);
  return floating;
}

/**
 * A floating piece made of given voxels (in the target's local space) that does not touch the
 * target until it is dropped: a paste. The target's selection moves onto the piece.
 */
export function floatingPiece(
  target: VoxelObject,
  volume: VoxelVolume,
  copy: boolean,
  label: string,
): Floating {
  const tx = new VoxelTransaction();
  const selection = new SelectionTransaction(target);
  // The selection travels with the piece: it leaves the source now and lands on drop.
  for (const key of [...target.selection.chunkKeys()]) selection.putChunk(key, null);
  const object: VoxelObject = {
    kind: 'object',
    id: -3,
    name: 'floating',
    hidden: false,
    locked: true,
    transform: worldTransform(target),
    parent: null,
    volume,
    selection: new SelectionMask(),
    layer: NO_LAYER,
  };
  volume.takeMeshDirty();
  const source = new VoxelVolume();
  for (const [key, chunk] of volume.chunks()) source.putChunk(key, chunk.clone());
  const b = volume.getBounds();
  const pivot2: [number, number, number] = b
    ? [b.minX + b.maxX + 1, b.minY + b.maxY + 1, b.minZ + b.maxZ + 1]
    : [0, 0, 0];
  return {
    target,
    object,
    offset: [0, 0, 0],
    copy,
    label,
    tx,
    selection,
    source,
    orientation: IDENTITY_ORIENTATION,
    pivot2,
  };
}

/** Writes the piece into the target at its offset (overwriting) and selects it there. */
export function dropFloating(f: Floating): void {
  const [dx, dy, dz] = f.offset;
  const target = f.target;
  for (const [key, chunk] of f.object.volume.chunks()) {
    chunk.decodeInto(dense);
    const ox = keyX(key) * CHUNK_SIZE + dx;
    const oy = keyY(key) * CHUNK_SIZE + dy;
    const oz = keyZ(key) * CHUNK_SIZE + dz;
    for (let i = 0; i < CHUNK_VOLUME; i++) {
      const v = dense[i]!;
      if (v === 0) continue;
      const x = ox + (i & 31);
      const y = oy + ((i >> 5) & 31);
      const z = oz + (i >> 10);
      f.tx.set(target, x, y, z, v);
    }
  }
  // Select the dropped voxels: build the moved mask chunk by chunk.
  const moved = new SelectionMask();
  for (const [key, chunk] of f.object.volume.chunks()) {
    chunk.decodeInto(dense);
    const ox = keyX(key) * CHUNK_SIZE + dx;
    const oy = keyY(key) * CHUNK_SIZE + dy;
    const oz = keyZ(key) * CHUNK_SIZE + dz;
    for (let i = 0; i < CHUNK_VOLUME; i++) {
      if (dense[i] !== 0) moved.set(ox + (i & 31), oy + ((i >> 5) & 31), oz + (i >> 10), true);
    }
  }
  f.selection.combine(moved, 'replace');
}

/**
 * Turns or mirrors a floating piece about the centre of the voxels as they were lifted. The
 * piece is rebuilt from the lifted voxels with the accumulated orientation, in doubled
 * coordinates: odd and even sizes stay on the grid, and four quarter turns give back exactly
 * the piece that was lifted — no half-voxel drift.
 */
export function orientPiece(f: Floating, orientation: number): void {
  f.orientation = composeOrientation(orientation, f.orientation);
  const volume = f.object.volume;
  const c2 = f.pivot2;
  const next = new VoxelVolume();
  for (const [key, chunk] of f.source.chunks()) {
    chunk.decodeInto(dense);
    const ox = keyX(key) * CHUNK_SIZE;
    const oy = keyY(key) * CHUNK_SIZE;
    const oz = keyZ(key) * CHUNK_SIZE;
    for (let i = 0; i < CHUNK_VOLUME; i++) {
      const v = dense[i]!;
      if (v === 0) continue;
      const r = applyOrientation(
        f.orientation,
        2 * (ox + (i & 31)) + 1 - c2[0]!,
        2 * (oy + ((i >> 5) & 31)) + 1 - c2[1]!,
        2 * (oz + (i >> 10)) + 1 - c2[2]!,
      );
      next.set(
        Math.floor((r[0] + c2[0]! - 1) / 2),
        Math.floor((r[1] + c2[1]! - 1) / 2),
        Math.floor((r[2] + c2[2]! - 1) / 2),
        v,
      );
    }
  }
  volume.clear();
  for (const [key, chunk] of next.chunks()) volume.putChunk(key, chunk);
}

type DragKind = 'plane' | 'normal';

interface Drag {
  kind: DragKind;
  /** Axis of the plane normal (plane drags) or of the line (normal drags). */
  axis: number;
  /** Local point grabbed on the plane at press. */
  grab: Vec3;
  startOffset: Vec3;
  startX: number;
  startY: number;
  /** Screen pixels per voxel along the axis, for normal drags. */
  screenDir: [number, number];
  /** Ctrl: keep only the larger of the two plane components. */
  oneAxis: boolean;
}

const OUTLINE = [0.45, 0.72, 1, 1];

/**
 * Move tool: grab the selection (or the whole object) and drag it — on the plane of the face
 * grabbed, along that face's normal with Shift, along one axis with Ctrl. Alt drags a copy.
 * The piece floats while the drag lasts (no remeshing while it moves) and lands on release, as
 * one step. Arrows, PageUp / PageDown and Q / E / H move and turn the selection at once, each
 * a step of its own. Only a pasted or duplicated piece floats until it is placed: the next
 * drag or click puts it down, Enter too, Escape drops it.
 */
export class MoveTool implements Tool {
  readonly id = 'move';
  readonly cursor = 'move';
  private floating: Floating | null = null;
  private drag: Drag | null = null;
  /** The last row of Q / E / H turns: what it did, and the volume right after. */
  private turns: {
    object: VoxelObject;
    orientation: number;
    command: Command | null;
    revision: number;
  } | null = null;

  get piece(): Floating | null {
    return this.floating;
  }

  handle(e: ToolEvent, ctx: ToolContext): void {
    switch (e.phase) {
      case 'hover':
        ctx.hint(
          this.floating
            ? 'Pasting: drag or click to place · arrows, Q / E — shift and turn · Esc — cancel'
            : 'Drag the selection (no selection — the whole object) · arrows, Q / E — shift and turn',
        );
        return;
      case 'down':
        this.press(e, ctx);
        return;
      case 'move':
        this.dragTo(e, ctx);
        return;
      case 'up':
        // The drag ends: the piece lands where it is.
        if (this.drag && this.floating) this.drop(ctx);
        this.drag = null;
        return;
      case 'cancel':
        if (this.drag && this.floating) this.cancel(ctx);
        this.drag = null;
        return;
    }
  }

  key(code: string, ctx: ToolContext, shift = false): boolean {
    const turn = this.turnFor(code, shift, ctx);
    if (turn !== null) {
      this.orient(ctx, turn);
      return true;
    }
    const floating = this.floating;
    if (floating && (code === 'Enter' || code === 'NumpadEnter')) {
      this.drop(ctx);
      return true;
    }
    if (floating && code === 'Escape') {
      this.cancel(ctx);
      return true;
    }
    const step = this.arrowStep(code, ctx);
    if (!step) return false;
    // Without a piece in hand, a nudge lifts the selection, moves it and puts it down.
    const lifted = !floating && this.lift(ctx);
    const f = this.floating;
    if (!f) return false;
    this.setOffset(ctx, [f.offset[0] + step[0], f.offset[1] + step[1], f.offset[2] + step[2]]);
    if (lifted) this.drop(ctx);
    return true;
  }

  /** Lifts the selection (or the whole object) into a floating piece; false when it cannot. */
  private lift(ctx: ToolContext, copy = false, label?: string): boolean {
    const object = ctx.object;
    if (!object || isLocked(object) || isHidden(object) || object.volume.isEmpty) return false;
    this.floating = liftSelection(object, copy, label);
    ctx.setFloating(this.floating);
    return true;
  }

  overlay(sink: OverlaySink): void {
    const f = this.floating;
    const box = f?.object.volume.getBounds();
    if (f && box) {
      sink.cellBox(
        f.object,
        [box.minX, box.minY, box.minZ],
        [box.maxX, box.maxY, box.maxZ],
        OUTLINE,
        1.5,
      );
    }
  }

  deactivate(ctx: ToolContext): void {
    if (this.floating) this.drop(ctx);
  }

  /**
   * Turns or mirrors the selection in place as one step; a pasted piece in hand just turns and
   * stays in hand. Turns in a row are one turn from where the selection started: each takes
   * back the step before and applies the sum, so Q then E lands exactly where it began, with
   * no rounding drift on odd and even sides, and undo takes the whole row back.
   */
  orient(ctx: ToolContext, orientation: number): void {
    if (this.floating) {
      orientPiece(this.floating, orientation);
      ctx.requestRender();
      return;
    }
    const object = ctx.object;
    const run = this.turns;
    let total = orientation;
    if (
      run &&
      object === run.object &&
      object.volume.revision === run.revision &&
      run.command &&
      ctx.revertLast(run.command)
    ) {
      total = composeOrientation(orientation, run.orientation);
    }
    if (!this.lift(ctx, false, 'Turn selection') || !object) {
      this.turns = null;
      return;
    }
    orientPiece(this.floating!, total);
    const command = this.drop(ctx);
    this.turns = { object, orientation: total, command, revision: object.volume.revision };
  }

  /**
   * Q / E: a quarter turn about Y; with Shift about the horizontal axis that looks most like the
   * screen's left–right. H mirrors along that axis, Shift+H mirrors upside down.
   */
  private turnFor(code: string, shift: boolean, ctx: ToolContext): number | null {
    if (code !== 'KeyQ' && code !== 'KeyE' && code !== 'KeyH') return null;
    const target = this.floating?.target ?? ctx.object;
    if (!target) return null;
    // The local horizontal axis whose screen image is the most horizontal.
    const t = worldTransform(target);
    const o = ctx.project(localToWorld(t, 0, 0, 0));
    const px = ctx.project(localToWorld(t, 1, 0, 0));
    const pz = ctx.project(localToWorld(t, 0, 0, 1));
    const horizontal = (p: [number, number] | null) =>
      p && o ? Math.abs(p[0] - o[0]) / (Math.hypot(p[0] - o[0], p[1] - o[1]) || 1) : 0;
    const side = horizontal(px) >= horizontal(pz) ? 0 : 2;
    if (code === 'KeyH') return reflection(shift ? 1 : side);
    const axis = shift ? side : 1;
    return quarterTurn(axis, code === 'KeyE');
  }

  /** Starts carrying a ready piece (a paste), dropping any piece carried before. */
  carry(ctx: ToolContext, floating: Floating): void {
    if (this.floating) this.drop(ctx);
    this.floating = floating;
    ctx.setFloating(floating);
    ctx.requestRender();
  }

  /** Undo while floating puts the piece back instead of undoing the step before. */
  cancelPending(ctx: ToolContext): boolean {
    if (!this.floating) return false;
    this.cancel(ctx);
    return true;
  }

  private press(e: ToolEvent, ctx: ToolContext): void {
    const object = ctx.object;
    if (!object || isLocked(object) || isHidden(object)) return;
    if (!this.floating && !this.lift(ctx, e.alt)) return;
    const f = this.floating;
    if (!f) return;
    const hit = ctx.pick(ctx.rayAt(e.x, e.y));
    const axis = hit ? faceAxis(hit.face) : 1;
    const grab: Vec3 = hit
      ? [hit.point[0], hit.point[1], hit.point[2]]
      : (this.planePoint(e, ctx, 1, 0) ?? [0, 0, 0]);
    let screenDir: [number, number] = [0, 0];
    if (e.shift) {
      const t = worldTransform(f.target);
      const n: Vec3 = [0, 0, 0];
      n[axis] = 1;
      const a = ctx.project(localToWorld(t, ...grab));
      const b = ctx.project(localToWorld(t, grab[0] + n[0], grab[1] + n[1], grab[2] + n[2]));
      if (a && b) screenDir = [b[0] - a[0], b[1] - a[1]];
    }
    this.drag = {
      kind: e.shift ? 'normal' : 'plane',
      axis,
      grab,
      startOffset: [...f.offset],
      startX: e.x,
      startY: e.y,
      screenDir,
      oneAxis: e.ctrl,
    };
  }

  /** Where a viewport ray meets the local plane `axis = value`. */
  private planePoint(e: ToolEvent, ctx: ToolContext, axis: number, value: number): Vec3 | null {
    const target = this.floating?.target ?? ctx.object;
    if (!target) return null;
    const ray = ctx.rayAt(e.x, e.y);
    const o = worldToLocal(worldTransform(target), ...ray.origin);
    const d = dirToLocal(worldTransform(target), ...ray.dir);
    if (Math.abs(d[axis]!) < 1e-6) return null;
    const t = (value - o[axis]!) / d[axis]!;
    if (t < 0) return null;
    return [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
  }

  private dragTo(e: ToolEvent, ctx: ToolContext): void {
    const drag = this.drag;
    if (!drag || !this.floating) return;
    const offset: Vec3 = [...drag.startOffset];
    if (drag.kind === 'normal') {
      const [nx, ny] = drag.screenDir;
      const len2 = nx * nx + ny * ny;
      if (len2 < 1e-6) return;
      offset[drag.axis] =
        drag.startOffset[drag.axis]! +
        Math.round(((e.x - drag.startX) * nx + (e.y - drag.startY) * ny) / len2);
    } else {
      const p = this.planePoint(e, ctx, drag.axis, drag.grab[drag.axis]!);
      if (!p) return;
      const delta = p.map((v, i) => (i === drag.axis ? 0 : Math.round(v - drag.grab[i]!)));
      if (drag.oneAxis) {
        const keep =
          Math.abs(delta[(drag.axis + 1) % 3]!) >= Math.abs(delta[(drag.axis + 2) % 3]!)
            ? (drag.axis + 1) % 3
            : (drag.axis + 2) % 3;
        for (let i = 0; i < 3; i++) if (i !== keep) delta[i] = 0;
      }
      for (let i = 0; i < 3; i++) offset[i] = drag.startOffset[i]! + delta[i]!;
    }
    this.setOffset(ctx, offset);
  }

  /** Arrow keys move along the world axis that looks most like screen right / up; PageUp/Down along Y. */
  private arrowStep(code: string, ctx: ToolContext): Vec3 | null {
    if (code === 'PageUp') return [0, 1, 0];
    if (code === 'PageDown') return [0, -1, 0];
    const screen =
      code === 'ArrowRight'
        ? [1, 0]
        : code === 'ArrowLeft'
          ? [-1, 0]
          : code === 'ArrowUp'
            ? [0, -1]
            : code === 'ArrowDown'
              ? [0, 1]
              : null;
    if (!screen) return null;
    const target = this.floating?.target ?? ctx.object;
    if (!target) return null;
    const t = worldTransform(target);
    const origin = ctx.project(localToWorld(t, 0, 0, 0));
    let best: Vec3 = [0, 0, 0];
    let bestDot = 0;
    if (!origin) return null;
    for (const axis of [0, 2, 1]) {
      for (const sign of [1, -1]) {
        const v: Vec3 = [0, 0, 0];
        v[axis] = sign;
        const p = ctx.project(localToWorld(t, ...v));
        if (!p) continue;
        const dx = p[0] - origin[0];
        const dy = p[1] - origin[1];
        const len = Math.hypot(dx, dy) || 1;
        const dot = (dx * screen[0]! + dy * screen[1]!) / len;
        if (dot > bestDot + 1e-3) {
          bestDot = dot;
          best = v;
        }
      }
    }
    return bestDot > 0 ? best : null;
  }

  private setOffset(ctx: ToolContext, offset: Vec3): void {
    const f = this.floating!;
    if (offset.every((v, i) => v === f.offset[i])) return;
    f.offset = offset;
    f.object.transform = floatingTransform(worldTransform(f.target), offset);
    ctx.hint(`Shift ${offset.join(', ')}`);
    ctx.requestRender();
  }

  /** Puts the piece down as one step; returns that step, or null when nothing changed. */
  private drop(ctx: ToolContext): Command | null {
    const f = this.floating;
    if (!f) return null;
    this.floating = null;
    this.drag = null;
    dropFloating(f);
    ctx.setFloating(null);
    const voxels = f.tx.commit(f.label);
    const selection = f.selection.commit('Selection');
    const parts = [voxels, selection].filter((c) => c !== null);
    const command = parts.length > 0 ? new CompositeCommand(f.label, parts) : null;
    if (command) ctx.pushCommand(command);
    ctx.hint(null);
    ctx.requestRender();
    return command;
  }

  private cancel(ctx: ToolContext): void {
    const f = this.floating;
    if (!f) return;
    this.floating = null;
    this.drag = null;
    f.tx.cancel();
    f.selection.cancel();
    ctx.setFloating(null);
    ctx.hint(null);
    ctx.requestRender();
  }
}
