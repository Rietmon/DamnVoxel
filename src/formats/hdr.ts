/**
 * Radiance .hdr (RGBE) images: the usual format of sky
 * panoramas. Reads the header, then scanlines either flat or in the new run-length form, into
 * linear RGB floats, top row first.
 */

export interface HdrImage {
  width: number;
  height: number;
  /** RGB floats, row by row from the top. */
  data: Float32Array;
}

export function parseHdr(bytes: Uint8Array): HdrImage {
  let pos = 0;
  const line = (): string => {
    let s = '';
    while (pos < bytes.length && bytes[pos] !== 0x0a) s += String.fromCharCode(bytes[pos++]!);
    pos++;
    return s;
  };
  const magic = line();
  if (!magic.startsWith('#?')) throw new Error('This is not a .hdr file');
  let format = '';
  for (;;) {
    const l = line();
    if (l === '') break;
    if (l.startsWith('FORMAT=')) format = l.slice(7);
    if (pos >= bytes.length) throw new Error('Truncated .hdr header');
  }
  if (format && format !== '32-bit_rle_rgbe') throw new Error(`Format ${format} is not supported`);
  const m = /^-Y (\d+) \+X (\d+)$/.exec(line().trim());
  if (!m) throw new Error('Only .hdr with -Y +X orientation is supported');
  const height = Number(m[1]);
  const width = Number(m[2]);
  const data = new Float32Array(width * height * 3);
  const scan = new Uint8Array(width * 4);
  for (let y = 0; y < height; y++) {
    if (
      width >= 8 &&
      width < 32768 &&
      bytes[pos] === 2 &&
      bytes[pos + 1] === 2 &&
      (bytes[pos + 2]! & 0x80) === 0
    ) {
      // New RLE: four planes (R, G, B, E), each run-length coded.
      if (((bytes[pos + 2]! << 8) | bytes[pos + 3]!) !== width)
        throw new Error('Wrong .hdr scanline length');
      pos += 4;
      for (let c = 0; c < 4; c++) {
        let x = 0;
        while (x < width) {
          let count = bytes[pos++]!;
          if (count > 128) {
            count -= 128;
            const v = bytes[pos++]!;
            for (let i = 0; i < count; i++) scan[x++ * 4 + c] = v;
          } else {
            for (let i = 0; i < count; i++) scan[x++ * 4 + c] = bytes[pos++]!;
          }
        }
      }
    } else {
      // Flat RGBE (old RLE is rare enough to treat as flat).
      scan.set(bytes.subarray(pos, pos + width * 4));
      pos += width * 4;
    }
    for (let x = 0; x < width; x++) {
      const e = scan[x * 4 + 3]!;
      const f = e === 0 ? 0 : 2 ** (e - 136);
      const o = (y * width + x) * 3;
      data[o] = scan[x * 4]! * f;
      data[o + 1] = scan[x * 4 + 1]! * f;
      data[o + 2] = scan[x * 4 + 2]! * f;
    }
  }
  return { width, height, data };
}

/** Writes an .hdr with flat scanlines (for tests and exports). */
export function writeHdr(image: HdrImage): Uint8Array {
  const header = `#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${image.height} +X ${image.width}\n`;
  const out = new Uint8Array(header.length + image.width * image.height * 4);
  for (let i = 0; i < header.length; i++) out[i] = header.charCodeAt(i);
  let pos = header.length;
  for (let i = 0; i < image.width * image.height; i++) {
    const r = image.data[i * 3]!;
    const g = image.data[i * 3 + 1]!;
    const b = image.data[i * 3 + 2]!;
    const v = Math.max(r, g, b);
    if (v < 1e-32) {
      pos += 4;
      continue;
    }
    const e = Math.ceil(Math.log2(v)) + 1;
    const f = 256 / 2 ** e;
    out[pos++] = Math.min(255, Math.floor(r * f));
    out[pos++] = Math.min(255, Math.floor(g * f));
    out[pos++] = Math.min(255, Math.floor(b * f));
    out[pos++] = e + 128;
  }
  return out;
}
