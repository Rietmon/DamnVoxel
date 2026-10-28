# Data model

The internal model is limited neither to 256 colours nor to 256³. The `.vox` limits apply only when writing `.vox`, see [formats.md](formats.md).

## Limits

| What | Value |
|---|---|
| Voxel value | `uint16`: 0 — empty, 1…65 535 — a palette entry |
| Chunk size | 32³ (`CHUNK_BITS = 5`) |
| Chunk coordinates | −65 536 to 65 535 on each axis |
| Voxel coordinates | ±2 097 152 on each axis |
| Document palette | up to 65 535 entries |

Why 16 bits and not 32: the index fits into the packed vertex and into the 256×256 palette texture on the GPU. A file format can record the index width, so it can grow later without breaking old files.

## Coordinates
- Integer coordinates, Y up, right-handed.
- Voxel `(x, y, z)` occupies the cube `[x, x+1) × [y, y+1) × [z, z+1)`.
- In `.vox`, Z points up. The axis conversion lives in one function in `io/` and is covered by tests on real files.

## Scene
A tree of nodes, like MagicaVoxel's scene graph:

| Node | What it holds |
|---|---|
| `Group` | children, transform, name, layer, hidden flag |
| `VoxelObject` | a sparse volume, transform, name, layer, hidden flag |
| procedural object | a voxel object that also keeps its parameters (a rope, a program) and rebuilds its volume from them |

- **Transform** — an integer translation and one of 48 orientations (quarter turns and reflections). It is exact on the voxel grid and matches a `.vox` transform one to one. Rotating by an arbitrary angle is an operation that resamples voxels, not a transform.
- **Animation frames** — a node can have transform keys and volume changes by frame, as in `.vox`.
- A procedural object becomes an ordinary one when its voxels are edited by hand: its parameters stop making sense.

### Layers
A list of layers with a name, colour, visibility and lock. A node refers to a layer; hiding or locking a layer hides or locks every node on it.

## Object volume
`Map<number, Chunk>` keyed by chunk. There are no empty chunks in the map.

The key packs the three chunk coordinates, 17 bits each, into one number (51 bits, within JS's exact integers):

```ts
const OFF = 65536, SPAN = 131072;
const chunkKey = (cx: number, cy: number, cz: number) =>
  ((cx + OFF) * SPAN + (cy + OFF)) * SPAN + (cz + OFF);
```

The voxel index inside a chunk is `x + (y << 5) + (z << 10)`; X changes fastest.

An object keeps the bounds of its filled voxels (recomputed lazily) and a version per chunk.

## Chunk
Memory depends on what a chunk holds, not on its size:

| Content | Storage | Size |
|---|---|---|
| One value (including a completely full chunk) | the value only | a few bytes |
| 2 values | a local palette + 1 bit per voxel | 4 KB |
| up to 4 | + 2 bits | 8 KB |
| up to 16 | + 4 bits | 16 KB |
| up to 256 | + 1 byte | 32 KB |
| more than 256 | a direct `Uint16Array` | 64 KB |

- The local palette is a `Uint16Array` of document palette indices. Index 0 of the local palette is always empty.
- A chunk moves to wider indices when a new colour arrives and the local palette is full. Before widening, the chunk is re-encoded: entries no voxel uses any more are dropped, and the chunk widens only if there is still not enough room. Shrinking back to uniform is `compact()`, done lazily, when idle or on save.
- A chunk stores its count of non-empty voxels: a chunk at zero is removed from the map.

### Fast path for kernels
Kernels (`kernels/`) never work on a packed chunk. They get a **dense** `Uint16Array(32768)` — 64 KB, a reused buffer:

```ts
chunk.decodeInto(dense);     // packed → dense
kernel(dense, ...);          // meshing, fills, booleans
Chunk.fromDense(dense);      // dense → packed, the narrowest storage (if the kernel wrote)
```

Storage stays compact; hot loops run over a flat array without bit twiddling.

## Document palette
A palette entry:

| Field | Type |
|---|---|
| colour | RGBA8 packed into one number: `r | g << 8 | b << 16 | a << 24` (in memory the bytes are R, G, B, A — as in a texture and as `0xAABBGGRR` in `.vox`) |
| material | a dictionary as in `MATL`: `_type` (`_diffuse`, `_metal`, `_glass`, `_emit`, `_blend`, `_media`) and parameters |
| name | a string, empty — unnamed |

- Entries are immutable: a command replaces a whole entry, so undo just puts the old entry back.
- The entry index (what a voxel holds) and the **display order** in the panel are different things. The order is stored separately, like `IMAP` in `.vox`. Reordering colours in the panel never touches voxels.
- Material parameters are kept as a dictionary: the editor understands the known keys and keeps and writes back the unknown ones.
- A new document gets the MagicaVoxel default palette: entries 1…255.
- **Duplicating colours** puts the copies into entries no voxel uses and places them right after the originals in the panel: the model's colours do not change. No free entries — no duplication.
- **Every palette edit** is a history step: order, colour, gradient, duplication. A colour edit touches only the current entry, and if it is one of several selected entries, it shifts all of them by the same HSV step (hue turns, saturation and value move). The whole palette changes only when all of it is selected.
- A **gradient** recolours the entries between the first and the last selected one (in display order), mixing in OKLab: it looks smoother than mixing in RGB.
- While the palette has at most 255 entries, the entry index is the `.vox` index, so no separate mapping is stored: an unedited export puts every colour back in its old place.

## Selection
- Every object has its own selection: sparse bitmask chunks, `Uint32Array(1024)` per 32³ chunk (4 KB). No empty chunks.
- Operations on the selection (union, subtraction, intersection, grow, shrink) are kernels over bitmasks.
- The floating selection is a separate sparse volume with a transform, see [architecture.md](architecture.md#floating-selection).

## History
A per-chunk diff, see [architecture.md](architecture.md#commands-and-history). The history memory limit is a setting, 256 MB by default.
