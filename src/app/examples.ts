import { nearestPaletteId } from '../core/clipboard';
import { packRgba } from '../core/color';
import { VoxelDocument } from '../core/document';
import { withMaterial } from '../core/materials';
import { quarterTurn } from '../core/orientation';
import type { GroupNode, Transform, VoxelObject } from '../core/scene';
import { VoxelVolume } from '../core/volume';
import { createDemoDocument } from './demo';

/**
 * Example documents (the guide's front page, “Examples”): small scenes that show what the editor
 * does — to look at, to take apart, to render. Built in code, so they cost nothing to ship and
 * always match the current format.
 */

export interface Example {
  id: string;
  title: string;
  description: string;
  build(): VoxelDocument;
}

/** A palette id for an sRGB colour. */
const colour = (doc: VoxelDocument, r: number, g: number, b: number) =>
  nearestPaletteId(doc.palette, packRgba(r, g, b));

function fill(
  v: VoxelVolume,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  id: number,
): void {
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) v.set(x, y, z, id);
}

function sphere(v: VoxelVolume, cx: number, cy: number, cz: number, r: number, id: number): void {
  for (let x = -r; x <= r; x++)
    for (let y = -r; y <= r; y++)
      for (let z = -r; z <= r; z++)
        if (x * x + y * y + z * z <= r * r + r) v.set(cx + x, cy + y, cz + z, id);
}

/** A new object at a place, in a group (the root by default). */
function place(
  doc: VoxelDocument,
  name: string,
  volume: VoxelVolume,
  t: Partial<Transform> = {},
  parent: GroupNode = doc.scene.root,
): VoxelObject {
  const o = doc.scene.createObject(name, volume);
  o.transform = { x: 0, y: 0, z: 0, orientation: 0, ...t };
  doc.scene.attach(o, parent);
  return o;
}

/** A document without the empty first object. */
function emptyDocument(): VoxelDocument {
  return new VoxelDocument();
}

function materials(): VoxelDocument {
  const doc = emptyDocument();
  const p = doc.palette;
  /** A colour of its own for a material: the nearest id, given the material. */
  const tinted = (r: number, g: number, b: number, material: Record<string, string | number>) => {
    const id = colour(doc, r, g, b);
    const e = p.entry(id);
    p.setEntry(id, { ...e, material: withMaterial(e.material, material) });
    return id;
  };
  const gold = tinted(255, 204, 51, { _type: '_metal', _metal: 1, _rough: 0.15 });
  const glass = tinted(153, 204, 255, { _type: '_glass', _trans: 0.9, _rough: 0.02, _ior: 0.5 });
  const lamp = tinted(255, 153, 51, { _type: '_emit', _emit: 1, _flux: 2 });
  const clay = colour(doc, 204, 51, 51);
  const stone = colour(doc, 136, 136, 136);
  const base = new VoxelVolume();
  fill(base, -24, 0, -9, 23, 2, 8, stone);
  place(doc, 'Stand', base);
  const balls = [
    ['Gold', gold],
    ['Glass', glass],
    ['Light', lamp],
    ['Clay', clay],
  ] as const;
  balls.forEach(([name, id], i) => {
    const v = new VoxelVolume();
    sphere(v, 0, 0, 0, 5, id);
    place(doc, name, v, { x: -18 + i * 12, y: 8 });
  });
  return doc;
}

function village(): VoxelDocument {
  const doc = emptyDocument();
  const grass = colour(doc, 102, 170, 68);
  const wall = colour(doc, 238, 238, 238);
  const roof = colour(doc, 170, 68, 34);
  const door = colour(doc, 102, 68, 34);
  const trunk = colour(doc, 102, 51, 0);
  const leaves = colour(doc, 51, 119, 34);
  const ground = new VoxelVolume();
  fill(ground, -32, 0, -32, 31, 0, 31, grass);
  place(doc, 'Ground', ground);

  // One house, three times: linked copies share the voxels — paint one, all change.
  const house = new VoxelVolume();
  fill(house, 0, 0, 0, 9, 6, 7, wall);
  fill(house, 1, 0, 1, 8, 6, 6, 0);
  fill(house, 4, 0, 0, 5, 3, 0, door);
  for (let s = 0; s < 5; s++) fill(house, -1, 7 + s, s - 1, 10, 7 + s, 8 - s, roof);
  const homes = doc.scene.createGroup('Houses');
  doc.scene.attach(homes, doc.scene.root);
  place(doc, 'House', house, { x: -20, y: 1, z: -18 }, homes);
  place(doc, 'House', house, { x: 6, y: 1, z: -20, orientation: quarterTurn(1) }, homes);
  place(doc, 'House', house, { x: -4, y: 1, z: 10, orientation: quarterTurn(1, true) }, homes);

  // Trees on a layer of their own: hide the layer, the trees go.
  const layer = { id: 1, name: 'Trees', hidden: false, locked: false };
  doc.scene.layers.push(layer);
  const tree = new VoxelVolume();
  fill(tree, 0, 0, 0, 0, 4, 0, trunk);
  sphere(tree, 0, 7, 0, 3, leaves);
  for (const [x, z] of [
    [-26, 4],
    [-14, 20],
    [20, 6],
    [24, 22],
    [14, -6],
    [-26, -26],
  ] as const) {
    const t = place(doc, 'Tree', tree, { x, y: 1, z });
    t.layer = layer;
  }
  return doc;
}

function bounce(): VoxelDocument {
  const doc = emptyDocument();
  const floor = new VoxelVolume();
  fill(floor, -12, 0, -12, 11, 0, 11, colour(doc, 85, 85, 102));
  place(doc, 'Floor', floor);
  const ball = new VoxelVolume();
  sphere(ball, 0, 0, 0, 4, colour(doc, 255, 102, 51));
  const o = place(doc, 'Ball', ball, { y: 5 });
  // Up and down in 24 frames: a key every other frame along a parabola.
  const transforms = new Map<number, Transform>();
  for (let f = 0; f <= 24; f += 2) {
    const t = f / 24;
    transforms.set(f, { x: 0, y: 5 + Math.round(16 * 4 * t * (1 - t)), z: 0, orientation: 0 });
  }
  o.keys = { transforms, volumes: new Map() };
  Object.assign(doc.animation, {
    frame: 0,
    start: 0,
    end: 24,
    fps: 24,
    loop: true,
    smooth: true,
  });
  return doc;
}

function hero(): VoxelDocument {
  const doc = emptyDocument();
  const skin = colour(doc, 255, 204, 153);
  const hair = colour(doc, 102, 51, 17);
  const shirt = colour(doc, 51, 102, 204);
  const belt = colour(doc, 68, 51, 34);
  const pants = colour(doc, 51, 51, 68);
  const boots = colour(doc, 34, 34, 34);
  const eye = colour(doc, 17, 17, 17);
  const v = new VoxelVolume();
  // Legs and boots.
  fill(v, 1, 0, 1, 2, 1, 3, boots);
  fill(v, 5, 0, 1, 6, 1, 3, boots);
  fill(v, 1, 2, 1, 2, 6, 3, pants);
  fill(v, 5, 2, 1, 6, 6, 3, pants);
  // Body, belt and arms.
  fill(v, 1, 7, 1, 6, 7, 3, belt);
  fill(v, 1, 8, 1, 6, 12, 3, shirt);
  fill(v, -1, 8, 1, 0, 12, 3, shirt);
  fill(v, 7, 8, 1, 8, 12, 3, shirt);
  fill(v, -1, 6, 1, 0, 7, 3, skin);
  fill(v, 7, 6, 1, 8, 7, 3, skin);
  // Head, hair and eyes (the face looks to +z).
  fill(v, 1, 13, 0, 6, 18, 4, skin);
  fill(v, 1, 18, 0, 6, 19, 4, hair);
  fill(v, 1, 13, 0, 6, 18, 0, hair);
  fill(v, 1, 13, 4, 6, 17, 4, skin);
  v.set(2, 15, 4, eye);
  v.set(5, 15, 4, eye);
  place(doc, 'Hero', v, { x: -4, z: -2 });
  return doc;
}

export const EXAMPLES: readonly Example[] = [
  {
    id: 'island',
    title: 'Island',
    description: 'Hills, a pond, a house and a tree — try the brushes and painting.',
    build: () => {
      const doc = createDemoDocument();
      doc.scene.objects()[0]!.name = 'Island';
      return doc;
    },
  },
  {
    id: 'materials',
    title: 'Materials',
    description: 'Gold, glass, glow and clay. Open the Render mode.',
    build: materials,
  },
  {
    id: 'village',
    title: 'Village',
    description: 'A group of linked houses and a layer of trees: scene, layers, linked copies.',
    build: village,
  },
  {
    id: 'bounce',
    title: 'Bouncing ball',
    description: 'Position keys every other frame and smooth motion: timeline and animation.',
    build: bounce,
  },
  {
    id: 'hero',
    title: 'Hero',
    description: 'A small character: sprites from 8 sides, export, recoloring.',
    build: hero,
  },
];
