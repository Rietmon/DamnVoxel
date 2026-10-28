# Drawing and shaping

## Action
Every drawing tool has three actions: **Add (A)**, **Erase (E)**, **Paint (P)**. Shift erases for a moment, Alt picks a color with the eyedropper.

## Brush (V)
- Size — the **[ ]** keys, the digits **1…9** or the slider in the bar; shape — cube or ball (**Q**).
- Mode (**Shift+Q**): *volume* — a ball of voxels in space; *plane* — draws on the plane where the stroke started; *surface* — lies on the model.
- A stroke can be locked to an axis or a line.
- Pen: pressure changes the size (turned on in the brush bar).

## Face (X)
Drag a face — the model extrudes or pushes in by as many layers as you dragged. **Shift+X** — the face stops at another color.

## Shapes
Box (**B**), line (**L**), rectangle (**R**), ellipse (**O**), sphere (**S**), cylinder (**C**), cone, pyramid, torus, stairs, arch. Drag over the floor or the model; **Ctrl** — set the height with the same gesture. The shape is applied when you release, and “Adjust last operation” changes its size afterwards.

## Smooth shapes — SDF (Shift+S)
Spheres, capsules and boxes that melt into each other softly, like clay; the softness of the blend is a number.

## Curve (J) and rope (Shift+J)
A Bézier curve becomes a voxel line of the thickness you want. A rope, chain or cable sags between two points by physics and stays an object with settings: kind, sag, thickness, colors.

## Stamp (Shift+V)
**Alt+B** makes a stamp from the selection (or the whole object); then it is placed with clicks, turned and flipped. A stamp can also come from the library.

## Sculpt (G)
Grow, erode, smooth, bumps, flatten — for organic things: stones, ground, trees.

## Fill (Shift+F)
Fill an area of one color, a cavity inside the model, or remove the voxels that cannot be seen from outside.

## Mirror
**X, Y, Z** in the tool bar turn on the live mirror on those axes — everything you draw is repeated. The plane goes through the model center (**Alt+M**), the selection center or a place of your own; **Shift+M** — through a voxel center or between voxels.

## Color
The eyedropper (**I**) picks a color; “Replace color” (**Shift+P**) changes one color into another across the whole object; **. and ,** step through the colors of a ramp. More in [Color and materials](color.md).

## Slice
**Alt+S** hides everything on one side of a layer — draw inside the model; **Alt+↑ / Alt+↓** move the slice. The brush does not touch what is hidden.

## Radial menu
**`** (the key above Tab) or a long press on a phone — a ring of frequent commands under your finger.
