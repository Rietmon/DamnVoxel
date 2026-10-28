/**
 * Cursors that stay visible on any background: a white line inside a dark outline reads on
 * white voxels, black ones and every colour between: the cursor must be visible on any
 * background. The system crosshair is one pixel of one colour and gets lost on a busy model.
 */
const CROSSHAIR_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='25' height='25' viewBox='0 0 25 25'>" +
  "<g stroke-linecap='round'>" +
  "<path d='M12.5 2 V9 M12.5 16 V23 M2 12.5 H9 M16 12.5 H23' stroke='black' stroke-width='3.5'/>" +
  "<path d='M12.5 2 V9 M12.5 16 V23 M2 12.5 H9 M16 12.5 H23' stroke='white' stroke-width='1.5'/>" +
  "<circle cx='12.5' cy='12.5' r='1.6' fill='white' stroke='black' stroke-width='1'/>" +
  '</g></svg>';

export const CONTRAST_CROSSHAIR = `url("data:image/svg+xml,${encodeURIComponent(CROSSHAIR_SVG)}") 12 12, crosshair`;

/** The cursor to show for one a tool asks for. */
export function visibleCursor(cursor: string): string {
  return cursor === 'crosshair' ? CONTRAST_CROSSHAIR : cursor;
}
