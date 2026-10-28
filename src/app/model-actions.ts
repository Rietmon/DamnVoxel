import { hiddenVoxels, hollowVoxels, interiorCells } from '../core/fill';
import { cellsOperation } from '../core/operation';
import { applyRegionTransform, type RegionTransform, regionBox } from '../core/region-transform';
import { isHidden, isLocked } from '../core/scene';
import type { AdjustField } from '../core/tools/adjust';
import { VoxelTransaction } from '../core/voxel-edit';
import type { Action } from './actions';
import type { Editor } from './editor';

/**
 * Whole-model edits of the active object (hollow, fill the inside): drop what
 * never shows, hollow it out to a wall, fill the empty pockets inside.
 */
export function modelActions(editor: Editor): Action[] {
  const tools = editor.tools;
  const object = () => {
    const o = editor.activeObject.get();
    return o && !isLocked(o) && !isHidden(o) ? o : null;
  };
  const enabled = () => object() !== null;

  /** One step from a list of cells; says how many changed, or why nothing did. */
  const edit = (label: string, action: 'add' | 'erase', cells: number[] | null) => {
    const o = object();
    if (!o) return false;
    if (cells === null) {
      editor.toast('The model is too large for this operation');
      return false;
    }
    if (cells.length === 0) {
      editor.toast(`${label}: nothing to change`);
      return false;
    }
    const tx = new VoxelTransaction();
    tools.apply(cellsOperation(action, tools.settings.color, cells), tx, o);
    tools.commit(tx, label);
    editor.toast(`${label}: ${(cells.length / 3).toLocaleString('en-US')} voxels`);
    return true;
  };

  /**
   * A transform of the selection (or the object): applied with `values`, then its numbers can
   * be changed in “Adjust”.
   */
  const transform = (
    kind: RegionTransform,
    label: string,
    fields: AdjustField[],
    values: (box: { size: number[] }) => Record<string, number>,
  ) => {
    const o = object();
    const box = o ? regionBox(o) : null;
    if (!o || !box) {
      editor.toast('Nothing to change: the object is empty');
      return;
    }
    const size = [box.maxX - box.minX + 1, box.maxY - box.minY + 1, box.maxZ - box.minZ + 1];
    const start = values({ size });
    const doc = editor.doc;
    const command = applyRegionTransform(doc, o, kind, start, label);
    if (!command) {
      editor.toast(`${label}: nothing to change`);
      return;
    }
    doc.history.push(command);
    editor.requestFrame();
    tools.offerAdjustment({
      title: label,
      object: o,
      fields,
      values: start,
      label: () => label,
      operation: () => cellsOperation('add', 0, []),
      run: (v) => applyRegionTransform(doc, o, kind, v, label),
    });
  };
  const AXES = ['X', 'Y', 'Z'] as const;
  return [
    ...AXES.map(
      (name, axis): Action => ({
        id: `region.rotate${name}`,
        title: `Rotate by an angle around ${name}`,
        group: 'Transform',
        enabled,
        run: () =>
          transform(
            'rotate',
            `Rotate around ${name}`,
            [{ key: 'angle', label: 'Angle, °', min: -360, max: 360 }],
            () => ({ axis, angle: 45 }),
          ),
      }),
    ),
    {
      id: 'region.scale',
      title: 'Scale',
      group: 'Transform',
      enabled,
      run: () =>
        transform(
          'scale',
          'Scale',
          ['sx', 'sy', 'sz'].map((key, i) => ({
            key,
            label: `× ${AXES[i]}`,
            min: 0.05,
            max: 16,
            step: 0.25,
            decimals: 2,
          })),
          () => ({ sx: 2, sy: 2, sz: 2 }),
        ),
    },
    {
      id: 'region.loop',
      title: 'Loop: shift around inside the box',
      group: 'Transform',
      enabled,
      run: () =>
        transform(
          'loop',
          'Loop',
          ['dx', 'dy', 'dz'].map((key, i) => ({ key, label: `Shift ${AXES[i]}` })),
          () => ({ dx: 1, dy: 0, dz: 0 }),
        ),
    },
    {
      id: 'region.array',
      title: 'Array: repeat several times',
      group: 'Transform',
      enabled,
      run: () =>
        transform(
          'array',
          'Array',
          [
            { key: 'count', label: 'Count', min: 1, max: 256 },
            ...['dx', 'dy', 'dz'].map((key, i) => ({ key, label: `Step ${AXES[i]}` })),
          ],
          ({ size }) => ({ count: 3, dx: size[0]! + 1, dy: 0, dz: 0 }),
        ),
    },
    {
      id: 'region.crop',
      title: 'Crop to a box with an anchor',
      group: 'Transform',
      enabled,
      run: () =>
        transform(
          'crop',
          'Crop',
          [
            ...['w', 'h', 'd'].map((key, i) => ({ key, label: `Size ${AXES[i]}`, min: 1 })),
            ...['ax', 'ay', 'az'].map((key, i) => ({
              key,
              label: `Anchor ${AXES[i]} (0·1·2)`,
              min: 0,
              max: 2,
            })),
          ],
          ({ size }) => ({
            w: Math.max(1, Math.ceil(size[0]! / 2)),
            h: size[1]!,
            d: size[2]!,
            ax: 1,
            ay: 1,
            az: 1,
          }),
        ),
    },
    {
      id: 'model.removeHidden',
      title: 'Remove hidden voxels',
      group: 'Model',
      enabled,
      run: () => {
        const o = object();
        const box = o?.volume.getBounds();
        if (o && box) edit('Remove hidden', 'erase', hiddenVoxels(o.volume, box));
      },
    },
    {
      id: 'model.hollow',
      title: 'Hollow out (keep a wall)',
      group: 'Model',
      enabled,
      run: () => {
        const o = object();
        const box = o?.volume.getBounds();
        if (!o || !box) return;
        const wall = 2;
        if (!edit('Hollow out', 'erase', hollowVoxels(o.volume, box, wall))) return;
        // The wall can be changed afterwards in “Adjust”.
        tools.offerAdjustment({
          title: 'Hollow out',
          object: o,
          fields: [{ key: 'wall', label: 'Wall', min: 1, max: 64 }],
          values: { wall },
          label: () => 'Hollow out',
          operation: (v) => cellsOperation('erase', 0, hollowVoxels(o.volume, box, v.wall!) ?? []),
        });
      },
    },
    {
      id: 'model.fillInterior',
      title: 'Fill the inside',
      group: 'Model',
      enabled,
      run: () => {
        const o = object();
        const box = o?.volume.getBounds();
        if (o && box) edit('Fill inside', 'add', interiorCells(o.volume, box));
      },
    },
  ];
}
