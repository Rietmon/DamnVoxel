import { copyVoxels, parseClip, remapClip, serializeClip, type VoxelClip } from '../core/clipboard';
import { CompositeCommand } from '../core/history';
import { isLocked } from '../core/scene';
import { duplicateNodes, removeNodes } from '../core/scene-edit';
import { SelectionMask } from '../core/selection';
import { SelectionTransaction } from '../core/selection-edit';
import { floatingPiece, liftSelection, MoveTool } from '../core/tools/move';
import { VoxelTransaction } from '../core/voxel-edit';
import { isTypingTarget } from '../input/keys';
import type { Action } from './actions';
import type { Editor } from './editor';

/** Clips bigger than this stay in memory only: the system clipboard is for reasonable sizes. */
const SYSTEM_CLIPBOARD_LIMIT = 200_000;

/**
 * Copy, cut, paste and duplicate. A clip lives in memory (it survives opening another document)
 * and, when small enough, on the system clipboard as text (it survives switching tabs). Pastes
 * arrive as a floating piece carried by the move tool: place it and press Enter.
 */
export class ClipboardService {
  private clip: VoxelClip | null = null;
  /** Native clipboard events seen: tells the keyboard fallback the browser already handled one. */
  events = 0;

  constructor(private readonly editor: Editor) {}

  get hasClip(): boolean {
    return this.clip !== null;
  }

  /** Copies the selection (or the whole object); returns text for the system clipboard. */
  copy(): string | null {
    const object = this.editor.activeObject.get();
    if (!object) return null;
    const clip = copyVoxels(object, this.editor.doc.palette);
    if (!clip) {
      this.editor.toast('Nothing to copy');
      return null;
    }
    this.clip = clip;
    this.editor.toast(`Copied: ${clip.volume.voxelCount.toLocaleString('en-US')} voxels`);
    return clip.volume.voxelCount <= SYSTEM_CLIPBOARD_LIMIT ? serializeClip(clip) : null;
  }

  /**
   * Copies the selected voxels, then erases them and the selection in one step. Needs a
   * selection: cutting a whole model by accident is too easy to miss.
   */
  cut(): string | null {
    const object = this.editor.activeObject.get();
    if (!object || object.selection.isEmpty) {
      this.editor.toast('Select what to cut');
      return null;
    }
    const text = this.copy();
    this.eraseSelected('Cut');
    return text;
  }

  /** Erases the selected voxels and drops the selection, as one history step. */
  eraseSelected(label: string): void {
    const object = this.editor.activeObject.get();
    if (!object || isLocked(object) || object.selection.isEmpty) return;
    const tx = new VoxelTransaction();
    object.selection.forEach((x, y, z) => {
      tx.set(object, x, y, z, 0);
    });
    const selTx = new SelectionTransaction(object);
    selTx.combine(new SelectionMask(), 'replace');
    const parts = [tx.commit(label), selTx.commit('Selection')].filter((c) => c !== null);
    if (parts.length === 0) return;
    const doc = this.editor.doc;
    doc.history.push(new CompositeCommand(label, parts));
    doc.notifySelection(object);
    this.editor.requestFrame();
  }

  /** Pastes a clip (from the system clipboard text, else the last copy) as a floating piece. */
  paste(text?: string): void {
    const clip = (text ? parseClip(text) : null) ?? this.clip;
    const object = this.editor.activeObject.get();
    if (!clip || !object) {
      this.editor.toast('Clipboard is empty');
      return;
    }
    if (isLocked(object)) return;
    const volume = remapClip(clip, this.editor.doc.palette);
    const tools = this.editor.tools;
    tools.setTool('move');
    const move = tools.tool;
    if (move instanceof MoveTool) move.carry(tools, floatingPiece(object, volume, true, 'Paste'));
    this.editor.toast('Pasted: move it into place and press Enter');
  }

  /** A floating copy of the selection, ready to be dragged away. */
  duplicate(): void {
    const object = this.editor.activeObject.get();
    if (!object || isLocked(object) || object.volume.isEmpty) return;
    const tools = this.editor.tools;
    tools.setTool('move');
    const move = tools.tool;
    if (move instanceof MoveTool) move.carry(tools, liftSelection(object, true));
  }

  /** Native clipboard events: they give access to the system clipboard without a permission. */
  attach(target: Window): () => void {
    const copy = (e: ClipboardEvent, cut: boolean) => {
      if (isTypingTarget(e.target)) return;
      this.events++;
      e.preventDefault();
      const text = cut ? this.cut() : this.copy();
      if (text) e.clipboardData?.setData('text/plain', text);
    };
    const onCopy = (e: ClipboardEvent) => copy(e, false);
    const onCut = (e: ClipboardEvent) => copy(e, true);
    const onPaste = (e: ClipboardEvent) => {
      if (isTypingTarget(e.target)) return;
      this.events++;
      e.preventDefault();
      this.paste(e.clipboardData?.getData('text/plain'));
    };
    target.addEventListener('copy', onCopy);
    target.addEventListener('cut', onCut);
    target.addEventListener('paste', onPaste);
    return () => {
      target.removeEventListener('copy', onCopy);
      target.removeEventListener('cut', onCut);
      target.removeEventListener('paste', onPaste);
    };
  }
}

export function clipboardActions(editor: Editor): Action[] {
  const clipboard = editor.clipboard;
  const hasObject = () => editor.activeObject.get() !== null;
  const inScene = () => editor.mode.get() === 'scene';
  const hasSelection = () => editor.activeObject.get()?.selection.isEmpty === false;
  return [
    {
      id: 'edit.copy',
      title: 'Copy',
      group: 'Edit',
      keys: ['Ctrl+KeyC'],
      native: true,
      run: () => {
        const text = clipboard.copy();
        if (text) navigator.clipboard?.writeText(text).catch(() => {});
      },
      enabled: hasObject,
    },
    {
      id: 'edit.cut',
      title: 'Cut',
      group: 'Edit',
      keys: ['Ctrl+KeyX'],
      native: true,
      run: () => {
        const text = clipboard.cut();
        if (text) navigator.clipboard?.writeText(text).catch(() => {});
      },
      enabled: hasSelection,
    },
    {
      id: 'edit.paste',
      title: 'Paste',
      group: 'Edit',
      keys: ['Ctrl+KeyV'],
      native: true,
      run: () => clipboard.paste(),
      enabled: () => clipboard.hasClip,
    },
    {
      id: 'edit.delete',
      title: 'Delete selection',
      group: 'Edit',
      keys: ['Delete', 'Backspace'],
      // Scene mode deletes the selected objects, model mode the selected voxels.
      run: () =>
        inScene()
          ? removeNodes(editor.doc, editor.sceneTargets())
          : clipboard.eraseSelected('Delete'),
      enabled: () => (inScene() ? editor.sceneTargets().length > 0 : hasSelection()),
    },
    {
      id: 'edit.duplicate',
      title: 'Duplicate selection',
      group: 'Edit',
      keys: ['Ctrl+KeyJ'],
      run: () =>
        inScene()
          ? editor.selectNodes(duplicateNodes(editor.doc, editor.sceneTargets()))
          : clipboard.duplicate(),
      enabled: () => (inScene() ? editor.sceneTargets().length > 0 : hasObject()),
    },
  ];
}
