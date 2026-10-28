# Stack

## Technologies

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript, `strict` | a large, long-lived codebase; types keep an open-source project from falling apart |
| Build | Vite, pnpm | an instant dev server, minimal configuration |
| Rendering | our own thin layer over WebGL2 | everything voxel-specific has to be written anyway, see below |
| Panel UI | Svelte 5 | compiles to small code without a virtual DOM, fine-grained reactivity, built-in transitions and scoped CSS |
| Background work | Web Workers (a pool) | meshing, programs and simulation never block the brush |
| Input | Pointer Events | mouse, finger and stylus through one API, pen pressure |
| Storage | IndexedDB (autosave, versions, library), File System Access API (where available), file download (everywhere) | built into the browser |
| Compression | `CompressionStream` / `DecompressionStream` (deflate) | built into the browser |
| Offline and install | PWA (`vite-plugin-pwa`) | installs to the home screen, works without a network |
| Tests | Vitest | the DOM-free core is tested in Node |
| Lint and format | Biome | one fast tool |

WebGPU is not the base; it may come later as an optional speed-up for path tracing and simulation. Older Android phones and iOS before 26 do not have it, while WebGL2 is practically everywhere.

## Why our own WebGL2 and not three.js
Everything that matters in a voxel editor has to be written by hand anyway:
- voxel picking is a ray walk over the grid (DDA), not a raycaster over triangles;
- chunk meshing and a packed 8-byte vertex instead of ~36 bytes for standard geometry;
- a shader with a palette texture and MagicaVoxel materials;
- a gizmo and a camera built for this UX;
- rendering only on request.

What would remain of three.js is a scene graph and a material system we do not need, and about 150 KB gzip. We need about six shaders of our own, see [rendering.md](rendering.md).

## Key decisions
- **Voxel value is `uint16`.** It fits into the packed vertex and the 256×256 palette texture; a format can record the width, so it can grow without breaking files.
- **32³ chunks with storage by content.** A local palette and 1/2/4/8-bit indices, a uniform chunk without an array, more than 256 values — a direct `uint16`. Kernels work on a dense copy. See [data-model.md](data-model.md#chunk).
- **An object transform is an integer translation plus one of 48 orientations.** Exact on the grid and identical to `.vox`. Rotating by an arbitrary angle is an operation that resamples voxels.
- **The internal model has no limits; `.vox` is a format at the border.** `.vox` limits (256 colours, 256³) apply only when writing it.
- **No chunks of our own in `.vox`.** There is no guarantee MagicaVoxel would tolerate them.
- **Workers without `SharedArrayBuffer`.** Chunk copies and transferable buffers; SAB needs COOP/COEP headers that not every host can set.
- **WASM only where a profiler asks for it.** Hot kernels are pure functions over typed arrays and can move to Rust/WASM one at a time.

## Budgets
The only place these numbers live.

| What | Budget |
|---|---|
| JS + CSS on first launch | ≤ 200 KB gzip |
| Brush response (touch → voxel on screen) | ≤ 1 frame |
| Re-meshing one 32³ chunk on a mid-range phone | ≤ 2 ms |
| Orbiting the camera around a 256³ model on a mid-range phone | 60 fps |
| Frames while idle | 0 (rendering on request) |
| Memory for a typical 256³ model | ≤ 100 MB |

To keep the first launch within budget, everything not needed at once loads on first use through `import()`: windows (export, voxelization, pictures, versions, examples, keys), drop-down menus (View, Paint, Arrange, the palette library), the timeline, the render bar, the path tracer with frame saving (`render/tracing.ts`; until it loads, the Render view simply waits for a frame), mesh writers and readers, voxelization, GIF, ZIP, `.vox` recovery, `.hdr`. The settings of these features live in light modules (`*-settings.ts`), so windows and saved settings do not pull the code in. `pnpm size` checks the budget after a build.

A “mid-range phone” is a mid-range Android device about three years old.

## Browser support
- Chrome and Edge from the last two years, Firefox from the last two years, Safari on iOS and macOS 16+.
- WebGL2 is required. Without it the editor shows a clear message, not a blank screen.
- The File System Access API is only a convenience: without it, files open through `<input type=file>` and save as downloads.

## Dependency policy
- **Runtime dependencies** (the ones that end up in the bundle) only with a reason: what they give, how much they weigh, why not the platform and not 200 lines of our own. Say it in the pull request.
- **Dev dependencies** — freely.
- Browser APIs first, then our own code, then a library.

## Rejected
| Option | Why not |
|---|---|
| Rust or C++ with a native UI (egui, ImGui) | fast, but a careful UI and touch are hard there; a higher bar for contributors |
| The whole core in Rust/WASM from day one | slower iteration, a harder build; JS over typed arrays is enough for these tasks. WASM — selectively, by profiler |
| three.js | see above |
| Babylon.js | even heavier than three.js |
| React | heavier; virtual DOM re-renders get in the way of frequent panel updates |
| SolidJS | on par with Svelte; a matter of taste, not engineering |
| Electron | more than 100 MB |
| WebGPU as the base | missing on some phones |
