export type WebGL2Support =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'failed'; detail: string };

/**
 * Checks that a WebGL2 context can be created. Distinguishes a browser without WebGL2 from a
 * browser that has it but refused to create a context (blocked driver, hardware acceleration off).
 */
export function checkWebGL2(): WebGL2Support {
  if (typeof WebGL2RenderingContext === 'undefined') {
    return { ok: false, reason: 'missing', detail: 'WebGL2RenderingContext is not defined' };
  }
  const canvas = document.createElement('canvas');
  let detail = '';
  canvas.addEventListener(
    'webglcontextcreationerror',
    (e) => {
      detail = (e as WebGLContextEvent).statusMessage;
    },
    { once: true },
  );
  const gl = canvas.getContext('webgl2');
  if (!gl) {
    return { ok: false, reason: 'failed', detail: detail || 'getContext("webgl2") returned null' };
  }
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return { ok: true };
}
