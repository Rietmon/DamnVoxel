import type { InputSink, Modifiers, PointerSample } from './types';

/** A tap is shorter than this and moves less than TAP_SLOP pixels. */
const TAP_MS = 300;
const TAP_SLOP = 12;
/** Two one-finger taps this close in time and space are a double tap. */
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_SLOP = 30;
/** A finger or pen held this long within LONG_PRESS_SLOP pixels opens the radial menu. */
export const LONG_PRESS_MS = 500;
export const LONG_PRESS_SLOP = 10;

interface Finger {
  x: number;
  y: number;
  startX: number;
  startY: number;
}

const NO_MODIFIERS: Modifiers = { shift: false, ctrl: false, alt: false };

/**
 * Touch gestures:
 * - one finger drives the tool;
 * - two fingers orbit (move) and zoom (pinch); three fingers pan;
 * - a second finger cancels the tool gesture the first one started;
 * - a quick tap with two fingers is undo, with three — redo;
 * - a long press with one finger opens the radial menu (the DOM layer times it), and the same
 *   finger then picks in it;
 * - in camera-only mode one finger orbits and two fingers pan and zoom;
 * - once a pen has been used, fingers never draw (a resting palm must not paint): they behave as
 *   in camera-only mode, and a finger held while the pen lands becomes the pen's modifier.
 *
 * Pure logic: the DOM layer feeds it pointer events with timestamps.
 */
export class TouchGestures {
  /** One finger moves the camera instead of the tool (a toolbar toggle). */
  cameraOnly = false;
  /** A pen draws: fingers only move the camera. */
  penMode = false;

  private readonly fingers = new Map<number, Finger>();
  private mode: 'idle' | 'tool' | 'camera' | 'menu' = 'idle';
  private toolFinger = -1;
  private menuFinger = -1;
  private maxFingers = 0;
  private startTime = 0;
  private moved = 0;
  private cx = 0;
  private cy = 0;
  private spread = 0;
  private lastTap: { x: number; y: number; time: number } | null = null;
  /** Fingers held as a pen modifier: they move nothing until lifted. */
  private holding = false;

  constructor(
    private readonly sink: InputSink,
    private readonly modifiers: () => Modifiers = () => NO_MODIFIERS,
  ) {}

  get active(): boolean {
    return this.fingers.size > 0;
  }

  private get cameraFingers(): boolean {
    return this.cameraOnly || this.penMode;
  }

  /**
   * Where a long press would open the menu: the only finger, while it has barely moved. Not
   * with a pen in use, where a held finger is the pen's modifier.
   */
  pressCandidate(): { x: number; y: number } | null {
    if (this.fingers.size !== 1 || this.holding || this.penMode || this.mode === 'menu')
      return null;
    if (this.moved >= LONG_PRESS_SLOP) return null;
    const [id, finger] = [...this.fingers][0]!;
    return id === this.toolFinger || this.mode !== 'tool' ? { x: finger.x, y: finger.y } : null;
  }

  /** The long press fired: the finger drops what it was doing and drives the radial menu. */
  longPress(): void {
    const at = this.pressCandidate();
    if (!at) return;
    if (this.mode === 'tool') this.emitToolCancel();
    if (this.mode === 'camera') this.sink.camera({ kind: 'end' });
    this.mode = 'menu';
    this.menuFinger = [...this.fingers.keys()][0]!;
    this.sink.radial('open', at.x, at.y);
  }

  /**
   * A pen lands: fingers on the screen now hold a modifier instead of moving the camera.
   * True when at least one finger is down.
   */
  hold(): boolean {
    if (this.fingers.size === 0) return false;
    if (this.mode === 'tool') this.emitToolCancel();
    if (this.mode === 'camera') this.sink.camera({ kind: 'end' });
    this.mode = 'idle';
    this.holding = true;
    return true;
  }

  down(id: number, sample: PointerSample, time: number): void {
    this.fingers.set(id, { x: sample.x, y: sample.y, startX: sample.x, startY: sample.y });
    const count = this.fingers.size;
    this.maxFingers = Math.max(this.maxFingers, count);
    if (this.holding || this.mode === 'menu') return;
    if (count === 1) {
      this.startTime = time;
      this.moved = 0;
      if (!this.cameraFingers) {
        this.mode = 'tool';
        this.toolFinger = id;
        this.emitTool('down', [sample], time);
        return;
      }
    }
    if (this.mode === 'tool') this.emitTool('cancel', [sample], time);
    const begins = this.mode !== 'camera';
    this.mode = 'camera';
    this.resetReference();
    if (begins) {
      this.sink.camera({ kind: 'start', mode: this.cameraMode(count), x: this.cx, y: this.cy });
    }
  }

  move(id: number, samples: PointerSample[], time: number): void {
    const finger = this.fingers.get(id);
    const last = samples.at(-1);
    if (!finger || !last) return;
    finger.x = last.x;
    finger.y = last.y;
    this.moved = Math.max(this.moved, Math.hypot(last.x - finger.startX, last.y - finger.startY));
    if (this.mode === 'menu') {
      if (id === this.menuFinger) this.sink.radial('move', last.x, last.y);
      return;
    }
    if (this.mode === 'tool' && id === this.toolFinger) {
      this.emitTool('move', samples, time);
      return;
    }
    if (this.mode !== 'camera') return;
    const count = this.fingers.size;
    const cameraOnly = this.cameraFingers;
    const [cx, cy, spread] = this.measure();
    const dx = cx - this.cx;
    const dy = cy - this.cy;
    if (count === 1) {
      if (cameraOnly) this.sink.camera({ kind: 'orbit', dx, dy });
    } else if (count === 2) {
      if (dx !== 0 || dy !== 0) {
        this.sink.camera(cameraOnly ? { kind: 'pan', dx, dy } : { kind: 'orbit', dx, dy });
      }
      if (this.spread > 0 && spread > 0 && spread !== this.spread) {
        this.sink.camera({ kind: 'zoom', factor: this.spread / spread, x: cx, y: cy });
      }
    } else if (dx !== 0 || dy !== 0) {
      this.sink.camera({ kind: 'pan', dx, dy });
    }
    this.cx = cx;
    this.cy = cy;
    this.spread = spread;
  }

  up(id: number, sample: PointerSample, time: number): void {
    this.release(id, sample, time, false);
  }

  cancel(id: number, sample: PointerSample, time: number): void {
    this.release(id, sample, time, true);
  }

  private release(id: number, sample: PointerSample, time: number, cancelled: boolean): void {
    if (!this.fingers.delete(id)) return;
    if (this.mode === 'menu' && id === this.menuFinger) {
      this.sink.radial(cancelled ? 'cancel' : 'up', sample.x, sample.y);
      this.mode = 'idle';
      this.menuFinger = -1;
      // Other fingers that landed meanwhile do nothing until lifted.
      if (this.fingers.size > 0) this.holding = true;
      else this.maxFingers = 0;
      return;
    }
    if (this.mode === 'tool' && id === this.toolFinger) {
      this.emitTool(cancelled ? 'cancel' : 'up', [sample], time);
      this.toolFinger = -1;
    }
    if (this.fingers.size > 0) {
      // Fewer fingers now: measure from the remaining ones so the view does not jump.
      this.resetReference();
      return;
    }
    if (this.holding) {
      this.holding = false;
      this.maxFingers = 0;
      return;
    }
    if (this.mode === 'camera') {
      this.sink.camera({ kind: 'end' });
      const quick = !cancelled && time - this.startTime < TAP_MS && this.moved < TAP_SLOP;
      if (quick && this.maxFingers >= 2) this.sink.tap(this.maxFingers);
      if (quick && this.maxFingers === 1) this.oneFingerTap(sample, time);
    }
    this.mode = 'idle';
    this.maxFingers = 0;
  }

  /** In camera-only mode a double tap sets the centre of rotation. */
  private oneFingerTap(sample: PointerSample, time: number): void {
    const last = this.lastTap;
    if (
      last &&
      time - last.time < DOUBLE_TAP_MS &&
      Math.hypot(sample.x - last.x, sample.y - last.y) < DOUBLE_TAP_SLOP
    ) {
      this.lastTap = null;
      this.sink.camera({ kind: 'pivot', x: sample.x, y: sample.y });
      return;
    }
    this.lastTap = { x: sample.x, y: sample.y, time };
  }

  private cameraMode(count: number) {
    if (this.cameraFingers) return count === 1 ? 'orbit' : 'pan';
    return count === 2 ? 'orbit' : 'pan';
  }

  private measure(): [number, number, number] {
    let x = 0;
    let y = 0;
    for (const f of this.fingers.values()) {
      x += f.x;
      y += f.y;
    }
    const n = this.fingers.size || 1;
    x /= n;
    y /= n;
    let spread = 0;
    for (const f of this.fingers.values()) spread += Math.hypot(f.x - x, f.y - y);
    return [x, y, spread / n];
  }

  private resetReference(): void {
    [this.cx, this.cy, this.spread] = this.measure();
  }

  private emitToolCancel(): void {
    const finger = this.fingers.get(this.toolFinger);
    if (finger) this.emitTool('cancel', [{ x: finger.x, y: finger.y, pressure: 0 }], 0);
    this.toolFinger = -1;
  }

  private emitTool(
    phase: 'down' | 'move' | 'up' | 'cancel',
    samples: PointerSample[],
    time: number,
  ) {
    const last = samples.at(-1)!;
    this.sink.tool({
      ...this.modifiers(),
      phase,
      x: last.x,
      y: last.y,
      pressure: last.pressure,
      samples,
      button: 'primary',
      pointerType: 'touch',
      time,
    });
  }
}
