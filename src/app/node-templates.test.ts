import { describe, expect, it } from 'vitest';
import { compileGraph } from '../core/node-graph';
import { runProgram } from '../kernels/program';
import { NODE_TEMPLATES } from './node-templates';

const PALETTE = new Uint32Array(255).map((_, i) => (0xff000000 | (i * 0x010101)) >>> 0);

describe('node templates', () => {
  it('compile and build', () => {
    for (const t of NODE_TEMPLATES) {
      const g = t.graph();
      const { source, errors } = compileGraph(g);
      expect(errors, t.id).toEqual([]);
      // Every wire went in: one per input that has one.
      const r = runProgram({ source, params: {}, palette: PALETTE });
      expect(r.error, t.id).toBeNull();
      expect(r.colors.length, t.id).toBeGreaterThan(50);
    }
  });
});
