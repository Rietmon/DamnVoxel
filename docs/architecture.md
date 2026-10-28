# Architecture

## Laws
1. **The core knows nothing about the browser.** `core/` and `kernels/` import no DOM, WebGL, Svelte or `window`. They run in Node (tests, command-line tools) and in workers.
2. **Every change to a document is a command.** There is no other way to write to a document. That is why everything can be undone and redone, and why every modifier (mirror, arrays) works with every tool.
3. **Voxel data is not reactive.** The UI subscribes to coarse events (the palette, the scene or the selection changed), not to voxels. Svelte state holds only what the panels show. Scene nodes, the palette and volumes go into `$state` only through `$state.raw`: a deep Svelte proxy would wrap them, and an edit would land in a copy instead of the document.
4. **Hot loops are pure functions over typed arrays.** No objects per voxel, no closures inside the loop. Such functions move to a worker — or, if needed, to WASM — without changing the calling code.
5. **Draw only when something changed.** An idle editor draws zero frames.

## Layers and folders

```
src/
  core/      document, scene, chunks, palette, selection, commands, history, tool logic
  kernels/   pure functions: meshing, programs, particle simulation
  formats/   file formats on their own: .vox chunks, glTF, OBJ, PLY, STL, GIF, PNG, ZIP, .hdr,
             palettes; takes nothing from the editor, MIT licence
  io/        .vox into the editor's document and back: axes, scene, layers, cameras, programs
  workers/   worker entry points, the pool, the message protocol
  render/    WebGL2: shaders, chunk meshes, camera, gizmos, overlays, path tracer
  input/     Pointer Events, gestures, keyboard → tool events
  ui/        Svelte components
  app/       puts everything together: creates the document, renderer and input; gives the UI its state
  main.ts    entry point: creates the app and mounts the UI
```

Dependency direction:

```
ui ──► app ──► core ──► kernels
        │       ▲
        ├──► render (reads core)
        ├──► input  (knows only core types)
        ├──► io ────┘
        │     └──► formats
        ├──► formats
        └──► workers ──► kernels
```

- `core` imports nothing but `kernels`.
- `formats` imports nothing: its files are MIT and get copied into other programs one by one (`src/formats/LICENSE`). What it needs from the editor (colour packing, PBR terms) is described inside it.
- `ui` takes types and pure functions from `core` (colour conversion, for example), and everything live from `app`.
- `app` knows nothing about `ui`: it hands state to the panels as stores with the Svelte store contract (`subscribe`) without importing Svelte.
- npm packages in shipped code — only in `ui` (Svelte).

`scripts/check-layers.ts` (part of `pnpm lint`) enforces the direction: the table of allowed layers and packages lives there. A separate `tsconfig.core.json` builds `core` and `kernels` without DOM types, and Biome forbids browser globals in them.

## Document and events
`VoxelDocument` (not `Document`, to avoid confusion with the DOM) owns the scene, the palette, the selection and the history. It lives on the main thread and changes only through `history.execute(command)`.

After a command the document publishes events:
- `voxels` — for each object, the set of chunks with a stale mesh (neighbours across a chunk border included). The renderer queues them for re-meshing.
- `palette` (with materials), `scene`, `selection`, `history` — for the panels.

Events are collected over a frame and delivered once at the start of the next frame (`flush()`), so a stroke of a hundred points does not cause a hundred panel redraws. A volume remembers which chunks changed by itself, so a writer has nothing to report about voxels; other topics are flagged with `notify`.

## Commands and history
```ts
interface Command {
  readonly label: string;
  readonly bytes: number;              // how much memory the step holds
  apply(doc: VoxelDocument): void;
  revert(doc: VoxelDocument): void;
  /** Absorb the next command of the same gesture; false — does not merge. */
  merge?(next: Command): boolean;
}
```

- A voxel edit stores a **per-chunk diff**: for every touched chunk, the indices of the changed voxels and the values before and after. If more than a quarter of a chunk changed, a full copy of the chunk is stored instead — that is cheaper.
- A brush stroke is one command built by a **transaction** (`VoxelTransaction`): writes go into the document right away, the first write into a chunk takes a copy of it, and `commit` compares the copies with the current chunks once to build the diff. A stroke of any length costs one comparison per touched chunk. `cancel` puts the copies back.
- The transaction gives a view “as it was before the stroke” (`baseOf`): the brush looks for the surface there, so voxels added by the stroke do not grow towards the camera.
- `merge` joins the small steps of one gesture (colour sliders): `execute(cmd, { merge: true })`; `closeMerge()` ends the gesture.
- The history has a memory limit (a setting, 256 MB by default). Old steps are dropped from the start; the last step always stays.
- The history remembers the saved state: the unsaved indicator is `history.isModified`, and it stays correct after undoing back to the saved step.
- Undo is instant: it applies the diff and marks chunks dirty; meshing catches up asynchronously.

## Tools
A tool is a state machine over input events:

```
hover ──press──► drag ──release──► commit
  ▲                │
  └────cancel──────┘   (Esc, a second finger, lost focus)
```

- `input/` turns Pointer Events into tool events: a ray in the world, buttons, pressure, modifiers. A tool does not know whether it is a mouse or a finger.
- Tools live in `core/tools/` and know nothing about the DOM and WebGL: everything they need comes from a `ToolContext` (a ray through a screen point, voxel picking, the preview, a transaction, the history, a hint). So every tool is tested in Node with synthetic rays (`core/tools/test-context.ts`). `app/tool-controller.ts` implements the context on top of the camera and the renderer.
- The preview is a “ghost”: a separate sparse volume with the cells the operation will change and the value they will get. The renderer draws it translucent over the scene: adding shows the future voxels in their colour, erasing shows red, painting shows the new colour.
- While a gesture is not finished, a tool draws its **preview** in a separate render layer and does not touch the document. The exception is the freehand brush: it writes into the document at once so the response fits in a frame, and the whole stroke becomes one command.
- On `commit` a tool produces an **operation** — a description of the edit (which voxels, which value, add / erase / paint).

## Modifiers
An operation passes a chain of modifiers before it is written to the document:

```
tool → operation → [mirror X/Y/Z] → [array] → [selection mask] → executor → command
```

- The mirror multiplies an operation across planes; the preview shows all copies at once. An axis plane lies at `center2 / 2` in object coordinates: an odd `center2` goes through a voxel center (a single “keel” row), an even one between voxels. The planes are drawn translucent; a handle on the edge moves a plane along its axis in half-voxel steps.
- The selection mask keeps an edit inside the selected voxels when it is on.
- Modifiers know nothing about tools, and tools nothing about modifiers. A new tool gets the mirror for free.

## Actions and keys
- Everything a user can do by name is an **action** in one registry (`app/actions.ts`): id, title, group, default keys, run, availability, toggle state. Keys, the command palette, tooltips and menus read the same list, so nothing is reachable only one way.
- Keys use physical codes (`KeyboardEvent.code`): shortcuts work the same on any keyboard layout. Ctrl on macOS is ⌘.
- The “combination → action” table (`input/hotkeys.ts`) refuses conflicts at registration; remapping goes into the same table.
- In text fields keys stay with the field. Space and Z are not actions but camera-drag modifiers, so bare Space and Z are never bound.

## Floating selection
The core of comfortable moving:

1. **Lift.** The selected voxels are taken out of the object into a separate buffer (its own sparse grid) with its own mesh. The hole in the source object is re-meshed once.
2. **Move.** Only the buffer's matrix changes. Zero mesh rebuilds per frame, for a selection of any size.
3. **Quarter turns and flips** rearrange the buffer's data and rebuild only its mesh.
4. **Drop.** The buffer is written into the object (or another object). Lift and drop are one command in the history.

A piece floats only while the gesture lasts: release it and it lands. Arrows and Q / E / H move and turn the selection at once, each as a history step; turns in a row count from the original position as one step (Q then E returns exactly to the start, without a half-voxel shift). Paste and duplicate (Ctrl+J) give the same floating piece without a hole in the source: the next gesture or click places it, so does Enter, Esc cancels.

## Objects in the scene
- A node's transform is relative to its group; the world transform comes from walking up to the root (`worldTransform`). Hiding and locking a group applies to everything inside.
- Moving into another group (the tree, “Group”) keeps the node's place in the world: the new local transform is recomputed exactly, everything is integer.
- Two modes. “Model”: tools edit the voxels of the active object. “Scene”: a click selects an object (Shift / Ctrl — add), dragging an object moves it over the floor, a double click opens it in “Model”; arrows, PageUp / PageDown and Q / E / H move, turn and flip the selection; Delete and Ctrl+J delete and duplicate objects, not voxels. Choosing a tool returns to “Model”.
- The gizmo (Scene mode, Tab): arrows move along an axis by whole voxels, the center moves over the floor (from the side — over a vertical plane), rings turn by a quarter when dragged past 45°. Turns go around the center of the combined bounds of the selected objects. One gesture is one history step (`TransformCommand` merging). The gizmo is drawn over the model and never hides behind it; the grab area for a finger is wider than for a mouse.

## Clipboard
- A copy holds the voxels of the selection (or the whole object) plus the colour of every palette index used. On paste an index is kept if the palette has the same colour under it, otherwise the nearest colour is taken: that way a copy travels between documents with different palettes.
- A copy lives in the editor's memory and, while it is not larger than 200 thousand voxels, also in the system clipboard as text tagged `voxels-clip/1`: that way it survives a switch to another tab.
- Ctrl+C, Ctrl+X and Ctrl+V are not intercepted: the browser sends `copy`, `cut` and `paste` events itself, and only in them is the system clipboard available without asking for permission. If no event comes (Safari without a text selection), the action runs from the key.
- Only a selection can be cut: cutting the whole model by accident is too easy.

## Workers
- A pool of `min(navigator.hardwareConcurrency - 1, 4)` workers, at least one.
- A meshing job gets a chunk with a one-voxel shell from its 26 neighbours (for face culling and AO) and returns the mesh as a transferable `ArrayBuffer`.
- Every chunk has a version number. A result for a stale version is dropped.
- Chunks under the brush during a stroke are meshed synchronously on the main thread — that is how the brush makes it into the frame. Small edits (up to 8 chunks) are meshed at once the same way: undoing a stroke shows instantly. The rest goes to the pool, chunks near the camera target first, at most two jobs per worker in flight.
- The scheduler (`render/mesh-scheduler.ts`) knows nothing about GL and workers: meshes go to a receiver, jobs to an async mesher. So it is tested in Node. If the workers could not be created, everything is meshed on the main thread with a time budget per frame.
- No `SharedArrayBuffer` until we hit a wall: it needs COOP/COEP headers, which not every static host lets you set.

## Frames
1. Apply input, update the tool.
2. Deliver the collected events.
3. Take finished meshes from the workers.
4. If something changed — draw a frame. Otherwise nothing.

`requestAnimationFrame` is requested only when there is a reason: input, a camera animation, jobs in the pool, path-tracing accumulation.

## Keeping work safe
- Autosave to IndexedDB 2 s after the last change, and at once when the tab is hidden or closed (phones kill hidden tabs without warning). The whole document is written as `.vox` by our own lossless writer.
- The copy lives only while there is unsaved work: after saving to a file, or undoing back to the saved state, it is erased. So a copy found at start-up is always work that never reached a file: the editor offers to restore or discard it. Autosave turns on only after the answer, so a new empty document cannot overwrite that work.
- Open / save: where the browser has the File System Access API (Chromium), saving writes back into the opened file; elsewhere (Firefox, Safari, phones) opening goes through a file picker and saving downloads a copy. A `.vox` file can be dropped onto the window. New document and open ask first if there is unsaved work; a broken file does not touch the open document.
- Restored work counts as unsaved until it is saved. Leaving the page with unsaved work asks for confirmation.
- The version history (`app/versions.ts`, IndexedDB `voxels-versions`: the list and the bytes in separate stores, so the list never reads documents) is separate from autosave: the document's `.vox` with a thumbnail of the view on every save to a file, every 10 minutes of editing (3 s after a change, never mid-stroke) and on the “Remember version” command. The same state twice in a row is not stored (FNV-1a + size). Limits: 40 versions per document (by name) and 256 MB in total; automatic ones go first, then the oldest. A version opens in a new tab as an unsaved document.
- Interface settings (panel width, collapsed sections, view, brush, tool, recent commands) go to localStorage; every value is checked against the defaults by key and type.
- Operations that cannot be undone (flattening the palette for an export, for example) never change the document — only the exported copy.

## Tests
- `core`, `kernels`, `io` — Vitest in Node, tests next to the code (`*.test.ts`). In CI, `pnpm test:coverage` holds coverage thresholds for these layers (the numbers are in `vite.config.ts`).
- The history is tested by a random walk: hundreds of random strokes and fills mixed with undo/redo, the state compared with a recording after every step.
- `.vox` — a corpus of real files: read, write, read — the content matches. Details in [formats.md](formats.md#testing).
- Meshing — comparison with reference meshes on a set of edge cases (empty chunk, full chunk, checkerboard, neighbour faces).
- Rendering and UI — screenshots: `node scripts/shot.ts <url> <out.png> [width] [height] [--script=js] [--mobile]` opens the page in the installed Edge or Chrome without a window (`playwright-core`, no browser download).
