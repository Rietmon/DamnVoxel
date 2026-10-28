import { describe, expect, it } from 'vitest';
import { Scene } from './scene';

describe('Scene', () => {
  it('lists objects depth first in tree order', () => {
    const scene = new Scene();
    const a = scene.createObject('A');
    const group = scene.createGroup('G');
    const b = scene.createObject('B');
    const c = scene.createObject('C');
    scene.attach(a, scene.root);
    scene.attach(group, scene.root);
    scene.attach(b, group);
    scene.attach(c, scene.root, 1);
    expect(scene.objects().map((o) => o.name)).toEqual(['A', 'C', 'B']);
    expect(scene.node(b.id)).toBe(b);
    expect(b.parent).toBe(group);
  });

  it('detaches nodes and reports their index so undo can put them back', () => {
    const scene = new Scene();
    const a = scene.createObject('A');
    const b = scene.createObject('B');
    scene.attach(a, scene.root);
    scene.attach(b, scene.root);
    expect(scene.detach(a)).toBe(0);
    expect(a.parent).toBeNull();
    expect(scene.objects()).toEqual([b]);
    scene.attach(a, scene.root, 0);
    expect(scene.objects()).toEqual([a, b]);
  });

  it('rejects attaching twice and detaching a detached node', () => {
    const scene = new Scene();
    const a = scene.createObject('A');
    expect(() => scene.detach(a)).toThrow();
    scene.attach(a, scene.root);
    expect(() => scene.attach(a, scene.root)).toThrow();
  });

  it('gives every node a unique id', () => {
    const scene = new Scene();
    const ids = new Set([scene.root.id]);
    for (let i = 0; i < 10; i++) {
      ids.add(scene.createObject('o').id);
      ids.add(scene.createGroup('g').id);
    }
    expect(ids.size).toBe(21);
  });
});
