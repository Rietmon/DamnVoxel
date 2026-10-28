import { alpha, blue, green, red } from './color';
import type { MaterialDict, PaletteEntry } from './palette';

/**
 * MagicaVoxel materials (docs/formats.md, “Materials”): every palette colour has a MATL dictionary
 * with a type and its parameters. The editor edits the common ones and keeps every other key as
 * it was; `pbrOf` turns a material into the metallic-roughness PBR terms the export uses.
 */

export type MaterialType =
  | '_diffuse'
  | '_metal'
  | '_glass'
  | '_emit'
  | '_blend'
  | '_media'
  | '_cloud';

export const MATERIAL_TITLES: Record<MaterialType, string> = {
  _diffuse: 'Matte',
  _metal: 'Metal',
  _glass: 'Glass',
  _emit: 'Glow',
  _blend: 'Blend',
  _media: 'Medium',
  _cloud: 'Cloud',
};

/** A parameter the editor shows: its key, title, range and default. */
export interface MaterialParam {
  readonly key: string;
  readonly title: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly fallback: number;
}

const ROUGH: MaterialParam = {
  key: '_rough',
  title: 'Roughness',
  min: 0,
  max: 1,
  step: 0.01,
  fallback: 0.1,
};
const METAL: MaterialParam = {
  key: '_metal',
  title: 'Metalness',
  min: 0,
  max: 1,
  step: 0.01,
  fallback: 0,
};
const SPEC: MaterialParam = {
  key: '_spec',
  title: 'Specular',
  min: 0,
  max: 1,
  step: 0.01,
  fallback: 0.5,
};
const TRANS: MaterialParam = {
  key: '_trans',
  title: 'Transparency',
  min: 0,
  max: 1,
  step: 0.01,
  fallback: 0.5,
};
/** MagicaVoxel writes the refractive index minus one: 0.3 is glass at 1.3. */
const IOR: MaterialParam = {
  key: '_ior',
  title: 'Refraction (−1)',
  min: 0,
  max: 2,
  step: 0.01,
  fallback: 0.3,
};
const EMIT: MaterialParam = {
  key: '_emit',
  title: 'Brightness',
  min: 0,
  max: 1,
  step: 0.01,
  fallback: 0,
};
const FLUX: MaterialParam = {
  key: '_flux',
  title: 'Power',
  min: 0,
  max: 4,
  step: 1,
  fallback: 0,
};
const DENSITY: MaterialParam = {
  key: '_d',
  title: 'Density',
  min: 0,
  max: 1,
  step: 0.01,
  fallback: 0.05,
};

export const MATERIAL_PARAMS: Record<MaterialType, readonly MaterialParam[]> = {
  _diffuse: [],
  _metal: [METAL, ROUGH, SPEC],
  _glass: [TRANS, ROUGH, IOR],
  _emit: [EMIT, FLUX],
  _blend: [METAL, ROUGH, SPEC, TRANS, IOR, EMIT, FLUX],
  _media: [DENSITY],
  _cloud: [DENSITY],
};

export function materialType(m: MaterialDict): MaterialType {
  const t = m.get('_type');
  return t && t in MATERIAL_TITLES ? (t as MaterialType) : '_diffuse';
}

export function materialValue(m: MaterialDict, p: MaterialParam): number {
  const v = Number(m.get(p.key));
  return Number.isFinite(v) ? v : p.fallback;
}

/** A material with a new type or parameter; every other key stays. */
export function withMaterial(
  m: MaterialDict,
  patch: Readonly<Record<string, string | number>>,
): MaterialDict {
  const out = new Map(m);
  for (const [k, v] of Object.entries(patch))
    out.set(k, typeof v === 'number' ? String(+v.toFixed(4)) : v);
  return out;
}

/** Metallic-roughness PBR terms of a palette colour, as glTF wants them. */
export interface Pbr {
  /** Linear-free sRGB 0…1, alpha last. */
  baseColor: [number, number, number, number];
  metallic: number;
  roughness: number;
  /** sRGB 0…1; black when it does not glow. */
  emissive: [number, number, number];
  emissiveStrength: number;
  transmission: number;
  ior: number;
}

/**
 * The PBR terms of a colour and its material. MagicaVoxel has no single PBR model, so this is the
 * usual reading: metal → metallic; glass → transmission with its refractive index; emission
 * strength grows with power (each step of flux doubles it); diffuse is rough and not metal.
 */
export function pbrOf(entry: PaletteEntry): Pbr {
  const m = entry.material;
  const type = materialType(m);
  const c = entry.color;
  const rgb: [number, number, number] = [red(c) / 255, green(c) / 255, blue(c) / 255];
  const get = (p: MaterialParam) => materialValue(m, p);
  const blend = type === '_blend';
  const metallic = type === '_metal' || blend ? get(METAL) : 0;
  const roughness = type === '_diffuse' ? 0.9 : get(ROUGH);
  const glass = type === '_glass' || blend;
  const transmission = glass ? get(TRANS) : 0;
  const glowing = type === '_emit' || blend;
  const strength = glowing ? get(EMIT) * 2 ** get(FLUX) : 0;
  return {
    baseColor: [...rgb, alpha(c) / 255],
    metallic,
    roughness,
    emissive: strength > 0 ? rgb : [0, 0, 0],
    emissiveStrength: strength,
    transmission,
    ior: glass ? 1 + get(IOR) : 1.5,
  };
}
