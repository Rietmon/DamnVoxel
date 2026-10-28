import { describe, expect, it } from 'vitest';
import { parseHdr, writeHdr } from './hdr';

describe('.hdr', () => {
  it('round-trips flat scanlines within RGBE precision', () => {
    const data = new Float32Array([0.5, 1, 2, 10, 0.1, 0, 0, 0, 0, 3.5, 3.5, 3.5]);
    const back = parseHdr(writeHdr({ width: 2, height: 2, data }));
    expect(back.width).toBe(2);
    for (let i = 0; i < data.length; i++) expect(back.data[i]!).toBeCloseTo(data[i]!, 0);
    expect(back.data[0]!).toBeCloseTo(0.5, 1);
  });

  it('reads run-length scanlines', () => {
    const width = 8;
    const header = `#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X ${width}\n`;
    const body = [2, 2, 0, width];
    // Each plane: one run of 8 of the same value.
    for (const v of [128, 64, 32, 129]) body.push(128 + width, v);
    const bytes = new Uint8Array([...header].map((c) => c.charCodeAt(0)).concat(body));
    const img = parseHdr(bytes);
    // e = 129 → scale 2^(129-136) = 1/128.
    expect(img.data[0]).toBe(1);
    expect(img.data[1]).toBe(0.5);
    expect(img.data[(width - 1) * 3 + 2]).toBe(0.25);
  });

  it('refuses other files', () => {
    expect(() => parseHdr(new Uint8Array([1, 2, 3]))).toThrow();
  });
});
