import { describe, expect, it } from 'vitest';
import { dragRate, evaluateNumber, snapNumber } from './number-expr';

describe('evaluateNumber', () => {
  it('reads numbers and arithmetic', () => {
    expect(evaluateNumber('12', 0)).toBe(12);
    expect(evaluateNumber(' 2*8+1 ', 0)).toBe(17);
    expect(evaluateNumber('(1+2)*3', 0)).toBe(9);
    expect(evaluateNumber('10/4', 0)).toBe(2.5);
    expect(evaluateNumber('1,5', 0)).toBe(1.5);
    expect(evaluateNumber('-3', 10)).toBe(-3);
    expect(evaluateNumber('2*-3', 0)).toBe(-6);
    expect(evaluateNumber('.5', 0)).toBe(0.5);
    expect(evaluateNumber('3×4', 0)).toBe(12);
  });

  it('changes the current value when the text starts with an operator', () => {
    expect(evaluateNumber('+5', 10)).toBe(15);
    expect(evaluateNumber('*2', 10)).toBe(20);
    expect(evaluateNumber('/4', 10)).toBe(2.5);
    expect(evaluateNumber('+2*3', 10)).toBe(16);
  });

  it('refuses what it cannot read', () => {
    for (const bad of ['', 'abc', '2+', '(1', '1)', '5/0', '1..2', '2 3'])
      expect(evaluateNumber(bad, 1)).toBeNull();
  });
});

describe('snapNumber and dragRate', () => {
  it('rounds to the step and the range', () => {
    expect(snapNumber(7.4, 1, 0, 10)).toBe(7);
    expect(snapNumber(12, 1, 0, 10)).toBe(10);
    expect(snapNumber(0.30000000000000004, 0.1)).toBe(0.3);
    expect(snapNumber(6, 5, 1)).toBe(6);
    expect(snapNumber(-2, 1, 0)).toBe(0);
  });

  it('drags faster with Shift and finer with Ctrl', () => {
    const none = { shift: false, ctrl: false };
    expect(dragRate(1, { ...none, shift: true })).toBe(10 * dragRate(1, none));
    expect(dragRate(1, { ...none, ctrl: true })).toBeCloseTo(dragRate(1, none) / 10);
  });
});
