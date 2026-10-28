# Interface design

How the interface is laid out and why.

## Principles
1. **The canvas comes first.** The model takes almost the whole screen. The only fixed panels are a narrow tool column on the left, a dock with collapsible sections on the right and a thin settings bar above the canvas. Only the view cube floats over the canvas itself.
2. **Everything about the tool is in one place.** The context bar above the canvas: the tool's name in words, what it does, size, shape, modes, mirror. The place is constant, only the content changes. The bar is docked, not floating: a floating one covered the view cube and the model.
3. **Fewer buttons at a time.** Six tool families instead of fifteen buttons; the variants of a family are in a pop-up list. Rare things go into the View menu, the command palette and keys.
4. **Words where it matters.** Add / Erase / Paint are words. Icons have a tooltip “name · key”. On phones, sheets have labels under the buttons.
5. **The mode shows twice.** In Scene mode the view frame is tinted and the context bar starts with the word “Scene”.
6. **Quiet style.** Neutral greys (dark theme by default, light and “as in the system” under View → Appearance), one orange accent for what is active, grouping by background and spacing instead of borders, a 4/8 spacing scale, 28 px controls (mouse) and 44 px (finger).

## Desktop (wider than 700 px)
```
┌─────────────────────────────────────────────────────────────────────────┐
│ ☰  House ●        ↶ ↷      [ Model │ Scene │ Render ]   View ▾  ⌘ Commands │  top bar 44
├────┬───────────────────────────────────────────────────────────┬────────┤
│ ✎  │ Brush │ Add|Erase|Paint │ ●── 3 Cube|Ball Volume ▾ ⟂ X Y Z │ Palette│
│ ⬆  ├───────────────────────────────────────────────────────────┤ ▦▦▦▦▦▦ │
│ ◇▸ │                                                         ◰ │ ▦▦▦▦▦▦ │
│ ⌖▸ │                                                           │ ■ #e85 │
│ ⬚▸ │                                                           ├────────┤
│ ✥  │                     canvas                                │ Scene  │
│    │                                                           │ ▸ House│
│ ■  │                                                           │   Tree │
├────┴───────────────────────────────────────────────────────────┴────────┤
│ Erase · Shift — add          Shift erase  Alt color      3 0 −2  brush 3 │
└─────────────────────────────────────────────────────────────────────────┘
```
- **Top bar:** the menu (☰: new, open, save, save as, examples, versions, keys and mouse, help, hide interface), document tabs, undo and redo, the mode switch in the middle, the Animation button, the View menu, the command palette.
- **Tabs:** the document name, a dot — there are unsaved changes, × — close (asks if unsaved), “+” — a new document; drag to reorder, middle-click to close. An opened file becomes a new tab, and an untouched empty document gives up its place to it. Every tab remembers its camera, mode and active object; autosave keeps all unsaved tabs and restores them together. Alt+PageUp / Alt+PageDown — the neighbouring tab, Ctrl+Alt+W — close.
- **Tool column** (left, 52 px): Brush ▸ (brush, stamp, sculpt), Face, Shapes ▸ (box, line, curve, rope, rectangle, ellipse, sphere, cylinder, cone, pyramid, torus, stairs, arch, smooth SDF shapes), Color ▸ (eyedropper, replace, fill), Select ▸, Move; at the bottom, the current colour (opens the colour editor). A button with ▸ is a family: a click takes the last variant, a second click, a long press or the right button opens the list of variants with labels and keys.
- **Context bar** (40 px, the full width of the canvas, above it): in Model mode — the tool name, the action, brush size and shape, brush mode, stroke lock, selection mode, mirror; for selection — All / None / Invert / Grow / Shrink; for moving — turns and flips. In Scene mode — “Scene · N objects” and the object actions. In a narrow window the bar scrolls sideways.
- **Dock on the right** (288 px, the width can be dragged at the edge, a double click on the edge resets it): Palette, Scene, Layers, References and Library sections, each collapsible.
- **Library:** “Save selection” puts the selection (or the whole object) with its colours and an isometric thumbnail into browser storage — it is available in any document and after a restart. A click on the thumbnail inserts it as an object in the center of the view on the ground (colours are matched to the document palette), “Stamp” takes it as a stamp, the name is editable, × deletes.
- **Layers:** the dot — the layer for new objects, the name is editable in place, the number — how many objects are on it, ⤓ — put the selected objects on the layer, the eye — hide, the lock — lock (objects cannot be edited), × — delete (the objects move to another layer), “+ Layer”. Everything can be undone.
- **References:** a picture is added with a button, from the menu or by dragging it into the window. Each is either “in scene” (a plane at the front, side or top; center and width by numbers, height by proportion) or “background” (behind the model, fitted to the view); opacity, hide, lock (the settings stop changing), remove. A new one appears as a plane behind the model, as wide as it, translucent. References live in the document's tab and are not written to `.vox`. The colour editor is a pop-up from the current colour (in the dock and in the tool column).
- **Status bar:** what the tool will do, modifiers (lit while held), the cell under the cursor, brush size, selection size.
- **Hide interface:** Shift+\\ (and four fingers on touch): the canvas, the view cube and a small “show” button remain.

## Phone (up to 700 px)
```
┌───────────────────────────────┐
│ ☰ House ●  [Model|Scene]  ↶ ↷ │
│                           ◰   │
│            canvas             │
│                               │
│ Add|Erase|Paint ●─ 3          │  context bar, scrolls sideways
│  ✎  ⬆  ◇  ⌖  ⬚  ✥   ■  ☷     │  tools + colour + panels, 48 px
└───────────────────────────────┘
```
- The tools and their settings are at the bottom, in thumb reach; the tool name is not repeated in the bar — the row shows it. A family opens the list of labelled variants above the row.
- “■” is the palette as a sheet, “☷” the scene and view as a sheet; a sheet has Palette / Scene / View tabs. Sheets take up to 60% of the height and close with a cross or a second press.
- There is no status bar: modifiers cannot be pressed on a phone, and key hints are of no use.
- Dangerous and rare things (the file menu) are at the top.

## Animation
The Animation button in the top bar (Alt+A) opens the timeline under the view: ◀ ▶ ▶▏ (Alt+, / Alt+/ / Alt+.), the frame number, a track with key diamonds (orange for the edited object), the start–end range, frames per second, loop, “+ Model” (a model frame — a copy of what is visible; edits go into it), “+ Position” (a position key; a moved object updates its key on this frame), × — remove the frame's keys, “Smooth” — the position glides between keys (moving by whole voxels, turning on the key), “Bake” — write the glide as a key on every frame, the way MagicaVoxel will show it; “Onion” (Alt+O) — the neighbouring key frames of the edited object shown faded: earlier in blue, later in orange. Dragging along the track scrubs frames.

## Paint
The “Paint ▾” button in the context bar of drawing tools and the fill (a dot — something is on). Inside: **pattern** — solid, a gradient along X/Y/Z between the model's edges, random, Perlin noise, Worley cells, Voronoi, splatter (mostly the current colour, sometimes a step lighter or darker); the pattern's colours are the ramp selected in the palette or the neighbours of the current colour; **tone while painting** — lighter, darker, warmer, cooler: every voxel takes its own colour one step that way, by palette (the neighbouring colour of the ramp) or by HSL (the nearest fitting palette colour); **colour lock** — paint and erase only voxels of the colours selected in the palette (or the current one), Alt+L. These are modifiers: they work in every tool and in the mirror; tone and lock read the model before the gesture, so a second pass of the brush does not lighten a voxel twice.

## Adjust last operation
After a shape, a line or a face operation, a card “Adjust: Box” appears in the bottom left corner of the view with the step's numbers: the corner and size of the shape's box (two ends for a line), the number of face layers (minus — push), the colour index and a “Current color” button. Changing a number replaces the step with a new one — the history keeps one step. The card lives while that step is the last: undo or another edit removes it. Its title collapses it.

## Keys and mouse
A window from the ☰ menu and the command palette. At the top — the layout: MagicaVoxel (default), Blockbench, Blender; the layout changes the keys that differ and the mouse buttons for the camera (Blender: middle — orbit, Shift + middle — pan, Ctrl + middle — zoom). Below — every action by group with its keys: “+” waits for a new combination, “×” removes a key, “↺” resets to the layout. A taken combination moves to the new action and the old one loses it — a line above the list says so. Your own keys win over the layout; everything saves to a file and loads from a file (JSON).

## Radial menu
A long press with a finger or a pen (500 ms almost without moving) or the ` key opens a ring of eight items around the point: Brush, Face, Redo, Shapes, Color, Select, Undo, Move (clockwise from the top; undo and redo on the left and right). Drag to an item and release — choose it; release in the center — the menu stays and an item is chosen by a tap; Esc or a tap outside — close. A family takes its last tool. A long press cancels a stroke in progress. Under a pen, a long finger press does not work: there the finger is a pen modifier.

## View
The View menu is a popover from the top bar (on phones — in the “☷” sheet):
- **Shading:** “Lit” (light and AO), “Flat” (pure palette colours, no light — for working with colour), “Clay” (every voxel one light colour with light and AO — only the shape shows).
- **Helpers:** floor grid, axes, a dimension box, voxel edges, wireframe, silhouette outline, 32³ chunk borders, AO, dim the other objects (in Model mode).
- **Light:** direction (sun turn and height), strength.
- **Slice:** hide everything beyond a chosen layer on the X, Y or Z axis (the side can be flipped) — to look and draw inside the model. The brush does not touch what is hidden.
- **Camera:** ten document slots (a click — go, on an empty one — remember, Shift+click — overwrite, right button — clear; every slot is an action for its own key), perspective or orthographic, and by numbers — center, turn, tilt, distance and field of view.
- **Appearance:** the interface theme and your own viewport colours — background, grid (and the dimension box), voxel edges, the selection film. An empty colour follows the theme; “Colors as in the theme” resets your own.

Every item is also an action with a key and in the command palette.

## Behaviour
- Number fields: drag sideways to change (Shift — 10 times faster, Ctrl — 10 times finer), click to type, Enter to apply, Esc to cancel, ↑/↓ for a step, double-click for the default. They accept expressions: `2*8+1`, and `+5`, `*2`, `/4` change the current value. A drag is one undo step.
- Tooltips: on hover after 400 ms, at once on keyboard focus; the text is “Name · key”.
- Pop-up lists and popovers close on Esc, a click outside and a choice.
- The interface is remembered: collapsed sections, dock width, whether the interface is hidden, view settings.
