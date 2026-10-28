import { type AnimationSettings, DEFAULT_ANIMATION } from './animation';
import { type CameraView, emptyCameraSlots } from './cameras';
import { History } from './history';
import { Palette } from './palette';
import { Scene, type VoxelObject } from './scene';

/** What changed in a document since the previous flush. */
export interface DocumentChanges {
  /** Stale chunk meshes per object; a key may point to a chunk that no longer exists. */
  readonly voxels: ReadonlyMap<VoxelObject, readonly number[]>;
  readonly palette: boolean;
  /** Structure, transforms, names, visibility of scene nodes. */
  readonly scene: boolean;
  /** Objects whose selection changed. */
  readonly selection: ReadonlySet<VoxelObject>;
  readonly history: boolean;
}

export type DocumentTopic = 'palette' | 'scene' | 'history';

export type DocumentListener = (changes: DocumentChanges) => void;

/**
 * An open document: scene, palette, history and, later, selection. Lives in the main thread and
 * changes only through `history.execute(command)`.
 *
 * Changes are not announced one by one. Writers mark what changed; `flush` — called once at the
 * start of a frame — collects everything into one `DocumentChanges` and hands it to listeners,
 * so a stroke of a hundred points causes one panel update, not a hundred.
 */
export class VoxelDocument {
  readonly scene: Scene;
  readonly palette: Palette;
  readonly history: History;
  /** The frame shown, the playback range and speed (core/animation.ts). */
  readonly animation: AnimationSettings = { ...DEFAULT_ANIMATION };
  /** Saved views, ten slots (core/cameras.ts). */
  readonly cameras: (CameraView | null)[] = emptyCameraSlots();

  private readonly listeners = new Set<DocumentListener>();
  private readonly topics = new Set<DocumentTopic>();
  private readonly selectionChanged = new Set<VoxelObject>();
  /** Called when something is marked as changed: the editor schedules a frame to flush it. */
  private wake: (() => void) | null = null;

  constructor(scene = new Scene(), palette = Palette.createDefault()) {
    this.scene = scene;
    this.palette = palette;
    this.history = new History(this);
  }

  /** A new document with one empty object. */
  static createEmpty(): VoxelDocument {
    const doc = new VoxelDocument();
    doc.scene.attach(doc.scene.createObject('Object 1'), doc.scene.root);
    return doc;
  }

  subscribe(listener: DocumentListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Sets the callback that schedules the next flush. */
  onPending(wake: (() => void) | null): void {
    this.wake = wake;
  }

  /** Marks a topic as changed; listeners hear about it on the next flush. */
  notify(topic: DocumentTopic): void {
    this.topics.add(topic);
    this.wake?.();
  }

  notifySelection(object: VoxelObject): void {
    this.selectionChanged.add(object);
    this.wake?.();
  }

  /** True when a flush would report something. */
  get hasPendingChanges(): boolean {
    if (this.topics.size > 0 || this.selectionChanged.size > 0) return true;
    return this.scene.objects().some((o) => o.volume.hasMeshDirty);
  }

  /**
   * Collects changes since the previous flush and passes them to every listener.
   * Returns the changes, or null when nothing changed.
   */
  flush(): DocumentChanges | null {
    const voxels = new Map<VoxelObject, number[]>();
    for (const object of this.scene.objects()) {
      if (object.volume.hasMeshDirty) voxels.set(object, object.volume.takeMeshDirty());
    }
    if (voxels.size === 0 && this.topics.size === 0 && this.selectionChanged.size === 0) {
      return null;
    }
    const changes: DocumentChanges = {
      voxels,
      palette: this.topics.has('palette'),
      scene: this.topics.has('scene'),
      selection: new Set(this.selectionChanged),
      history: this.topics.has('history'),
    };
    this.topics.clear();
    this.selectionChanged.clear();
    for (const listener of [...this.listeners]) listener(changes);
    return changes;
  }
}
