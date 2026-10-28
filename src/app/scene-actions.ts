import {
  type AlignEdge,
  alignNodes,
  dropToGround,
  type OriginPlace,
  originOffset,
  SetOriginCommand,
} from '../core/arrange';
import { BOOLEAN_TITLES, type BooleanOp, booleanObjects, splitObject } from '../core/boolean';
import { quarterTurn, reflection } from '../core/orientation';
import type { GroupNode, SceneNode, VoxelObject } from '../core/scene';
import {
  duplicateNodes,
  groupNodes,
  InsertNodeCommand,
  linkedCopies,
  linkedCopiesOf,
  orientNodes,
  removeNodes,
  UnlinkCommand,
  ungroup,
} from '../core/scene-edit';
import type { Action } from './actions';
import type { Editor } from './editor';
import { programSpecs } from './programs';

/** Objects and groups: create, group, ungroup, duplicate, delete, turn. */
export function sceneActions(editor: Editor): Action[] {
  const scene = () => editor.doc.scene;
  const hasTargets = () => editor.sceneTargets().length > 0;
  const select = (nodes: SceneNode[]) => editor.selectNodes(nodes);
  /** Selected objects: the edited one (or the first) is the target, the others the tools. */
  const operands = () => {
    const objects = editor.sceneTargets().filter((n): n is VoxelObject => n.kind === 'object');
    const active = editor.activeObject.get();
    const target = active && objects.includes(active) ? active : objects[0];
    return target ? { target, tools: objects.filter((o) => o !== target) } : null;
  };
  const boolean = (op: BooleanOp): Action => ({
    id: `scene.${op}`,
    title:
      op === 'union'
        ? 'Merge the selected objects into one'
        : op === 'subtract'
          ? 'Subtract the other selected objects from this one'
          : 'Intersect the object with the other selected ones',
    group: 'Scene',
    run: () => {
      const o = operands();
      if (!o || o.tools.length === 0) {
        editor.toast('Select two objects or more (in the Scene mode)');
        return;
      }
      const command = booleanObjects(editor.doc, o.target, o.tools, op);
      if (command) {
        editor.doc.history.push(command);
        select([o.target]);
        editor.toast(`${BOOLEAN_TITLES[op]}: into “${o.target.name}”`);
      }
    },
    enabled: () => (operands()?.tools.length ?? 0) > 0,
  });
  const split = (byColor: boolean): Action => ({
    id: byColor ? 'scene.splitByColor' : 'scene.split',
    title: byColor ? 'Split the object by colors' : 'Split the object into unconnected parts',
    group: 'Scene',
    run: () => {
      const target = operands()?.target;
      if (!target) return;
      const made = splitObject(editor.doc, target, byColor);
      if (made.length === 0) editor.toast('The object is in one piece: nothing to split');
      else {
        select([target, ...made]);
        editor.toast(`Parts: ${made.length + 1}`);
      }
    },
    enabled: () => operands() !== null,
  });
  return [
    {
      id: 'mode.toggle',
      title: 'Mode: model / scene',
      group: 'Scene',
      keys: ['Tab'],
      run: () => editor.setMode(editor.mode.get() === 'model' ? 'scene' : 'model'),
    },
    {
      id: 'scene.newObject',
      title: 'New object',
      group: 'Scene',
      keys: ['Shift+KeyN'],
      run: () => {
        const s = scene();
        const object = s.createObject(`Object ${s.objects().length + 1}`);
        object.layer = editor.currentLayer();
        // Next to the active object, in the same group; at the end of the scene otherwise.
        const active = editor.activeObject.get();
        const parent = active?.parent ?? s.root;
        const index = active ? parent.children.indexOf(active) + 1 : parent.children.length;
        editor.doc.history.execute(new InsertNodeCommand('New object', object, parent, index));
        select([object]);
      },
    },
    {
      id: 'scene.group',
      title: 'Group',
      group: 'Scene',
      keys: ['Ctrl+KeyG'],
      run: () => {
        const count = scene().root.children.filter((n) => n.kind === 'group').length;
        const group = groupNodes(editor.doc, editor.sceneTargets(), `Group ${count + 1}`);
        if (group) select([group]);
      },
      enabled: hasTargets,
    },
    {
      id: 'scene.ungroup',
      title: 'Ungroup',
      group: 'Scene',
      keys: ['Ctrl+Shift+KeyG'],
      run: () => {
        // Selected groups, or the group around the active object.
        const targets = editor.sceneTargets();
        let groups = targets.filter((n): n is GroupNode => n.kind === 'group');
        if (groups.length === 0) {
          const parent = targets[0]?.parent;
          if (parent?.parent) groups = [parent];
        }
        const children = groups.flatMap((g) => ungroup(editor.doc, g));
        if (children.length > 0) select(children);
      },
      enabled: hasTargets,
    },
    {
      id: 'scene.duplicate',
      title: 'Duplicate object',
      group: 'Scene',
      run: () => select(duplicateNodes(editor.doc, editor.sceneTargets())),
      enabled: hasTargets,
    },
    ...(['x', 'y', 'z'] as const).flatMap((name, axis) =>
      (['min', 'center', 'max'] as AlignEdge[]).map(
        (edge): Action => ({
          id: `scene.align.${name}.${edge}`,
          title: `Align on ${name.toUpperCase()}: ${edge === 'min' ? 'low edge' : edge === 'max' ? 'high edge' : 'middle'}`,
          group: 'Scene',
          run: () => {
            const o = operands();
            if (!o || o.tools.length === 0) {
              editor.toast('Select the objects and the one to align to (the edited one)');
              return;
            }
            alignNodes(editor.doc, o.target, o.tools, axis, edge);
          },
          enabled: () => (operands()?.tools.length ?? 0) > 0,
        }),
      ),
    ),
    {
      id: 'scene.ground',
      title: 'Put on the ground',
      group: 'Scene',
      keys: ['End'],
      run: () => {
        if (!dropToGround(editor.doc, editor.sceneTargets())) editor.toast('Already on the ground');
      },
      enabled: hasTargets,
    },
    ...(['bottom', 'center'] as OriginPlace[]).map(
      (place): Action => ({
        id: `scene.origin.${place}`,
        title:
          place === 'bottom' ? 'Object origin at the bottom center' : 'Object origin at the center',
        group: 'Scene',
        run: () => {
          for (const o of editor.sceneTargets()) {
            if (o.kind !== 'object') continue;
            const offset = originOffset(o, place);
            if (offset?.some((v) => v !== 0))
              editor.doc.history.execute(new SetOriginCommand(o, offset));
          }
        },
        enabled: () => editor.sceneTargets().some((n) => n.kind === 'object'),
      }),
    ),
    {
      id: 'program.new',
      title: 'New program: a shape from code or nodes',
      group: 'Programs',
      run: () => editor.programOpen.set('new'),
    },
    {
      id: 'program.edit',
      title: 'Edit the object’s program',
      group: 'Programs',
      run: () => editor.openProgram(),
      enabled: () => {
        const o = editor.activeObject.get();
        return o !== null && programSpecs.has(o);
      },
    },
    {
      id: 'scene.cloth',
      title: 'Drape cloth over the selection',
      group: 'Scene',
      run: () => void editor.drapeCloth(),
    },
    {
      id: 'library.save',
      title: 'Save to library (selection or object)',
      group: 'Library',
      run: () => editor.saveAsset(),
      enabled: () => editor.activeObject.get() !== null,
    },
    boolean('union'),
    boolean('subtract'),
    boolean('intersect'),
    split(false),
    split(true),
    {
      id: 'scene.linkedCopy',
      title: 'Linked copy: shared voxels',
      group: 'Scene',
      keys: ['Alt+KeyD'],
      run: () => {
        const objects = editor.sceneTargets().filter((n): n is VoxelObject => n.kind === 'object');
        const copies = linkedCopiesOf(editor.doc, objects);
        if (copies.length > 0) {
          select(copies);
          editor.toast('Linked copy: editing one changes all');
        }
      },
      enabled: () => editor.sceneTargets().some((n) => n.kind === 'object'),
    },
    {
      id: 'scene.unlink',
      title: 'Unlink copy: own voxels',
      group: 'Scene',
      run: () => {
        const objects = editor
          .sceneTargets()
          .filter(
            (n): n is VoxelObject => n.kind === 'object' && linkedCopies(scene(), n).length > 0,
          );
        for (const o of objects) editor.doc.history.execute(new UnlinkCommand(o));
        if (objects.length > 0) editor.toast('Copy unlinked');
      },
      enabled: () =>
        editor
          .sceneTargets()
          .some((n) => n.kind === 'object' && linkedCopies(scene(), n).length > 0),
    },
    {
      id: 'scene.delete',
      title: 'Delete object',
      group: 'Scene',
      run: () => removeNodes(editor.doc, editor.sceneTargets()),
      enabled: hasTargets,
    },
    ...(
      [
        ['object.turnY', 'Turn object around Y', quarterTurn(1)],
        ['object.turnYBack', 'Turn object around Y back', quarterTurn(1, true)],
        ['object.turnX', 'Turn object around X', quarterTurn(0)],
        ['object.turnZ', 'Turn object around Z', quarterTurn(2)],
        ['object.flipX', 'Flip object on X', reflection(0)],
        ['object.flipY', 'Flip object on Y', reflection(1)],
        ['object.flipZ', 'Flip object on Z', reflection(2)],
      ] as const
    ).map(
      ([id, title, orientation]): Action => ({
        id,
        title,
        group: 'Scene',
        run: () => orientNodes(editor.doc, editor.sceneTargets(), orientation, title),
        enabled: hasTargets,
      }),
    ),
  ];
}
