import type { Palette } from '../core/palette';
import type { GL } from './gl';

/** Texture side: 256 × 256 texels hold every possible palette id (uint16). */
export const PALETTE_TEXTURE_SIZE = 256;

/**
 * Palette colours on the GPU. Id → texel (id & 255, id >> 8), read with `texelFetch`.
 * A palette change uploads only the rows in use and never touches meshes.
 */
export class PaletteTexture {
  readonly texture: WebGLTexture;
  private readonly data = new Uint32Array(PALETTE_TEXTURE_SIZE * PALETTE_TEXTURE_SIZE);

  constructor(private readonly gl: GL) {
    const texture = gl.createTexture();
    if (!texture) throw new Error('Cannot create the palette texture');
    this.texture = texture;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, PALETTE_TEXTURE_SIZE, PALETTE_TEXTURE_SIZE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** Uploads the colours of every palette entry. */
  update(palette: Palette): void {
    const size = palette.size;
    const rows = Math.floor(size / PALETTE_TEXTURE_SIZE) + 1;
    this.data.fill(0, 0, rows * PALETTE_TEXTURE_SIZE);
    for (let id = 1; id <= size; id++) this.data[id] = palette.color(id);
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      PALETTE_TEXTURE_SIZE,
      rows,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array(this.data.buffer, 0, rows * PALETTE_TEXTURE_SIZE * 4),
    );
  }

  dispose(): void {
    this.gl.deleteTexture(this.texture);
  }
}
