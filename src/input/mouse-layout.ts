import type { CameraMode, Modifiers, MouseLayout } from './types';

/** MagicaVoxel: right button orbits, middle pans; the wheel zooms in every layout. */
export const DEFAULT_MOUSE: MouseLayout = {
  orbit: [{ button: 2 }],
  pan: [{ button: 1 }],
  zoom: [],
};

/**
 * What a press of the right or middle button does under a layout: the binding whose button
 * matches and whose modifiers are all held wins, the one asking for more modifiers first
 * (Shift + middle pans in Blender even though plain middle orbits). Null: nothing.
 */
export function mouseCameraMode(
  layout: MouseLayout,
  button: number,
  mods: Modifiers,
): CameraMode | null {
  let best: CameraMode | null = null;
  let bestWeight = -1;
  for (const mode of ['orbit', 'pan', 'zoom'] as const) {
    for (const b of layout[mode]) {
      if (b.button !== button) continue;
      if ((b.shift && !mods.shift) || (b.ctrl && !mods.ctrl) || (b.alt && !mods.alt)) continue;
      const weight = Number(!!b.shift) + Number(!!b.ctrl) + Number(!!b.alt);
      if (weight > bestWeight) {
        best = mode;
        bestWeight = weight;
      }
    }
  }
  return best;
}
