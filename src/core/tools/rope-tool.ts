import { worldTransform } from '../scene';
import { localToWorld } from '../transform';
import { brushTarget } from './brush';
import type { OverlaySink, Tool, ToolContext, ToolEvent, ToolHit, Vec3 } from './tool';

const LINE = [1, 0.62, 0.26, 1];

/**
 * The rope tool (rope / chain / cable): press on the model where the rope
 * starts, release where it ends. The editor then hangs a rope between the two points, letting it
 * sag and settle on the model (app/ropes.ts); this tool only picks the ends.
 */
export class RopeTool implements Tool {
  readonly id = 'rope';
  readonly cursor = 'crosshair';
  private start: Vec3 | null = null;
  private end: Vec3 | null = null;
  private hover: ToolHit | null = null;

  handle(e: ToolEvent, ctx: ToolContext): void {
    const hit = Number.isFinite(e.x) ? ctx.pick(ctx.rayAt(e.x, e.y)) : null;
    const point = hit ? this.anchor(hit, ctx) : null;
    switch (e.phase) {
      case 'hover':
        this.hover = hit;
        ctx.hint('Rope: press where it starts, release where it ends');
        break;
      case 'down':
        this.start = point;
        this.end = point;
        break;
      case 'move':
        if (this.start) this.end = point ?? this.end;
        else this.hover = hit;
        break;
      case 'up':
        {
          const [a, b] = [this.start, this.end];
          if (a && b?.some((v, i) => v !== a[i])) ctx.makeRope(a, b);
        }
        this.start = null;
        this.end = null;
        break;
      case 'cancel':
        this.start = null;
        this.end = null;
        break;
    }
    ctx.requestRender();
  }

  key(code: string, ctx: ToolContext): boolean {
    if (code !== 'Escape' || !this.start) return false;
    this.start = null;
    this.end = null;
    ctx.requestRender();
    return true;
  }

  overlay(sink: OverlaySink, ctx: ToolContext): void {
    if (this.start && this.end) {
      sink.line(this.start, this.end, LINE, 2);
      return;
    }
    const hit = this.hover;
    if (hit && ctx.object) sink.faceOutline(ctx.object, hit.x, hit.y, hit.z, hit.face, LINE);
  }

  deactivate(): void {
    this.start = null;
    this.end = null;
    this.hover = null;
  }

  /** The world point a rope end holds on to: the middle of the cell in front of the face. */
  private anchor(hit: ToolHit, ctx: ToolContext): Vec3 | null {
    const object = ctx.object;
    const cell = brushTarget(hit, 'add');
    if (!object || !cell) return null;
    return localToWorld(worldTransform(object), cell[0]! + 0.5, cell[1]! + 0.5, cell[2]! + 0.5);
  }
}
