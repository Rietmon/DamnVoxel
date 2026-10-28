import type { Command } from '../history';
import type { Operation } from '../operation';
import type { VoxelObject } from '../scene';

/**
 * “Adjust last operation”, as Blender's redo panel: a
 * tool that has just applied something offers its numbers — where and how big a shape is, how
 * deep a face went, which colour — and changing one replaces that step with a new one built
 * from the new numbers. It lasts while that step is the last one in the history.
 */

export interface AdjustField {
  readonly key: string;
  readonly label: string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly decimals?: number;
}

export interface Adjustment {
  /** What the step was: “Box”, “Extrude face”. */
  readonly title: string;
  readonly fields: readonly AdjustField[];
  /** The numbers the step was made with. */
  readonly values: Readonly<Record<string, number>>;
  /** The object the step changed. */
  readonly object: VoxelObject;
  /** The edit for a set of numbers, in that object's space. */
  operation(values: Readonly<Record<string, number>>): Operation;
  /** The history label for a set of numbers. */
  label(values: Readonly<Record<string, number>>): string;
  /**
   * For steps that are more than one operation (voxels and the selection): makes the whole step
   * for a set of numbers and returns it applied, instead of `operation`.
   */
  run?(values: Readonly<Record<string, number>>): Command | null;
}

/** Palette colour as a field: 1…255. */
export const COLOR_FIELD: AdjustField = { key: 'color', label: 'Color', min: 1, max: 255 };
