import { describe, expect, it } from 'vitest';
import { TabList } from './doc-tabs';

const tab = (id: number) => ({ id });
const ids = (list: TabList<{ id: number }>) => list.all.map((t) => t.id);

describe('TabList', () => {
  it('adds after the current tab and shows the new one', () => {
    const list = new TabList(tab(1));
    list.add(tab(2));
    list.select(1);
    list.add(tab(3));
    expect(ids(list)).toEqual([1, 3, 2]);
    expect(list.current.id).toBe(3);
  });

  it('replaces the current tab in place', () => {
    const list = new TabList(tab(1));
    list.add(tab(2));
    list.select(1);
    list.replaceCurrent(tab(5));
    expect(ids(list)).toEqual([5, 2]);
    expect(list.current.id).toBe(5);
  });

  it('shows a neighbour when the shown tab closes and keeps the last one', () => {
    const list = new TabList(tab(1));
    list.add(tab(2));
    list.add(tab(3));
    list.select(2);
    expect(list.remove(2)).toBe(true);
    expect(list.current.id).toBe(3);
    expect(list.remove(3)).toBe(true);
    expect(list.current.id).toBe(1);
    expect(list.remove(1)).toBe(false);
    expect(list.remove(9)).toBe(false);
  });

  it('closing a hidden tab keeps the shown one', () => {
    const list = new TabList(tab(1));
    list.add(tab(2));
    list.remove(1);
    expect(list.current.id).toBe(2);
  });

  it('steps through tabs around the ends and reorders', () => {
    const list = new TabList(tab(1));
    list.add(tab(2));
    list.add(tab(3));
    expect(list.neighbour(1).id).toBe(1);
    expect(list.neighbour(-1).id).toBe(2);
    list.move(3, 0);
    expect(ids(list)).toEqual([3, 1, 2]);
    expect(list.select(7)).toBe(false);
  });
});
