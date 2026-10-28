import { describe, expect, it } from 'vitest';
import { encodeGif, lzwEncode, medianCut } from './gif';

/** GIF's LZW, read back: sub-blocks joined, codes LSB first. */
function lzwDecode(blocks: Uint8Array, minCodeSize: number): number[] {
  const data: number[] = [];
  let p = 0;
  while (blocks[p]! > 0) {
    const n = blocks[p++]!;
    for (let i = 0; i < n; i++) data.push(blocks[p++]!);
  }
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let size = minCodeSize + 1;
  let dict: number[][] = [];
  const reset = () => {
    dict = [];
    for (let i = 0; i < clear; i++) dict.push([i]);
    dict.push([], []);
    size = minCodeSize + 1;
  };
  reset();
  const out: number[] = [];
  let prev: number[] | null = null;
  let bit = 0;
  for (;;) {
    let code = 0;
    for (let i = 0; i < size; i++, bit++) code |= ((data[bit >> 3]! >> (bit & 7)) & 1) << i;
    if (code === clear) {
      reset();
      prev = null;
      continue;
    }
    if (code === eoi) break;
    let entry: number[];
    if (prev === null) entry = dict[code]!;
    else {
      entry = code < dict.length ? dict[code]! : [...prev, prev[0]!];
      if (dict.length < 4096) dict.push([...prev, entry[0]!]);
    }
    out.push(...entry);
    if (dict.length === 1 << size && size < 12) size++;
    prev = entry;
  }
  return out;
}

/** Just enough of a GIF reader to check what was written. */
function readGif(bytes: Uint8Array) {
  const text = (a: number, n: number) => String.fromCharCode(...bytes.subarray(a, a + n));
  const u16 = (a: number) => bytes[a]! | (bytes[a + 1]! << 8);
  expect(text(0, 6)).toBe('GIF89a');
  const width = u16(6);
  const height = u16(8);
  const tableSize = 2 << (bytes[10]! & 7);
  const palette: number[][] = [];
  for (let i = 0; i < tableSize; i++) palette.push([...bytes.subarray(13 + i * 3, 16 + i * 3)]);
  let p = 13 + tableSize * 3;
  const frames: { indices: number[]; delay: number; transparent: number }[] = [];
  let delay = 0;
  let transparent = -1;
  let looping = false;
  while (bytes[p] !== 0x3b) {
    if (bytes[p] === 0x21) {
      const label = bytes[p + 1];
      if (label === 0xff) looping = text(p + 3, 11) === 'NETSCAPE2.0';
      if (label === 0xf9) {
        delay = u16(p + 4);
        transparent = bytes[p + 3]! & 1 ? bytes[p + 6]! : -1;
      }
      p += 2;
      while (bytes[p]! > 0) p += bytes[p]! + 1;
      p++;
    } else if (bytes[p] === 0x2c) {
      const min = bytes[p + 10]!;
      const start = p + 11;
      let q = start;
      while (bytes[q]! > 0) q += bytes[q]! + 1;
      frames.push({ indices: lzwDecode(bytes.subarray(start, q + 1), min), delay, transparent });
      p = q + 1;
    } else throw new Error(`Unexpected block ${bytes[p]} at ${p}`);
  }
  return { width, height, palette, frames, looping };
}

describe('GIF', () => {
  it('LZW round-trips through a table that fills and clears', () => {
    // Noise fills the 4096-entry table several times over.
    let seed = 7;
    const indices = new Uint8Array(40000).map(() => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed >> 16) & 255;
    });
    expect(lzwDecode(lzwEncode(indices, 8), 8)).toEqual([...indices]);
    const runs = new Uint8Array(5000).map((_, i) => (i >> 6) & 3);
    expect(lzwDecode(lzwEncode(runs, 2), 2)).toEqual([...runs]);
  });

  it('finds the colours of a picture', () => {
    const pixels = new Uint8ClampedArray(4 * 4 * 4);
    const colors = [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [250, 250, 250],
    ];
    for (let i = 0; i < 16; i++) pixels.set([...colors[i % 4]!, 255], i * 4);
    const palette = medianCut([{ pixels }], 8).map((c) => c.join(','));
    expect(palette.sort()).toEqual(colors.map((c) => c.join(',')).sort());
  });

  it('writes looping frames with the right colours and a transparent index', () => {
    const w = 3;
    const h = 2;
    const frame = (rgb: number[], clearAt: number) => {
      const pixels = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < w * h; i++)
        pixels.set(i === clearAt ? [0, 0, 0, 0] : [...rgb, 255], i * 4);
      return { pixels };
    };
    const gif = readGif(
      encodeGif([frame([200, 40, 40], 0), frame([40, 40, 200], 5)], {
        width: w,
        height: h,
        delay: 4,
      }),
    );
    expect([gif.width, gif.height, gif.looping]).toEqual([3, 2, true]);
    expect(gif.frames).toHaveLength(2);
    const [a, b] = gif.frames;
    expect(a!.delay).toBe(4);
    expect(a!.transparent).toBeGreaterThanOrEqual(0);
    expect(a!.indices[0]).toBe(a!.transparent);
    expect(gif.palette[a!.indices[1]!]).toEqual([200, 40, 40]);
    expect(b!.indices[5]).toBe(b!.transparent);
    expect(gif.palette[b!.indices[0]!]).toEqual([40, 40, 200]);
  });
});
