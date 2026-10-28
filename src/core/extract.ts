import { copyVoxels } from './clipboard';
import type { VoxelDocument } from './document';
import { type Command, CompositeCommand } from './history';
import { isLocked, type VoxelObject } from './scene';
import { InsertNodeCommand } from './scene-edit';
import { SelectionMask } from './selection';
import { SelectionTransaction } from './selection-edit';
import { VoxelTransaction } from './voxel-edit';

/**
 * Moves the selected voxels of an object into a new object right after it, in the same place
 * (same transform, same cells): one undo step. Returns the new object, or null when there was
 * nothing selected or the object is locked.
 */
export function extractSelection(doc: VoxelDocument, object: VoxelObject): VoxelObject | null {
  if (object.selection.isEmpty || isLocked(object)) return null;
  const clip = copyVoxels(object, doc.palette);
  if (!clip) return null;
  const scene = doc.scene;
  const part = scene.createObject(`${object.name}: part`, clip.volume);
  part.transform = { ...object.transform };
  const erase = new VoxelTransaction();
  object.selection.forEach((x, y, z) => {
    erase.set(object, x, y, z, 0);
  });
  const removed = erase.commit('Move into object');
  const clear = new SelectionTransaction(object);
  clear.combine(new SelectionMask(), 'replace');
  const cleared = clear.commit('Deselect');
  const parent = object.parent ?? scene.root;
  const insert = new InsertNodeCommand(
    'Move into object',
    part,
    parent,
    parent.children.indexOf(object) + 1,
  );
  insert.apply(doc);
  const parts: Command[] = [removed, cleared, insert].filter((c) => c !== null);
  doc.history.push(new CompositeCommand('Move into object', parts));
  doc.notifySelection(object);
  return part;
}
