import type { KeyState } from './keys';
import { DEFAULT_MOUSE, mouseCameraMode } from './mouse-layout';
import { LONG_PRESS_MS, LONG_PRESS_SLOP, TouchGestures } from './touch-gestures';
import type { CameraMode, InputSink, MouseLayout, PointerSample, ToolPointerEvent } from './types';
import { WheelClassifier } from './wheel';

interface Drag {
  id: number;
  /** menu: a long press turned the pen drag into picking in the radial menu. */
  mode: 'tool' | 'menu' | CameraMode;
  button: 'primary' | 'secondary';
  pointerType: 'mouse' | 'pen';
  x: number;
  y: number;
  startX: number;
  startY: number;
  startTime: number;
  /** Farthest distance from the start, to tell a click from a drag. */
  moved: number;
}

/** A camera button released within this distance and time is a click: it sets the pivot. */
const CLICK_SLOP = 4;
const CLICK_MS = 350;

/** Zoom factor per pixel of a Z + drag. */
const DRAG_ZOOM_SPEED = 0.006;

/**
 * Turns Pointer Events on the viewport into tool events and camera gestures.
 *
 * Mouse: left — tool; right and middle move the camera as the layout says (MagicaVoxel: right
 * orbits, middle pans); wheel — zoom;
 * trackpad: two-finger swipe — orbit, with Shift — pan, pinch — zoom (see WheelClassifier);
 * Space + left — pan and Z + left — zoom for mice without a middle button.
 * Pen: tip — tool, barrel button or a finger held on the screen — secondary tool action; after
 * the first pen event fingers stop drawing. Touch: see TouchGestures.
 */
export class PointerInput {
  readonly touch: TouchGestures;
  private drag: Drag | null = null;
  private rect: DOMRect | null = null;
  private toolCursor = 'crosshair';
  readonly wheel = new WheelClassifier();
  private swipe = false;
  /** Which buttons orbit, pan and zoom (control layouts). */
  mouse: MouseLayout = DEFAULT_MOUSE;
  private pressTimer = 0;
  /** Called once, when the first pen event arrives. */
  onPen: (() => void) | null = null;
  private swipeEnd = 0;
  private gestureScale = 1;
  private readonly detachers: (() => void)[] = [];

  constructor(
    private readonly element: HTMLElement,
    private readonly sink: InputSink,
    private readonly keys: KeyState,
  ) {
    this.touch = new TouchGestures(sink, () => keys.modifiers());
    const on = <K extends keyof HTMLElementEventMap>(
      type: K,
      handler: (e: HTMLElementEventMap[K]) => void,
      options?: AddEventListenerOptions,
    ) => {
      element.addEventListener(type, handler as EventListener, options);
      this.detachers.push(() =>
        element.removeEventListener(type, handler as EventListener, options),
      );
    };
    on('pointerdown', (e) => this.onDown(e));
    on('pointermove', (e) => this.onMove(e));
    on('pointerup', (e) => this.onUp(e, false));
    on('pointercancel', (e) => this.onUp(e, true));
    on('lostpointercapture', (e) => {
      if (this.drag?.id === e.pointerId) this.onUp(e, true);
    });
    on('pointerleave', (e) => {
      if (!this.drag && e.pointerType !== 'touch') this.emitHoverLeave(e);
    });
    on('contextmenu', (e) => e.preventDefault());
    on('wheel', (e) => this.onWheel(e), { passive: false });
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
      const handler = (e: Event) => this.onGesture(e);
      element.addEventListener(type, handler);
      this.detachers.push(() => element.removeEventListener(type, handler));
    }
    const blur = () => this.cancelAll();
    window.addEventListener('blur', blur);
    this.detachers.push(() => window.removeEventListener('blur', blur));
    this.detachers.push(keys.onChange(() => this.updateCursor()));
    this.updateCursor();
  }

  /** Default cursor over the viewport when no camera key is held (set by the active tool). */
  setToolCursor(cursor: string): void {
    this.toolCursor = cursor;
    this.updateCursor();
  }

  /**
   * The cursor tells what a left drag will do: Space — grab and pan, Z — zoom, otherwise the
   * tool. During a camera drag it shows the drag itself.
   */
  private updateCursor(): void {
    const drag = this.drag;
    let cursor = this.toolCursor;
    if (drag && drag.mode !== 'tool') {
      cursor = drag.mode === 'pan' ? 'grabbing' : drag.mode === 'zoom' ? 'ns-resize' : 'move';
    } else if (!drag && this.keys.isHeld('Space')) {
      cursor = 'grab';
    } else if (!drag && this.keys.isHeld('KeyZ')) {
      cursor = 'zoom-in';
    }
    if (this.element.style.cursor !== cursor) this.element.style.cursor = cursor;
  }

  dispose(): void {
    this.cancelAll();
    clearTimeout(this.swipeEnd);
    clearTimeout(this.pressTimer);
    for (const d of this.detachers) d();
    this.detachers.length = 0;
  }

  /** Converts a client position into element CSS pixels. */
  local(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.rect ?? this.element.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }

  private sample(e: PointerEvent): PointerSample {
    const p = this.local(e.clientX, e.clientY);
    // Mice report 0 or 0.5; pens and some touch screens report real pressure.
    const pressure = e.pointerType === 'mouse' ? (e.buttons ? 0.5 : 0) : e.pressure;
    return { x: p.x, y: p.y, pressure };
  }

  private samples(e: PointerEvent): PointerSample[] {
    const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    return list.length > 0 ? list.map((c) => this.sample(c)) : [this.sample(e)];
  }

  private onDown(e: PointerEvent): void {
    this.keys.syncModifiers(e);
    this.element.focus({ preventScroll: true });
    this.rect = this.element.getBoundingClientRect();
    const s = this.sample(e);
    if (e.pointerType === 'touch') {
      this.capture(e);
      this.touch.down(e.pointerId, s, e.timeStamp);
      if (this.touch.pressCandidate()) this.armLongPress(() => this.touch.longPress());
      return;
    }
    if (this.drag) return;
    const pointerType = e.pointerType === 'pen' ? 'pen' : 'mouse';
    let mode: Drag['mode'];
    let button: Drag['button'] = 'primary';
    if (pointerType === 'pen') {
      this.seePen();
      const barrel = e.button === 2 || (e.buttons & 2) !== 0;
      const finger = this.touch.hold();
      button = barrel || finger ? 'secondary' : 'primary';
      mode = 'tool';
    } else if (e.button === 0) {
      mode = this.keys.isHeld('Space') ? 'pan' : this.keys.isHeld('KeyZ') ? 'zoom' : 'tool';
    } else {
      const camera = mouseCameraMode(this.mouse, e.button, this.keys.modifiers());
      if (!camera) return;
      mode = camera;
      // The middle button would start the browser's autoscroll.
      if (e.button === 1) e.preventDefault();
    }
    this.capture(e);
    this.drag = {
      id: e.pointerId,
      mode,
      button,
      pointerType,
      x: s.x,
      y: s.y,
      startX: s.x,
      startY: s.y,
      startTime: e.timeStamp,
      moved: 0,
    };
    this.updateCursor();
    if (mode === 'tool') this.emitTool('down', [s], e, button, pointerType);
    else this.sink.camera({ kind: 'start', mode, x: s.x, y: s.y });
    if (pointerType === 'pen') {
      const id = e.pointerId;
      this.armLongPress(() => {
        const drag = this.drag;
        if (drag?.id !== id || drag.mode !== 'tool' || drag.moved >= LONG_PRESS_SLOP) return;
        this.emitTool('cancel', [{ x: drag.x, y: drag.y, pressure: 0 }], null, drag.button, 'pen');
        drag.mode = 'menu';
        this.sink.radial('open', drag.x, drag.y);
      });
    }
  }

  private onMove(e: PointerEvent): void {
    this.keys.syncModifiers(e);
    if (e.pointerType === 'touch') {
      this.touch.move(e.pointerId, this.samples(e), e.timeStamp);
      return;
    }
    if (e.pointerType === 'pen') this.seePen();
    const drag = this.drag;
    if (!drag) {
      // Hover: no button pressed. Keep the rect fresh, the page may have scrolled or resized.
      this.rect = null;
      const s = this.samples(e);
      this.emitTool('hover', s, e, 'primary', e.pointerType === 'pen' ? 'pen' : 'mouse');
      return;
    }
    if (drag.id !== e.pointerId) return;
    const samples = this.samples(e);
    const last = samples.at(-1)!;
    const dx = last.x - drag.x;
    const dy = last.y - drag.y;
    drag.x = last.x;
    drag.y = last.y;
    drag.moved = Math.max(drag.moved, Math.hypot(last.x - drag.startX, last.y - drag.startY));
    switch (drag.mode) {
      case 'tool':
        this.emitTool('move', samples, e, drag.button, drag.pointerType);
        break;
      case 'menu':
        this.sink.radial('move', last.x, last.y);
        break;
      case 'orbit':
        this.sink.camera({ kind: 'orbit', dx, dy });
        break;
      case 'pan':
        this.sink.camera({ kind: 'pan', dx, dy });
        break;
      case 'zoom':
        // Towards where the drag started: the point of interest does not slide away.
        this.sink.camera({
          kind: 'zoom',
          factor: Math.exp(dy * DRAG_ZOOM_SPEED),
          x: drag.startX,
          y: drag.startY,
        });
        break;
    }
  }

  private onUp(e: PointerEvent, cancelled: boolean): void {
    if (e.pointerType === 'touch') {
      const s = this.sample(e);
      if (cancelled) this.touch.cancel(e.pointerId, s, e.timeStamp);
      else this.touch.up(e.pointerId, s, e.timeStamp);
      return;
    }
    const drag = this.drag;
    if (!drag || drag.id !== e.pointerId) return;
    this.drag = null;
    this.release(e);
    this.updateCursor();
    if (drag.mode === 'menu') {
      const s = this.sample(e);
      this.sink.radial(cancelled ? 'cancel' : 'up', s.x, s.y);
      return;
    }
    if (drag.mode === 'tool') {
      this.emitTool(
        cancelled ? 'cancel' : 'up',
        [this.sample(e)],
        e,
        drag.button,
        drag.pointerType,
      );
      return;
    }
    this.sink.camera({ kind: 'end' });
    const click = drag.moved < CLICK_SLOP && e.timeStamp - drag.startTime < CLICK_MS;
    if (!cancelled && click && drag.mode !== 'zoom') {
      this.sink.camera({ kind: 'pivot', x: drag.startX, y: drag.startY });
    }
  }

  /** Fires after LONG_PRESS_MS unless another press re-arms it; `fire` checks it still applies. */
  private armLongPress(fire: () => void): void {
    clearTimeout(this.pressTimer);
    this.pressTimer = window.setTimeout(fire, LONG_PRESS_MS);
  }

  private seePen(): void {
    if (this.touch.penMode) return;
    this.touch.penMode = true;
    this.onPen?.();
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    this.keys.syncModifiers(e);
    const p = this.local(e.clientX, e.clientY);
    const intent = this.wheel.classify({
      deltaX: e.deltaX,
      deltaY: e.deltaY,
      deltaMode: e.deltaMode,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      wheelDeltaY: (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY,
      timeStamp: e.timeStamp,
    });
    if (intent.kind === 'zoom') {
      this.sink.camera({ kind: 'zoom', factor: intent.factor, x: p.x, y: p.y });
      return;
    }
    // A swipe is a short camera gesture of its own: start (for the anchor), move, end.
    if (!this.swipe) {
      this.swipe = true;
      this.sink.camera({ kind: 'start', mode: intent.kind, x: p.x, y: p.y });
    }
    this.sink.camera(intent);
    clearTimeout(this.swipeEnd);
    this.swipeEnd = window.setTimeout(() => {
      this.swipe = false;
      this.sink.camera({ kind: 'end' });
    }, 120);
  }

  /** Safari reports trackpad pinches as non-standard gesture events instead of Ctrl + wheel. */
  private onGesture(e: Event & { scale?: number; clientX?: number; clientY?: number }): void {
    e.preventDefault();
    if (e.type === 'gesturestart') {
      this.gestureScale = 1;
      return;
    }
    const scale = e.scale ?? 1;
    if (scale <= 0) return;
    const p = this.local(e.clientX ?? 0, e.clientY ?? 0);
    this.sink.camera({ kind: 'zoom', factor: this.gestureScale / scale, x: p.x, y: p.y });
    this.gestureScale = scale;
  }

  private cancelAll(): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    if (drag.mode === 'menu') {
      this.sink.radial('cancel', drag.x, drag.y);
    } else if (drag.mode === 'tool') {
      this.sink.tool({
        ...this.keys.modifiers(),
        phase: 'cancel',
        x: drag.x,
        y: drag.y,
        pressure: 0,
        samples: [{ x: drag.x, y: drag.y, pressure: 0 }],
        button: drag.button,
        pointerType: drag.pointerType,
        time: performance.now(),
      });
    } else {
      this.sink.camera({ kind: 'end' });
    }
  }

  private emitHoverLeave(e: PointerEvent): void {
    // Hover far outside the viewport: tools hide their cursor preview.
    const outside = { x: Number.NaN, y: Number.NaN, pressure: 0 };
    this.sink.tool({
      ...this.keys.modifiers(),
      phase: 'hover',
      ...outside,
      samples: [outside],
      button: 'primary',
      pointerType: e.pointerType === 'pen' ? 'pen' : 'mouse',
      time: e.timeStamp,
    });
  }

  private emitTool(
    phase: ToolPointerEvent['phase'],
    samples: PointerSample[],
    e: PointerEvent | null,
    button: 'primary' | 'secondary',
    pointerType: 'mouse' | 'pen',
  ): void {
    const last = samples.at(-1)!;
    this.sink.tool({
      ...this.keys.modifiers(),
      phase,
      x: last.x,
      y: last.y,
      pressure: last.pressure,
      samples,
      button,
      pointerType,
      time: e?.timeStamp ?? performance.now(),
    });
  }

  private capture(e: PointerEvent): void {
    try {
      this.element.setPointerCapture(e.pointerId);
    } catch {
      // The pointer may already be gone; nothing to capture.
    }
  }

  private release(e: PointerEvent): void {
    if (this.element.hasPointerCapture(e.pointerId))
      this.element.releasePointerCapture(e.pointerId);
  }
}
