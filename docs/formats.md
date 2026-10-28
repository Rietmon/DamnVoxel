# File formats

> This description of the formats is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/): you may copy and adapt it with attribution. The format code (`src/formats`) is under the [MIT licence](../src/formats/LICENSE); turning `.vox` into the editor's scene (`src/io`) is part of the editor and under the AGPL.

| Format | Read | Write | Role |
|---|---|---|---|
| `.vox` (MagicaVoxel) | yes | yes | the main exchange format, **full compatibility is required** |
| `.dvox` (DamnVoxel) | planned | planned | everything without limits, including procedural objects and editor settings |
| glTF / GLB | yes (voxelize) | yes | game engines, Blender, the web |
| OBJ + MTL + PNG palette | yes (voxelize) | yes | like MagicaVoxel's export |
| PLY | — | yes | colour in vertices |
| STL | yes (voxelize) | yes | 3D printing |
| PNG | yes (picture → voxels, slice sheets) | yes (render, slices) | |

## `.vox`

Specification: the `ephtracy/voxel-model` repository on GitHub (`MagicaVoxel-file-format-vox.txt` and `MagicaVoxel-file-format-vox-extension.txt`).

### What we read and write

| Chunk | What | Where it goes in the model |
|---|---|---|
| `MAIN` | the root | — |
| `PACK` | number of models (old files) | — |
| `SIZE` + `XYZI` | a model's size and voxels | the volume of a `VoxelObject` |
| `RGBA` | the 256-colour palette | the document palette |
| `MATL` | a material per palette index (dictionary) | the palette entry's material |
| `MATT` | the old material format | the palette entry's material (read only) |
| `nTRN` | a transform node: name, hidden flag, layer, frames (`_r`, `_t`, `_f`) | the node's transform and its keys |
| `nGRP` | a group | `Group` |
| `nSHP` | a reference to models (by frame) | `VoxelObject` |
| `LAYR` | a layer | layers |
| `rOBJ` | render settings | document settings |
| `rCAM` | cameras | document cameras |
| `NOTE` | notes for palette rows | row notes |
| `IMAP` | the palette display order | display order |
| `META` | the animation playback range (0.99.7.2) | animation settings |
| unknown | — | kept as is and written back |

### Guarantee
Open a `.vox` and save it without edits — **the same content**: the same models and voxels, every colour at its index, the same materials, scene graph, layers, frames, cameras, render settings, colour names, palette order and unknown chunks. A byte-for-byte match is welcome but not required (the chunk order may differ).

### Pitfalls
- **Palette index shift.** A voxel with index `i` (1…255) takes its colour from entry `i − 1` of the `RGBA` chunk. Index 0 is empty, so there are 255 colours, not 256.
- **No `RGBA` chunk** means the MagicaVoxel default palette. It has to be built into the editor.
- **Axes.** In `.vox`, Z points up; ours is Y. The conversion lives in one function.
- **Model position.** `_t` in `nTRN` is the position of the model's center, not its corner; rounding matters for odd sizes. The rule is pinned by tests on files from MagicaVoxel, not by guesswork.
- **Dictionary values are strings.** `_t` is `"x y z"` as text, `_r` is the decimal string of the rotation byte. The specification does not say so explicitly.
- **Rotation `_r`** is a byte: bits 0–1 and 2–3 hold the indices of the non-zero columns of the first two rows, bits 4–6 the signs of the rows. The rotation applies around the model's center. All 48 variants are covered by a test.
- **Version.** MagicaVoxel writes `150` even in new files so that old versions can read them; `200` also occurs, with undocumented changes. We read both and write `150` until real files prove otherwise.
- **Undocumented chunks.** `LAYR`, `rOBJ`, `rCAM` and `META` are described incompletely — their structure comes from real files, and their dictionaries are kept whole.
- **`IMAP` is for the interface only.** A voxel index always points into `RGBA` directly (with the shift by 1); `IMAP` sets the palette display order and how `NOTE` notes attach. Getting the direction backwards is a classic parser bug.
- **Dictionaries** (`DICT`) in `MATL`, `nTRN`, `rOBJ` and `rCAM` are kept whole, unknown keys included.
- **Animation** (`core/animation.ts`, `io/vox-read.ts`, `io/vox-write.ts`): `nTRN` frames (`_f`, `_r`, `_t`) are the node's position keys, `nSHP` models with `_f` are the object's model keys. A frame shows the last key at or before it. On reading, the models of all frames of an object are shifted so their centers match the center of the shown model (that is how MagicaVoxel places a frame's model at `_t`) — one position works for every frame; on writing, each frame's model goes into a box with the same center, untouched ones as they were. Other frame keys are kept. The playback range is kept in the document but not yet written to `META`; a `META` read from a file is written back as it was.
- **Colour names and row notes.** A colour's name is written into its `MATL` under the `_name` key (MagicaVoxel leaves extra keys alone); notes for rows of 8 colours go into the `NOTE` chunk in its old place and are rewritten only when they change.
- **`rCAM` cameras** are the document's slots 0–9. We read `_mode` (`pers`; `orth` and `iso` mean orthographic), `_focus` (a point, in file axes), `_angle` (tilt and turn in degrees), `_radius` and `_fov`, and also write `_frustum` = tan(fov/2). An untouched slot is written as its old chunk byte for byte, a changed one as the same dictionary with updated keys, a cleared one not at all. The order of angles and the zero of the turn follow MagicaVoxel's default camera (`30 45 0` — the same as ours) and have not yet been checked by hand in MagicaVoxel.
- **We never write chunks of our own into `.vox`.** There is no guarantee MagicaVoxel would tolerate them. Everything of our own belongs in our own format (one exception: the program key below lives inside an `nTRN` dictionary, which MagicaVoxel keeps).

### Materials
`core/materials.ts`: the type `_type` (`_diffuse`, `_metal`, `_glass`, `_emit`, `_blend`, `_media`, `_cloud`) and the parameters `_metal`, `_rough`, `_spec`, `_trans`, `_ior` (stored as the refractive index minus 1), `_emit`, `_flux` and `_d`; they are edited in the colour window, other `MATL` keys are kept. In PBR for export (`pbrOf`): metal → metallic, glass → transmission and IOR, glow → emissive with strength `_emit · 2^_flux`, matte → roughness 0.9.

### Palettes
`formats/palette-formats.ts`: we read and write GIMP `.gpl`, `.hex` (one colour per line, as Lospec serves them; `.txt` too), JASC `.pal`, Adobe `.act` (256 triples and the colour count); `.png` — the distinct colours of a picture, row by row (up to 255), exported as a strip of one pixel per colour; from a `.vox` its palette is taken. Applying: “Replace” — colours 1…N become the new ones, voxels keep their indices; “Fit the model” — every voxel first moves to the nearest new colour. One undo step.

### How it is built (`src/formats`, `src/io`)
- Three layers: `formats/vox-chunks` — bytes ⇄ typed chunks without meaning (MIT, knows nothing about the editor — it can be taken into another program); `io/vox-read` / `io/vox-write` — chunks ⇄ the editor's document; `io/vox-axes` — the only place where MagicaVoxel's axes and rules meet ours.
- **Axes:** a file point `(x, y, z)` is the editor's `(x, z, −y)`. This is a rotation, not a reflection: handedness and face winding are kept.
- **Model position** (checked against the open `ogt_vox` reader): the model's center is `floor(size / 2)`; the geometry is shifted by −center, rotated by `_r`, shifted by `_t`. For us this is one object transform: `T = C·(t − R·center)`. A test checks the rule for all 48 rotations and for odd and even sizes.
- **Palette:** entry `k` of the `RGBA` chunk is index `k + 1`; entry 255 (the colour of index 0) is kept and written back. A `MATL` with number `i` is the material of index `i`; numbers 0 and 256 mean index 0 and are kept as is.
- **`IMAP`:** display cell → voxel index. While the panel order is untouched, the old `IMAP` is written byte for byte; a changed order is written anew, index 0 stays in its cell.
- **What we keep without understanding:** `rOBJ`, `NOTE`, `META`, `MATT`, unknown chunks, node attributes and all animation frames (and the models of other frames) — next to the document in the weak maps of `io/vox-extras`, and written back.
- **`LAYR` layers** are the scene's layers (`io/vox-layers.ts`): the name `_name`, the hidden flag `_hidden`, a node's layer is the `layerId` field in `nTRN` (MagicaVoxel writes −1 for groups — that is the first layer). An untouched layer is written as its old chunk with all keys; a layer the file only named in `nTRN` without its own `LAYR`, and the single default layer of a file without layers, are written only after an edit — open and save gives the same chunks. Layer locking exists only in the editor and is not written to `.vox`.
- **Instances:** several nodes on one model become several objects with copies of the voxels. As long as an object is not edited, they share one model again when written. An edit makes the copy independent; linked copies stay linked.
- **A model larger than 256** on any axis is written as a group of pieces of up to 256³; palette indices above 255 take the nearest colour among 1…255 on writing.
- Dictionary strings are read as UTF-8; names in another encoding become UTF-8 after saving.
- We write version 150.

### Beyond the `.vox` limits

| What exceeds the limit | What the writer does | Loss |
|---|---|---|
| an object larger than 256 on any axis | cuts it into 256³ pieces and puts them in a group with the right offsets | none |
| palette indices above 255 | each takes the nearest colour among 1…255 | yes |
| editor settings (mirror and so on) | not written | yes |

- The flattening changes only the written copy; the document stays as it was.
- MagicaVoxel's world is limited: ±1024 per axis is the documented value, users report [−1000, 999] in practice. A larger scene may not open fully there.

### Damaged files
A file that cannot be read completely opens with whatever survived (`io/vox-salvage.ts`) — as a new unsaved document “name (recovered)”; the file itself is not touched until it is overwritten.

- Chunks are found by MagicaVoxel's tags (`SIZE`, `XYZI`, `nTRN`, `RGBA`…): garbage between them is skipped, so is a broken header; reading starts at the first tag.
- A truncated `XYZI`, or one lying about its length, gives as many whole voxels as there are before the end of the file or the next chunk; a `SIZE` outside 1…256 is dropped — the size is taken from the voxels.
- If the scene graph loses models (broken nodes, no root), all models are placed at the origin — so not a single voxel is lost; of the two readings, the one with more voxels wins (animation frames count).
- The user is told how many models and voxels were saved and what was wrong.

### Testing
- A corpus in `tests/fixtures/vox/`: generated files that cover every chunk type, plus real MagicaVoxel files when they are added.
- An automatic test for every file: read → write → read → compare the models.
- Synthetic tests: every chunk type, a file without `RGBA`, odd sizes, all 48 rotations, empty models, several frames, unknown chunks.
- Tests for bugs other parsers shipped: only one model read from a multi-model scene; a flattened hierarchy with group names and transforms lost; a wrong rotation; 256³ not loading; `IMAP` backwards.
- A manual checklist before a release: exported files open in MagicaVoxel and look the same. The files and what to look for — [tests/manual/vox](../tests/manual/vox/README.md); regenerate them with `pnpm samples:vox`.

## Mesh export
“Menu → Export mesh…” (Ctrl+E), `app/export.ts`.

- **Mesh** (`core/export-mesh.ts`): only visible faces (the neighbour is empty), greedily merged into same-colour rectangles inside each 32³ chunk; no AO — it would get in the way of merging, and lighting is the importer's job. Linked copies are meshed once.
- **Placement:** objects as they stand in the world (rotation and translation applied to the vertices), then the origin — the middle of the bottom, the center of the box or the scene origin; the voxel size in file units; the up axis Y or Z (a quarter turn around X, `(x, y, z) → (x, −z, y)`). glTF is always Y up — the specification says so.
- **Files:** one for everything or one per object; the name follows the `{doc}`, `{object}`, `{n}` pattern (if the pattern has no object or number, a number is appended); several files download as one uncompressed ZIP (`formats/zip.ts`).
- **glTF / GLB** (`formats/mesh-formats.ts`): a node and a mesh per object, a primitive per material. Materials come from MagicaVoxel through `pbrOf`: metalness, roughness, glass — `KHR_materials_transmission` and `KHR_materials_ior`, glow — `emissiveFactor` and `KHR_materials_emissive_strength`; identical materials are shared. Colour is `COLOR_0` in linear space or a 256×1 palette texture without filtering (then glow takes its colour from it too). `.gltf` keeps its data inside as base64.
- **OBJ:** with a texture — `.obj` + `.mtl` + a 256×1 PNG palette (as in MagicaVoxel; the PNG is written without a canvas, `formats/png.ts`), `vt` at the center of the colour's cell; with vertex colours — the `v x y z r g b` extension that Blender and MeshLab read. Shared vertices and normals are written once, faces are quads.
- **PLY:** binary, four coloured vertices per face. **STL:** binary, two triangles per face, no colour.

## Voxelization
“Menu → Voxelize mesh…”, or a model dropped onto the window (together with its files).

- **Reading** (`formats/mesh-import.ts`): glTF 2.0 — `.glb`, or `.gltf` with its `.bin` and pictures among the chosen files or inside (base64); a node hierarchy with matrices or TRS, triangles, strips and fans, normalized data, materials (`baseColorFactor`, the colour texture, alpha cut-out for MASK and BLEND), vertex colours. Draco, meshopt and sparse data cannot be read yet — the editor says so plainly. OBJ — polygons as fans, negative indices, vertex colours `v x y z r g b`, MTL (`Kd`, `map_Kd`). STL — binary and text.
- **Up axis:** Z for STL, Y for the rest; it can be set by hand. Z-up is turned into Y-up: `(x, y, z) → (x, z, −y)`.
- **Voxelization** (`core/voxelize.ts`): the model is fitted so its long side is N voxels. A cell is a voxel if a triangle crosses it (an exact triangle–box test on separating axes). A face lying exactly on a cell border (as on any voxel model at its own scale) goes to the cell behind it, and touching a cell only with an edge does not count — so our own export comes back voxel for voxel (a test checks this on the demo island). A cell's colour is taken at the point of the nearest triangle closest to the cell's center: material colour × vertex colour × texture (nearest pixel, repeating).
- **Solid model:** cells that cannot be reached from outside through faces (a flood from the grid borders) are filled with the colour of the surface above them. Up to 64 million cells.
- **Palette:** a new document gets its own, built from the model's colours by median cut (up to 255); the current scene uses the nearest colours of the document palette.
- Runs on the main thread; the demo island (5 thousand triangles, 49³) takes about 0.25 s.

## Pictures and slices
“Menu → Picture to voxels…” and “Export PNG slices…” (`core/image-voxels.ts`, `app/pictures.ts`). Pixel colours go to the nearest palette colours; a pixel with alpha below half is empty.

- **Plane:** a voxel per pixel, standing (XY, the top row higher) or lying (XZ, like a map from above). A picture larger than the limit (256 by default) is scaled down with smoothing; at its own size pixel art stays crisp.
- **Height map:** a solid column per pixel, the height is the brightness (at least 1, white is the chosen height), the colour is the pixel's or the current one.
- **Slices out:** layers along Y from bottom to top, in each x goes right and z goes down, empty is transparent. One sheet — a grid close to a square (256 layers of 256 px is 4096 px on a side, within canvas limits), or a PNG per layer in a ZIP. The name holds `width x depth x layers`.
- **Slice sheet in:** cells of the given size left to right and down, cell k is layer y = k. The cell size comes from the file name if our export made it, otherwise it is guessed: square slices in a row or in a column.
- The new object goes where the camera looks, onto the floor, onto the current layer, as one undo step.

## Programs
An object built by a program keeps it in its `nTRN` node under the `_vx_program` key (`io/vox-program.ts`): JSON with the code, the parameter values, the node graph and the world cell where the program starts. The file shifts the object's cells (MagicaVoxel centers models); after reading, this cell gives the shift, and the rebuild lands where the voxels were. An object that stops being a program loses the key. MagicaVoxel shows the voxels and keeps the unknown key.

## DamnVoxel format (`.dvox`)

A draft: the structure gets settled before it is implemented. The name and extension are decided — `.dvox`, MIME `application/x-damnvoxel`, magic `DVOX`.

Modelled on GLB: the metadata is readable JSON, the data is compressed binary chunks.

```
header     magic (4 bytes) · format version (u32)
sections   type (4 characters) · flags (u32) · length (u32) · data
```

All numbers are little-endian.

| Section | What |
|---|---|
| `MANI` | JSON: version, voxel index width, scene tree, layers, cameras, render settings, procedural object parameters, editor settings |
| `PALT` | the document palette: colours, materials, names, display order (binary — 65 thousand entries are too fat in JSON) |
| `CIDX` | the chunk index: for every object, the chunk coordinates, data offset and length |
| `CHNK` | chunk data, **each chunk compressed separately** (deflate-raw): storage kind, local palette, indices |
| `THMB` | a PNG preview for file managers |
| unknown | kept as is and written back |

- Compressing chunks separately lets a large scene load in parts (the visible part first) and lets a save rewrite only the changed chunks.
- Older versions are read through a chain of migrations up to the current model.
- A voxel index is 16 bits by default; the width is recorded in `MANI`, so widening it does not break old files.
