# Files

## `.vox`
Open — **Ctrl+O** or drop a file onto the window; save — **Ctrl+S**, save as — **Ctrl+Shift+S**. Everything MagicaVoxel understands is written: objects, groups, positions, layers, the palette with materials, cameras, animation frames; foreign data in the file is kept as it was. Documents open as tabs; each remembers its camera and mode.

## Autosave and versions
- While a document is unsaved, a copy of it is written to the browser; after a crash the editor offers to bring the work back.
- **☰ → Version history…** — snapshots of the document with a picture of the view: on every save, every 10 minutes of work and with the “Remember now” button. A version opens in a new tab. The last 40 per document are kept.

## Damaged files
If a `.vox` cannot be read completely, whatever survived opens as a new document “… (recovered)”, and the file itself is not touched. The editor says how many models and voxels were saved.

## Mesh export (Ctrl+E)
- **GLB / glTF** — for engines, Blender and the web, with PBR materials; **OBJ** — with MTL and a PNG palette, as in MagicaVoxel; **PLY** — color in vertices; **STL** — for 3D printing.
- Color in vertices or as a palette texture; the origin at the bottom, the center or as in the scene; the voxel size in file units; the up axis Y or Z.
- Only the selection or all visible objects; one file or a file per object, names from the `{doc}`, `{object}`, `{n}` pattern. Several files download as a ZIP archive.
- Faces of one color merge into large rectangles, there are no inner faces.

## Voxelization
**☰ → Voxelize mesh…** or just drop a model onto the window: `.glb`, `.gltf`, `.obj`, `.stl` (for `.gltf` and `.obj` — together with their `.bin`, `.mtl` and textures). Set how many voxels go along the long side, solid or a shell, and where to — a new document with its own palette from the model's colors, or into this scene. Color comes from the material, vertex colors and textures.

## Pictures and slices
**☰ → Picture to voxels…:**
- **Plane** — a voxel per pixel, standing or lying;
- **Height map** — the lighter the pixel, the taller the column;
- **Slice sheet** — the model's layers from bottom to top on a grid.

**☰ → Export PNG slices…** — the layers of an object or the whole scene as one sheet, or a PNG per layer in a ZIP; the file name holds the slice size, so the sheet can be read back.
