import { describe, expect, it } from 'vitest';
import { VoxelDocument } from '../core/document';
import { startingGraph } from '../core/node-graph';
import { cloneNode } from '../core/scene-edit';
import { parseVoxFile } from '../formats/vox-chunks';
import { PROGRAM_KEY, readProgram } from './vox-program';
import { readVox } from './vox-read';
import { writeVox } from './vox-write';

describe('programs in .vox', () => {
  it('keep their code, parameters and graph through a file', () => {
    const doc = VoxelDocument.createEmpty();
    const o = doc.scene.objects()[0]!;
    o.volume.set(0, 0, 0, 3);
    o.program = {
      source: 'sphere(0, 8, 0, param("R", 4, 1, 9), 1);',
      params: { R: 6 },
      graph: startingGraph(),
    };
    const back = readVox(writeVox(doc)).scene.objects()[0]!;
    // The same program; the file moved the cells, so it also knows where its origin went.
    expect(back.program).toMatchObject(o.program!);
    expect(back.volume.voxelCount).toBe(1);
  });

  it('drop the key when the object stops being a program', () => {
    const doc = VoxelDocument.createEmpty();
    const o = doc.scene.objects()[0]!;
    o.volume.set(0, 0, 0, 3);
    o.program = { source: 'set(0, 0, 0, 1)', params: {}, graph: null };
    const read = readVox(writeVox(doc));
    delete read.scene.objects()[0]!.program;
    const file = parseVoxFile(writeVox(read));
    const keys = file.chunks.flatMap((c) =>
      c.id === 'nTRN' && 'attrs' in c ? [...c.attrs.keys()] : [],
    );
    expect(keys).not.toContain(PROGRAM_KEY);
  });

  it('go with copies, and refuse what is not a program', () => {
    const doc = VoxelDocument.createEmpty();
    const o = doc.scene.objects()[0]!;
    o.program = { source: 'set(0, 0, 0, 1)', params: { a: 1 }, graph: null };
    const copy = cloneNode(doc.scene, o);
    expect(copy.kind === 'object' && copy.program).toEqual(o.program);
    expect(copy.kind === 'object' && copy.program).not.toBe(o.program);
    expect(readProgram('{oops')).toBeNull();
    expect(readProgram('{"source": 5}')).toBeNull();
    expect(
      readProgram('{"source": "x", "params": {"a": "b", "c": 2}, "graph": 7}')?.program,
    ).toEqual({
      source: 'x',
      params: { c: 2 },
      graph: null,
    });
  });
});
