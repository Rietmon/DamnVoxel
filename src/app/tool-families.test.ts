import { describe, expect, it } from 'vitest';
import { familyOf, familyTool, TOOL_FAMILIES } from './tool-families';

const TOOLS = [
  'brush',
  'stamp',
  'sculpt',
  'face',
  'box',
  'line',
  'rect',
  'ellipse',
  'sphere',
  'cylinder',
  'sdf',
  'curve',
  'rope',
  'cone',
  'pyramid',
  'torus',
  'stairs',
  'arch',
  'pipette',
  'replace',
  'fill',
  'select-rect',
  'select-lasso',
  'select-box',
  'select-region',
  'move',
];

describe('tool families', () => {
  it('hold every tool exactly once, in six buttons', () => {
    expect(TOOL_FAMILIES).toHaveLength(6);
    const all = TOOL_FAMILIES.flatMap((f) => f.tools);
    expect([...all].sort()).toEqual([...TOOLS].sort());
    for (const id of TOOLS) expect(familyOf(id)).toBeDefined();
    expect(familyOf('nothing')).toBeUndefined();
  });

  it('stand for the last tool used, or their first', () => {
    const shapes = familyOf('sphere')!;
    expect(familyTool(shapes, {})).toBe('box');
    expect(familyTool(shapes, { shape: 'sphere' })).toBe('sphere');
    expect(familyTool(shapes, { shape: 'brush' })).toBe('box');
  });
});
