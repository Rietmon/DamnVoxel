/** Little-endian readers and writers for binary formats. */

const utf8 = new TextDecoder();
const utf8Encoder = new TextEncoder();

export class FormatError extends Error {
  override name = 'FormatError';
}

export class ByteReader {
  private readonly view: DataView;
  offset = 0;

  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  private need(n: number): void {
    if (n < 0 || this.offset + n > this.bytes.length) {
      throw new FormatError(`Unexpected end of data at byte ${this.offset}`);
    }
  }

  u8(): number {
    this.need(1);
    return this.bytes[this.offset++]!;
  }

  i32(): number {
    this.need(4);
    const v = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return v;
  }

  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  f32(): number {
    this.need(4);
    const v = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return v;
  }

  /** A view of the next n bytes (not a copy). */
  take(n: number): Uint8Array {
    this.need(n);
    const out = this.bytes.subarray(this.offset, this.offset + n);
    this.offset += n;
    return out;
  }

  /** Four ASCII characters, such as a chunk id. */
  tag(): string {
    return String.fromCharCode(...this.take(4));
  }

  /** A length-prefixed UTF-8 string. */
  string(): string {
    const n = this.i32();
    return utf8.decode(this.take(n));
  }
}

export class ByteWriter {
  private data = new Uint8Array(1024);
  private view = new DataView(this.data.buffer);
  length = 0;

  private reserve(n: number): void {
    if (this.length + n <= this.data.length) return;
    let size = this.data.length * 2;
    while (size < this.length + n) size *= 2;
    const grown = new Uint8Array(size);
    grown.set(this.data.subarray(0, this.length));
    this.data = grown;
    this.view = new DataView(grown.buffer);
  }

  u8(v: number): void {
    this.reserve(1);
    this.data[this.length++] = v;
  }

  i32(v: number): void {
    this.reserve(4);
    this.view.setInt32(this.length, v, true);
    this.length += 4;
  }

  u32(v: number): void {
    this.reserve(4);
    this.view.setUint32(this.length, v >>> 0, true);
    this.length += 4;
  }

  f32(v: number): void {
    this.reserve(4);
    this.view.setFloat32(this.length, v, true);
    this.length += 4;
  }

  bytes(b: Uint8Array): void {
    this.reserve(b.length);
    this.data.set(b, this.length);
    this.length += b.length;
  }

  tag(id: string): void {
    for (let i = 0; i < 4; i++) this.u8(id.charCodeAt(i) & 255);
  }

  string(s: string): void {
    const b = utf8Encoder.encode(s);
    this.i32(b.length);
    this.bytes(b);
  }

  /** Overwrites four bytes written earlier (a length known only afterwards). */
  patchI32(at: number, v: number): void {
    this.view.setInt32(at, v, true);
  }

  /** The written bytes (a copy). */
  finish(): Uint8Array {
    return this.data.slice(0, this.length);
  }
}
