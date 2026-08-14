import { describe, it, expect } from 'vitest';
import balance from '../src/config/balance.json';
import { isTap, gestureDistance, parseInputConfig } from '../src/systems/tapGesture.js';

const config = parseInputConfig(balance);

/** Geste par défaut : un doigt posé et relâché au même endroit, tout de suite. */
function gesture(patch = {}) {
  return { startX: 100, startY: 100, endX: 100, endY: 100, startTime: 0, endTime: 80, ...patch };
}

describe('parseInputConfig', () => {
  it('lit les seuils du balance.json du jeu', () => {
    expect(config.tapMaxDistancePx).toBeGreaterThan(0);
    expect(config.tapMaxDurationMs).toBeGreaterThan(0);
  });

  it('refuse une section ou une valeur manquante plutôt que d’inventer un défaut', () => {
    expect(() => parseInputConfig({})).toThrow(/input/);
    expect(() => parseInputConfig({ input: { tapMaxDurationMs: 400 } })).toThrow(
      /tapMaxDistancePx/
    );
    expect(() => parseInputConfig({ input: { tapMaxDistancePx: 0, tapMaxDurationMs: 400 } })).toThrow(
      /tapMaxDistancePx/
    );
  });
});

describe('gestureDistance', () => {
  it('mesure la distance parcourue, quelle que soit la direction', () => {
    expect(gestureDistance(gesture({ endX: 103, endY: 104 }))).toBeCloseTo(5);
    expect(gestureDistance(gesture({ endX: 97, endY: 96 }))).toBeCloseTo(5);
  });
});

describe('isTap — tap vs glisser', () => {
  const strict = { tapMaxDistancePx: 10, tapMaxDurationMs: 500 };

  it('accepte un doigt qui ne bouge pas', () => {
    expect(isTap(gesture(), strict)).toBe(true);
  });

  it('accepte le tremblement inévitable au doigt', () => {
    expect(isTap(gesture({ endX: 106, endY: 104 }), strict)).toBe(true); // ~7,2 px
  });

  it('refuse un geste qui a franchi le seuil de distance', () => {
    expect(isTap(gesture({ endX: 112 }), strict)).toBe(false);
    expect(isTap(gesture({ endY: 88 }), strict)).toBe(false);
    // Une diagonale sous le seuil sur chaque axe mais au-dessus en distance réelle.
    expect(isTap(gesture({ endX: 108, endY: 108 }), strict)).toBe(false);
  });

  it('accepte pile au seuil, refuse juste au-delà', () => {
    expect(isTap(gesture({ endX: 110 }), strict)).toBe(true);
    expect(isTap(gesture({ endX: 110.01 }), strict)).toBe(false);
  });

  it('refuse un appui long, même parfaitement immobile', () => {
    expect(isTap(gesture({ endTime: 500 }), strict)).toBe(true);
    expect(isTap(gesture({ endTime: 501 }), strict)).toBe(false);
  });

  it('refuse une durée incohérente plutôt que de deviner', () => {
    expect(isTap(gesture({ startTime: 100, endTime: 0 }), strict)).toBe(false);
    expect(isTap(gesture({ endTime: NaN }), strict)).toBe(false);
  });

  it('refuse un geste ou une config absents', () => {
    expect(isTap(null, strict)).toBe(false);
    expect(isTap(gesture(), null)).toBe(false);
  });

  it('suit les seuils de la config, et rien d’autre', () => {
    const loose = { tapMaxDistancePx: 40, tapMaxDurationMs: 5000 };
    const moved = gesture({ endX: 130, endTime: 3000 });
    expect(isTap(moved, strict)).toBe(false);
    expect(isTap(moved, loose)).toBe(true);
  });
});
