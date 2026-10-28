import type { ViewSettings } from '../render/renderer';

/**
 * Light and dark themes (docs/ui-design.md, “Quiet style”). The interface takes its colours from
 * CSS tokens under `data-theme`; the viewport gets its own: background, grid, voxel edges and
 * the selection film. Each of those can be set by hand; an empty value follows the theme.
 */

export type Theme = 'dark' | 'light' | 'auto';
export type Scheme = 'dark' | 'light';

export const THEMES: readonly Theme[] = ['dark', 'light', 'auto'];
export const THEME_TITLES: Record<Theme, string> = {
  dark: 'Dark',
  light: 'Light',
  auto: 'As in the system',
};

export type ViewColorKey = 'background' | 'gridColor' | 'edgeColor' | 'selectionColor';

export const VIEW_COLOR_TITLES: Record<ViewColorKey, string> = {
  background: 'Background',
  gridColor: 'Grid',
  edgeColor: 'Edges',
  selectionColor: 'Selection',
};

/** The viewport colours of each scheme, #rrggbb. */
export const SCHEME_VIEW_COLORS: Record<Scheme, Record<ViewColorKey, string>> = {
  dark: {
    background: '#1b1d22',
    gridColor: '#ffffff',
    edgeColor: '#000000',
    selectionColor: '#4d9eff',
  },
  light: {
    background: '#dfe2e7',
    gridColor: '#1b1d22',
    edgeColor: '#000000',
    selectionColor: '#2f7de1',
  },
};

/** The scheme a theme means now. */
export function schemeOf(theme: Theme, systemPrefersDark: boolean): Scheme {
  if (theme === 'auto') return systemPrefersDark ? 'dark' : 'light';
  return theme;
}

const HEX = /^#[0-9a-f]{6}$/i;

/** View settings with every colour filled in: own colours as set, the rest from the scheme. */
export function withViewColors(view: ViewSettings, scheme: Scheme): ViewSettings {
  const defaults = SCHEME_VIEW_COLORS[scheme];
  const pick = (key: ViewColorKey) => (HEX.test(view[key]) ? view[key] : defaults[key]);
  return {
    ...view,
    background: pick('background'),
    gridColor: pick('gridColor'),
    edgeColor: pick('edgeColor'),
    selectionColor: pick('selectionColor'),
  };
}
