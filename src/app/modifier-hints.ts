import type { EditorMode } from './editor';

/** One line of the status bar's modifier hints: which keys, and what they change. */
export interface ModifierHint {
  /** Modifiers that must be held, as in the key names of KeyState: shift, ctrl, alt. */
  keys: readonly ('shift' | 'ctrl' | 'alt')[];
  text: string;
}

const DRAW: ModifierHint[] = [
  { keys: ['shift'], text: 'erase' },
  { keys: ['alt'], text: 'pick color' },
];

const SHAPE: ModifierHint[] = [
  { keys: ['shift'], text: 'erase' },
  { keys: ['ctrl'], text: 'height' },
  { keys: ['alt'], text: 'from center' },
  { keys: ['alt', 'ctrl'], text: 'from center, even' },
];

/** Flat shapes have no height to pull. */
const FLAT: ModifierHint[] = SHAPE.filter((h) => h.text !== 'height');

const SELECT: ModifierHint[] = [
  { keys: ['shift'], text: 'add' },
  { keys: ['alt'], text: 'subtract' },
  { keys: ['shift', 'alt'], text: 'intersect' },
];

const HINTS: Record<string, ModifierHint[]> = {
  brush: DRAW,
  stamp: DRAW,
  sdf: [{ keys: ['shift'], text: 'erase' }],
  curve: [{ keys: ['shift'], text: 'erase' }],
  rope: [],
  sculpt: [{ keys: ['shift'], text: 'grow ↔ erode' }],
  face: DRAW,
  box: SHAPE,
  line: [{ keys: ['shift'], text: 'erase' }],
  rect: FLAT,
  ellipse: FLAT,
  sphere: SHAPE,
  cylinder: SHAPE,
  cone: SHAPE,
  pyramid: SHAPE,
  torus: SHAPE,
  stairs: SHAPE,
  arch: SHAPE,
  pipette: [],
  fill: [{ keys: ['shift'], text: 'erase area' }],
  replace: [{ keys: ['alt'], text: 'pick color' }],
  'select-rect': SELECT,
  'select-lasso': SELECT,
  'select-box': SELECT,
  'select-region': SELECT,
  move: [
    { keys: ['shift'], text: 'along the normal' },
    { keys: ['ctrl'], text: 'along one axis' },
    { keys: ['alt'], text: 'copy' },
  ],
};

/** Ctrl adds too, but one line is enough. */
const SCENE: ModifierHint[] = [{ keys: ['shift'], text: 'add to selection' }];

/** What modifiers do right now: in scene mode the same for all, in model mode per tool. */
export function modifierHints(mode: EditorMode, toolId: string): ModifierHint[] {
  return mode === 'scene' ? SCENE : (HINTS[toolId] ?? []);
}

/** Every tool that has hints: the toolbar's tools must all be here. */
export const HINTED_TOOLS = Object.keys(HINTS);
