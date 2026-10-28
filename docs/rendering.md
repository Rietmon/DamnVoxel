# Rendering

Two modes: the **viewport** (mesh rasterization, always on, on any phone) and **path tracing** (progressive ray tracing, on request). The document is the source of truth; everything on the GPU can be rebuilt from it at any time.

## Viewport

### Meshing
- A mesh is built for every 32³ chunk of every object.
- Inner faces are culled: a face is drawn only if its neighbour is empty. The mesher's input is a 34³ block: the chunk itself plus a one-voxel shell from **all 26 neighbours** (faces, edges, corners). The six face neighbours are not enough: the AO of a vertex on a chunk edge depends on the voxel diagonally across that edge. `buildPadded` in `core/padded.ts` collects the shell.
- AO is computed per vertex from the three neighbours at the corner (the classic scheme: two sides and the corner).
- Greedy meshing merges neighbouring faces into rectangles when they have the same colour and **the same AO value in all four corners** of every face. A face with different corners stays alone: otherwise interpolation over a large quad would smear the shading.
- A quad is split along the diagonal whose ends differ less in AO, to avoid anisotropic artefacts. The flip is a cyclic shift of the vertices, so every quad shares one index pattern: (0, 1, 2), (0, 2, 3).

### Vertex — 8 bytes

| Word | Bits | What |
|---|---|---|
| 0 | 0–5, 6–11, 12–17 | x, y, z inside the chunk (0…32) |
| 0 | 18–20 | normal (one of six) |
| 0 | 21–22 | AO (0…3) |
| 0 | 23–24 | quad corner (u, v) — for the wireframe |
| 0 | 25 | quad split along the other diagonal |
| 0 | 26–31 | reserved (flags) |
| 1 | 0–15 | palette entry index |
| 1 | 16–31 | reserved |

Read through `vertexAttribIPointer` as `uvec2` and unpacked in the shader. Indices are `Uint32`: in the worst case (a checkerboard) a chunk has about 98 thousand faces.

### Palette on the GPU
- Colours are a 256×256 RGBA8 texture, entry index → `(id & 255, id >> 8)`.
- Material parameters for the viewport (glow, metal, roughness) are a second texture of the same kind.
- A palette change updates the texture, without re-meshing.

### Viewport shader
- Light: sky and ground (hemispherical) + one directional light + AO from the vertex.
- An optional grid on voxel faces, from the fractional part of the position in the fragment shader.

### Drawing
- One draw call per chunk; frustum culling against chunk bounds.
- A VAO and buffers per chunk, buffers reused from a pool.
- A 256³ model is at most 512 chunks, fewer in practice.

### Overlays

| Shader | What it draws |
|---|---|
| grid and floor | the construction plane, axes |
| selection | the outline and highlight of selected voxels |
| preview | the translucent ghost of the coming edit, mirror copies included |
| mirror planes | symmetry planes with a soft edge |
| gizmo | move arrows, rotation arcs |

The floating selection is an ordinary chunk mesh with its own matrix.

### Resolution and frames
- Frames are drawn only on request, see [architecture.md](architecture.md#frames).
- `devicePixelRatio` is capped at two.
- If a frame does not fit the budget while the camera turns, resolution drops for a while and comes back after the camera stops. The frame budget is the display refresh interval, which the editor measures itself from the shortest interval between frames (60, 90, 120 Hz). Resolution drops in steps after a series of late frames (a single hitch does not count), never below half; during a long smooth motion it climbs back; after the camera stops, a sharp frame is drawn at once. The thresholds are in `app/resolution.ts`.
- The statistics overlay (`?stats`) shows the frame counter, fps, CPU time per frame, draw calls and mesh memory.

### Lost context
On phones the WebGL context can disappear (background, low memory). We handle `webglcontextlost` / `webglcontextrestored`: all resources are rebuilt from the document. No data is lost.

## View modes and helpers
- **Shading:** “lit” — sky, ground, sun and AO; “flat” — palette colours as they are, without light, for working with colour; “clay” — every voxel in one warm light grey with light and AO, only the shape shows. The sun's direction (turn and height) and strength are in the view settings.
- **Dim the others:** in Model mode the objects other than the edited one are drawn grey and dark — the context stays, the attention is on one.
- **Slice along an axis:** everything on one side of a chosen layer along the world X, Y or Z axis is hidden (above it by default; the side can be flipped). The slice happens **in meshing**, not by discarding pixels: hidden cells count as empty at the mesher's input, so faces along the slice line get built and the model looks solid, without holes. An object's orientation maps the world axis to one local axis, so in object space the slice is the half-space `sign · cell[axis] > limit` (`core/slice.ts`). An object is re-meshed only when its slice changed (the slice or the object moved). Voxel picking clips the volume bounds with the same half-space, and `sliceModifier` drops the operation's cells beyond the slice — the brush never touches what is invisible.
- **Chunk borders 32³** of the edited object — thin lines; they show how the model lies on the memory and meshing chunks.

### Outline
The silhouette outline (`render/outline.ts`): the models are drawn into an offscreen target (colour + depth) and then copied to the screen with a line wherever the depth breaks — along the silhouette and at steps. The test is the second difference of window depth across neighbours, converted to world units: it is zero on any plane in both perspective and orthographic, so flat faces stay clean. The copy writes depth too, so ghosts, the grid and lines drawn after it still hide behind the model. The line colour is the edge colour from “Appearance”. Without the outline there is no extra pass.

## Picking a voxel
- The ray from the cursor runs on the CPU over the voxel grid with the DDA algorithm (Amanatides–Woo) in the object's local coordinates.
- Object bounds are tested first, then chunk steps inside: empty chunks are skipped whole, inside a non-empty one the ray steps voxel by voxel.
- The result: the object, the voxel, the face hit (normal), the distance.
- If nothing is hit — the intersection with the construction plane.
- It takes a fraction of a millisecond; no meshes and no GPU readback needed.

## Camera
- Orbit around the model point under the pointer (if the pointer is on the model, it does not drift off screen), pan that keeps the grabbed point under the pointer, zoom towards the point under the cursor, inertia after a quick flick.
- Rotation center: a right or middle click on a voxel without dragging (in the touch “camera only” mode — a double tap) smoothly turns the camera towards that point without moving the eye.
- Perspective and orthographic, preset views (front, side, top, isometric).
- Mouse: MagicaVoxel, Blockbench and Blender layouts to choose from, all keys remappable.
- Default mouse (MagicaVoxel): left — tool, right — orbit, middle — pan, wheel — zoom to the cursor. Without a middle button: Space + left — pan, Z + left — zoom to where the drag started. The cursor shows in advance what a drag will do; Space does not scroll the page or press the focused button.
- Touchpad: two fingers — orbit, with Shift — pan, pinch — zoom to the cursor. Mouse and touchpad are told apart by their wheel events (line mode, deltas on two axes, fractional deltas, `wheelDeltaY`); touchpad momentum scrolling does not turn into zoom. A setting can force the device.
- Touch: one finger — tool; two fingers — orbit (moving the fingers) and zoom (pinch); three fingers — pan. A second finger cancels the tool action the first one started. A quick two-finger tap undoes, three fingers redo, with a short notice of what was undone. The “camera only” button (on touch devices, by the view cube): one finger orbits, two pan and zoom, a double tap sets the rotation center.

## Path tracing
Progressive path tracing in the spirit of MagicaVoxel's Render tab (`render/pathtracer.ts`, the Render mode in the mode switch).

- The visible voxels of the scene are baked into one `R16UI` 3D texture of world cells with an empty layer around it (`app/render-scene.ts`); the limit is 64 million cells (128 MB). It is rebuilt when the document, the palette or the animation frame changes.
- The fragment shader walks the ray over the grid with DDA: diffuse with direct sunlight (a shadow ray, softness from the sun's angular size) and a cosine bounce, metal (a mirror blurred by roughness), glass (Fresnel, refraction in and out, tint), glow; the sky is a zenith–horizon gradient with a sun disc; the ground is a plane under the lowest voxel. Russian roulette after two bounces; sample brightness is clamped against fireflies.
- Samples add up in `RGBA16F` with additive blending (`EXT_color_buffer_float`); the display is the average, exposure, ACES, gamma. The number of passes per frame grows while frames are fast and drops when they are slow: the interface never freezes. Moving the camera or changing the light starts the picture over; exposure, bloom and denoising affect the display only.
- Environment: instead of the sky gradient, an `.hdr` panorama (RGBE, `formats/hdr.ts`; equirectangular, `RGB16F` with linear filtering), its brightness is “sky brightness”. Fog is exponential absorption along the ray, lit with the fog colour.
- Film: depth of field is a thin lens (radius and focus distance; a click on the model in the render sets the focus there), bloom blurs spots brighter than one with a Gaussian at half resolution on two axes and adds them, the tone curve is ACES or a plain clip, denoising is a 5×5 filter with step 2, weighted by brightness difference and distance, weakening with the sample count.
- In Render mode the tools rest and the camera turns; editing happens in Model mode.
- Every picture has its own accumulation (`Accumulation`): the Render view, the render window and a frame being saved share one scene. A scene change (grid, materials, panorama) bumps its version — every picture starts over at its next draw.

### Render window
The render does not get in the way of editing: “View → Render window over editing” shows the traced picture in a window over the viewport. The window is a transparent frame in the interface; the picture is drawn into the canvas under it after the regular frame (`renderPathTraced` with a rectangle). The scene grid catches up with the document at most every 300 ms, with up to six passes per frame (editing comes first). The window follows the view's camera or keeps its own pinned view; its shape is that of the saved frame. The title bar drags the window; the buttons pin the view, resize, fill the view and close.

### Transparent background
“Transparent background: the model only”: the sky and the ground give alpha 0, and light in uncovered samples does not accumulate (colour is stored premultiplied by coverage). On screen, transparency is a checkerboard of the background colour; in PNG it is straight alpha. The ground still lights the model with its bounce.

### Large frames
“Save PNG” in the render settings (size: as the view, 1080p, 4K, square or custom, up to 8192 on a side) traces the frame in 512² tiles with 32 px margins (`render/frame-job.ts`): every tile gets all its samples, the margins are there for denoising and bloom, and the middle is read with `readPixels` into the final picture. One tile at a time on the GPU, passes adapt to the frame rate, editing goes on, the view and the render window wait. The scene is the one at the start; later edits go into the next frame. The finished PNG downloads by itself (browsers do not allow a file picker after a long computation).

### Frame series
“Render → Save ▾ → Frame series” (`app/render-sequence.ts`): a queue of shots, each the same tiled job as a large frame; the progress shows in the render bar or a badge over the view, and it can be cancelled at any time.

- **Turntable:** the camera goes around the target in N frames (48 at 24 fps by default). “The light turns with the camera” turns the sun by the same angle — like a model on a stand under studio lights; without it the light stays in the world.
- **Animation:** the timeline frames from start to end at its frame rate, from the view's camera; the previous frame is shown again afterwards.
- **Formats:** GIF (`formats/gif.ts`): one palette for all frames by median cut over a 5:5:5 histogram, ordered 4×4 Bayer dithering (it stays put from frame to frame, so still parts do not flicker), a transparent colour for pixels with alpha < 128 and clearing between frames, LZW with 9–12-bit codes and table resets, a NETSCAPE2.0 loop. Video is recorded by the browser itself (`MediaRecorder` on the canvas stream, MP4 where supported, otherwise WebM) in real time; video frames are opaque.
- **Sprites:** an orthographic camera from 4 or 8 sides (the first is front-right, 45°), a 30° tilt — the 2:1 lines of pixel art — or the 35.26° of true isometry. One scale for all: the tightest square that fits the model box from every side (box corners on the screen axes), +4 %. The light turns with the side, the background is transparent, “pixelated” sends the ray through the pixel center without jitter (crisp edges). PNG sheet: sides go across, animation frames go in rows if enabled.
- A series has its own samples per frame (64 by default): a series needs fewer than a single frame.
