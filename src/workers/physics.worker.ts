import { type SimInput, simulate } from '../kernels/verlet';

/** Physics worker: a particle system in, settled positions out (transferred back). */
self.onmessage = (event: MessageEvent<{ id: number; input: SimInput }>) => {
  const { id, input } = event.data;
  const positions = simulate(input);
  self.postMessage({ id, positions }, { transfer: [positions.buffer] });
};
