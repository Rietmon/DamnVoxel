# Technical documentation

How DamnVoxel is built and why. For how to use the editor, see the [user guide](user/README.md).

| Document | What it covers | Read it when |
|---|---|---|
| [architecture.md](architecture.md) | the laws of the code, layers, documents and events, commands and history, tools, modifiers, workers, keeping work safe, tests | you write any code |
| [data-model.md](data-model.md) | scene, objects, chunks, palette, selection, history | you touch how voxels are stored |
| [rendering.md](rendering.md) | the viewport, meshing, voxel picking, camera, path tracing, saving frames | you touch rendering or performance |
| [formats.md](formats.md) | `.vox` and full compatibility with it, mesh export, voxelization, pictures, the planned `.dvox` format | you touch import, export or saving |
| [programs.md](programs.md) | programmable shapes: the engine, the API, nodes | you touch programs or nodes |
| [ui-design.md](ui-design.md) | the interface layout on desktop and phone, the context bar, menus, behaviour | you change any part of the interface |
| [stack.md](stack.md) | technologies, key decisions, performance budgets, rejected options | you add a dependency or pick a tool |
| [benchmarks.md](benchmarks.md) | how to measure the budgets and the latest results | you check speed or change meshing or rendering |
| [user/](user/README.md) | the user guide; `scripts/build-site.ts` turns it into `/guide/` | you change something people see |

## Writing documentation
- A document says how things work and why. The history of changes belongs in git.
- Numbers (budgets, sizes, limits) live in one place; other documents link there.
- A change people can see updates the user guide in the same pull request.
