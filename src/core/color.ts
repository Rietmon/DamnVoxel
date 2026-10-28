/**
 * Colours are packed into one unsigned 32-bit number: r | g << 8 | b << 16 | a << 24.
 * In little-endian memory this is the byte order R, G, B, A, the same as RGBA8 texture data
 * and as 0xAABBGGRR values in the .vox specification.
 */

export function packRgba(r: number, g: number, b: number, a = 255): number {
  return ((r & 255) | ((g & 255) << 8) | ((b & 255) << 16) | ((a & 255) << 24)) >>> 0;
}

export function red(c: number): number {
  return c & 255;
}

export function green(c: number): number {
  return (c >>> 8) & 255;
}

export function blue(c: number): number {
  return (c >>> 16) & 255;
}

export function alpha(c: number): number {
  return c >>> 24;
}

/** `#rrggbb`, lowercase, alpha ignored. */
export function toHex(c: number): string {
  const rgb = (red(c) << 16) | (green(c) << 8) | blue(c);
  return `#${rgb.toString(16).padStart(6, '0')}`;
}

/** Parses `#rgb`, `#rrggbb` or the same without `#`; returns null for anything else. */
export function fromHex(text: string, a = 255): number | null {
  const m = text.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let hex = m[1]!;
  if (hex.length === 3) hex = [...hex].map((ch) => ch + ch).join('');
  const n = Number.parseInt(hex, 16);
  return packRgba((n >> 16) & 255, (n >> 8) & 255, n & 255, a);
}

/** Hue 0…360, saturation and value 0…1. */
export interface Hsv {
  h: number;
  s: number;
  v: number;
}

export function rgbToHsv(r: number, g: number, b: number): Hsv {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max / 255 };
}

/** RGB 0…255, rounded. */
export function hsvToRgb({ h, s, v }: Hsv): [number, number, number] {
  const c = v * s;
  const hh = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const [r, g, b] =
    hh < 1
      ? [c, x, 0]
      : hh < 2
        ? [x, c, 0]
        : hh < 3
          ? [0, c, x]
          : hh < 4
            ? [0, x, c]
            : hh < 5
              ? [x, 0, c]
              : [c, 0, x];
  const m = v - c;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
