/** Packed RGBA, red in the low byte. */
export const packRgba = (r: number, g: number, b: number, a = 255): number =>
  ((r & 255) | ((g & 255) << 8) | ((b & 255) << 16) | ((a & 255) << 24)) >>> 0;
const red = (c: number) => c & 255;
const green = (c: number) => (c >>> 8) & 255;
const blue = (c: number) => (c >>> 16) & 255;

/**
 * Palette files: GIMP .gpl, Lospec/plain .hex, JASC .pal and Adobe
 * .act, read and written. Colours are packed RGBA (packRgba below), opaque. PNG palettes are
 * pictures and need the browser to decode them, so this module leaves them out.
 */

export type PaletteFormat = 'gpl' | 'hex' | 'pal' | 'act';

export interface NamedColors {
  name: string;
  colors: number[];
}

const hex2 = (v: number) => v.toString(16).padStart(2, '0');
const toHex6 = (c: number) => `${hex2(red(c))}${hex2(green(c))}${hex2(blue(c))}`;

function fromHex6(text: string): number | null {
  const m = /^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(text.trim());
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 16);
  return packRgba((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

/** GIMP palette: a header, then «r g b name» lines. */
export function parseGpl(text: string): NamedColors {
  const lines = text.split(/\r?\n/);
  if (!/^GIMP Palette/.test(lines[0] ?? '')) throw new Error('This is not a GIMP palette');
  let name = '';
  const colors: number[] = [];
  for (const line of lines.slice(1)) {
    const t = line.trim();
    if (t.startsWith('Name:')) name = t.slice(5).trim();
    const m = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})/.exec(t);
    if (m) colors.push(packRgba(Number(m[1]), Number(m[2]), Number(m[3])));
  }
  return { name, colors };
}

export function writeGpl(p: NamedColors): string {
  const rows = p.colors.map(
    (c) =>
      `${String(red(c)).padStart(3)} ${String(green(c)).padStart(3)} ${String(blue(c)).padStart(3)}\t#${toHex6(c)}`,
  );
  return `GIMP Palette\nName: ${p.name}\nColumns: 8\n#\n${rows.join('\n')}\n`;
}

/** One hex colour per line, with or without #. */
export function parseHex(text: string, name = ''): NamedColors {
  const colors: number[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const c = fromHex6(line);
    if (c === null) throw new Error(`Not a color: “${line.trim()}”`);
    colors.push(c);
  }
  return { name, colors };
}

export function writeHex(p: NamedColors): string {
  return `${p.colors.map(toHex6).join('\n')}\n`;
}

/** JASC-PAL: «JASC-PAL», «0100», the count, then «r g b» lines. */
export function parsePal(text: string, name = ''): NamedColors {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  if (lines[0] !== 'JASC-PAL') throw new Error('This is not a JASC-PAL palette');
  const count = Number(lines[2]);
  const colors: number[] = [];
  for (const line of lines.slice(3)) {
    const m = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})/.exec(line);
    if (m) colors.push(packRgba(Number(m[1]), Number(m[2]), Number(m[3])));
  }
  return { name, colors: Number.isFinite(count) && count > 0 ? colors.slice(0, count) : colors };
}

export function writePal(p: NamedColors): string {
  const rows = p.colors.map((c) => `${red(c)} ${green(c)} ${blue(c)}`);
  return `JASC-PAL\r\n0100\r\n${p.colors.length}\r\n${rows.join('\r\n')}\r\n`;
}

/** Adobe Color Table: 256 RGB triples, optionally followed by the count of used colours. */
export function parseAct(bytes: Uint8Array, name = ''): NamedColors {
  if (bytes.length < 768) throw new Error('This is not an ACT color table');
  let count = 256;
  if (bytes.length >= 772) count = Math.min(256, (bytes[768]! << 8) | bytes[769]!) || 256;
  const colors: number[] = [];
  for (let i = 0; i < count; i++)
    colors.push(packRgba(bytes[i * 3]!, bytes[i * 3 + 1]!, bytes[i * 3 + 2]!));
  return { name, colors };
}

export function writeAct(p: NamedColors): Uint8Array {
  const out = new Uint8Array(772);
  const n = Math.min(256, p.colors.length);
  for (let i = 0; i < n; i++) {
    const c = p.colors[i]!;
    out[i * 3] = red(c);
    out[i * 3 + 1] = green(c);
    out[i * 3 + 2] = blue(c);
  }
  out[768] = n >> 8;
  out[769] = n & 255;
  out[770] = 0xff;
  out[771] = 0xff;
  return out;
}

/** The format a file name says, or null. */
export function formatOf(fileName: string): PaletteFormat | 'png' | 'vox' | null {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase();
  return ext === 'gpl' ||
    ext === 'hex' ||
    ext === 'pal' ||
    ext === 'act' ||
    ext === 'png' ||
    ext === 'vox'
    ? ext
    : ext === 'txt'
      ? 'hex'
      : null;
}
