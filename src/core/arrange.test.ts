import { describe, expect, it } from 'vitest';
import { alignNodes, dropToGround, originOffset, placeNode, SetOriginCommand } from './arrange';
import { VoxelDocument } from './document';
import { quarterTurn } from './orientation';
import { worldTransform } from './scene';
import { InsertNodeCommand, worldBounds } from './scene-edit';
import { cellToWorld } from './transform';

function setup() {
  const doc = VoxelDocument.createEmpty();
  const a = doc.scene.objects()[0]!;
  for (let x = 0; x < 4; x++) for (let y = 0; y < 2; y++) a.volume.set(x, y, 0, 2);
  const b = doc.scene.createObject('B');
  b.volume.set(0, 0, 0, 3);
  b.transform = { x: 10, y: 5, z: 3, orientation: 0 };
  doc.history.execute(new InsertNodeCommand('B', b, doc.scene.root, 1));
  return { doc, a, b };
}

describe('arranging', () => {
  it('aligns sides and middles to the target', () => {
    const { doc, a, b } = setup();
    alignNodes(doc, a, [a, b], 0, 'min');
    expect(worldBounds([b])!.minX).toBe(0);
    alignNodes(doc, a, [b], 0, 'max');
    expect(worldBounds([b])!.maxX).toBe(3);
    alignNodes(doc, a, [b], 1, 'center');
    expect(worldBounds([b])!.minY).toBe(1);
    doc.history.undo();
    expect(worldBounds([b])!.minY).toBe(5);
  });

  it('puts things on the ground and places them by numbers', () => {
    const { doc, b } = setup();
    expect(dropToGround(doc, [b])).toBe(true);
    expect(worldBounds([b])!.minY).toBe(0);
    expect(dropToGround(doc, [b])).toBe(false);
    placeNode(doc, b, 2, -7);
    expect(worldBounds([b])!.minZ).toBe(-7);
  });

  it('moves the origin without moving the voxels in the world', () => {
    const { doc, a } = setup();
    a.transform = { x: 3, y: 0, z: 0, orientation: quarterTurn(1) };
    const before = cellToWorld(worldTransform(a), 3, 1, 0);
    const offset = originOffset(a, 'bottom')!;
    expect(offset).toEqual([2, 0, 0]);
    doc.history.execute(new SetOriginCommand(a, offset));
    const [x, y, z] = [3 - offset[0], 1 - offset[1], 0 - offset[2]];
    expect(a.volume.get(x, y, z)).toBe(2);
    expect(cellToWorld(worldTransform(a), x, y, z)).toEqual(before);
    doc.history.undo();
    expect(a.volume.get(3, 1, 0)).toBe(2);
  });
});
