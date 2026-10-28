/**
 * Minimal observable value with the Svelte store contract (`subscribe` returns an unsubscribe
 * function and calls the subscriber immediately). Lets `app` expose state to `ui` without
 * importing Svelte.
 */
export interface Readable<T> {
  subscribe(run: (value: T) => void): () => void;
  get(): T;
}

export interface Writable<T> extends Readable<T> {
  set(value: T): void;
  update(fn: (value: T) => T): void;
}

export function writable<T>(initial: T, equals: (a: T, b: T) => boolean = Object.is): Writable<T> {
  let value = initial;
  const subscribers = new Set<(value: T) => void>();
  return {
    subscribe(run) {
      subscribers.add(run);
      run(value);
      return () => subscribers.delete(run);
    },
    get: () => value,
    set(next) {
      if (equals(value, next)) return;
      value = next;
      for (const run of [...subscribers]) run(value);
    },
    update(fn) {
      this.set(fn(value));
    },
  };
}
