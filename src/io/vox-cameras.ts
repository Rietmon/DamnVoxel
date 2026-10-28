import { CAMERA_SLOTS, type CameraView, sameCameraView } from '../core/cameras';
import type { VoxelDocument } from '../core/document';
import type { VoxChunk, VoxDict } from '../formats/vox-chunks';
import { vectorFromVox, vectorToVox } from './vox-axes';

/**
 * Camera slots ↔ rCAM chunks. MagicaVoxel keeps ten cameras in the file as dictionaries:
 * `_mode` (pers, orth, iso, free…), `_focus` (the point it looks at, file axes), `_angle`
 * (pitch, yaw, roll in degrees), `_radius` (distance), `_fov` and `_frustum` (tan of half the
 * fov). The editor reads what it understands and writes a chunk back untouched while its slot
 * is unchanged, so a file keeps its cameras byte for byte; a changed slot keeps the keys the
 * editor does not know. The angle convention is the best reading of real files and still has
 * to be checked against MagicaVoxel by hand (docs/formats.md).
 */

type CameraChunk = Extract<VoxChunk, { id: 'rCAM' }>;

/** What each rCAM chunk was read as, to tell an untouched slot from an edited one. */
const readViews = new WeakMap<CameraChunk, CameraView>();

const DEG = Math.PI / 180;

function numbers(text: string | undefined, count: number): number[] | null {
  if (text === undefined) return null;
  const parts = text.trim().split(/\s+/).map(Number);
  return parts.length >= count && parts.slice(0, count).every(Number.isFinite) ? parts : null;
}

/** A camera chunk as a view, or null when it lacks what a view needs. */
export function viewFromDict(attrs: VoxDict): CameraView | null {
  const focus = numbers(attrs.get('_focus'), 3);
  const angle = numbers(attrs.get('_angle'), 2);
  const radius = Number(attrs.get('_radius'));
  if (!focus || !angle || !Number.isFinite(radius) || radius <= 0) return null;
  const fov = Number(attrs.get('_fov'));
  const mode = attrs.get('_mode');
  return {
    target: vectorFromVox(focus),
    pitch: angle[0]! * DEG,
    yaw: angle[1]! * DEG,
    distance: radius,
    projection: mode === 'orth' || mode === 'iso' ? 'orthographic' : 'perspective',
    fov: Number.isFinite(fov) && fov > 0 ? fov : 45,
  };
}

const num = (v: number) => String(Math.round(v * 1e4) / 1e4);

/** A view written into a dictionary: the known keys replaced, the others kept. */
export function dictFromView(view: CameraView, base: VoxDict = new Map()): VoxDict {
  const dict = new Map(base);
  const mode = dict.get('_mode');
  const ortho = view.projection === 'orthographic';
  // An isometric camera stays one while it is orthographic.
  dict.set('_mode', ortho ? (mode === 'iso' ? 'iso' : 'orth') : 'pers');
  dict.set('_focus', vectorToVox(view.target).map(num).join(' '));
  dict.set('_angle', [view.pitch / DEG, view.yaw / DEG, 0].map(num).join(' '));
  dict.set('_radius', num(view.distance));
  dict.set('_frustum', num(Math.tan((view.fov * DEG) / 2)));
  dict.set('_fov', num(view.fov));
  return dict;
}

/** Fills the document's slots from the rCAM chunks of a file. */
export function readCameras(doc: VoxelDocument, kept: readonly VoxChunk[]): void {
  for (const c of kept) {
    if (c.id !== 'rCAM' || !('cameraId' in c)) continue;
    if (c.cameraId < 0 || c.cameraId >= CAMERA_SLOTS) continue;
    const view = viewFromDict(c.attrs);
    if (!view) continue;
    readViews.set(c, view);
    doc.cameras[c.cameraId] = view;
  }
}

/**
 * The kept chunks with cameras brought up to date: an untouched slot's chunk as it was, an
 * edited one rewritten, a cleared one dropped, new slots added at the end.
 */
export function writeCameras(doc: VoxelDocument, kept: readonly VoxChunk[]): VoxChunk[] {
  const out: VoxChunk[] = [];
  const written = new Set<number>();
  for (const c of kept) {
    if (c.id !== 'rCAM' || !('cameraId' in c) || c.cameraId < 0 || c.cameraId >= CAMERA_SLOTS) {
      out.push(c);
      continue;
    }
    const read = readViews.get(c) ?? null;
    const now = doc.cameras[c.cameraId] ?? null;
    written.add(c.cameraId);
    // A chunk the editor could not read stays as it was while its slot is still empty.
    if (sameCameraView(read, now)) out.push(c);
    else if (now) out.push({ id: 'rCAM', cameraId: c.cameraId, attrs: dictFromView(now, c.attrs) });
  }
  doc.cameras.forEach((view, slot) => {
    if (view && !written.has(slot))
      out.push({ id: 'rCAM', cameraId: slot, attrs: dictFromView(view) });
  });
  return out;
}
