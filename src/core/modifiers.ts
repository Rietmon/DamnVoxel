import type { Operation } from './operation';

/**
 * A modifier turns an operation into another one before it is executed or previewed: mirror
 * copies it across planes, a selection mask clips it. Modifiers know nothing about tools and
 * tools nothing about modifiers, so every tool gets every modifier (docs/architecture.md,
 * "Modifiers").
 */
export type Modifier = (op: Operation) => Operation;

/** Runs an operation through modifiers in order. */
export function applyModifiers(op: Operation, modifiers: readonly Modifier[]): Operation {
  let result = op;
  for (const modifier of modifiers) result = modifier(result);
  return result;
}
