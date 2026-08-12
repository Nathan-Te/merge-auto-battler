/**
 * Courbe de vagues — fonctions pures, sans état ni Phaser.
 *
 * Deux régimes, décrits dans `balance.schema.md` :
 *   - les premières vagues sont **scriptées** (composition exacte) pour maîtriser
 *     l'ordre d'introduction des types d'ennemis ;
 *   - au-delà, la composition est **générée** depuis le modèle `waves.infinite` et la
 *     formule de scaling, sans limite de vague.
 *
 * Le scaling numérique (PV, vitesse) vit dans `enemyStats()` — ici on ne décide que
 * *qui* apparaît, *combien* et *à quel rythme*.
 */

/**
 * Composition d'une vague : liste d'entrées `{ type, count }` dans l'ordre d'apparition.
 *
 * @param {object} config Config normalisée (`parseBattleConfig`)
 * @param {number} wave Numéro de vague, à partir de 1
 * @returns {{type: string, count: number}[]}
 */
export function waveComposition(config, wave) {
  const { scripted, infinite, scaling } = config.waves;
  const index = Math.max(1, Math.floor(wave)) - 1;

  if (index < scripted.length) {
    // Copie défensive : le modèle ne doit jamais pouvoir muter la config chargée.
    return scripted[index].map((entry) => ({ ...entry }));
  }

  // Vagues générées : le modèle `infinite` grossit d'un cran par vague au-delà des
  // vagues scriptées (la première vague générée vaut donc exactement le modèle).
  const steps = index - scripted.length;
  const growth = scaling.countPerWave ** steps;
  return infinite.map((entry) => ({
    type: entry.type,
    count: Math.min(scaling.maxCountPerEntry, Math.max(1, Math.round(entry.count * growth))),
  }));
}

/**
 * Ordre d'apparition des ennemis d'une vague, un type par ennemi.
 *
 * @returns {string[]} par exemple `['basic', 'basic', 'fast']`
 */
export function waveSpawnOrder(config, wave) {
  const order = [];
  for (const entry of waveComposition(config, wave)) {
    for (let i = 0; i < entry.count; i += 1) order.push(entry.type);
  }
  return order;
}

/** Nombre total d'ennemis d'une vague. */
export function waveEnemyCount(config, wave) {
  return waveComposition(config, wave).reduce((total, entry) => total + entry.count, 0);
}

/**
 * Délai entre deux apparitions d'ennemis au sein d'une vague : les vagues se resserrent
 * avec le temps, jusqu'à un plancher.
 */
export function waveSpawnGapMs(config, wave) {
  const { spawnGapMs, scaling } = config.waves;
  const steps = Math.max(0, Math.floor(wave) - 1);
  return Math.max(scaling.minSpawnGapMs, spawnGapMs * scaling.spawnGapPerWave ** steps);
}

/**
 * Libellé lisible d'une composition, pour le HUD de debug et les tests.
 * Exemple : `3× Basique, 2× Rapide`.
 */
export function describeWave(config, wave) {
  return waveComposition(config, wave)
    .map((entry) => `${entry.count}× ${config.enemies[entry.type].label}`)
    .join(', ');
}
