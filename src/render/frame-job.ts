import type { Camera } from './camera';
import type { GL } from './gl';
import type { Accumulation, PathTracer, RenderSettings } from './pathtracer';

/**
 * A large frame traced in tiles (docs/rendering.md, “Large frames”). Each tile gets the full
 * sample count with a margin around it, so the denoiser and bloom see their neighbours; then its
 * middle is read back into the frame. A few passes per animation frame keep the editor
 * responsive while it runs, and the GPU never holds more than one tile of samples.
 */

/** The longest side of a saved frame, pixels. */
export const MAX_FRAME_SIDE = 8192;
/** Tile side and the margin traced around it, pixels. */
export const FRAME_TILE = 512;
export const FRAME_TILE_MARGIN = 32;

export interface FrameTile {
  /** The part of the frame this tile fills, pixels from the bottom left. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** The traced area: the part with its margin, clipped to the frame. */
  px: number;
  py: number;
  pw: number;
  ph: number;
}

/** The tiles of a frame, bottom row first. */
export function frameTiles(
  width: number,
  height: number,
  size = FRAME_TILE,
  margin = FRAME_TILE_MARGIN,
): FrameTile[] {
  const tiles: FrameTile[] = [];
  for (let y = 0; y < height; y += size)
    for (let x = 0; x < width; x += size) {
      const w = Math.min(size, width - x);
      const h = Math.min(size, height - y);
      const px = Math.max(0, x - margin);
      const py = Math.max(0, y - margin);
      tiles.push({
        x,
        y,
        width: w,
        height: h,
        px,
        py,
        pw: Math.min(width, x + w + margin) - px,
        ph: Math.min(height, y + h + margin) - py,
      });
    }
  return tiles;
}

/**
 * Copies a tile's middle into the frame. The tile's pixels are RGBA rows from the bottom (as
 * readPixels gives them), the frame's rows run from the top (as images do).
 */
export function placeTile(
  frame: Uint8ClampedArray,
  frameWidth: number,
  frameHeight: number,
  tile: FrameTile,
  pixels: Uint8Array,
): void {
  const ox = tile.x - tile.px;
  const oy = tile.y - tile.py;
  for (let row = 0; row < tile.height; row++) {
    const from = ((oy + row) * tile.pw + ox) * 4;
    const to = ((frameHeight - 1 - (tile.y + row)) * frameWidth + tile.x) * 4;
    frame.set(pixels.subarray(from, from + tile.width * 4), to);
  }
}

export class FrameJob {
  /** The frame, RGBA rows from the top, straight alpha. */
  readonly pixels: Uint8ClampedArray<ArrayBuffer>;
  private readonly tiles: FrameTile[];
  private index = 0;
  private readonly picture: Accumulation;
  private readonly framebuffer: WebGLFramebuffer;
  private readonly texture: WebGLTexture;
  private readonly readback: Uint8Array;

  constructor(
    private readonly gl: GL,
    private readonly tracer: PathTracer,
    private readonly camera: Camera,
    private readonly settings: RenderSettings,
    readonly width: number,
    readonly height: number,
    private readonly background: [number, number, number],
  ) {
    this.pixels = new Uint8ClampedArray(width * height * 4);
    this.tiles = frameTiles(width, height);
    this.picture = tracer.accumulation();
    const side = FRAME_TILE + 2 * FRAME_TILE_MARGIN;
    this.readback = new Uint8Array(side * side * 4);
    this.texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, side, side, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  get done(): boolean {
    return this.index >= this.tiles.length;
  }

  /** How much is traced, 0…1. */
  get progress(): number {
    if (this.done) return 1;
    const part = Math.min(1, this.picture.samples / Math.max(1, this.settings.samples));
    return (this.index + part) / this.tiles.length;
  }

  /** Adds up to `passes` samples to the current tile; once it has them all, reads it back. */
  step(palette: WebGLTexture, passes: number): void {
    if (this.done) return;
    const t = this.tiles[this.index]!;
    this.tracer.render(this.picture, this.camera, this.settings, palette, t.pw, t.ph, passes, {
      framebuffer: this.framebuffer,
      background: this.background,
      straight: true,
      tile: { x: t.px, y: t.py, width: this.width, height: this.height },
    });
    if (this.picture.samples < this.settings.samples) return;
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.readPixels(0, 0, t.pw, t.ph, gl.RGBA, gl.UNSIGNED_BYTE, this.readback);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    placeTile(this.pixels, this.width, this.height, t, this.readback);
    this.index++;
    this.tracer.restart(this.picture);
  }

  dispose(): void {
    this.tracer.release(this.picture);
    this.gl.deleteFramebuffer(this.framebuffer);
    this.gl.deleteTexture(this.texture);
  }
}
