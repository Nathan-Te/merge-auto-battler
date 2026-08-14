/**
 * Objectifs chiffrés du Lot 3 (et du Lot 4) — **critères de validation**, pas des stats de
 * gameplay.
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
  /**
   * Invariant du Lot 4 : **les pouvoirs doivent se voir**. Le même joueur, aux pouvoirs
   * près, doit survivre nettement moins longtemps sans eux — sinon la mécanique ne fait
   * qu'occuper des cases de grille, et il vaudrait mieux la retirer que la publier.
   *
   * La marge est exprimée en **vagues** et non en ratio : à `hpPerWave` 1,66, une vague est
   * une multiplication de la difficulté par deux tiers, donc un demi-cran de vague est déjà
   * un écart massif de puissance — un ratio y serait illisible.
   */
  powersPolicy: 'mixed',
  noPowersPolicy: 'noPowers',
  powersBeatNoPowersWaves: 0.5,
};

export default TARGETS;
