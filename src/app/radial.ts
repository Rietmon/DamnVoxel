import type { ActionRegistry } from './actions';
import { familyTool, TOOL_FAMILIES } from './tool-families';

/**
 * The radial menu (docs/ui-design.md, “Radial menu”): the tools and undo around a point,
 * opened by a long press of a finger or pen, or by a key. On a tablet it stands in for the
 * keyboard: press, slide towards an item, lift.
 */

export interface RadialItem {
  /** Action id to run, or a tool family («family:shape») that takes its last tool. */
  readonly id: string;
  readonly title: string;
  readonly icon: string;
}

/** Clockwise from the top. Undo and redo sit left and right, where a thumb flicks easily. */
export const RADIAL_ITEMS: readonly RadialItem[] = [
  { id: 'family:brush', title: 'Brush', icon: 'brush' },
  { id: 'family:face', title: 'Face', icon: 'face' },
  { id: 'edit.redo', title: 'Redo', icon: 'redo' },
  { id: 'family:shape', title: 'Shapes', icon: 'box' },
  { id: 'family:color', title: 'Color', icon: 'pipette' },
  { id: 'family:select', title: 'Select', icon: 'select-rect' },
  { id: 'edit.undo', title: 'Undo', icon: 'undo' },
  { id: 'family:move', title: 'Move', icon: 'move' },
];

/** Distance from the centre to the items, CSS pixels. */
export const RADIAL_RADIUS = 104;
/** Room the menu needs around its centre to stay on screen. */
export const RADIAL_EXTENT = RADIAL_RADIUS + 44;
/** A pointer closer to the centre than this points at nothing. */
export const RADIAL_DEAD_ZONE = 26;

/**
 * The item an offset from the centre points at: item 0 straight up, then clockwise, each owning
 * an equal slice; -1 inside the dead zone.
 */
export function radialIndex(dx: number, dy: number, count: number, deadZone = RADIAL_DEAD_ZONE) {
  if (count <= 0 || Math.hypot(dx, dy) < deadZone) return -1;
  // 0 rad points up, growing clockwise (screen y goes down).
  const angle = Math.atan2(dx, -dy);
  const slice = (2 * Math.PI) / count;
  return Math.round(angle / slice + count) % count;
}

/** Where an item sits relative to the centre. */
export function radialOffset(
  index: number,
  count: number,
  radius = RADIAL_RADIUS,
): [number, number] {
  const angle = (index / count) * 2 * Math.PI;
  return [Math.sin(angle) * radius, -Math.cos(angle) * radius];
}

/** Keeps the centre far enough from the edges for the whole ring to show. */
export function clampCentre(x: number, y: number, width: number, height: number): [number, number] {
  const place = (v: number, size: number) =>
    size < 2 * RADIAL_EXTENT
      ? size / 2
      : Math.max(RADIAL_EXTENT, Math.min(size - RADIAL_EXTENT, v));
  return [place(x, width), place(y, height)];
}

/** Runs a radial item: a family takes its remembered tool. */
export function runRadialItem(
  item: RadialItem,
  actions: ActionRegistry,
  lastTool: Readonly<Record<string, string>>,
): void {
  if (item.id.startsWith('family:')) {
    const family = TOOL_FAMILIES.find((f) => f.id === item.id.slice('family:'.length));
    if (family) actions.run(`tool.${familyTool(family, lastTool)}`);
    return;
  }
  actions.run(item.id);
}
