/** Messages between the main thread and the mesh worker. */

export interface MeshRequest {
  id: number;
  /** Padded chunk (see kernels/mesher); transferred and sent back for reuse. */
  padded: Uint16Array;
}

export interface MeshResponse {
  id: number;
  /** Exactly `quads` quads of packed vertices. */
  vertices: Uint32Array;
  quads: number;
  padded: Uint16Array;
}
