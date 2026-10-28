import { quarterTurn, reflection } from '../core/orientation';
import { pickVoxel } from '../core/picking';
import { isHidden, isLocked, type VoxelObject } from '../core/scene';
import { orientNodes, transformNodes } from '../core/scene-edit';
import type { ToolPointerEvent } from '../input/types';
import type { Vec3 } from '../render/math';
import type { Editor } from './editor';

/** Two presses this close in time and space make a double click. */
const DOUBLE_MS = 350;
const DOUBLE_PX = 6;

/**
 * Scene mode in the viewport: clicking picks objects (Shift or Ctrl adds), dragging an object
 * moves it on the floor, a double click opens it for editing; arrows, PageUp / PageDown, Q, E
 * and H move and turn the selected objects. The gizmo comes first where its handles are.
 */
export class SceneMode {
  private lastDown: { x: number; y: number; time: number; node: VoxelObject | null } | null = null;

  constructor(private readonly editor: Editor) {}

  /** The visible object under a viewport point. */
  objectAt(x: number, y: number): VoxelObject | null {
    const e = this.editor;
    e.camera.update();
    const ray = e.camera.rayAt(x, y);
    const visible = e.doc.scene.objects().filter((o) => !isHidden(o));
    return pickVoxel(visible, ray.origin, ray.dir, (o) => e.pickSource(o))?.object ?? null;
  }

  pointer(event: ToolPointerEvent): void {
    const e = this.editor;
    const gizmo = e.gizmo;
    if (gizmo.dragging) {
      gizmo.pointer(event);
      e.setToolCursor(gizmo.dragging ? 'grabbing' : 'grab');
      e.requestFrame();
      return;
    }
    if (event.phase === 'hover') {
      const before = gizmo.hovered;
      if (gizmo.pointer(event)) e.setToolCursor('grab');
      else e.setToolCursor(this.objectAt(event.x, event.y) ? 'pointer' : 'default');
      if (gizmo.hovered !== before) e.requestFrame();
      return;
    }
    if (event.phase !== 'down' || event.button !== 'primary') return;
    const object = this.objectAt(event.x, event.y);
    const last = this.lastDown;
    this.lastDown = { x: event.x, y: event.y, time: event.time, node: object };
    if (
      object &&
      last?.node === object &&
      event.time - last.time < DOUBLE_MS &&
      Math.hypot(event.x - last.x, event.y - last.y) < DOUBLE_PX
    ) {
      // Double click, even on a gizmo handle: edit this object's voxels.
      this.lastDown = null;
      e.selectNodes([object]);
      e.setMode('model');
      return;
    }
    if (gizmo.pointer(event)) {
      e.setToolCursor('grabbing');
      e.requestFrame();
      return;
    }
    const selected = e.selectedNodes.get();
    const adding = event.shift || event.ctrl;
    if (!object) {
      if (!adding) e.selectNodes([]);
      return;
    }
    if (adding) {
      e.selectNodes(
        selected.includes(object) ? selected.filter((n) => n !== object) : [...selected, object],
      );
      return;
    }
    // Clicking one of several selected objects keeps them all, so they move together.
    if (!selected.includes(object)) e.selectNodes([object]);
    else e.setActiveObject(object);
    if (!isLocked(object)) {
      const ray = e.camera.rayAt(event.x, event.y);
      const hit = pickVoxel([object], ray.origin, ray.dir, (o) => e.pickSource(o));
      const point: Vec3 = hit
        ? [
            ray.origin[0] + ray.dir[0] * hit.t,
            ray.origin[1] + ray.dir[1] * hit.t,
            ray.origin[2] + ray.dir[2] * hit.t,
          ]
        : [0, 0, 0];
      gizmo.grab(point, ray);
      e.setToolCursor('grabbing');
    }
    e.requestFrame();
  }

  /** Keys of scene mode; true when used. */
  key(code: string, shift: boolean): boolean {
    const e = this.editor;
    const nodes = e.sceneTargets();
    if (code === 'Escape') {
      if (e.gizmo.dragging) e.gizmo.cancel();
      else e.selectNodes([]);
      return true;
    }
    if (nodes.length === 0) return false;
    const step = this.arrowStep(code);
    if (step) {
      transformNodes(
        e.doc,
        nodes,
        { x: step[0], y: step[1], z: step[2], orientation: 0 },
        'Move object',
      );
      return true;
    }
    if (code === 'KeyQ' || code === 'KeyE') {
      const axis = shift ? this.sideAxis() : 1;
      orientNodes(e.doc, nodes, quarterTurn(axis, code === 'KeyE'), 'Turn object');
      return true;
    }
    if (code === 'KeyH') {
      orientNodes(e.doc, nodes, reflection(shift ? 1 : this.sideAxis()), 'Flip object');
      return true;
    }
    return false;
  }

  /** The world axis (X or Z) that looks most horizontal on screen. */
  private sideAxis(): number {
    const c = this.editor.camera;
    const o = c.project(c.target);
    const px = c.project([c.target[0] + 1, c.target[1], c.target[2]]);
    const pz = c.project([c.target[0], c.target[1], c.target[2] + 1]);
    const h = (p: Vec3) => Math.abs(p[0] - o[0]) / (Math.hypot(p[0] - o[0], p[1] - o[1]) || 1);
    return h(px) >= h(pz) ? 0 : 2;
  }

  /** Arrows move along the world axis that looks most like screen right / up. */
  private arrowStep(code: string): Vec3 | null {
    if (code === 'PageUp') return [0, 1, 0];
    if (code === 'PageDown') return [0, -1, 0];
    const screen: Record<string, [number, number]> = {
      ArrowRight: [1, 0],
      ArrowLeft: [-1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const want = screen[code];
    if (!want) return null;
    const c = this.editor.camera;
    const o = c.project(c.target);
    let best: Vec3 | null = null;
    let bestDot = 0;
    for (const axis of [0, 2, 1]) {
      for (const sign of [1, -1]) {
        const v: Vec3 = [0, 0, 0];
        v[axis] = sign;
        const p = c.project([c.target[0] + v[0], c.target[1] + v[1], c.target[2] + v[2]]);
        const dx = p[0] - o[0];
        const dy = p[1] - o[1];
        const d = (dx * want[0] + dy * want[1]) / (Math.hypot(dx, dy) || 1);
        if (d > bestDot + 1e-3) {
          bestDot = d;
          best = v;
        }
      }
    }
    return best;
  }
}
