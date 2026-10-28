/**
 * Programs to start from (docs/programs.md): each shows a part of the API and is short enough
 * to read in one go. Loaded with the program window.
 */

export interface ProgramTemplate {
  id: string;
  title: string;
  source: string;
}

export const PROGRAM_TEMPLATES: readonly ProgramTemplate[] = [
  {
    id: 'tower',
    title: 'Tower',
    source: `// A round tower with battlements. Parameter sliders are under the code.
const h = param('Height', 24, 6, 80);
const r = param('Radius', 6, 3, 20);
const stone = color('#8a8a8a');
const dark = color('#5a5a5a');
const roof = color('#b03a2e');

cylinder(0, 0, 0, r, h, stone);
cylinder(0, 1, 0, r - 2, h, 0); // hollow inside
// Dark bands every 6 floors.
for (let y = 6; y < h; y += 6) shape((x, yy, z) => Math.abs(Math.hypot(x, z) - r + 0.5) - 0.6, dark, -r, y, -r, r, y, r);
// Battlements around.
const n = Math.round(r * 1.5);
for (let i = 0; i < n; i += 2) {
  const a = (i / n) * Math.PI * 2;
  box(Math.round(Math.cos(a) * (r - 1)), h, Math.round(Math.sin(a) * (r - 1)),
      Math.round(Math.cos(a) * (r - 1)), h + 1, Math.round(Math.sin(a) * (r - 1)), stone);
}
cone(0, h + 3, 0, r - 1, r + 2, roof);
`,
  },
  {
    id: 'tree',
    title: 'Tree',
    source: `// A trunk with branches and a crown of balls. The seed changes the shape.
seed(param('Seed', 3, 1, 99));
const h = param('Trunk height', 14, 4, 40);
const bark = color('#6b4423');
const leaves = [color('#2e6b1f'), color('#3f8f2a'), color('#5aa832')];

line(0, 0, 0, 0, h, 0, bark, 1.5);
for (let i = 0; i < 4; i++) {
  const a = rand() * Math.PI * 2;
  const y = h * (0.5 + rand() * 0.4);
  const len = 4 + rand() * 4;
  const x1 = Math.cos(a) * len, z1 = Math.sin(a) * len;
  line(0, y, 0, x1, y + len * 0.6, z1, bark, 0.8);
  sphere(x1, y + len * 0.6 + 1, z1, 3 + rand() * 2, leaves[i % 3]);
}
sphere(0, h + 2, 0, 5, leaves[1]);
`,
  },
  {
    id: 'hills',
    title: 'Noise hills',
    source: `// Terrain: height is a sum of noise octaves, color follows height.
seed(param('Seed', 7, 1, 99));
const size = param('Size', 48, 16, 128);
const height = param('Height', 14, 2, 40);
const scale = param('Scale', 24, 4, 64);
const water = color('#3a6fd8'), sand = color('#e0cf8a');
const grass = color('#4f9a3a'), rock = color('#7c7c7c'), snow = color('#f2f2f2');
const level = 3;

for (let x = 0; x < size; x++)
  for (let z = 0; z < size; z++) {
    const top = Math.round((fbm(x / scale, 0, z / scale, 5) + 0.5) * height);
    for (let y = 0; y <= Math.max(top, level); y++) {
      if (y > top) set(x, y, z, water);
      else set(x, y, z, top < level + 1 ? sand : top > height * 0.85 ? snow : top > height * 0.65 ? rock : grass);
    }
  }
`,
  },
  {
    id: 'spiral',
    title: 'Spiral',
    source: `// A spiral staircase: steps around a circle, rising.
const steps = param('Steps', 32, 8, 96);
const r = param('Radius', 8, 3, 24);
const turn = param('Steps per turn', 16, 6, 40);
const wood = color('#a0703c');
const post = color('#555555');

cylinder(0, 0, 0, 1.5, steps + 3, post);
for (let i = 0; i < steps; i++) {
  const a = (i / turn) * Math.PI * 2;
  line(0, i, 0, Math.cos(a) * r, i, Math.sin(a) * r, wood, 1);
}
`,
  },
  {
    id: 'menger',
    title: 'Menger sponge',
    source: `// A fractal: the middle thirds are taken out of a cube, again and again.
const level = param('Level', 3, 1, 4);
const n = 3 ** level;
const a = color('#d9a441'), b = color('#7a4f9a');

fill(0, 0, 0, n - 1, n - 1, n - 1, (x, y, z) => {
  for (let k = 1; k < n; k *= 3) {
    const holes = (Math.floor(x / k) % 3 === 1) + (Math.floor(y / k) % 3 === 1) + (Math.floor(z / k) % 3 === 1);
    if (holes >= 2) return 0;
  }
  return (x + y + z) % 2 ? a : b;
});
`,
  },
  {
    id: 'blob',
    title: 'Smooth blob',
    source: `// Signed distances: balls joined by a soft seam, and a carved torus.
const k = param('Seam softness', 4, 0, 10, 0.5);
const body = color('#e86f4f');
const r = 18;

shape((x, y, z) => {
  let d = sd.sphere(x, y - 8, z, 7);
  d = sd.smoothUnion(d, sd.sphere(x - 7, y - 4, z, 5), k);
  d = sd.smoothUnion(d, sd.sphere(x + 6, y - 5, z + 3, 4.5), k);
  d = sd.smoothSubtract(d, sd.torus(x, y - 8, z, 7, 1.5), k / 2);
  return d;
}, (x, y, z) => (y > 9 ? color('#f4a261') : body), -r, -2, -r, r, r, r);
`,
  },
  {
    id: 'empty',
    title: 'Empty',
    source: `// Write here. The API reference is the “API” button above.
const c = color('#4f9a3a');
box(0, 0, 0, 7, 0, 7, c);
`,
  },
];
