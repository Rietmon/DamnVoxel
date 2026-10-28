# Programmable shapes

A shape can be described by an algorithm: with **code** (JavaScript with a small API) or **nodes** (a graph that compiles into the same code). The result is a procedural object: the program's parameters show as sliders, the object rebuilds when they change, and editing the program is one undo step.

## Engine (`kernels/program.ts`)
A pure function `runProgram({ source, params, palette, maxVoxels })` → voxels (coordinates and palette indices), the declared parameters, a log, an error with a line number, the time taken. No DOM and no `core`: a worker calls it, and tests call it directly.

- The code runs through `new Function` in strict mode; the program sees only the API names (and plain `Math`). The error line comes from the stack: the engine measures the offset of the function body itself with a probe error, so the number is right in every browser. Syntax errors have no line — the engine does not report one.
- Voxels are a sparse map keyed by integer coordinates (±65 536 per axis); the limit is 8 million voxels (`DEFAULT_MAX_VOXELS`). What was built before an error stays in the result.
- A colour is a palette index 1…255; `color('#rrggbb')` and `color(r, g, b)` look up the nearest colour of the document palette (weighted the way the eye sees), with a cache.

## API
| Name | What |
|---|---|
| `param(name, value, min, max, step)` | a parameter: a slider in the panel, the program gets its value |
| `color('#rrggbb')`, `color(r, g, b)`, `palette(n)` | a colour index |
| `set(x, y, z, c)`, `get(x, y, z)`, `erase(x, y, z)` | a single voxel |
| `box(x0, y0, z0, x1, y1, z1, c)` | a box, corners inclusive |
| `sphere(cx, cy, cz, r, c)`, `ellipsoid(cx, cy, cz, rx, ry, rz, c)` | a ball, an ellipsoid |
| `cylinder(x, y, z, r, h, c)`, `cone(x, y, z, r, h, c)` | stand on the point, height h |
| `torus(cx, cy, cz, R, r, c)` | a torus lying in the XZ plane |
| `line(x0, y0, z0, x1, y1, z1, c, radius)` | a line; with a radius — a capsule |
| `fill(x0, y0, z0, x1, y1, z1, (x, y, z) => c)` | every cell of the box gets what the function returns (0 — leave alone) |
| `shape((x, y, z) => d, c, x0, y0, z0, x1, y1, z1)` | the cells where the distance is ≤ 0 (at the cell center); `c` is an index or a function |
| `sd.sphere / box / cylinder / torus / capsule` | signed distances (negative inside) |
| `sd.union / subtract / intersect / smoothUnion / smoothSubtract` | their combinations; the smooth ones take a seam width k |
| `noise(x, y, z)`, `fbm(x, y, z, octaves)` | Perlin noise ≈ −1…1 and its sum of octaves |
| `rand()`, `seed(n)` | a random 0…1 and the seed (shared with the noise) |
| `lerp`, `clamp`, `smoothstep`, `ramp(t, [colors])` | helpers |
| `log(...)` | a line in the log under the code |

## Where it runs (`workers/program-client.ts`)
A program runs in its own worker, one at a time: a new run (and with live preview there is one on every edit) ends the worker with the previous one, because it may never return. A program that runs past the limit (5 s) is stopped the same way; the worker is created again on the next run. Without workers (tests) it runs in place.

## Code editor
`ui/ProgramPanel.svelte`:

- **Open:** “☰ → New program”, the “Program” button in the Scene mode bar (for a program object — its code, otherwise a new one), the “Edit the object's program” command. A new program starts from a template (`app/program-templates.ts`: tower, tree, noise hills, spiral, Menger sponge, smooth blob, empty): the program runs, and the object lands in the center of the view on the floor — in one step.
- **Code:** a transparent text area over highlighted text (`app/program-highlight.ts`: comments, strings, numbers, keywords, API names), line numbers, the line with the error in red. Tab is two spaces, Enter keeps the indent (and adds one after `{`), Ctrl+Enter builds at once; otherwise the build runs 0.4 s after a pause and when focus leaves the field.
- **Parameters:** every `param()` is a draggable field; a change rebuilds the object.
- **Rebuild** (`ProgramCommand`): the object's voxels and program change in one step that keeps merging while the edit continues. A program with an error keeps the previous voxels — the model does not vanish while a line is being typed. Undo brings the code back too: the window shows the object's program if something else changed it.
- At the bottom: how many voxels and how long it took, or the error with its line; under it, the `log()` output.

## Nodes
`core/node-graph.ts`: a node graph compiles into a program for the same engine — so nodes run, stop and report errors the same way, and “Show code” hands that program over to edit by hand (from then on it lives as code).

- **A solid** in the compiled program is a function `(x, y, z) → distance` that also puts its colour into `C`, plus a box `b = [x0, y0, z0, x1, y1, z1]` it lies in. No objects are created per cell. “Result” fills its box (with a one-cell margin) through `shape`.
- **Shapes:** ball, box (with rounding), cylinder, torus, cone, stick (a capsule), terrain (a sum of noise octaves over the floor).
- **Combine:** union, subtract, intersect — the colour comes from the nearest solid; blend and carve — smooth, with a seam width.
- **Transform:** move, rotate around an axis, scale, mirror, repeat along an axis, twist, bumps (noise added to the distance). The solid is evaluated at the point mapped back; the box is recomputed with a margin.
- **Color:** recolor, color by height (three colours), noise spots.
- **Numbers:** “Parameter” is the program's `param()`: a slider in the window and a wire into any number field; “Compute” is `+ − × ÷ min max`. A number on a wire replaces the field's value.
- Every noise node has its own seed — an offset in the noise, not a shared `seed()`, otherwise only the last one would work.
- Compilation walks the graph from “Result”; no result, an empty input or a loop are errors in words, not exceptions. `canLink` refuses incompatible links (a solid into a number) and loops; an input takes one wire — a new one replaces the old.

## Node editor
`ui/NodeEditor.svelte`:

- For a program made of nodes the window is a strip at the bottom of the view (nodes want width, the model stays visible), with “Nodes” and “Code” tabs: the compiled program is read-only, “Edit as code” unlinks it from the nodes.
- A node card: the title (drag to move, × to delete), rows of solid inputs and fields of one height — so input points are placed by calculation, without measuring the DOM. A number field has a point on its left: a wire from “Parameter” or “Compute” replaces the value (“← wire”).
- A wire is dragged from the output point (right of the title) to an input point; dragging a connected input takes the wire off and moves it. Incompatible links and loops do not connect (`canLink`).
- Dragging the background pans the canvas, the wheel zooms to the cursor, the right button or “+ Node” opens the node menu by groups, “Fit” shows them all. On opening, the graph is fitted, but not below 0.6: a wide graph starts at the left and scrolls.
- Wires, values, new and deleted nodes compile the graph (`compileGraph`) and rebuild the object in one merging step. Moving cards, and a graph that does not compile yet (a wire taken off to move it), are saved without a rebuild and without an undo step; compile errors show at the bottom in words.
- Templates (`app/node-templates.ts`): ball, snowman (blended balls and a turned cone), crystals (repeat, tilt, twist, color by height), island (terrain and a tree), tower with parameters (wires from “Parameter” into the height and radius).
