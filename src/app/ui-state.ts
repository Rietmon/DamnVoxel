import { writable } from './store';
import type { Theme } from './theme';

/** Layout of the window that the user changes by hand. */
export interface UiState {
  /** Width of the right dock in CSS pixels. */
  sideWidth: number;
  /** Folded sections of the dock. */
  folded: string[];
  /** The whole interface is hidden: only the canvas (Shift+\, four fingers). */
  hidden: boolean;
  /** The last tool used in each tool family, by family id. */
  lastTool: Record<string, string>;
  theme: Theme;
  /** The animation timeline is shown under the view. */
  timeline: boolean;
}

export const SIDE_WIDTH = { min: 240, max: 560, initial: 288 };

export const DEFAULT_UI_STATE: UiState = {
  sideWidth: SIDE_WIDTH.initial,
  folded: [],
  hidden: false,
  lastTool: { shape: 'box', color: 'pipette', select: 'select-rect' },
  theme: 'dark',
  timeline: false,
};

export function clampSideWidth(width: number): number {
  return Math.round(Math.min(SIDE_WIDTH.max, Math.max(SIDE_WIDTH.min, width)));
}

export function createUiState() {
  return writable<UiState>({ ...DEFAULT_UI_STATE, lastTool: { ...DEFAULT_UI_STATE.lastTool } });
}
