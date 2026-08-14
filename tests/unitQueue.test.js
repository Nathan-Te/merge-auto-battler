import { describe, it, expect } from 'vitest';
import balance from '../src/config/balance.json';
import { UnitQueue } from '../src/systems/unitQueue.js';

describe('UnitQueue', () => {
  it('refuse un motif vide', () => {
    expect(() => new UnitQueue([])).toThrow();
    expect(() => new UnitQueue(undefined)).toThrow();
  });

  it('annonce le prochain type sans le consommer', () => {
    const queue = new UnitQueue(['a', 'b', 'c']);
    expect(queue.peek()).toBe('a');
    expect(queue.peek()).toBe('a');
    expect(queue.take()).toBe('a');
    expect(queue.peek()).toBe('b');
  });

  it('parcourt le motif en boucle, indéfiniment', () => {
    const queue = new UnitQueue(['a', 'b']);
    const taken = Array.from({ length: 7 }, () => queue.take());
    expect(taken).toEqual(['a', 'b', 'a', 'b', 'a', 'b', 'a']);
  });

  it('donne un aperçu des prochains types, sans avancer', () => {
    const queue = new UnitQueue(['a', 'b', 'c']);
    queue.take();
    expect(queue.preview(4)).toEqual(['b', 'c', 'a', 'b']);
    expect(queue.peek()).toBe('b');
    expect(queue.preview(0)).toEqual([]);
  });

  it('revient au départ après un reset', () => {
    const queue = new UnitQueue(['a', 'b', 'c']);
    queue.take();
    queue.take();
    queue.reset();
    expect(queue.peek()).toBe('a');
  });

  it('est déterministe : deux files sur le même motif donnent la même suite', () => {
    const a = new UnitQueue(balance.battle.unitTypePattern);
    const b = new UnitQueue(balance.battle.unitTypePattern);
    const suiteA = Array.from({ length: 25 }, () => a.take());
    const suiteB = Array.from({ length: 25 }, () => b.take());
    expect(suiteA).toEqual(suiteB);
  });

  it('ne recopie pas la référence du motif fourni', () => {
    const pattern = ['a', 'b'];
    const queue = new UnitQueue(pattern);
    pattern.push('c');
    expect(queue.preview(3)).toEqual(['a', 'b', 'a']);
  });
});
