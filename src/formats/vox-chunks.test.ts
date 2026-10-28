import { describe, expect, it } from 'vitest';
import { ByteReader, ByteWriter, FormatError } from './binary';
import { decodeChunk, parseVoxFile, type VoxChunk, type VoxFile, writeVoxFile } from './vox-chunks';

const dict = (...pairs: [string, string][]) => new Map(pairs);

/** One chunk of every kind the editor decodes, plus a raw one with children. */
function everyChunk(): VoxChunk[] {
  const colors = new Uint32Array(256);
  for (let i = 0; i < 256; i++) colors[i] = (0xff000000 | (i * 0x010203)) >>> 0;
  const map = new Uint8Array(256);
  for (let i = 0; i < 256; i++) map[i] = (i + 1) & 255;
  return [
    { id: 'PACK', models: 1 },
    { id: 'SIZE', x: 3, y: 4, z: 5 },
    { id: 'XYZI', voxels: new Uint8Array([0, 0, 0, 1, 2, 3, 4, 255]) },
    {
      id: 'nTRN',
      nodeId: 0,
      attrs: dict(),
      childId: 1,
      reservedId: -1,
      layerId: -1,
      frames: [dict()],
    },
    { id: 'nGRP', nodeId: 1, attrs: dict(), children: [2] },
    {
      id: 'nTRN',
      nodeId: 2,
      attrs: dict(['_name', 'House'], ['_hidden', '1']),
      childId: 3,
      reservedId: -1,
      layerId: 0,
      frames: [dict(['_r', '20'], ['_t', '-3 4 17']), dict(['_f', '5'], ['_t', '0 0 1'])],
    },
    { id: 'nSHP', nodeId: 3, attrs: dict(), models: [{ modelId: 0, attrs: dict(['_f', '0']) }] },
    {
      id: 'LAYR',
      layerId: 0,
      attrs: dict(['_name', 'Layer'], ['_color', '255 0 0']),
      reservedId: -1,
    },
    { id: 'RGBA', colors },
    { id: 'IMAP', map },
    {
      id: 'MATL',
      materialId: 1,
      props: dict(['_type', '_metal'], ['_rough', '0.25'], ['_x', 'y']),
    },
    { id: 'rOBJ', attrs: dict(['_type', '_bloom'], ['_mix', '0.5']) },
    { id: 'rCAM', cameraId: 2, attrs: dict(['_mode', 'pers'], ['_focus', '0 0 0']) },
    { id: 'NOTE', names: ['trunks', '', 'leaves'] },
    {
      id: 'ZZZZ',
      raw: true,
      content: new Uint8Array([1, 2, 3]),
      children: new Uint8Array(
        [...'META'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0, 0, 0, 0, 0]),
      ),
    },
  ];
}

describe('.vox chunks', () => {
  it('writes and reads every chunk, byte for byte', () => {
    const file: VoxFile = { version: 150, chunks: everyChunk() };
    const bytes = writeVoxFile(file);
    const back = parseVoxFile(bytes);
    expect(back.version).toBe(150);
    expect(back.chunks).toEqual(file.chunks);
    expect(writeVoxFile(back)).toEqual(bytes);
  });

  it('keeps chunks it cannot decode exactly as raw bytes', () => {
    // A SIZE with a fourth number, a MATL cut short, an unknown chunk.
    const longSize = decodeChunk('SIZE', new Uint8Array(16), new Uint8Array(0));
    expect(longSize).toMatchObject({ id: 'SIZE', raw: true });
    const shortMatl = decodeChunk('MATL', new Uint8Array([1, 0, 0, 0, 5]), new Uint8Array(0));
    expect(shortMatl).toMatchObject({ id: 'MATL', raw: true });
    const meta = decodeChunk('META', new Uint8Array([9, 9]), new Uint8Array(0));
    expect(meta).toMatchObject({ id: 'META', raw: true, content: new Uint8Array([9, 9]) });
    const bytes = writeVoxFile({ version: 200, chunks: [longSize, shortMatl, meta] });
    expect(writeVoxFile(parseVoxFile(bytes))).toEqual(bytes);
  });

  it('reads to the end even when MAIN gives a wrong children size', () => {
    const bytes = writeVoxFile({ version: 150, chunks: [{ id: 'SIZE', x: 1, y: 1, z: 1 }] });
    new DataView(bytes.buffer).setInt32(16, 0, true);
    expect(parseVoxFile(bytes).chunks).toHaveLength(1);
  });

  it('rejects files that are not .vox or are cut short', () => {
    expect(() => parseVoxFile(new Uint8Array([1, 2, 3]))).toThrow(FormatError);
    expect(() => parseVoxFile(new TextEncoder().encode('PNG 1234 whatever'))).toThrow(FormatError);
    const bytes = writeVoxFile({ version: 150, chunks: everyChunk() });
    expect(() => parseVoxFile(bytes.subarray(0, bytes.length - 10))).toThrow(FormatError);
  });

  it('reads and writes little-endian numbers and UTF-8 strings', () => {
    const w = new ByteWriter();
    w.i32(-2);
    w.u32(0xfffffffe);
    w.f32(0.5);
    w.string('naïve ✓');
    for (let i = 0; i < 2000; i++) w.u8(i & 255);
    const r = new ByteReader(w.finish());
    expect([r.i32(), r.u32(), r.f32(), r.string()]).toEqual([-2, 0xfffffffe, 0.5, 'naïve ✓']);
    expect(r.u8()).toBe(0);
    expect(() => r.take(5000)).toThrow(FormatError);
  });
});
