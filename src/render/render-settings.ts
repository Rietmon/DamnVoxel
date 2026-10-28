/**
 * What the path tracer is told (docs/rendering.md, “Path tracing”): its settings and the scene
 * data it takes. Apart from the tracer itself, whose code loads the first time a picture is
 * traced (render/tracing.ts).
 */

export interface RenderSettings {
  bounces: number;
  /** Stop after this many samples per pixel. */
  samples: number;
  sunYaw: number;
  sunPitch: number;
  sunStrength: number;
  /** Angular radius of the sun, degrees: bigger is softer shadows. */
  sunSize: number;
  skyStrength: number;
  /** Sky colours, #rrggbb. */
  skyZenith: string;
  skyHorizon: string;
  ground: boolean;
  groundColor: string;
  /** Fog per voxel of distance, 0 for none. */
  fog: number;
  fogColor: string;
  exposure: number;
  /** Depth of field: lens radius in voxels (0: everything sharp) and focus distance. */
  aperture: number;
  focus: number;
  bloom: number;
  /** ACES film curve, or plain clipping. */
  tonemap: 'aces' | 'none';
  denoise: boolean;
  /** Only the model is opaque: sky and ground are transparent (a checkerboard on screen). */
  transparent: boolean;
  /** One ray through each pixel centre: crisp pixel-art edges instead of smooth ones. */
  pixelated: boolean;
}

export const DEFAULT_RENDER: RenderSettings = {
  bounces: 4,
  samples: 512,
  sunYaw: 52,
  sunPitch: 50,
  sunStrength: 2,
  sunSize: 2,
  skyStrength: 0.8,
  skyZenith: '#7aa7e6',
  skyHorizon: '#e8eef5',
  ground: true,
  groundColor: '#9aa0a8',
  fog: 0,
  fogColor: '#c8d2dc',
  exposure: 0.9,
  aperture: 0,
  focus: 60,
  bloom: 0,
  tonemap: 'aces',
  denoise: false,
  transparent: false,
  pixelated: false,
};

/** The scene as cells of palette ids, x fastest, and where cell (0, 0, 0) is in the world. */
export interface SceneGrid {
  min: [number, number, number];
  size: [number, number, number];
  cells: Uint16Array;
}

/** Material terms per palette id (core/materials.ts, pbrOf). */
export interface MaterialRow {
  metallic: number;
  roughness: number;
  transmission: number;
  emission: number;
  ior: number;
}
