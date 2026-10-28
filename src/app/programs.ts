import type { VoxelDocument } from '../core/document';
import type { Command } from '../core/history';
import type { ObjectProgram, VoxelObject } from '../core/scene';
import { VoxelVolume } from '../core/volume';
import type { ProgramResult } from '../kernels/program';

/**
 * Objects built by programs (docs/programs.md): what each was made from — code, or a node graph
 * compiled to code — and the parameter values set in the panel. The object keeps its voxels like
 * any other; the program builds them again when it or a parameter changes.
 */

/** The program as written (or as its node graph compiled it), its parameters and graph. */
export type ProgramSpec = ObjectProgram;

/** What each program object was made from: kept on the object, so files and copies carry it. */
export const programSpecs = {
  get: (o: VoxelObject): ProgramSpec | undefined => o.program,
  set: (o: VoxelObject, spec: ProgramSpec): void => {
    o.program = spec;
  },
  has: (o: VoxelObject): boolean => o.program !== undefined,
};

/** A program's voxels as a volume of the object, moved by the program's offset among its cells. */
export function resultVolume(
  result: ProgramResult,
  offset: readonly [number, number, number] = [0, 0, 0],
): VoxelVolume {
  const v = new VoxelVolume();
  const p = result.positions;
  const [ox, oy, oz] = offset;
  for (let i = 0; i < result.colors.length; i++)
    v.set(p[i * 3]! + ox, p[i * 3 + 1]! + oy, p[i * 3 + 2]! + oz, result.colors[i]!);
  v.takeMeshDirty();
  return v;
}

/** The palette as the program engine takes it: 255 packed colours, id 1 first. */
export function programPalette(doc: VoxelDocument): Uint32Array {
  const out = new Uint32Array(255);
  for (let id = 1; id <= 255; id++) out[id - 1] = doc.palette.color(id);
  return out;
}

/**
 * Swaps a program object's voxels and program: one step, merging while the program is typed
 * or a parameter is dragged.
 */
export class ProgramCommand implements Command {
  readonly label = 'Program';
  readonly bytes: number;

  constructor(
    private readonly object: VoxelObject,
    private readonly before: { volume: VoxelVolume; spec: ProgramSpec },
    private after: { volume: VoxelVolume; spec: ProgramSpec },
  ) {
    this.bytes = 256 + after.spec.source.length * 2 + after.volume.voxelCount * 4;
  }

  apply(doc: VoxelDocument): void {
    this.put(doc, this.after);
  }

  revert(doc: VoxelDocument): void {
    this.put(doc, this.before);
  }

  merge(next: Command): boolean {
    if (!(next instanceof ProgramCommand) || next.object !== this.object) return false;
    this.after = next.after;
    return true;
  }

  private put(doc: VoxelDocument, state: { volume: VoxelVolume; spec: ProgramSpec }): void {
    (this.object as { volume: VoxelVolume }).volume = state.volume;
    programSpecs.set(this.object, state.spec);
    doc.notify('scene');
  }
}
