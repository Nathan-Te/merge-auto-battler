import { describe, it, expect } from 'vitest';
import { readBest, submitScore, STORAGE_KEY } from '../src/systems/highScore.js';
import { isDebugEnabled } from '../src/systems/debug.js';

/** Faux `localStorage`, avec option de panne (navigation privée, quota plein). */
function fakeStorage({ throwOnGet = false, throwOnSet = false, initial } = {}) {
  const map = new Map();
  if (initial !== undefined) map.set(STORAGE_KEY, initial);
  return {
    getItem(key) {
      if (throwOnGet) throw new Error('stockage indisponible');
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      if (throwOnSet) throw new Error('quota dépassé');
      map.set(key, value);
    },
  };
}

describe('highScore', () => {
  it('part de zéro quand rien n’est enregistré', () => {
    expect(readBest(fakeStorage())).toBe(0);
  });

  it('enregistre un premier score puis le relit', () => {
    const storage = fakeStorage();
    expect(submitScore(7, storage)).toEqual({ best: 7, isRecord: true });
    expect(readBest(storage)).toBe(7);
  });

  it('ne remplace le record que s’il est battu', () => {
    const storage = fakeStorage({ initial: '12' });
    expect(submitScore(9, storage)).toEqual({ best: 12, isRecord: false });
    expect(submitScore(12, storage)).toEqual({ best: 12, isRecord: false });
    expect(submitScore(13, storage)).toEqual({ best: 13, isRecord: true });
  });

  it('ignore une valeur stockée illisible', () => {
    expect(readBest(fakeStorage({ initial: 'douze' }))).toBe(0);
    expect(readBest(fakeStorage({ initial: '-4' }))).toBe(0);
  });

  it('normalise les scores absurdes plutôt que de les enregistrer', () => {
    const storage = fakeStorage();
    expect(submitScore(-3, storage)).toEqual({ best: 0, isRecord: false });
    expect(submitScore(NaN, storage)).toEqual({ best: 0, isRecord: false });
    expect(submitScore(4.8, storage)).toEqual({ best: 4, isRecord: true });
  });

  it('ne casse jamais la partie si le stockage est indisponible', () => {
    expect(readBest(fakeStorage({ throwOnGet: true }))).toBe(0);
    expect(submitScore(5, fakeStorage({ throwOnSet: true }))).toEqual({
      best: 5,
      isRecord: true,
    });
    expect(readBest(null)).toBe(0);
    expect(submitScore(3, null)).toEqual({ best: 3, isRecord: true });
  });
});

describe('isDebugEnabled', () => {
  it('n’est actif que sur `?debug=1`', () => {
    expect(isDebugEnabled('?debug=1')).toBe(true);
    expect(isDebugEnabled('?a=b&debug=1')).toBe(true);
    expect(isDebugEnabled('?debug')).toBe(true);
    expect(isDebugEnabled('?debug=true')).toBe(true);
  });

  it('reste éteint par défaut', () => {
    expect(isDebugEnabled('')).toBe(false);
    expect(isDebugEnabled('?autre=1')).toBe(false);
    expect(isDebugEnabled('?debug=0')).toBe(false);
    expect(isDebugEnabled('?debug=false')).toBe(false);
    expect(isDebugEnabled(undefined)).toBe(false);
    expect(isDebugEnabled(null)).toBe(false);
  });
});
