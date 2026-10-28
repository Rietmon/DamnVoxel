/**
 * The open documents as tabs: the order,
 * which one is shown, and where to go when one closes. The editor keeps what each tab needs to
 * come back as it was (camera, mode, file); this only keeps the list straight.
 */
export class TabList<T extends { readonly id: number }> {
  private items: T[];
  private currentId: number;

  constructor(first: T) {
    this.items = [first];
    this.currentId = first.id;
  }

  get all(): readonly T[] {
    return this.items;
  }

  get current(): T {
    return this.items.find((t) => t.id === this.currentId)!;
  }

  get(id: number): T | undefined {
    return this.items.find((t) => t.id === id);
  }

  /** Adds a tab after the current one and shows it. */
  add(tab: T): void {
    const at = this.items.findIndex((t) => t.id === this.currentId);
    this.items.splice(at + 1, 0, tab);
    this.currentId = tab.id;
  }

  /** Puts a tab in place of the current one (an untouched empty document gives way to a file). */
  replaceCurrent(tab: T): void {
    const at = this.items.findIndex((t) => t.id === this.currentId);
    this.items[at] = tab;
    this.currentId = tab.id;
  }

  select(id: number): boolean {
    if (!this.get(id)) return false;
    this.currentId = id;
    return true;
  }

  /** The tab `step` places away from the current one, wrapping around. */
  neighbour(step: number): T {
    const n = this.items.length;
    const at = this.items.findIndex((t) => t.id === this.currentId);
    return this.items[(((at + step) % n) + n) % n]!;
  }

  /**
   * Removes a tab. Closing the shown one shows its right neighbour (or the left one at the end).
   * Returns false for the last tab: there is always one.
   */
  remove(id: number): boolean {
    if (this.items.length === 1) return false;
    const at = this.items.findIndex((t) => t.id === id);
    if (at < 0) return false;
    this.items.splice(at, 1);
    if (id === this.currentId) this.currentId = this.items[Math.min(at, this.items.length - 1)]!.id;
    return true;
  }

  /** Moves a tab to another place in the order. */
  move(id: number, to: number): void {
    const at = this.items.findIndex((t) => t.id === id);
    if (at < 0) return;
    const [tab] = this.items.splice(at, 1);
    this.items.splice(Math.max(0, Math.min(this.items.length, to)), 0, tab!);
  }
}
