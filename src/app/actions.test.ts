import { describe, expect, it } from 'vitest';
import { ActionRegistry } from './actions';

describe('ActionRegistry', () => {
  it('runs enabled actions only and finds them by shortcut', () => {
    const registry = new ActionRegistry();
    let count = 0;
    let enabled = false;
    registry.register(
      { id: 'a', title: 'A', group: 'G', keys: ['Ctrl+KeyA'], run: () => count++ },
      { id: 'b', title: 'B', group: 'G', run: () => count++, enabled: () => enabled },
    );
    expect(registry.run('a')).toBe(true);
    expect(registry.run('b')).toBe(false);
    enabled = true;
    expect(registry.run('b')).toBe(true);
    expect(registry.run('missing')).toBe(false);
    expect(count).toBe(2);
    expect(registry.hotkeys.lookup('Ctrl+KeyA')).toBe('a');
    expect(registry.shortcut('a')).toBe('Ctrl+A');
    expect(registry.shortcut('b')).toBeNull();
    expect(registry.all().map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('refuses duplicate ids', () => {
    const registry = new ActionRegistry();
    registry.register({ id: 'a', title: 'A', group: 'G', run: () => {} });
    expect(() => registry.register({ id: 'a', title: 'A2', group: 'G', run: () => {} })).toThrow();
  });
});
