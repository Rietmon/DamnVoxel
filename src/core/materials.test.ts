import { describe, expect, it } from 'vitest';
import { packRgba } from './color';
import { MATERIAL_PARAMS, materialType, materialValue, pbrOf, withMaterial } from './materials';
import { EMPTY_MATERIAL } from './palette';

const entry = (material: Map<string, string>) => ({
  color: packRgba(255, 128, 0),
  material,
  name: '',
});

describe('materials', () => {
  it('reads types and parameters with defaults, keeping unknown keys on edits', () => {
    expect(materialType(EMPTY_MATERIAL)).toBe('_diffuse');
    const m = new Map([
      ['_type', '_metal'],
      ['_rough', '0.25'],
      ['_custom', 'x'],
    ]);
    expect(materialType(m)).toBe('_metal');
    const [metal, rough] = MATERIAL_PARAMS._metal;
    expect(materialValue(m, rough!)).toBe(0.25);
    expect(materialValue(m, metal!)).toBe(0);
    const edited = withMaterial(m, { _metal: 0.7 });
    expect(edited.get('_metal')).toBe('0.7');
    expect(edited.get('_custom')).toBe('x');
  });

  it('turns materials into PBR terms', () => {
    const diffuse = pbrOf(entry(new Map()));
    expect(diffuse.metallic).toBe(0);
    expect(diffuse.baseColor[0]).toBe(1);
    const metal = pbrOf(
      entry(
        new Map([
          ['_type', '_metal'],
          ['_metal', '1'],
          ['_rough', '0.2'],
        ]),
      ),
    );
    expect(metal.metallic).toBe(1);
    expect(metal.roughness).toBe(0.2);
    const glass = pbrOf(
      entry(
        new Map([
          ['_type', '_glass'],
          ['_trans', '0.8'],
          ['_ior', '0.5'],
        ]),
      ),
    );
    expect(glass.transmission).toBe(0.8);
    expect(glass.ior).toBe(1.5);
    const lamp = pbrOf(
      entry(
        new Map([
          ['_type', '_emit'],
          ['_emit', '0.5'],
          ['_flux', '2'],
        ]),
      ),
    );
    expect(lamp.emissiveStrength).toBe(2);
    expect(lamp.emissive).toEqual([1, 128 / 255, 0]);
  });
});
