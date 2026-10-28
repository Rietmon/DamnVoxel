/**
 * What the input layer produces. Tools never see raw DOM events and never learn whether a
 * mouse, a finger or a pen drives them (docs/architecture.md, "Tools").
 */

export interface PointerSample {
  /** CSS pixels relative to the input element. */
  x: number;
  y: number;
  /** 0…1; a mouse reports 0.5 while pressed. */
  pressure: number;
}

export interface Modifiers {
  shift: boolean;
  /** Ctrl, or Cmd on macOS. */
  ctrl: boolean;
  alt: boolean;
}

export type ToolPhase = 'hover' | 'down' | 'move' | 'up' | 'cancel';

export interface ToolPointerEvent extends PointerSample, Modifiers {
  phase: ToolPhase;
  /** Every sample since the previous event (coalesced events), the last one equals x, y. */
  samples: PointerSample[];
  /** primary: left button, pen tip, finger; secondary: right button or pen barrel button. */
  button: 'primary' | 'secondary';
  pointerType: 'mouse' | 'pen' | 'touch';
  /** Milliseconds, performance.now() clock. */
  time: number;
}

export type CameraMode = 'orbit' | 'pan' | 'zoom';

/** A mouse button (1 middle, 2 right) with the modifiers it needs. */
export interface MouseBinding {
  button: 1 | 2;
  shift?: boolean;
  ctrl?: boolean;
  alt?: boolean;
}

/** Which buttons move the camera; the left button always drives the tool. */
export interface MouseLayout {
  orbit: readonly MouseBinding[];
  pan: readonly MouseBinding[];
  zoom: readonly MouseBinding[];
}

export type CameraGesture =
  /** A drag or touch gesture begins at a point (for orbiting around what is under it). */
  | { kind: 'start'; mode: CameraMode; x: number; y: number }
  /** Pixel deltas; positive dx turns the view as if dragging the scene to the right. */
  | { kind: 'orbit'; dx: number; dy: number }
  | { kind: 'pan'; dx: number; dy: number }
  /** factor < 1 zooms in, keeping the point (x, y) under the same pixel. */
  | { kind: 'zoom'; factor: number; x: number; y: number }
  /** The gesture ended; the camera may keep coasting (inertia). */
  | { kind: 'end' }
  /** Make the point under (x, y) the centre of rotation (a click without a drag). */
  | { kind: 'pivot'; x: number; y: number };

export interface InputSink {
  tool(event: ToolPointerEvent): void;
  camera(gesture: CameraGesture): void;
  /** A quick tap with several fingers: 2 is undo, 3 is redo. */
  tap(fingers: number): void;
  /**
   * The radial menu: a long press opens it at a point, the same finger or pen then moves over
   * it and lifts (picking what is under it), or the gesture is cancelled.
   */
  radial(phase: 'open' | 'move' | 'up' | 'cancel', x: number, y: number): void;
}
