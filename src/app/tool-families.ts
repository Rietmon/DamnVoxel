/**
 * Tools grouped into families for the tool rail: six buttons instead of fifteen
 * (docs/ui-design.md). A family button holds its last used tool; the others are one press away.
 */
export interface ToolFamily {
  readonly id: string;
  readonly title: string;
  /** Tool ids, the default first. */
  readonly tools: readonly string[];
}

export const TOOL_FAMILIES: readonly ToolFamily[] = [
  { id: 'brush', title: 'Brush', tools: ['brush', 'stamp', 'sculpt'] },
  { id: 'face', title: 'Face', tools: ['face'] },
  {
    id: 'shape',
    title: 'Shapes',
    tools: [
      'box',
      'line',
      'curve',
      'rope',
      'rect',
      'ellipse',
      'sphere',
      'cylinder',
      'cone',
      'pyramid',
      'torus',
      'stairs',
      'arch',
      'sdf',
    ],
  },
  { id: 'color', title: 'Color', tools: ['pipette', 'replace', 'fill'] },
  {
    id: 'select',
    title: 'Select',
    tools: ['select-rect', 'select-lasso', 'select-box', 'select-region'],
  },
  { id: 'move', title: 'Move', tools: ['move'] },
];

export function familyOf(toolId: string): ToolFamily | undefined {
  return TOOL_FAMILIES.find((f) => f.tools.includes(toolId));
}

/** The tool a family button stands for now: the last one used, else its first. */
export function familyTool(family: ToolFamily, last: Readonly<Record<string, string>>): string {
  const remembered = last[family.id];
  return remembered && family.tools.includes(remembered) ? remembered : family.tools[0]!;
}
