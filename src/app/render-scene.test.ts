import { describe, expect, it } from 'vitest';
import { VoxelDocument } from '../core/document';
import { DEFAULT_RENDER } from '../render/pathtracer';
import { lightKey, sceneGrid } from './render-scene';

describe('render scene', () => {
  it('starts a picture over only for settings that change the light', () => {
    const base = lightKey(DEFAULT_RENDER);
    for (const look of [
      { exposure: 2 },
      { bloom: 0.5 },
      { tonemap: 'none' as const },
      { denoise: true },
      { samples: 64 },
    ])
      expect(lightKey({ ...DEFAULT_RENDER, ...look })).toBe(base);
    for (const light of [
      { sunYaw: 10 },
      { fog: 0.01 },
      { aperture: 1 },
      { ground: false },
      { transparent: true },
    ])
      expect(lightKey({ ...DEFAULT_RENDER, ...light })).not.toBe(base);
  });

  it('has nothing to trace in an empty document', () => {
    expect(sceneGrid(VoxelDocument.createEmpty())).toBe('empty');
  });
});
