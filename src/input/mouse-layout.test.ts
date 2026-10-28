import { describe, expect, it } from 'vitest';
import { DEFAULT_MOUSE, mouseCameraMode } from './mouse-layout';
import type { MouseLayout } from './types';

const none = { shift: false, ctrl: false, alt: false };
const BLENDER: MouseLayout = {
  orbit: [{ button: 1 }, { button: 2 }],
  pan: [{ button: 1, shift: true }],
  zoom: [{ button: 1, ctrl: true }],
};

describe('mouseCameraMode', () => {
  it('follows MagicaVoxel by default', () => {
    expect(mouseCameraMode(DEFAULT_MOUSE, 2, none)).toBe('orbit');
    expect(mouseCameraMode(DEFAULT_MOUSE, 1, none)).toBe('pan');
    expect(mouseCameraMode(DEFAULT_MOUSE, 1, { ...none, shift: true })).toBe('pan');
    expect(mouseCameraMode(DEFAULT_MOUSE, 3, none)).toBeNull();
  });

  it('prefers the binding that asks for the held modifiers', () => {
    expect(mouseCameraMode(BLENDER, 1, none)).toBe('orbit');
    expect(mouseCameraMode(BLENDER, 1, { ...none, shift: true })).toBe('pan');
    expect(mouseCameraMode(BLENDER, 1, { ...none, ctrl: true })).toBe('zoom');
    expect(mouseCameraMode(BLENDER, 2, { ...none, shift: true })).toBe('orbit');
  });
});
