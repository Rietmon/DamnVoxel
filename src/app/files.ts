import { VoxelDocument } from '../core/document';
import { isHidden, isInside } from '../core/scene';
import { FormatError } from '../formats/binary';
import { readVox } from '../io/vox-read';
import { writeVox } from '../io/vox-write';
import type { Action } from './actions';
import type { Editor } from './editor';

/**
 * The parts of the File System Access API the editor uses. Chromium browsers have it; others
 * get the fallback: a file input to open and a download to save.
 */
interface FileHandle {
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
}
interface PickerOptions {
  types?: { description: string; accept: Record<string, string[]> }[];
  suggestedName?: string;
  excludeAcceptAllOption?: boolean;
}
interface FilePickers {
  showOpenFilePicker?(options?: PickerOptions): Promise<FileHandle[]>;
  showSaveFilePicker?(options?: PickerOptions): Promise<FileHandle>;
}

const VOX_TYPES = [
  { description: 'MagicaVoxel model', accept: { 'application/octet-stream': ['.vox'] } },
];
const UNTITLED = 'Untitled';

/** «house.vox» → «house». */
export function documentName(fileName: string): string {
  return fileName.replace(/\.vox$/i, '') || UNTITLED;
}

/** A file name for a document: its name with the extension, characters files cannot have removed. */
export function fileNameFor(name: string): string {
  const clean = name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'model';
  return /\.vox$/i.test(clean) ? clean : `${clean}.vox`;
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

/**
 * New, open, save and save as. A new or opened document gets its own tab, so nothing open is
 * dropped; closing a tab with unsaved work asks first. Saving goes back into the opened file
 * where the browser allows it, otherwise downloads a copy.
 */
/** Hands a file to the browser's downloads (no picker: it may be long after the click). */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export class FileService {
  private readonly pickers: FilePickers;

  constructor(private readonly editor: Editor) {
    this.pickers = typeof window === 'undefined' ? {} : (window as unknown as FilePickers);
  }

  /** The file the shown document came from or was last saved to (each tab has its own). */
  private get handle(): FileHandle | null {
    return this.editor.file as FileHandle | null;
  }

  private set handle(handle: FileHandle | null) {
    this.editor.file = handle;
  }

  newDocument(): void {
    this.editor.open(VoxelDocument.createEmpty(), UNTITLED, true);
  }

  async open(): Promise<void> {
    const pick = this.pickers.showOpenFilePicker;
    if (!pick) {
      this.openWithInput();
      return;
    }
    try {
      const [handle] = await pick.call(window, { types: VOX_TYPES, excludeAcceptAllOption: false });
      if (!handle) return;
      if (await this.openFile(await handle.getFile())) this.handle = handle;
    } catch (e) {
      if (!isAbort(e)) this.editor.toast('Could not open the file');
    }
  }

  /**
   * Opens a file from a picker, an input or a drop; true when the document is that file. A
   * damaged file opens as much as can be read, as a new unsaved document: the file stays as it
   * was until the person saves somewhere.
   */
  async openFile(file: File): Promise<boolean> {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      this.editor.toast(`Could not read “${file.name}”`);
      return false;
    }
    try {
      const doc = readVox(bytes);
      this.editor.open(doc, documentName(file.name));
      this.editor.toast(`Opened “${file.name}”`);
      return true;
    } catch (e) {
      if (!(e instanceof FormatError)) {
        this.editor.toast(`Could not read “${file.name}”`);
        return false;
      }
    }
    const { salvageVox } = await import('../io/vox-salvage');
    const saved = salvageVox(bytes);
    if (!saved) {
      this.editor.toast(`“${file.name}” is not a .vox file, or no model in it survived`);
      return false;
    }
    const { doc, report } = saved;
    this.editor.open(doc, `${documentName(file.name)} (recovered)`);
    this.editor.markUnsaved();
    const lost = report.problems.slice(0, 2).join('; ');
    this.editor.toast(
      `The file is damaged. Recovered models: ${report.models}, voxels: ${report.voxels}. ${lost}`,
    );
    return false;
  }

  async save(): Promise<void> {
    if (!this.handle) {
      await this.saveAs();
      return;
    }
    try {
      await this.writeTo(this.handle);
    } catch (e) {
      if (!isAbort(e)) this.editor.toast('Could not save: the file is not available');
    }
  }

  async saveAs(): Promise<void> {
    const name = fileNameFor(this.editor.docName.get());
    const pick = this.pickers.showSaveFilePicker;
    if (!pick) {
      this.download(name);
      return;
    }
    try {
      const handle = await pick.call(window, { types: VOX_TYPES, suggestedName: name });
      await this.writeTo(handle);
      this.handle = handle;
    } catch (e) {
      if (!isAbort(e)) this.editor.toast('Could not save the file');
    }
  }

  private async writeTo(handle: FileHandle): Promise<void> {
    const bytes = writeVox(this.editor.doc);
    const writable = await handle.createWritable();
    await writable.write(new Blob([bytes as BlobPart]));
    await writable.close();
    this.saved(handle.name);
  }

  /** Without file handles: the browser downloads a copy. */
  private download(name: string): void {
    downloadBlob(new Blob([writeVox(this.editor.doc) as BlobPart]), name);
    this.saved(name);
  }

  private saved(fileName: string): void {
    this.editor.docName.set(documentName(fileName));
    this.editor.markSaved();
    this.editor.toast(`Saved: ${fileName}`);
    void this.editor.rememberVersion('save');
  }

  private openWithInput(): void {
    const input = document.createElement('input');
    input.type = 'file';
    // iOS greys out files of an unknown type: let it show everything there.
    if (!/iPhone|iPad/.test(navigator.userAgent)) input.accept = '.vox';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) void this.openFile(file);
    };
    input.click();
  }

  /**
   * Exports meshes with the export settings: the visible objects, or the selected ones. One
   * file downloads as it is; several (a file per object, OBJ with its MTL and PNG) as a ZIP.
   */
  async exportMesh(): Promise<void> {
    const editor = this.editor;
    const s = editor.exportSettings.get();
    const visible = editor.doc.scene.objects().filter((o) => !isHidden(o));
    const targets = editor.sceneTargets();
    const objects = s.selectedOnly
      ? visible.filter((o) => targets.some((t) => t === o || isInside(o, t)))
      : visible;
    if (objects.length === 0) {
      editor.toast(s.selectedOnly ? 'Nothing selected' : 'The scene is empty');
      return;
    }
    const name = editor.docName.get();
    // The writers load with the first export.
    const [{ exportMeshes }, { zip }] = await Promise.all([
      import('./export'),
      import('../formats/zip'),
    ]);
    const { files, quads } = exportMeshes(editor.doc, objects, name, s);
    if (files.length === 0) {
      editor.toast('The selection has no voxels');
      return;
    }
    const one = files.length === 1 ? files[0]! : null;
    const file = one ?? { name: `${name}.zip`, data: zip(files) };
    downloadBlob(new Blob([file.data as BlobPart]), file.name);
    editor.toast(`Export: ${file.name} — ${quads.toLocaleString('en-US')} faces`);
    editor.exportOpen.set(false);
  }

  /** Asks for pictures and adds them as references. */
  pickReference(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = () => {
      for (const file of input.files ?? []) void this.editor.addReference(file);
    };
    input.click();
  }

  /** A .vox dropped anywhere on the window opens; a picture becomes a reference. */
  attach(target: Window): () => void {
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length === 0) return;
      e.preventDefault();
      // A mesh with its companions (.bin, .mtl, textures) goes to voxelizing as a whole.
      if (files.some((f) => /\.(glb|gltf|obj|stl)$/i.test(f.name))) {
        this.editor.meshImportFiles.set(files);
        return;
      }
      // Pictures become references; a .vox opens.
      for (const file of files) {
        if (file.type.startsWith('image/')) void this.editor.addReference(file);
        else void this.openFile(file);
      }
    };
    target.addEventListener('dragover', over);
    target.addEventListener('drop', drop);
    return () => {
      target.removeEventListener('dragover', over);
      target.removeEventListener('drop', drop);
    };
  }
}

export function fileActions(editor: Editor): Action[] {
  const files = editor.files;
  return [
    {
      id: 'file.new',
      title: 'New document',
      group: 'File',
      keys: ['Ctrl+Alt+KeyN'],
      run: () => files.newDocument(),
    },
    {
      id: 'file.addReference',
      title: 'Add reference picture…',
      group: 'File',
      run: () => files.pickReference(),
    },
    {
      id: 'file.closeTab',
      title: 'Close tab',
      group: 'File',
      keys: ['Ctrl+Alt+KeyW'],
      run: () => editor.closeTab(),
    },
    {
      id: 'file.nextTab',
      title: 'Next tab',
      group: 'File',
      keys: ['Alt+PageDown'],
      run: () => editor.stepTab(1),
      enabled: () => editor.tabs.get().length > 1,
    },
    {
      id: 'file.previousTab',
      title: 'Previous tab',
      group: 'File',
      keys: ['Alt+PageUp'],
      run: () => editor.stepTab(-1),
      enabled: () => editor.tabs.get().length > 1,
    },
    {
      id: 'file.open',
      title: 'Open…',
      group: 'File',
      keys: ['Ctrl+KeyO'],
      run: () => void files.open(),
    },
    {
      id: 'file.save',
      title: 'Save',
      group: 'File',
      keys: ['Ctrl+KeyS'],
      run: () => void files.save(),
    },
    {
      id: 'file.export',
      title: 'Export mesh (glTF, OBJ, PLY, STL)…',
      group: 'File',
      keys: ['Ctrl+KeyE'],
      run: () => editor.exportOpen.set(true),
    },
    {
      id: 'file.examples',
      title: 'Examples…',
      group: 'File',
      run: () => editor.examplesOpen.set(true),
    },
    {
      id: 'file.help',
      title: 'Help',
      group: 'File',
      run: () => window.open('guide/index.html', '_blank', 'noopener'),
    },
    {
      id: 'file.importMesh',
      title: 'Voxelize mesh (glTF, OBJ, STL)…',
      group: 'File',
      run: () => editor.meshImportFiles.set([]),
    },
    {
      id: 'file.importPicture',
      title: 'Picture to voxels: plane, height map, slice sheet…',
      group: 'File',
      run: () => editor.picturesOpen.set('import'),
    },
    {
      id: 'file.exportSlices',
      title: 'Export PNG slices…',
      group: 'File',
      run: () => editor.picturesOpen.set('slices'),
    },
    {
      id: 'file.versions',
      title: 'Version history…',
      group: 'File',
      run: () => editor.versionsOpen.set(true),
    },
    {
      id: 'file.rememberVersion',
      title: 'Remember version',
      group: 'File',
      run: () => void editor.rememberVersion('manual'),
    },
    {
      id: 'file.saveAs',
      title: 'Save as…',
      group: 'File',
      keys: ['Ctrl+Shift+KeyS'],
      run: () => void files.saveAs(),
    },
  ];
}
