import type { VoxelDocument } from '../core/document';
import { quarterTurn } from '../core/orientation';
import { isLocked, type SceneNode } from '../core/scene';
import { orientNodes, transformNodes, worldBounds } from '../core/scene-edit';
import type { ToolPointerEvent } from '../input/types';
import type { Camera, Ray } from '../render/camera';
import type { LineBatch } from '../render/lines';
import type { Vec3 } from '../render/math';
import { AXIS_COLORS } from '../render/overlays';

/** A part of the gizmo: an axis arrow (move along it), a ring (turn about it), the centre. */
export type GizmoHandle = { kind: 'axis' | 'ring'; axis: number } | { kind: 'center' };

/** Sizes in CSS pixels: the gizmo keeps its size on screen at any zoom. */
const AXIS_PX = 84;
const RING_PX = 60;
const CENTER_PX = 9;
/** How far from a handle a pointer still grabs it: a finger is less precise than a mouse. */
const SLOP_MOUSE = 8;
const SLOP_TOUCH = 18;
const RING_SEGMENTS = 64;

const MOVE_LABEL = 'Move object';
const TURN_LABEL = 'Turn object';

const add = (a: Vec3, b: Vec3, s = 1): Vec3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (axis: number): Vec3 => [axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0];

/** World units per CSS pixel at a point, for keeping the gizmo a fixed size on screen. */
export function unitsPerPixel(camera: Camera, p: Vec3): number {
  const height = Math.max(1, camera.height);
  if (camera.projection === 'orthographic') return (2 * camera.halfHeightAtTarget()) / height;
  const depth = Math.max(0.01, dot(sub(p, camera.eye()), camera.forward()));
  return (2 * depth * Math.tan(camera.fovY / 2)) / height;
}

/** Distance from a point to a screen segment. */
function segmentDistance(px: number, py: number, a: Vec3, b: Vec3): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / len2)) : 0;
  return Math.hypot(px - a[0] - dx * t, py - a[1] - dy * t);
}

/** The two in-plane axes of the ring about `axis`, ordered so that u × v = axis. */
function ringBasis(axis: number): [Vec3, Vec3] {
  return [unit((axis + 1) % 3), unit((axis + 2) % 3)];
}

/** Where a ray crosses a plane, or null when it runs along it or points away. */
function rayPlane(ray: Ray, point: Vec3, normal: Vec3): Vec3 | null {
  const along = dot(ray.dir, normal);
  if (Math.abs(along) < 1e-6) return null;
  const t = dot(sub(point, ray.origin), normal) / along;
  return t < 0 ? null : add(ray.origin, ray.dir, t);
}

/** Parameter along the line `origin + s · axis` of the point closest to a ray. */
function lineParam(ray: Ray, origin: Vec3, axis: Vec3): number | null {
  const b = dot(axis, ray.dir);
  const denom = 1 - b * b;
  // The axis points almost straight at the camera: dragging along it means nothing.
  if (denom < 0.02) return null;
  const w = sub(ray.origin, origin);
  return (dot(axis, w) - b * dot(ray.dir, w)) / denom;
}

/** The plane the centre handle drags in: the floor, or an upright one seen from the side. */
function centerNormal(camera: Camera): Vec3 {
  const f = camera.forward();
  if (Math.abs(f[1]) > 0.25) return [0, 1, 0];
  return Math.abs(f[0]) > Math.abs(f[2]) ? [1, 0, 0] : [0, 0, 1];
}

/** Gizmo geometry for one frame. */
export interface GizmoFrame {
  readonly origin: Vec3;
  /** Arrow and ring sizes in world units. */
  readonly length: number;
  readonly radius: number;
}

export function gizmoFrame(camera: Camera, nodes: readonly SceneNode[]): GizmoFrame | null {
  const box = worldBounds(nodes);
  if (!box) return null;
  const origin: Vec3 = [
    (box.minX + box.maxX + 1) / 2,
    (box.minY + box.maxY + 1) / 2,
    (box.minZ + box.maxZ + 1) / 2,
  ];
  const upp = unitsPerPixel(camera, origin);
  return { origin, length: AXIS_PX * upp, radius: RING_PX * upp };
}

function ringPoint(frame: GizmoFrame, axis: number, angle: number): Vec3 {
  const [u, v] = ringBasis(axis);
  return add(
    add(frame.origin, u, frame.radius * Math.cos(angle)),
    v,
    frame.radius * Math.sin(angle),
  );
}

/** The handle under a screen point, or null. */
export function gizmoHandleAt(
  camera: Camera,
  frame: GizmoFrame,
  x: number,
  y: number,
  slop: number,
): GizmoHandle | null {
  const o = camera.project(frame.origin);
  if (Math.hypot(x - o[0], y - o[1]) <= CENTER_PX + slop) return { kind: 'center' };
  let best: GizmoHandle | null = null;
  let bestDistance = slop;
  for (let axis = 0; axis < 3; axis++) {
    const dir = unit(axis);
    const a = camera.project(add(frame.origin, dir, frame.length * 0.25));
    const b = camera.project(add(frame.origin, dir, frame.length));
    const d = segmentDistance(x, y, a, b);
    if (d < bestDistance) {
      bestDistance = d;
      best = { kind: 'axis', axis };
    }
  }
  // Arrows win over rings where they cross.
  if (best) return best;
  for (let axis = 0; axis < 3; axis++) {
    let prev = camera.project(ringPoint(frame, axis, 0));
    for (let i = 1; i <= RING_SEGMENTS; i++) {
      const next = camera.project(ringPoint(frame, axis, (i / RING_SEGMENTS) * Math.PI * 2));
      const d = segmentDistance(x, y, prev, next);
      if (d < bestDistance) {
        bestDistance = d;
        best = { kind: 'ring', axis };
      }
      prev = next;
    }
  }
  return best;
}

interface Drag {
  readonly handle: GizmoHandle;
  readonly nodes: readonly SceneNode[];
  readonly origin: Vec3;
  /** Axis: start parameter. Centre: start point on the plane. Ring: last angle. */
  start: number | Vec3;
  /** Whole voxels moved so far (axis, centre) or quarter turns made (ring). */
  applied: Vec3 | number;
  /** Ring: angle turned so far, unwrapped. */
  angle: number;
  readonly normal: Vec3;
}

/**
 * Moves and turns scene nodes: arrows move along an axis by whole voxels, the centre moves in
 * the floor plane, rings turn by quarter turns once dragged past 45°. One gesture is one step
 * of history.
 */
export class ObjectGizmo {
  hovered: GizmoHandle | null = null;
  private drag: Drag | null = null;

  constructor(
    private readonly doc: () => VoxelDocument,
    private readonly camera: Camera,
    private readonly targets: () => SceneNode[],
  ) {}

  get dragging(): boolean {
    return this.drag !== null;
  }

  /** Nodes the gizmo moves, without locked ones. */
  private movable(): SceneNode[] {
    return this.targets().filter((n) => !isLocked(n));
  }

  /** Handles a pointer event; returns true when the gizmo took it. */
  pointer(e: ToolPointerEvent): boolean {
    const frame = gizmoFrame(this.camera, this.targets());
    if (e.phase === 'hover') {
      const handle = frame ? gizmoHandleAt(this.camera, frame, e.x, e.y, SLOP_MOUSE) : null;
      this.hovered = handle && this.movable().length > 0 ? handle : null;
      return this.hovered !== null;
    }
    if (e.phase === 'down') {
      if (!frame || e.button !== 'primary') return false;
      const slop = e.pointerType === 'touch' ? SLOP_TOUCH : SLOP_MOUSE;
      const handle = gizmoHandleAt(this.camera, frame, e.x, e.y, slop);
      const nodes = this.movable();
      if (!handle || nodes.length === 0) return false;
      this.begin(handle, nodes, frame.origin, this.camera.rayAt(e.x, e.y));
      return true;
    }
    const drag = this.drag;
    if (!drag) return false;
    if (e.phase === 'move') this.update(drag, this.camera.rayAt(e.x, e.y));
    else {
      // Up or cancel: the step stays; undo takes the whole gesture back.
      this.drag = null;
      this.hovered = null;
      this.doc().history.closeMerge();
    }
    return true;
  }

  /** Starts moving the targets on the floor from a point on one of them: drag anywhere. */
  grab(point: Vec3, ray: Ray): void {
    const nodes = this.movable();
    if (nodes.length > 0) this.begin({ kind: 'center' }, nodes, point, ray);
  }

  private begin(handle: GizmoHandle, nodes: SceneNode[], origin: Vec3, ray: Ray): void {
    this.doc().history.closeMerge();
    let normal: Vec3 = [0, 1, 0];
    let start: number | Vec3 = 0;
    if (handle.kind === 'axis') {
      start = lineParam(ray, origin, unit(handle.axis)) ?? 0;
    } else if (handle.kind === 'center') {
      normal = centerNormal(this.camera);
      start = rayPlane(ray, origin, normal) ?? origin;
    } else {
      normal = unit(handle.axis);
      start = this.ringAngle(ray, origin, handle.axis) ?? 0;
    }
    this.drag = {
      handle,
      nodes,
      origin,
      start,
      applied: handle.kind === 'ring' ? 0 : [0, 0, 0],
      angle: 0,
      normal,
    };
    this.hovered = handle;
  }

  private ringAngle(ray: Ray, origin: Vec3, axis: number): number | null {
    // Seen edge-on, the ring plane gives no stable angle.
    if (Math.abs(dot(ray.dir, unit(axis))) < 0.05) return null;
    const hit = rayPlane(ray, origin, unit(axis));
    if (!hit) return null;
    const [u, v] = ringBasis(axis);
    const w = sub(hit, origin);
    return Math.atan2(dot(w, v), dot(w, u));
  }

  private update(drag: Drag, ray: Ray): void {
    const doc = this.doc();
    const handle = drag.handle;
    if (handle.kind === 'ring') {
      const angle = this.ringAngle(ray, drag.origin, handle.axis);
      if (angle === null) return;
      let delta = angle - (drag.start as number);
      if (delta > Math.PI) delta -= Math.PI * 2;
      else if (delta < -Math.PI) delta += Math.PI * 2;
      drag.start = angle;
      drag.angle += delta;
      const turns = Math.round(drag.angle / (Math.PI / 2));
      const applied = drag.applied as number;
      for (let i = applied; i < turns; i++)
        orientNodes(doc, drag.nodes, quarterTurn(handle.axis), TURN_LABEL, true);
      for (let i = applied; i > turns; i--)
        orientNodes(doc, drag.nodes, quarterTurn(handle.axis, true), TURN_LABEL, true);
      drag.applied = turns;
      return;
    }
    let total: Vec3;
    if (handle.kind === 'axis') {
      const s = lineParam(ray, drag.origin, unit(handle.axis));
      if (s === null) return;
      const step = Math.round(s - (drag.start as number));
      total = [0, 0, 0];
      total[handle.axis] = step;
    } else {
      const hit = rayPlane(ray, drag.origin, drag.normal);
      if (!hit) return;
      const d = sub(hit, drag.start as Vec3);
      total = [Math.round(d[0]), Math.round(d[1]), Math.round(d[2])];
      for (let i = 0; i < 3; i++) if (drag.normal[i] !== 0) total[i] = 0;
    }
    const applied = drag.applied as Vec3;
    const by = sub(total, applied);
    if (by[0] === 0 && by[1] === 0 && by[2] === 0) return;
    transformNodes(
      doc,
      drag.nodes,
      { x: by[0], y: by[1], z: by[2], orientation: 0 },
      MOVE_LABEL,
      true,
    );
    drag.applied = total;
  }

  /** Drops the gesture without undoing what it did (the tool or mode changed). */
  cancel(): void {
    if (this.drag) this.doc().history.closeMerge();
    this.drag = null;
    this.hovered = null;
  }

  /** Draws the gizmo into a batch drawn over everything. */
  draw(batch: LineBatch): void {
    const targets = this.targets();
    const frame = gizmoFrame(this.camera, targets);
    if (!frame) return;
    const locked = this.movable().length === 0;
    const active = this.drag?.handle ?? this.hovered;
    const same = (h: GizmoHandle) =>
      active !== null &&
      active.kind === h.kind &&
      (h.kind === 'center' || (active.kind !== 'center' && active.axis === h.axis));
    const colour = (axis: number, h: GizmoHandle, alpha = 1): number[] => {
      if (locked) return [0.6, 0.62, 0.66, 0.5];
      const c = AXIS_COLORS[axis]!;
      if (same(h)) return [1, 0.85, 0.45, 1];
      return [c[0]!, c[1]!, c[2]!, alpha];
    };
    for (let axis = 0; axis < 3; axis++) {
      const h: GizmoHandle = { kind: 'ring', axis };
      const c = colour(axis, h, 0.8);
      const width = same(h) ? 3.5 : 2;
      let prev = ringPoint(frame, axis, 0);
      for (let i = 1; i <= RING_SEGMENTS; i++) {
        const next = ringPoint(frame, axis, (i / RING_SEGMENTS) * Math.PI * 2);
        batch.add(prev, next, c, width);
        prev = next;
      }
    }
    for (let axis = 0; axis < 3; axis++) {
      const h: GizmoHandle = { kind: 'axis', axis };
      const dir = unit(axis);
      const c = colour(axis, h);
      const width = same(h) ? 4 : 3;
      batch.add(
        add(frame.origin, dir, frame.length * 0.25),
        add(frame.origin, dir, frame.length),
        c,
        width,
      );
      // A thick stub at the end reads as the arrow head.
      batch.add(
        add(frame.origin, dir, frame.length * 0.86),
        add(frame.origin, dir, frame.length * 1.08),
        c,
        width * 3,
      );
    }
    // The centre: a small square facing the camera.
    const view = this.camera.view;
    const right: Vec3 = [view[0]!, view[4]!, view[8]!];
    const up: Vec3 = [view[1]!, view[5]!, view[9]!];
    const r = (CENTER_PX * frame.length) / AXIS_PX;
    const corners = [
      add(add(frame.origin, right, -r), up, -r),
      add(add(frame.origin, right, r), up, -r),
      add(add(frame.origin, right, r), up, r),
      add(add(frame.origin, right, -r), up, r),
    ];
    const center: GizmoHandle = { kind: 'center' };
    const cc = locked ? [0.6, 0.62, 0.66, 0.5] : same(center) ? [1, 0.85, 0.45, 1] : [1, 1, 1, 0.9];
    for (let i = 0; i < 4; i++)
      batch.add(corners[i]!, corners[(i + 1) % 4]!, cc, same(center) ? 3 : 2);
  }
}
