/**
 * What a number field accepts: a number, arithmetic with
 * brackets («2*8+1»), or a change of the current value written as its start: «+5», «*2», «/4».
 * A leading minus is a negative number, not a change. A comma works as a decimal point.
 * Returns null for anything else (and for division by zero).
 */
export function evaluateNumber(text: string, current: number): number | null {
  let src = text.trim().replace(/,/g, '.').replace(/×/g, '*').replace(/÷/g, '/');
  if (src === '') return null;
  if (/^[+*/]/.test(src)) src = `${current}${src}`;
  const parser = new Parser(src);
  const value = parser.parse();
  return value !== null && Number.isFinite(value) ? value : null;
}

class Parser {
  private pos = 0;

  constructor(private readonly src: string) {}

  parse(): number | null {
    const value = this.expression();
    this.skip();
    return value !== null && this.pos === this.src.length ? value : null;
  }

  private skip(): void {
    while (this.src[this.pos] === ' ') this.pos++;
  }

  private peek(): string | undefined {
    this.skip();
    return this.src[this.pos];
  }

  private expression(): number | null {
    let left = this.term();
    while (left !== null) {
      const op = this.peek();
      if (op !== '+' && op !== '-') break;
      this.pos++;
      const right = this.term();
      if (right === null) return null;
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  private term(): number | null {
    let left = this.factor();
    while (left !== null) {
      const op = this.peek();
      if (op !== '*' && op !== '/') break;
      this.pos++;
      const right = this.factor();
      if (right === null || (op === '/' && right === 0)) return null;
      left = op === '*' ? left * right : left / right;
    }
    return left;
  }

  private factor(): number | null {
    const c = this.peek();
    if (c === '-' || c === '+') {
      this.pos++;
      const inner = this.factor();
      return inner === null ? null : c === '-' ? -inner : inner;
    }
    if (c === '(') {
      this.pos++;
      const inner = this.expression();
      if (inner === null || this.peek() !== ')') return null;
      this.pos++;
      return inner;
    }
    const match = /^\d*\.?\d+(e[+-]?\d+)?|^\d+\./i.exec(this.src.slice(this.pos));
    if (!match) return null;
    this.pos += match[0].length;
    return Number(match[0]);
  }
}

/** Clamps to the range and rounds to the step (counted from min, or from 0 without one). */
export function snapNumber(value: number, step: number, min = -Infinity, max = Infinity): number {
  const origin = Number.isFinite(min) ? min : 0;
  const snapped = step > 0 ? origin + Math.round((value - origin) / step) * step : value;
  // Steps like 0.1 leave float dust: keep as many decimals as the step has.
  const decimals = Math.max(0, (String(step).split('.')[1] ?? '').length);
  return Math.min(max, Math.max(min, Number(snapped.toFixed(decimals))));
}

/** Drag speed: value per pixel for a step; Shift — ten times faster, Ctrl — ten times finer. */
export function dragRate(step: number, mods: { shift: boolean; ctrl: boolean }): number {
  const base = step / 2;
  return mods.shift ? base * 10 : mods.ctrl ? base / 10 : base;
}
