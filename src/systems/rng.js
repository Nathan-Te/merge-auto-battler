/**
 * Générateur pseudo-aléatoire **déterministe**, sans dépendance. Pur, testable.
 *
 * `Math.random()` ne se rejoue pas : une partie simulée ne serait pas reproductible, et le
 * harness d'équilibrage (`npm run sim`) n'aurait aucune valeur — deux exécutions du même
 * `balance.json` donneraient deux résultats. `makeRng(seed)` donne une suite identique à
 * seed identique, sur toutes les plateformes.
 *
 * Algorithme : mulberry32 — 32 bits d'état, période 2^32, distribution suffisante pour un
 * tirage de tier et un choix de case. Ce n'est pas de la cryptographie, et ça n'en demande
 * pas.
 */

/**
 * Construit un générateur `[0, 1)` déterministe.
 *
 * @param {number} seed Graine entière (0 accepté)
 * @returns {() => number}
 */
export function makeRng(seed = 1) {
  let state = (Math.floor(seed) || 0) >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Entier dans `[0, max)` tiré avec `rng`. */
export function randomInt(rng, max) {
  return Math.min(max - 1, Math.floor(rng() * max));
}

export default makeRng;
