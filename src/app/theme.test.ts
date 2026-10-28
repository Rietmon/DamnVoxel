import { describe, expect, it } from 'vitest';
import { DEFAULT_VIEW } from '../render/renderer';
import { SCHEME_VIEW_COLORS, schemeOf, withViewColors } from './theme';

describe('themes', () => {
  it('follows the system in auto', () => {
    expect(schemeOf('auto', true)).toBe('dark');
    expect(schemeOf('auto', false)).toBe('light');
    expect(schemeOf('light', true)).toBe('light');
  });

  it('fills viewport colours from the scheme unless set by hand', () => {
    const view = withViewColors(
      { ...DEFAULT_VIEW, gridColor: '#ff0000', edgeColor: 'nope' },
      'light',
    );
    expect(view.gridColor).toBe('#ff0000');
    expect(view.edgeColor).toBe(SCHEME_VIEW_COLORS.light.edgeColor);
    expect(view.background).toBe(SCHEME_VIEW_COLORS.light.background);
  });
});
