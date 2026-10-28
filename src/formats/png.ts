import { crc32 } from './zip';

/**
 * PNG writing without a canvas: RGBA, deflate in stored
 * blocks. For small pictures that go into files — the palette strip of an export — where size
 * does not matter and Node must be able to write them too.
 */
export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  // Scanlines, each with filter 0.
  const raw = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y++)
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  // zlib: header, stored blocks of up to 65535 bytes, Adler-32.
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  const z = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  z[0] = 0x78;
  z[1] = 0x01;
  let p = 2;
  for (let b = 0; b < blocks; b++) {
    const start = b * 65535;
    const len = Math.min(65535, raw.length - start);
    z[p++] = b === blocks - 1 ? 1 : 0;
    z[p++] = len & 255;
    z[p++] = len >> 8;
    z[p++] = ~len & 255;
    z[p++] = (~len >> 8) & 255;
    z.set(raw.subarray(start, start + len), p);
    p += len;
  }
  let s1 = 1;
  let s2 = 0;
  for (let i = 0; i < raw.length; i++) {
    s1 = (s1 + raw[i]!) % 65521;
    s2 = (s2 + s1) % 65521;
  }
  new DataView(z.buffer).setUint32(p, ((s2 << 16) | s1) >>> 0);

  const ihdr = new Uint8Array(13);
  const h = new DataView(ihdr.buffer);
  h.setUint32(0, width);
  h.setUint32(4, height);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const chunks = [
    ['IHDR', ihdr],
    ['IDAT', z],
    ['IEND', new Uint8Array(0)],
  ] as const;
  const size = 8 + chunks.reduce((s, [, d]) => s + 12 + d.length, 0);
  const out = new Uint8Array(size);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(out.buffer);
  let q = 8;
  for (const [type, data] of chunks) {
    view.setUint32(q, data.length);
    const typed = new Uint8Array(4 + data.length);
    for (let i = 0; i < 4; i++) typed[i] = type.charCodeAt(i);
    typed.set(data, 4);
    out.set(typed, q + 4);
    view.setUint32(q + 8 + data.length, crc32(typed));
    q += 12 + data.length;
  }
  return out;
}
