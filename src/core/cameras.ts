import type { VoxelDocument } from './document';
import type { Command } from './history';

/**
 * Saved views of a document (camera slots): ten slots, as in MagicaVoxel,
 * kept in the file with the model so a view set up for a render or a screenshot comes back.
 */

/** A camera as the document keeps it: world space, angles in radians, fov in degrees. */
export interface CameraView {
  readonly target: readonly [number, number, number];
  readonly yaw: number;
  readonly pitch: number;
  readonly distance: number;
  readonly projection: 'perspective' | 'orthographic';
  /** Vertical field of view of the perspective camera, degrees. */
  readonly fov: number;
}

export const CAMERA_SLOTS = 10;

export function emptyCameraSlots(): (CameraView | null)[] {
  return Array.from({ length: CAMERA_SLOTS }, () => null);
}

export function sameCameraView(a: CameraView | null, b: CameraView | null): boolean {
  if (a === null || b === null) return a === b;
  const close = (x: number, y: number) => Math.abs(x - y) < 1e-6;
  return (
    a.target.every((v, i) => close(v, b.target[i]!)) &&
    close(a.yaw, b.yaw) &&
    close(a.pitch, b.pitch) &&
    close(a.distance, b.distance) &&
    close(a.fov, b.fov) &&
    a.projection === b.projection
  );
}

/** Puts a view into a slot (or clears it with null): one undo step. */
export class SetCameraSlotCommand implements Command {
  readonly bytes = 96;
  readonly label: string;
  private before: CameraView | null = null;

  constructor(
    private readonly slot: number,
    private readonly view: CameraView | null,
  ) {
    this.label = view ? `Remember camera ${slot + 1}` : `Clear camera ${slot + 1}`;
  }

  apply(doc: VoxelDocument): void {
    this.before = doc.cameras[this.slot] ?? null;
    doc.cameras[this.slot] = this.view;
  }

  revert(doc: VoxelDocument): void {
    doc.cameras[this.slot] = this.before;
  }
}
