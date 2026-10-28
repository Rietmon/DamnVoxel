/** The fields of a WheelEvent the classifier reads. */
export interface WheelInput {
  deltaX: number;
  deltaY: number;
  /** 0 pixels, 1 lines, 2 pages. */
  deltaMode: number;
  ctrlKey: boolean;
  shiftKey: boolean;
  /** Non-standard, Chromium and Safari: ±120 per notch for mice. */
  wheelDeltaY?: number;
  timeStamp: number;
}

export type WheelIntent =
  | { kind: 'zoom'; factor: number }
  | { kind: 'orbit'; dx: number; dy: number }
  | { kind: 'pan'; dx: number; dy: number };

/** Pixels per line and per page for line- and page-mode wheels. */
const LINE_PX = 16;
const PAGE_PX = 800;
/** Zoom speed per wheel pixel (mouse) and per pinch unit (trackpad). */
const WHEEL_ZOOM = 0.0015;
const PINCH_ZOOM = 0.01;
/** A trackpad gesture keeps its classification while events keep coming this often. */
const STICKY_MS = 400;

/**
 * Tells a mouse wheel from a two-finger trackpad swipe and turns both into camera intents
 * (touchpad gestures):
 * - mouse wheel → zoom to the cursor;
 * - trackpad swipe → orbit, with Shift → pan;
 * - pinch (browsers send it as Ctrl + wheel) or Ctrl + wheel → zoom.
 *
 * The heuristics: line or page mode is a mouse; a delta on both axes at once, a fractional or
 * tiny delta, or Chromium's wheelDeltaY = −3 × deltaY is a trackpad. Once a trackpad gesture is
 * recognised it stays one until the events stop, so the slow tail of momentum scrolling does
 * not suddenly turn into zoom.
 */
export class WheelClassifier {
  /** 'auto' guesses; a setting can force one device. */
  mode: 'auto' | 'mouse' | 'trackpad' = 'auto';
  private trackpadUntil = 0;

  classify(e: WheelInput): WheelIntent {
    const scale = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? PAGE_PX : 1;
    const dx = e.deltaX * scale;
    const dy = e.deltaY * scale;
    if (e.ctrlKey) {
      // Pinch deltas are small; Ctrl + mouse wheel notches are ~100. Clamp so a notch zooms
      // by a sensible step.
      const d = Math.max(-60, Math.min(60, dy));
      return { kind: 'zoom', factor: Math.exp(d * PINCH_ZOOM) };
    }
    if (this.isTrackpad(e)) {
      this.trackpadUntil = e.timeStamp + STICKY_MS;
      return e.shiftKey ? { kind: 'pan', dx: -dx, dy: -dy } : { kind: 'orbit', dx: -dx, dy: -dy };
    }
    return { kind: 'zoom', factor: Math.exp(dy * WHEEL_ZOOM) };
  }

  private isTrackpad(e: WheelInput): boolean {
    if (this.mode !== 'auto') return this.mode === 'trackpad';
    if (e.deltaMode !== 0) return false;
    if (e.timeStamp < this.trackpadUntil) return true;
    if (e.deltaX !== 0 && e.deltaY !== 0) return true;
    if (e.wheelDeltaY !== undefined && e.wheelDeltaY !== 0) {
      if (e.wheelDeltaY === -3 * e.deltaY) return true;
      if (Math.abs(e.wheelDeltaY) % 120 === 0) return false;
    }
    if (e.deltaX !== 0) return true;
    return !Number.isInteger(e.deltaY) || Math.abs(e.deltaY) < 4;
  }
}
