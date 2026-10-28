/** Device pixel ratio is capped: above 2 the extra pixels cost a lot and are barely visible. */
export const MAX_PIXEL_RATIO = 2;
export const MIN_RENDER_SCALE = 0.5;

/** Frames slower than this many refresh intervals count as slow. */
const SLOW_FACTOR = 1.35;
/** Slow frames in a row before the resolution drops. */
const SLOW_STREAK = 3;
/** Fast frames in a row before the resolution goes back up during motion. */
const FAST_STREAK = 45;

/**
 * Lowers the drawing resolution while the view moves and frames come late, and restores it
 * when motion stops. A blurry frame during an orbit is better than a stutter; the still image
 * is always sharp.
 */
export class ResolutionGovernor {
  /** Multiplier on top of the device pixel ratio, MIN_RENDER_SCALE…1. */
  scale = 1;
  /** Shortest frame interval seen: the display refresh interval. */
  private refreshMs = 1000 / 60;
  private slow = 0;
  private fast = 0;

  /** Feeds the time between two consecutive frames drawn while the view was moving. */
  sample(intervalMs: number): void {
    if (intervalMs <= 0 || intervalMs > 250) return;
    // Track the refresh interval, ignoring jitter below 4 ms (240 Hz).
    this.refreshMs = Math.max(4, Math.min(this.refreshMs, intervalMs));
    if (intervalMs > Math.max(this.refreshMs * SLOW_FACTOR, this.refreshMs + 4)) {
      this.fast = 0;
      if (++this.slow >= SLOW_STREAK) {
        this.slow = 0;
        this.scale = Math.max(MIN_RENDER_SCALE, this.scale * 0.8);
      }
    } else {
      this.slow = 0;
      if (this.scale < 1 && ++this.fast >= FAST_STREAK) {
        this.fast = 0;
        this.scale = Math.min(1, this.scale * 1.15);
      }
    }
  }

  /** Motion stopped: draw sharp again. Returns true when the scale changed. */
  settle(): boolean {
    this.slow = 0;
    this.fast = 0;
    if (this.scale === 1) return false;
    this.scale = 1;
    return true;
  }
}

/** Pixels per CSS pixel to draw with. */
export function pixelRatio(devicePixelRatio: number, scale: number): number {
  return Math.min(devicePixelRatio || 1, MAX_PIXEL_RATIO) * scale;
}
