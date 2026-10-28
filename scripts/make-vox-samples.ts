/**
 * Writes .vox files with the editor's own writer into tests/manual/vox/, for the manual check
 * in MagicaVoxel (tests/manual/vox/README.md). Each file shows one thing that is easy
 * to get wrong: placement, rotation, hierarchy, palette order, materials, size limits.
 *
 *   node scripts/make-vox-samples.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runnerImport } from 'vite';

const root = join(import.meta.dirname, '..');
const out = join(root, 'tests', 'manual', 'vox');
mkdirSync(out, { recursive: true });

// The sources use extensionless imports, as bundlers do: load them through Vite.
const load = async <T>(path: string): Promise<T> =>
  (await runnerImport<T>(path, { root, configFile: false, logLevel: 'error' })).module;
const { createDemoDocument } = await load<typeof import('../src/app/demo.ts')>('./src/app/demo.ts');
const { VoxelDocument } =
  await load<typeof import('../src/core/document.ts')>('./src/core/document.ts');
const { composeOrientation, quarterTurn, reflection } = await load<
  typeof import('../src/core/orientation.ts')
>('./src/core/orientation.ts');
const { groupNodes } = await load<typeof import('../src/core/scene-edit.ts')>(
  './src/core/scene-edit.ts',
);
const { movedOrder } = await load<typeof import('../src/core/palette-edit.ts')>(
  './src/core/palette-edit.ts',
);
const { writeVox } = await load<typeof import('../src/io/vox-write.ts')>('./src/io/vox-write.ts');

type Doc = InstanceType<typeof VoxelDocument>;

function save(name: string, doc: Doc): void {
  writeFileSync(join(out, name), writeVox(doc));
  console.log(`wrote ${name}`);
}

/** An L-shaped arrow pointing +X with a tip of another colour: its turn is easy to read. */
function arrow(doc: Doc, name: string, x: number, orientation: number) {
  const object = doc.scene.createObject(name);
  for (let i = 0; i < 6; i++) object.volume.set(i, 0, 0, 1 + 16 * 5);
  object.volume.set(5, 1, 0, 1 + 16 * 9);
  object.volume.set(0, 0, 1, 1 + 16 * 12);
  object.transform = { x, y: 0, z: 0, orientation };
  doc.scene.attach(object, doc.scene.root);
  return object;
}

// 1. The demo island: placement on the floor, colours, one object.
save('1-island.vox', createDemoDocument());

// 2. Rotations: the same arrow in eight orientations, side by side, names say which.
{
  const doc = new VoxelDocument();
  const turns: [string, number][] = [
    ['as is', 0],
    ['Y 90', quarterTurn(1)],
    ['Y 180', composeOrientation(quarterTurn(1), quarterTurn(1))],
    ['Y −90', quarterTurn(1, true)],
    ['X 90', quarterTurn(0)],
    ['Z 90', quarterTurn(2)],
    ['mirror X', reflection(0)],
    ['mirror Z', reflection(2)],
  ];
  turns.forEach(([name, o], i) => {
    arrow(doc, name, i * 10, o);
  });
  save('2-rotations.vox', doc);
}

// 3. Hierarchy: nested, moved and turned groups with names, one hidden object.
{
  const doc = new VoxelDocument();
  const a = arrow(doc, 'arrow', 0, 0);
  const b = arrow(doc, 'hidden', 0, quarterTurn(1));
  b.transform = { ...b.transform, z: 8 };
  b.hidden = true;
  const inner = groupNodes(doc, [a, b], 'inner')!;
  inner.transform = { x: 5, y: 2, z: 0, orientation: quarterTurn(1) };
  const outer = groupNodes(doc, [inner], 'outer')!;
  outer.transform = { x: 20, y: 0, z: -4, orientation: 0 };
  save('3-hierarchy.vox', doc);
}

// 4. Palette: reordered panel (IMAP), changed colours, materials.
{
  const doc = createDemoDocument();
  const p = doc.palette;
  p.setDisplayOrder(movedOrder(p.displayOrder(), [200, 201, 202], 1));
  p.setEntry(1, {
    color: 0xff3366ff,
    material: new Map([
      ['_type', '_metal'],
      ['_rough', '0.2'],
    ]),
    name: '',
  });
  p.setEntry(2, {
    color: 0xff00ccff,
    material: new Map([
      ['_type', '_emit'],
      ['_flux', '1'],
    ]),
    name: '',
  });
  save('4-palette.vox', doc);
}

// 5. Size limits: one object 300 wide, written as a group of two pieces.
{
  const doc = VoxelDocument.createEmpty();
  const object = doc.scene.objects()[0]!;
  object.name = 'long beam';
  for (let x = 0; x < 300; x++) object.volume.set(x, 0, 0, x < 150 ? 9 : 37);
  save('5-wider-than-256.vox', doc);
}
