import { meshChunk, meshScratch, QUAD_WORDS } from '../kernels/mesher';
import type { MeshRequest, MeshResponse } from './mesh-protocol';

/** Mesh worker: padded chunk in, packed vertices out, both as transferables. */
self.onmessage = (event: MessageEvent<MeshRequest>) => {
  const { id, padded } = event.data;
  const out = meshScratch();
  const quads = meshChunk(padded, out);
  const vertices = out.slice(0, quads * QUAD_WORDS);
  const response: MeshResponse = { id, vertices, quads, padded };
  self.postMessage(response, { transfer: [vertices.buffer, padded.buffer] });
};
