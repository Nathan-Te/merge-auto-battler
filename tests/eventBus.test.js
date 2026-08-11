import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../src/systems/eventBus.js';

describe('EventBus', () => {
  it('transmet la charge utile à tous les abonnés d’un type', () => {
    const bus = new EventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.on('merge', a);
    bus.on('merge', b);

    bus.emit('merge', { tier: 3 });

    expect(a).toHaveBeenCalledWith({ tier: 3 });
    expect(b).toHaveBeenCalledWith({ tier: 3 });
  });

  it('n’appelle pas les abonnés d’un autre type, et tolère un type sans abonné', () => {
    const bus = new EventBus();
    const listener = vi.fn();
    bus.on('merge', listener);

    bus.emit('spawn', {});
    expect(() => bus.emit('inconnu', {})).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
  });

  it('renvoie une fonction de désabonnement', () => {
    const bus = new EventBus();
    const listener = vi.fn();
    const off = bus.on('merge', listener);

    off();
    bus.emit('merge', {});

    expect(listener).not.toHaveBeenCalled();
    expect(bus.listenerCount('merge')).toBe(0);
  });

  it('`once` ne se déclenche qu’une fois', () => {
    const bus = new EventBus();
    const listener = vi.fn();
    bus.once('full', listener);

    bus.emit('full', {});
    bus.emit('full', {});

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('supporte un désabonnement pendant l’émission', () => {
    const bus = new EventBus();
    const second = vi.fn();
    const first = vi.fn(() => bus.off('merge', second));
    bus.on('merge', first);
    bus.on('merge', second);

    bus.emit('merge', {});

    // La liste est copiée avant parcours : le second écouteur de ce tour est servi,
    // mais plus jamais ensuite.
    expect(second).toHaveBeenCalledTimes(1);
    bus.emit('merge', {});
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(2);
  });

  it('refuse un écouteur qui n’est pas une fonction', () => {
    const bus = new EventBus();
    expect(() => bus.on('merge', null)).toThrow(TypeError);
  });

  it('`clear` vide un type ou tout le bus', () => {
    const bus = new EventBus();
    bus.on('a', vi.fn());
    bus.on('b', vi.fn());

    bus.clear('a');
    expect(bus.listenerCount('a')).toBe(0);
    expect(bus.listenerCount('b')).toBe(1);

    bus.clear();
    expect(bus.listenerCount('b')).toBe(0);
  });
});
