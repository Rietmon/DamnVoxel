/**
 * Line icons on a 20 × 20 grid, drawn with `stroke: currentColor` (see .icon in theme.css).
 * One path per icon keeps them tiny and lets them take any colour.
 */
export const ICONS: Record<string, string> = {
  // Tools
  brush: 'M4 16 C4 13 7 13 7 13 L14 6 L16 8 L9 15 C9 15 9 18 4 16 Z',
  face: 'M4 10 L10 7 L16 10 L10 13 Z M4 10 V15 L10 18 L16 15 V10 M10 13 V18 M10 1.5 V5 M8.5 3 L10 1.5 L11.5 3',
  box: 'M4 7 L10 4 L16 7 V14 L10 17 L4 14 Z M4 7 L10 10 L16 7 M10 10 V17',
  line: 'M4 16 L16 4 M3 15 H5 V17 M15 3 H17 V5',
  rect: 'M4 5 H16 V15 H4 Z',
  ellipse: 'M3 10 a7 5 0 1 0 14 0 a7 5 0 1 0 -14 0',
  sphere: 'M3 10 a7 7 0 1 0 14 0 a7 7 0 1 0 -14 0 M3 10 C6 13 14 13 17 10',
  cylinder: 'M4 5 a6 2 0 1 0 12 0 a6 2 0 1 0 -12 0 M4 5 V15 a6 2 0 0 0 12 0 V5',
  pipette: 'M4 16 L4 13 L12 5 L15 8 L7 16 Z M12 5 L14 3 a1.5 1.5 0 0 1 3 3 L15 8',
  replace:
    'M3 3 H9 V9 H3 Z M11 11 H17 V17 H11 Z M12 3 H15 a2 2 0 0 1 2 2 V8 M15.5 6.5 L17 8 L18.5 6.5 M8 17 H5 a2 2 0 0 1 -2 -2 V12',
  'select-rect':
    'M4 5 H7 M9 5 H11 M13 5 H16 V8 M16 10 V12 M16 14 V15 H13 M11 15 H9 M7 15 H4 V12 M4 10 V8',
  'select-lasso': 'M5 10 C3 5 15 3 16.5 7.5 C18 12 9 13 7 11.5 M7 11.5 C5 13 6 16 8 17',
  'select-box':
    'M4 7 L10 4 L16 7 V14 L10 17 L4 14 Z M4 7 L10 10 L16 7 M10 10 V17 M7 2 H8 M12 2 H13',
  'select-region': 'M3 17 L12 8 M14 2 V5 M17 4.5 L15 6.5 M18 9 H15 M11 4.5 L13 6.5',
  move: 'M10 2 V18 M2 10 H18 M8 4 L10 2 L12 4 M8 16 L10 18 L12 16 M4 8 L2 10 L4 12 M16 8 L18 10 L16 12',
  // What the tool does
  add: 'M10 4 V16 M4 10 H16',
  erase: 'M4 10 H16',
  paint: 'M4 11 L10 5 L16 11 L10 17 Z M4 11 H16 M16 11 C18 13 18 15.5 16.5 16',
  // Editor
  undo: 'M7 5 L3 9 L7 13 M3 9 H12 a5 5 0 0 1 0 10 H9',
  redo: 'M13 5 L17 9 L13 13 M17 9 H8 a5 5 0 0 0 0 10 H11',
  command: 'M7 4 a3 3 0 1 0 0 6 H13 a3 3 0 1 0 0 -6 V16 a3 3 0 1 0 -6 0 V4',
  menu: 'M3 5 H17 M3 10 H17 M3 15 H17',
  palette:
    'M10 3 a7 7 0 1 0 0 14 c1.5 0 2 -1 1.5 -2 c-.5 -1 0 -2 1.5 -2 H15 a2 2 0 0 0 2 -2 a7 7 0 0 0 -7 -8 Z M6 9 h.01 M8.5 6 h.01 M12 6 h.01',
  scene: 'M3 4 H11 M6 9 H14 M6 14 H17 M3 4 V14 H6 M3 9 H6',
  options: 'M4 6 H16 M4 14 H16 M8 4 V8 M12 12 V16',
  mirror: 'M10 2 V18 M8 5 L4 10 L8 15 Z M12 5 L16 10 L12 15 Z',
  close: 'M5 5 L15 15 M15 5 L5 15',
  film: 'M3 4 H17 V16 H3 Z M6 4 V16 M14 4 V16 M3 8 H6 M3 12 H6 M14 8 H17 M14 12 H17',
  cone: 'M10 3 L16 15 M10 3 L4 15 M4 15 C4 17.5 16 17.5 16 15 C16 12.5 4 12.5 4 15',
  pyramid: 'M10 3 L3 14 L10 17 L17 14 Z M10 3 V17',
  torus:
    'M2 10 C2 5 18 5 18 10 C18 15 2 15 2 10 Z M7 10 C7 8.5 13 8.5 13 10 C13 11.5 7 11.5 7 10 Z',
  stairs: 'M3 17 V13 H7 V9 H11 V5 H17 V17 Z',
  arch: 'M3 17 V5 H17 V17 H13 V12 A3 3 0 0 0 7 12 V17 Z',
  rope: 'M3 5 C6 15 14 15 17 5 M3 5 V3 M17 5 V3',
  curve: 'M3 16 C5 4 15 4 17 16',
  sdf: 'M7 13 a4 4 0 1 1 3 -6.5 a3.5 3.5 0 1 1 1 6.5 Z',
  fill: 'M4 10 L10 4 L16 10 L10 16 Z M16 12 C16 12 18 15 18 16 A2 2 0 0 1 14 16 C14 15 16 12 16 12',
  sculpt: 'M3 16 C5 11 7 13 9 9 C11 5 13 9 17 4 M3 16 H17',
  stamp: 'M7.5 3 H12.5 V8 H10.8 V11 H16.5 V14.5 H3.5 V11 H9.2 V8 H7.5 Z M3.5 17 H16.5',
  eye: 'M2 10 C5 4.5 15 4.5 18 10 C15 15.5 5 15.5 2 10 Z M10 7.5 a2.5 2.5 0 1 0 .01 0',
  panels: 'M3 4 H17 V16 H3 Z M12 4 V16',
  pin: 'M7 3 H13 M8 3 V8 L5.5 11 H14.5 L12 8 V3 M10 11 V17',
  expand: 'M11 3 H17 V9 M17 3 L11 9 M9 17 H3 V11 M3 17 L9 11',
  resize: 'M4 7 H13 V16 H4 Z M8 4 H16 V12',
  render: 'M10 3 a7 7 0 1 0 .01 0 M6.5 8 a4 4 0 0 1 4 -3',
};
