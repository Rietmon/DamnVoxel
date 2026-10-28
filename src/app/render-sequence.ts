import type { CameraView } from '../core/cameras';
import { Camera } from '../render/camera';

/**
 * Series of rendered frames (docs/rendering.md, “Frame series”): a turntable or the animation
 * as a GIF or a video, and sprites — the model from 4 or 8 sides with an orthographic camera,
 * laid out in a PNG sheet. Here are the views and the sheet; the editor traces the frames.
 */

export type SequenceKind = 'turntable' | 'animation' | 'sprites';
export type SequenceFormat = 'gif' | 'video';
/** The sprite camera's tilt: 2:1 pixel-art lines (30°) or true isometric (35.26°). */
export type SpriteTilt = 'pixel' | 'iso';

export interface SequenceSettings {
  kind: SequenceKind;
  /** The turntable and the animation: a GIF or a video. */
  format: SequenceFormat;
  /** Frame size of the turntable and the animation, pixels. */
  width: number;
  height: number;
  /** Turntable: frames in a full turn, and frames per second. */
  frames: number;
  fps: number;
  /** Turntable: the sun turns with the camera, as if the model turned on a stand. */
  lightFollows: boolean;
  /** Samples per frame: a series needs fewer than a still. */
  samples: number;
  directions: 4 | 8;
  tilt: SpriteTilt;
  /** Sprite cell side, pixels. */
  spriteSize: number;
  /** One ray through each pixel centre: crisp pixel-art edges. */
  pixelated: boolean;
  /** Sprites: the animation frames as rows of the sheet. */
  animated: boolean;
}

export const DEFAULT_SEQUENCE: SequenceSettings = {
  kind: 'turntable',
  format: 'gif',
  width: 512,
  height: 512,
  frames: 48,
  fps: 24,
  lightFollows: true,
  samples: 64,
  directions: 8,
  tilt: 'pixel',
  spriteSize: 128,
  pixelated: true,
  animated: false,
};

const clamp = (v: number, lo: number, hi: number, fallback: number) =>
  Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : fallback;

/** Settings read back from storage, kept within what the series can make. */
export function vetSequence(s: SequenceSettings): SequenceSettings {
  const d = DEFAULT_SEQUENCE;
  return {
    kind: (['turntable', 'animation', 'sprites'] as const).includes(s.kind) ? s.kind : d.kind,
    format: s.format === 'video' ? 'video' : 'gif',
    width: clamp(s.width, 16, 4096, d.width),
    height: clamp(s.height, 16, 4096, d.height),
    frames: clamp(s.frames, 2, 720, d.frames),
    fps: clamp(s.fps, 1, 60, d.fps),
    lightFollows: s.lightFollows !== false,
    samples: clamp(s.samples, 1, 8192, d.samples),
    directions: s.directions === 4 ? 4 : 8,
    tilt: s.tilt === 'iso' ? 'iso' : 'pixel',
    spriteSize: clamp(s.spriteSize, 8, 1024, d.spriteSize),
    pixelated: s.pixelated !== false,
    animated: s.animated === true,
  };
}

/** A camera for a saved view, shaped for a picture of the given size. */
export function cameraOf(view: CameraView, width: number, height: number): Camera {
  const c = new Camera();
  c.target = [view.target[0], view.target[1], view.target[2]];
  c.yaw = view.yaw;
  c.pitch = view.pitch;
  c.distance = view.distance;
  c.projection = view.projection;
  c.fovY = (view.fov * Math.PI) / 180;
  return c.resized(width, height);
}

/** The views of a turntable: the camera goes once around its target, `count` steps. */
export function turntableViews(view: CameraView, count: number): CameraView[] {
  return Array.from({ length: count }, (_, i) => ({
    ...view,
    yaw: view.yaw + (i * 2 * Math.PI) / count,
  }));
}

export const SPRITE_TILT: Record<SpriteTilt, number> = {
  pixel: Math.PI / 6,
  iso: Math.atan(1 / Math.SQRT2),
};

/** Field of view the sprite cameras use; only the visible size counts in orthographic. */
const SPRITE_FOV = 30;

/**
 * Orthographic views of a box (the model's bounds) from `directions` sides, front-right first,
 * then around. All share one scale — the tightest square that holds the box from every side —
 * so the sprites line up.
 */
export function spriteViews(
  min: readonly [number, number, number],
  max: readonly [number, number, number],
  directions: number,
  tilt: SpriteTilt,
): CameraView[] {
  const center = [0, 1, 2].map((i) => (min[i]! + max[i]!) / 2) as [number, number, number];
  const pitch = SPRITE_TILT[tilt];
  const yaws = Array.from(
    { length: directions },
    (_, i) => Math.PI / 4 + (i * 2 * Math.PI) / directions,
  );
  // Half the visible size: the box's corners on the screen's axes, over every side.
  let reach = 0.5;
  for (const yaw of yaws) {
    const right = [Math.cos(yaw), 0, -Math.sin(yaw)];
    const sp = Math.sin(pitch);
    const up = [-sp * Math.sin(yaw), Math.cos(pitch), -sp * Math.cos(yaw)];
    for (let c = 0; c < 8; c++) {
      const d = [0, 1, 2].map((i) => ((c >> i) & 1 ? max[i]! : min[i]!) - center[i]!);
      const x = d[0]! * right[0]! + d[2]! * right[2]!;
      const y = d[0]! * up[0]! + d[1]! * up[1]! + d[2]! * up[2]!;
      reach = Math.max(reach, Math.abs(x), Math.abs(y));
    }
  }
  const half = Math.tan((SPRITE_FOV * Math.PI) / 360);
  return yaws.map((yaw) => ({
    target: center,
    yaw,
    pitch,
    distance: (reach * 1.04) / half,
    projection: 'orthographic' as const,
    fov: SPRITE_FOV,
  }));
}

/** Pictures in a grid, `columns` across, in order from the top left. */
export function spriteSheet(
  images: readonly Uint8ClampedArray[],
  width: number,
  height: number,
  columns: number,
): { pixels: Uint8ClampedArray<ArrayBuffer>; width: number; height: number } {
  const rows = Math.max(1, Math.ceil(images.length / columns));
  const sheetWidth = width * Math.min(columns, Math.max(1, images.length));
  const sheetHeight = height * rows;
  const pixels = new Uint8ClampedArray(sheetWidth * sheetHeight * 4);
  images.forEach((image, i) => {
    const x0 = (i % columns) * width;
    const y0 = Math.floor(i / columns) * height;
    for (let y = 0; y < height; y++)
      pixels.set(
        image.subarray(y * width * 4, (y + 1) * width * 4),
        ((y0 + y) * sheetWidth + x0) * 4,
      );
  });
  return { pixels, width: sheetWidth, height: sheetHeight };
}
