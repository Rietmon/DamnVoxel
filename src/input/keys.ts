import type { Modifiers } from './types';

/** True when the event comes from a place where typing is expected. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || !(target as Element).tagName) return false;
  const el = target as HTMLElement;
  return (
    el.isContentEditable ||
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT'
  );
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * Keys held right now, by `KeyboardEvent.code` (the physical key, so shortcuts work the same on
 * any keyboard layout). Space and Z turn a left drag into pan and zoom; modifiers go into every
 * tool event. Everything is released when the window loses focus.
 */
export class KeyState implements Modifiers {
  shift = false;
  ctrl = false;
  alt = false;
  private readonly held = new Set<string>();
  private readonly listeners = new Set<() => void>();

  isHeld(code: string): boolean {
    return this.held.has(code);
  }

  /** Called whenever a held key or modifier changes (tools redraw their hints and previews). */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  attach(target: Window): () => void {
    const down = (e: KeyboardEvent) => this.update(e, true);
    const up = (e: KeyboardEvent) => this.update(e, false);
    const blur = () => this.reset();
    target.addEventListener('keydown', down);
    target.addEventListener('keyup', up);
    target.addEventListener('blur', blur);
    return () => {
      target.removeEventListener('keydown', down);
      target.removeEventListener('keyup', up);
      target.removeEventListener('blur', blur);
    };
  }

  /** Takes modifier state from a pointer or wheel event, which is always current. */
  syncModifiers(e: {
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
  }): void {
    const ctrl = isMac ? e.metaKey : e.ctrlKey;
    if (this.shift === e.shiftKey && this.ctrl === ctrl && this.alt === e.altKey) return;
    this.shift = e.shiftKey;
    this.ctrl = ctrl;
    this.alt = e.altKey;
    this.emit();
  }

  modifiers(): Modifiers {
    return { shift: this.shift, ctrl: this.ctrl, alt: this.alt };
  }

  reset(): void {
    this.held.clear();
    this.shift = this.ctrl = this.alt = false;
    this.emit();
  }

  private update(e: KeyboardEvent, pressed: boolean): void {
    this.syncModifiers(e);
    if (isTypingTarget(e.target)) return;
    // Space is a camera key: it must neither scroll the page nor press the focused button.
    if (e.code === 'Space') e.preventDefault();
    const had = this.held.has(e.code);
    if (pressed) this.held.add(e.code);
    else this.held.delete(e.code);
    if (had !== pressed) this.emit();
  }

  private emit(): void {
    for (const l of [...this.listeners]) l();
  }
}
