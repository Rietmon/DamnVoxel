/**
 * Animated GIF writing: one palette of up to 256 colours for
 * all frames by median cut, optional ordered dithering (it stays put from frame to frame, so
 * still parts do not shimmer), a transparent colour for clear pixels, LZW per frame, looping.
 */

export interface GifFrame {
  /** RGBA, rows from the top. */
  pixels: Uint8ClampedArray | Uint8Array;
}

export interface GifOptions {
  width: number;
  height: number;
  /** Time each frame shows, hundredths of a second. */
  delay: number;
  /** Bayer dithering against banding in gradients. */
  dither?: boolean;
}

/** Pixels with less alpha than this are transparent. */
const OPAQUE = 128;

/** Bytes appended to a buffer that grows by doubling. */
class Bytes {
  private buf = new Uint8Array(1 << 16);
  length = 0;

  push(v: number): void {
    if (this.length === this.buf.length) {
      const bigger = new Uint8Array(this.buf.length * 2);
      bigger.set(this.buf);
      this.buf = bigger;
    }
    this.buf[this.length++] = v;
  }

  pushAll(vs: ArrayLike<number>): void {
    for (let i = 0; i < vs.length; i++) this.push(vs[i]!);
  }

  bytes(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

/** 5 bits per channel: the histogram and the colour lookup run on these keys. */
const key15 = (r: number, g: number, b: number): number =>
  ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Up to `count` colours that stand for the opaque pixels of all frames (RGB triples). */
export function medianCut(frames: readonly GifFrame[], count: number): number[][] {
  const n = 1 << 15;
  const hist = new Float64Array(n);
  const sums = new Float64Array(n * 3);
  for (const f of frames) {
    const p = f.pixels;
    for (let i = 0; i < p.length; i += 4) {
      if (p[i + 3]! < OPAQUE) continue;
      const k = key15(p[i]!, p[i + 1]!, p[i + 2]!);
      hist[k]!++;
      sums[k * 3]! += p[i]!;
      sums[k * 3 + 1]! += p[i + 1]!;
      sums[k * 3 + 2]! += p[i + 2]!;
    }
  }
  const bins: number[] = [];
  for (let k = 0; k < n; k++) if (hist[k]! > 0) bins.push(k);
  if (bins.length === 0) return [[0, 0, 0]];
  const channel = (k: number, c: number) => (k >> (10 - c * 5)) & 31;
  type Box = { bins: number[]; weight: number; axis: number; score: number };
  /** A box of bins, with the axis it spreads most along and how much it is worth splitting. */
  const box = (bs: number[]): Box => {
    let weight = 0;
    for (const k of bs) weight += hist[k]!;
    let axis = 0;
    let spread = 0;
    for (let c = 0; c < 3; c++) {
      let lo = 31;
      let hi = 0;
      for (const k of bs) {
        const v = channel(k, c);
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (hi - lo > spread) {
        spread = hi - lo;
        axis = c;
      }
    }
    return { bins: bs, weight, axis, score: bs.length < 2 ? 0 : spread * Math.sqrt(weight) };
  };
  const boxes: Box[] = [box(bins)];
  while (boxes.length < count) {
    // Split the box that covers the most pixels across the widest spread, at its median.
    let best = -1;
    for (let i = 0; i < boxes.length; i++)
      if (boxes[i]!.score > 0 && (best < 0 || boxes[i]!.score > boxes[best]!.score)) best = i;
    if (best < 0) break;
    const b = boxes[best]!;
    b.bins.sort((x, y) => channel(x, b.axis) - channel(y, b.axis));
    let acc = 0;
    let cut = 1;
    for (; cut < b.bins.length - 1; cut++) {
      acc += hist[b.bins[cut - 1]!]!;
      if (acc >= b.weight / 2) break;
    }
    boxes.splice(best, 1, box(b.bins.slice(0, cut)), box(b.bins.slice(cut)));
  }
  return boxes.map((b) => {
    let r = 0;
    let g = 0;
    let bl = 0;
    for (const k of b.bins) {
      r += sums[k * 3]!;
      g += sums[k * 3 + 1]!;
      bl += sums[k * 3 + 2]!;
    }
    return [Math.round(r / b.weight), Math.round(g / b.weight), Math.round(bl / b.weight)];
  });
}

/** Nearest palette colour per 15-bit key, worked out on first use. */
function nearestLookup(palette: readonly number[][]): (k: number) => number {
  const cache = new Int16Array(1 << 15).fill(-1);
  return (k) => {
    const hit = cache[k]!;
    if (hit >= 0) return hit;
    const r = ((k >> 10) & 31) * 8 + 4;
    const g = ((k >> 5) & 31) * 8 + 4;
    const b = (k & 31) * 8 + 4;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const c = palette[i]!;
      const d = (c[0]! - r) ** 2 * 2 + (c[1]! - g) ** 2 * 4 + (c[2]! - b) ** 2 * 3;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    cache[k] = best;
    return best;
  };
}

/** GIF's LZW: codes grow from min+1 to 12 bits, a clear code when the table fills; in sub-blocks. */
export function lzwEncode(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let next = eoi + 1;
  let size = minCodeSize + 1;
  const table = new Int16Array(4096 * 256);
  const out = new Bytes();
  let bits = 0;
  let shift = 0;
  const emit = (code: number) => {
    bits |= code << shift;
    shift += size;
    while (shift >= 8) {
      out.push(bits & 255);
      bits >>>= 8;
      shift -= 8;
    }
  };
  emit(clear);
  let prefix = indices[0] ?? 0;
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i]!;
    const code = table[prefix * 256 + k]!;
    if (code) {
      prefix = code;
      continue;
    }
    emit(prefix);
    if (next === 4096) {
      emit(clear);
      table.fill(0);
      next = eoi + 1;
      size = minCodeSize + 1;
    } else {
      if (next >= 1 << size) size++;
      table[prefix * 256 + k] = next++;
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (shift > 0) out.push(bits & 255);
  // Sub-blocks of at most 255 bytes, then the empty one.
  const data = out.bytes();
  const blocks = new Uint8Array(data.length + Math.ceil(data.length / 255) + 1);
  let p = 0;
  for (let i = 0; i < data.length; i += 255) {
    const n = Math.min(255, data.length - i);
    blocks[p++] = n;
    blocks.set(data.subarray(i, i + n), p);
    p += n;
  }
  blocks[p++] = 0;
  return blocks.subarray(0, p);
}

/** An animated, looping GIF of the frames. */
export function encodeGif(frames: readonly GifFrame[], o: GifOptions): Uint8Array {
  const clear = frames.some((f) => {
    for (let i = 3; i < f.pixels.length; i += 4) if (f.pixels[i]! < OPAQUE) return true;
    return false;
  });
  const colors = medianCut(frames, clear ? 255 : 256);
  const transparent = clear ? colors.length : -1;
  const palette = clear ? [...colors, [0, 0, 0]] : colors;
  const nearest = nearestLookup(colors);
  const bytes = new Bytes();
  const u8 = (...v: number[]) => bytes.pushAll(v);
  const u16 = (v: number) => u8(v & 255, (v >> 8) & 255);
  const text = (s: string) => u8(...[...s].map((c) => c.charCodeAt(0)));
  text('GIF89a');
  u16(o.width);
  u16(o.height);
  // Global colour table of 2^(n+1) entries.
  let tableBits = 0;
  while (1 << (tableBits + 1) < palette.length) tableBits++;
  u8(0x80 | (7 << 4) | tableBits, 0, 0);
  for (let i = 0; i < 1 << (tableBits + 1); i++) u8(...(palette[i] ?? [0, 0, 0]));
  // Loop forever.
  u8(0x21, 0xff, 11);
  text('NETSCAPE2.0');
  u8(3, 1, 0, 0, 0);
  const indices = new Uint8Array(o.width * o.height);
  const minCodeSize = Math.max(2, tableBits + 1);
  for (const f of frames) {
    const p = f.pixels;
    for (let y = 0, i = 0; y < o.height; y++)
      for (let x = 0; x < o.width; x++, i++) {
        const a = p[i * 4 + 3]!;
        if (a < OPAQUE) {
          indices[i] = transparent;
          continue;
        }
        let r = p[i * 4]!;
        let g = p[i * 4 + 1]!;
        let b = p[i * 4 + 2]!;
        if (o.dither) {
          const d = (BAYER4[(y & 3) * 4 + (x & 3)]! / 16 - 0.5) * 10;
          r = Math.max(0, Math.min(255, r + d));
          g = Math.max(0, Math.min(255, g + d));
          b = Math.max(0, Math.min(255, b + d));
        }
        indices[i] = nearest(key15(r, g, b));
      }
    // Graphic control: clear to the background before the next frame when there is transparency.
    u8(0x21, 0xf9, 4, ((clear ? 2 : 1) << 2) | (clear ? 1 : 0));
    u16(o.delay);
    u8(clear ? transparent : 0, 0);
    u8(0x2c);
    u16(0);
    u16(0);
    u16(o.width);
    u16(o.height);
    u8(0);
    u8(minCodeSize);
    bytes.pushAll(lzwEncode(indices, minCodeSize));
  }
  u8(0x3b);
  return bytes.bytes();
}
