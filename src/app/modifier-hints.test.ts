import { describe, expect, it } from 'vitest';
import { HINTED_TOOLS, modifierHints } from './modifier-hints';

describe('modifier hints', () => {
  it('cover every tool and switch with the mode', () => {
    for (const id of [
      'brush',
      'face',
      'box',
      'line',
      'rect',
      'ellipse',
      'sphere',
      'cylinder',
      'pipette',
      'replace',
      'select-rect',
      'select-lasso',
      'select-box',
      'select-region',
      'move',
    ]) {
      expect(HINTED_TOOLS).toContain(id);
    }
    expect(modifierHints('model', 'select-rect').map((h) => h.text)).toEqual([
      'add',
      'subtract',
      'intersect',
    ]);
    expect(modifierHints('scene', 'select-rect')[0]!.text).toBe('add to selection');
    expect(modifierHints('model', 'unknown')).toEqual([]);
  });
});
