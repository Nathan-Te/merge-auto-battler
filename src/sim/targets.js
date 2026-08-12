/**
 * Objectifs chiffrés du Lot 3 — **critères de validation**, pas des stats de gameplay.
 *
 * Rien ici n'influence une partie : ce sont les seuils que le harness (`npm run sim`) et le
 * test d'invariant (`tests/balanceInvariant.test.js`) opposent à `balance.json`. Ils vivent
 * donc dans le code du harness et non dans `balance.json`, dont la règle est de ne contenir
 * que ce qui pilote le jeu.
 *
 * Source : prompt du Lot 3 et `docs/seed.md` (« session cible : 3-5 minutes »).
 */
export const TARGETS = {
  /** Politique qui représente un joueur découvrant le jeu. */
  referencePolicy: 'mixed',
  /** Fenêtre de la première défaite, en vagues survécues. */
  minWave: 8,
  maxWave: 12,
  /** Durée d'une partie moyenne. */
  minDurationMs: 3 * 60 * 1000,
  maxDurationMs: 5 * 60 * 1000,
  /**
   * Invariant du design : préparer doit battre **nettement** le spam. « Nettement » vaut
   * ici +40 % de vagues survécues — au-delà du bruit d'un échantillon de 20 parties, et
   * lisible en une partie jouée à la main.
   */
  mergeBeatsSpamRatio: 1.4,
};

export default TARGETS;
