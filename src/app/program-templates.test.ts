import { describe, expect, it } from 'vitest';
import { runProgram } from '../kernels/program';
import { PROGRAM_TEMPLATES } from './program-templates';

const PALETTE = new Uint32Array(255).map((_, i) => (0xff000000 | (i * 0x010101)) >>> 0);

describe('program templates', () => {
  it('all run without errors and make voxels', () => {
    for (const t of PROGRAM_TEMPLATES) {
      const r = runProgram({ source: t.source, params: {}, palette: PALETTE });
      expect(r.error, t.id).toBeNull();
      expect(r.colors.length, t.id).toBeGreaterThan(10);
    }
  });
});
