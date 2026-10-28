import { Chunk } from '../chunk';
import { CHUNK_SIZE, CHUNK_VOLUME, keyX, keyY, keyZ } from '../coords';
import type { Operation } from '../operation';
import { isLocked, type VoxelObject } from '../scene';
import { VoxelTransaction } from '../voxel-edit';
import type { OverlaySink, Tool, ToolContext, ToolEvent, ToolHit } from './tool';

/** An eyedropper cursor: the tip is the hot spot. */
export const PIPETTE_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 22 22'%3E%3Cpath d='M3 19 L3 16 L12 7 L15 10 L6 19 Z' fill='white' stroke='black' stroke-width='1.2'/%3E%3Cpath d='M12 7 L14 5 A2.5 2.5 0 0 1 17.5 8.5 L15 10 Z' fill='black'/%3E%3C/svg%3E\") 3 19, crosshair";

const OUTLINE = [1, 0.62, 0.26, 1];

/** Palette id under a viewport point, or null over empty space. */
function voxelAt(e: ToolEvent, ctx: ToolContext): ToolHit | null {
  if (!Number.isFinite(e.x)) return null;
  const hit = ctx.pick(ctx.rayAt(e.x, e.y));
  return hit && !hit.onPlane ? hit : null;
}

/** Takes the colour of the voxel under the pointer. Alt + click does the same in any tool. */
export class PipetteTool implements Tool {
  readonly id = 'pipette';
  readonly cursor = PIPETTE_CURSOR;
  private hover: ToolHit | null = null;

  handle(e: ToolEvent, ctx: ToolContext): void {
    if (e.phase === 'hover' || e.phase === 'move') {
      this.hover = voxelAt(e, ctx);
      ctx.hint(this.hover ? `Pick color ${this.hover.value}` : 'Eyedropper: hover over a voxel');
      ctx.requestRender();
    } else if (e.phase === 'down') {
      const hit = voxelAt(e, ctx);
      if (hit) ctx.setColor(hit.value);
    }
  }

  overlay(sink: OverlaySink, ctx: ToolContext): void {
    const h = this.hover;
    if (h && ctx.object) sink.faceOutline(ctx.object, h.x, h.y, h.z, h.face, OUTLINE);
  }

  deactivate(): void {
    this.hover = null;
  }
}

/** Every voxel of colour `from` in an object, as a paint operation to `to`. */
function replaceOperation(object: VoxelObject, from: number, to: number): Operation {
  const dense = new Uint16Array(CHUNK_VOLUME);
  return {
    action: 'paint',
    forEachCell(visit) {
      for (const [key, chunk] of object.volume.chunks()) {
        chunk.decodeInto(dense);
        const ox = keyX(key) * CHUNK_SIZE;
        const oy = keyY(key) * CHUNK_SIZE;
        const oz = keyZ(key) * CHUNK_SIZE;
        for (let i = 0; i < CHUNK_VOLUME; i++) {
          if (dense[i] !== from) continue;
          visit(ox + (i & 31), oy + ((i >> 5) & 31), oz + (i >> 10), to);
        }
      }
    },
  };
}

/**
 * Replaces one colour by another in a whole object, chunk by chunk through dense buffers, as
 * one transaction. Returns how many voxels changed.
 */
export function replaceColor(
  object: VoxelObject,
  from: number,
  to: number,
  tx: VoxelTransaction,
): number {
  if (from === to || from === 0) return 0;
  const dense = new Uint16Array(CHUNK_VOLUME);
  let changed = 0;
  for (const [key, chunk] of [...object.volume.chunks()]) {
    chunk.decodeInto(dense);
    let hits = 0;
    for (let i = 0; i < CHUNK_VOLUME; i++) {
      if (dense[i] === from) {
        dense[i] = to;
        hits++;
      }
    }
    if (hits === 0) continue;
    changed += hits;
    tx.putChunk(object, key, Chunk.fromDense(dense));
  }
  return changed;
}

/**
 * Click a voxel: every voxel of its colour in the object takes the current colour. The preview
 * shows them all in the new colour first.
 */
export class ReplaceTool implements Tool {
  readonly id = 'replace';
  readonly cursor = 'crosshair';
  private hover: ToolHit | null = null;
  private previewKey = '';

  handle(e: ToolEvent, ctx: ToolContext): void {
    const object = ctx.object;
    if (e.phase === 'hover' || e.phase === 'move') {
      this.hover = voxelAt(e, ctx);
      const from = this.hover?.value ?? 0;
      const to = ctx.settings.color;
      const key =
        object && from && from !== to ? `${object.id}|${from}|${to}|${object.volume.revision}` : '';
      if (key !== this.previewKey) {
        this.previewKey = key;
        ctx.preview(key && object ? replaceOperation(object, from, to) : null);
      }
      ctx.hint(
        this.hover
          ? `Replace color ${from} with ${to} in the whole object`
          : 'Replace color: hover over a voxel',
      );
      ctx.requestRender();
      return;
    }
    if (e.phase !== 'down' || !object || isLocked(object)) return;
    const hit = voxelAt(e, ctx);
    if (!hit) return;
    const tx = new VoxelTransaction();
    replaceColor(object, hit.value, ctx.settings.color, tx);
    this.previewKey = '';
    ctx.preview(null);
    ctx.commit(tx, 'Replace color');
    ctx.requestRender();
  }

  overlay(sink: OverlaySink, ctx: ToolContext): void {
    const h = this.hover;
    if (h && ctx.object) sink.faceOutline(ctx.object, h.x, h.y, h.z, h.face, OUTLINE);
  }

  settingsChanged(ctx: ToolContext): void {
    this.previewKey = '';
    ctx.preview(null);
  }

  deactivate(ctx: ToolContext): void {
    this.hover = null;
    this.previewKey = '';
    ctx.preview(null);
  }
}
