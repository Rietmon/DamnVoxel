# Manual check in MagicaVoxel

These files are written by DamnVoxel (`pnpm samples:vox`, `scripts/make-vox-samples.ts`). Open each one in MagicaVoxel 0.99.7 and compare it with the description. If something does not match, add a test to `src/io/vox-compat.test.ts` and a note to [docs/formats.md](../../../docs/formats.md).

| File | What you should see |
|---|---|
| `1-island.vox` | the island with a pond, a tree and a house stands on the floor, colors as in the editor, one model “Island” |
| `2-rotations.vox` | eight identical arrows in a row along X; the name of each says how it is turned; the long part of an arrow shows its +X, the light cube at the end points up, the dark one at the base points towards −Y (MagicaVoxel's Y axis) |
| `3-hierarchy.vox` | in the world tree: “outer” → “inner” → “arrow” and “hidden”; “hidden” is switched off; the groups are moved and turned, the arrows stand where they stand in the editor |
| `4-palette.vox` | colors 200–202 at the start of the palette; color 1 is metal, color 2 glows; the island model looks as in `1-island.vox`, except for the recolored 1 and 2 |
| `5-wider-than-256.vox` | a 300-long beam made of two models in one group “long beam”, the joint without a gap or an overlap |
