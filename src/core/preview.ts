import { type Operation, resultValue } from './operation';
import type { GhostMode } from './tools/tool';
import type { VolumeReader, VoxelVolume } from './volume';

/**
 * Fills `ghost` with the cells an operation would change in `target`: the value they would get
 * for add and paint, 1 for erase (the ghost is tinted, its colour does not matter). Cells the
 * operation leaves alone stay out, so the preview shows exactly the future voxels
 * (the brush preview is the future voxels themselves).
 */
export function buildGhost(op: Operation, target: VolumeReader, ghost: VoxelVolume): GhostMode {
  ghost.clear();
  op.forEachCell((x, y, z, color) => {
    const current = target.get(x, y, z);
    const next = resultValue(op.action, color, current);
    if (next === current) return;
    ghost.set(x, y, z, op.action === 'erase' ? 1 : next);
  });
  return op.action;
}
