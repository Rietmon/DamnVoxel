import { describe, expect, it } from 'vitest';
import { ActionRegistry } from './actions';
import {
  clampCentre,
  RADIAL_EXTENT,
  RADIAL_ITEMS,
  radialIndex,
  radialOffset,
  runRadialItem,
} from './radial';

describe('radial menu', () => {
  it('picks the item a direction points at, clockwise from the top', () => {
    expect(radialIndex(0, -50, 8)).toBe(0);
    expect(radialIndex(50, 0, 8)).toBe(2);
    expect(radialIndex(0, 50, 8)).toBe(4);
    expect(radialIndex(-50, 0, 8)).toBe(6);
    expect(radialIndex(-40, -40, 8)).toBe(7);
    // Slices are centred on their items: just past the half-way line is the next one.
    expect(radialIndex(Math.sin(0.4) * 50, -Math.cos(0.4) * 50, 8)).toBe(1);
    expect(radialIndex(Math.sin(0.38) * 50, -Math.cos(0.38) * 50, 8)).toBe(0);
  });

  it('points at nothing near the centre', () => {
    expect(radialIndex(5, 5, 8)).toBe(-1);
    expect(radialIndex(0, -30, 0)).toBe(-1);
  });

  it('places every item where radialIndex finds it', () => {
    const n = RADIAL_ITEMS.length;
    for (let i = 0; i < n; i++) {
      const [x, y] = radialOffset(i, n);
      expect(radialIndex(x, y, n)).toBe(i);
    }
  });

  it('keeps the ring on screen', () => {
    expect(clampCentre(5, 5, 1000, 800)).toEqual([RADIAL_EXTENT, RADIAL_EXTENT]);
    expect(clampCentre(990, 400, 1000, 800)).toEqual([1000 - RADIAL_EXTENT, 400]);
    expect(clampCentre(10, 10, 200, 800)).toEqual([100, RADIAL_EXTENT]);
  });

  it('runs actions and takes the remembered tool of a family', () => {
    const ran: string[] = [];
    const actions = new ActionRegistry();
    for (const id of ['edit.undo', 'tool.brush', 'tool.sphere', 'tool.box'])
      actions.register({ id, title: id, group: 'g', run: () => ran.push(id) });
    const item = (id: string) => RADIAL_ITEMS.find((i) => i.id === id)!;
    runRadialItem(item('edit.undo'), actions, {});
    runRadialItem(item('family:shape'), actions, { shape: 'sphere' });
    runRadialItem(item('family:shape'), actions, {});
    runRadialItem(item('family:brush'), actions, {});
    expect(ran).toEqual(['edit.undo', 'tool.sphere', 'tool.box', 'tool.brush']);
  });
});
