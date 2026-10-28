# `.vox` corpus

Every file in this folder goes through the “read → write → read” test (`src/io/vox-corpus.node.test.ts`): the same scene tree with attributes and frames, the same models, palette, materials and every other chunk; saving again gives the same bytes.

| File | Source | What it checks |
|---|---|---|
| `mv-scene.vox` | generated | a scene as MagicaVoxel 0.99 writes it: nested groups, names, rotations, a hidden node, 16 layers, 256 materials, `IMAP`, `rOBJ`, 10 cameras, `NOTE` |
| `old-pack.vox` | generated | the 0.98 format: `PACK`, several models, no scene graph and no palette |
| `animation.vox` | generated | a node with three frames, a shape with a model per frame |
| `max-256.vox` | generated | a 256³ model with voxels in the far corners |
| `unknown-chunks.vox` | generated | version 200, `META`, `MATT`, an unknown chunk with children |

`pnpm fixtures:vox` regenerates the generated files (`scripts/make-vox-fixtures.ts`).

**Real files from MagicaVoxel** go here as they are — the test picks them up by itself. Files from different versions of the program are welcome, as are examples from `ephtracy/voxel-model` where the licence allows.
