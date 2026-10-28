import type { Camera, Projection } from './camera';
import type { Vec3 } from './math';

/** Radians per pixel of an orbit drag. */
const ORBIT_SPEED = 0.006;
/** Pitch stays just short of straight up/down while dragging, so the view never flips. */
const PITCH_LIMIT = Math.PI / 2 - 1e-4;
const MIN_DISTANCE = 0.5;
const MAX_DISTANCE = 50000;
/** Inertia: velocity decays with this time constant; below the threshold it stops. */
const COAST_TAU_MS = 160;
const COAST_MIN_SPEED = 0.02;
/** Velocities from samples older than this are ignored when the drag ends. */
const VELOCITY_WINDOW_MS = 80;

export interface CameraState {
  target: Vec3;
  yaw: number;
  pitch: number;
  distance: number;
  projection?: Projection;
}

type DragMode = 'orbit' | 'pan' | 'zoom';

interface Animation {
  from: CameraState;
  to: CameraState;
  start: number;
  duration: number;
}

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

/** Camera basis for a yaw and pitch: right, up and back (from target towards the eye). */
function basis(yaw: number, pitch: number): [Vec3, Vec3, Vec3] {
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  return [
    [cy, 0, -sy],
    [-sp * sy, cp, -sp * cy],
    [cp * sy, sp, cp * cy],
  ];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Shortest signed angle from a to b. */
function angleDelta(a: number, b: number): number {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

/**
 * Camera navigation on top of the orbit camera: orbit around any point, pan that keeps the
 * grabbed point under the pointer, zoom towards the pointer, inertia after a drag and smooth
 * transitions. Pure math on the Camera; the caller passes world points under the pointer.
 */
export class CameraController {
  /** Orbit around the point under the pointer when the drag starts on the model. */
  orbitAroundAnchor = true;

  private mode: DragMode | null = null;
  private anchor: Vec3 | null = null;
  /** World units per pixel for the current pan. */
  private panScale = 0;
  private velocity = { mode: 'orbit' as DragMode, x: 0, y: 0, time: 0 };
  private coast: { mode: DragMode; vx: number; vy: number } | null = null;
  private animation: Animation | null = null;

  constructor(readonly camera: Camera) {}

  /** True while inertia or a transition is running; the caller keeps drawing frames. */
  get animating(): boolean {
    return this.coast !== null || this.animation !== null;
  }

  begin(mode: DragMode, anchor: Vec3 | null): void {
    this.stop();
    this.mode = mode;
    this.anchor = mode === 'orbit' && !this.orbitAroundAnchor ? null : anchor;
    this.velocity = { mode, x: 0, y: 0, time: 0 };
    if (mode === 'pan') this.panScale = this.worldPerPixel(anchor);
  }

  orbit(dx: number, dy: number, time: number): void {
    this.track('orbit', dx, dy, time);
    this.applyOrbit(dx, dy);
  }

  pan(dx: number, dy: number, time: number): void {
    if (this.mode !== 'pan') this.panScale = this.worldPerPixel(null);
    this.track('pan', dx, dy, time);
    this.applyPan(dx, dy, this.panScale);
  }

  /**
   * Zooms by `factor` (< 1 is closer) keeping `anchor` — the world point under the pointer —
   * fixed on screen. Without an anchor it zooms towards the target.
   */
  zoom(factor: number, anchor: Vec3 | null): void {
    this.stopCoast();
    this.animation = null;
    const c = this.camera;
    const distance = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, c.distance * factor));
    const k = distance / c.distance;
    if (anchor) {
      // Scaling the whole rig about the anchor keeps the anchor's projection in place.
      c.target = [
        anchor[0] + (c.target[0] - anchor[0]) * k,
        anchor[1] + (c.target[1] - anchor[1]) * k,
        anchor[2] + (c.target[2] - anchor[2]) * k,
      ];
    }
    c.distance = distance;
  }

  /** The drag ended at `time`: keep moving with the release velocity if it was fast. */
  end(time: number): void {
    const v = this.velocity;
    const fresh = time - v.time < VELOCITY_WINDOW_MS;
    if (this.mode && this.mode !== 'zoom' && fresh && Math.hypot(v.x, v.y) > COAST_MIN_SPEED * 4) {
      this.coast = { mode: v.mode, vx: v.x, vy: v.y };
    }
    this.mode = null;
  }

  /** Smoothly moves the camera to a state. */
  animateTo(to: CameraState, now: number, duration = 260): void {
    this.stopCoast();
    const c = this.camera;
    if (to.projection) c.projection = to.projection;
    this.animation = {
      from: { target: [...c.target], yaw: c.yaw, pitch: c.pitch, distance: c.distance },
      to: { ...to, yaw: c.yaw + angleDelta(c.yaw, to.yaw) },
      start: now,
      duration,
    };
  }

  /** Makes `point` the centre of rotation: the camera turns to it without moving the eye. */
  setPivot(point: Vec3, now: number): void {
    const eye = this.camera.eye();
    const d: Vec3 = [eye[0] - point[0], eye[1] - point[1], eye[2] - point[2]];
    const distance = Math.max(MIN_DISTANCE, Math.hypot(d[0], d[1], d[2]));
    const pitch = Math.asin(Math.max(-1, Math.min(1, d[1] / distance)));
    const yaw = Math.atan2(d[0], d[2]);
    this.animateTo({ target: [...point], yaw, pitch, distance }, now, 220);
  }

  /** Advances inertia and transitions to `now`; returns true while still moving. */
  update(now: number, dt: number): boolean {
    if (this.animation) {
      const a = this.animation;
      const t = Math.min(1, (now - a.start) / a.duration);
      const e = easeOutCubic(t);
      const c = this.camera;
      const lerp = (x: number, y: number) => x + (y - x) * e;
      c.target = [
        lerp(a.from.target[0], a.to.target[0]),
        lerp(a.from.target[1], a.to.target[1]),
        lerp(a.from.target[2], a.to.target[2]),
      ];
      c.yaw = lerp(a.from.yaw, a.to.yaw);
      c.pitch = lerp(a.from.pitch, a.to.pitch);
      // Interpolate distance geometrically: zooming feels even at any scale.
      c.distance = a.from.distance * (a.to.distance / a.from.distance) ** e;
      if (t >= 1) this.animation = null;
    }
    if (this.coast && dt > 0) {
      const k = this.coast;
      const dx = k.vx * dt;
      const dy = k.vy * dt;
      if (k.mode === 'orbit') this.applyOrbit(dx, dy);
      else this.applyPan(dx, dy, this.worldPerPixel(null));
      const decay = Math.exp(-dt / COAST_TAU_MS);
      k.vx *= decay;
      k.vy *= decay;
      if (Math.hypot(k.vx, k.vy) < COAST_MIN_SPEED) this.coast = null;
    }
    return this.animating;
  }

  /** Stops inertia and transitions (a new gesture takes over). */
  stop(): void {
    this.stopCoast();
    this.animation = null;
  }

  private stopCoast(): void {
    this.coast = null;
  }

  private track(mode: DragMode, dx: number, dy: number, time: number): void {
    const v = this.velocity;
    const dt = time - v.time;
    if (v.time > 0 && dt > 0 && dt < 100) {
      // Exponential average of pixels per millisecond, biased towards the latest samples.
      const k = Math.min(1, dt / 40);
      v.x = v.x + (dx / dt - v.x) * k;
      v.y = v.y + (dy / dt - v.y) * k;
    } else {
      v.x = 0;
      v.y = 0;
    }
    v.mode = mode;
    v.time = time;
  }

  private applyOrbit(dx: number, dy: number): void {
    const c = this.camera;
    const yaw = c.yaw - dx * ORBIT_SPEED;
    const pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, c.pitch + dy * ORBIT_SPEED));
    const p = this.anchor;
    if (p) {
      // Rotate the whole rig about the anchor: express the target offset in the old camera
      // basis and rebuild it in the new one.
      const [r0, u0, b0] = basis(c.yaw, c.pitch);
      const [r1, u1, b1] = basis(yaw, pitch);
      const v: Vec3 = [c.target[0] - p[0], c.target[1] - p[1], c.target[2] - p[2]];
      const x = dot(v, r0);
      const y = dot(v, u0);
      const z = dot(v, b0);
      c.target = [
        p[0] + x * r1[0] + y * u1[0] + z * b1[0],
        p[1] + x * r1[1] + y * u1[1] + z * b1[1],
        p[2] + x * r1[2] + y * u1[2] + z * b1[2],
      ];
    }
    c.yaw = yaw;
    c.pitch = pitch;
  }

  private applyPan(dx: number, dy: number, scale: number): void {
    const c = this.camera;
    const [right, up] = basis(c.yaw, c.pitch);
    for (let i = 0; i < 3; i++) c.target[i] = c.target[i]! - (dx * right[i]! - dy * up[i]!) * scale;
  }

  /**
   * World units per screen pixel at the depth of `at` (or of the target): panning by that much
   * keeps the grabbed point under the pointer.
   */
  private worldPerPixel(at: Vec3 | null): number {
    const c = this.camera;
    const h = Math.max(1, c.height);
    if (c.projection === 'orthographic' || !at) return (2 * c.halfHeightAtTarget()) / h;
    const eye = c.eye();
    const forward = c.forward();
    const depth = Math.max(
      c.distance * 0.01,
      dot([at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]], forward),
    );
    return (2 * depth * Math.tan(c.fovY / 2)) / h;
  }
}
