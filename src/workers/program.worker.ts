import { type ProgramInput, runProgram } from '../kernels/program';

/** Shape programs off the main thread; the editor ends this worker when one runs too long. */
self.onmessage = (event: MessageEvent<{ id: number; input: ProgramInput }>) => {
  const { id, input } = event.data;
  const result = runProgram(input);
  self.postMessage({ id, result }, { transfer: [result.positions.buffer, result.colors.buffer] });
};
