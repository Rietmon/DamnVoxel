import { describe, expect, it } from 'vitest';
import { WheelClassifier, type WheelInput } from './wheel';

const base: WheelInput = {
  deltaX: 0,
  deltaY: 0,
  deltaMode: 0,
  ctrlKey: false,
  shiftKey: false,
  timeStamp: 0,
};

describe('WheelClassifier', () => {
  it('zooms with a mouse wheel in pixel and line modes', () => {
    const c = new WheelClassifier();
    const notch = c.classify({ ...base, deltaY: 100, wheelDeltaY: -120, timeStamp: 1000 });
    expect(notch.kind).toBe('zoom');
    expect(notch.kind === 'zoom' && notch.factor).toBeGreaterThan(1);
    const lines = c.classify({ ...base, deltaY: -3, deltaMode: 1, timeStamp: 3000 });
    expect(lines.kind === 'zoom' && lines.factor).toBeLessThan(1);
  });

  it('orbits with a two-finger trackpad swipe and pans with Shift', () => {
    const c = new WheelClassifier();
    expect(c.classify({ ...base, deltaX: 4, deltaY: -2.5, timeStamp: 10 })).toEqual({
      kind: 'orbit',
      dx: -4,
      dy: 2.5,
    });
    expect(
      c.classify({ ...base, deltaY: 6, wheelDeltaY: -18, shiftKey: true, timeStamp: 20 }).kind,
    ).toBe('pan');
  });

  it('zooms on a pinch, which arrives as Ctrl + wheel', () => {
    const c = new WheelClassifier();
    const pinch = c.classify({ ...base, deltaY: -2.4, ctrlKey: true, timeStamp: 5 });
    expect(pinch.kind === 'zoom' && pinch.factor).toBeCloseTo(Math.exp(-0.024));
    // A Ctrl + mouse notch is clamped to a reasonable step.
    const notch = c.classify({ ...base, deltaY: 100, ctrlKey: true, timeStamp: 6 });
    expect(notch.kind === 'zoom' && notch.factor).toBeCloseTo(Math.exp(0.6));
  });

  it('keeps a trackpad gesture a trackpad through momentum scrolling', () => {
    const c = new WheelClassifier();
    expect(c.classify({ ...base, deltaY: 12.5, timeStamp: 100 }).kind).toBe('orbit');
    // A whole-number tail event alone would look like a mouse; it is still the same gesture.
    expect(c.classify({ ...base, deltaY: 40, timeStamp: 300 }).kind).toBe('orbit');
    expect(c.classify({ ...base, deltaY: 100, wheelDeltaY: -120, timeStamp: 2000 }).kind).toBe(
      'zoom',
    );
  });

  it('can be forced to one device', () => {
    const c = new WheelClassifier();
    c.mode = 'mouse';
    expect(c.classify({ ...base, deltaX: 3, deltaY: 1.5 }).kind).toBe('zoom');
    c.mode = 'trackpad';
    expect(c.classify({ ...base, deltaY: 100, wheelDeltaY: -120 }).kind).toBe('orbit');
  });
});
