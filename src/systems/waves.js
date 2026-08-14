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
    return scripted[index].composition.map((entry) => ({ ...entry }));
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
  const { scripted, spawnGapMs, scaling } = config.waves;
  const index = Math.max(1, Math.floor(wave)) - 1;

  // Une vague scriptée peut imposer sa cadence : c'est ce qui donne sa texture au rush
  // (arrivées serrées) face au mur (arrivées espacées). L'override ne subit pas le
  // resserrement par vague, sous peine de dériver.
  const override = scripted[index]?.spawnGapMs;
  if (typeof override === 'number') return override;

  const steps = Math.max(0, index);
  return Math.max(scaling.minSpawnGapMs, spawnGapMs * scaling.spawnGapPerWave ** steps);
}

/**
 * Texture d'une vague, **sous forme de données et non de phrase**.
 *
 * Une vague scriptée porte un identifiant écrit dans `balance.json` (`labelId`). Les vagues
 * **générées** n'en ont pas — la formule empile, elle ne compose pas de texture — mais
 * l'annonce du Lot 3.5 ne doit pas s'éteindre à la vague 11 : on en dérive donc une depuis
 * la composition calculée, à partir du type **dominant**.
 *
 * Depuis le Lot 5, la fonction rend un **descripteur** (`{ kind, id }` ou
 * `{ kind: 'tide', enemy }`) plutôt qu'une chaîne : la mise en mots appartient à
 * `src/i18n/` (`waveLabelText`). Sans cette séparation, ce module — qui décide de *ce qui
 * apparaît*, donc du gameplay — porterait du français, et traduire le jeu obligerait à
 * toucher une règle. Purement descriptif dans les deux cas : aucune règle ne lit ce
 * descripteur, et rien ici ne décide de qui gagne.
 *
 * @returns {{kind: 'scripted', id: string}|{kind: 'tide', enemy: string}|{kind: 'mixed'}|null}
 */
export function waveLabel(config, wave) {
  const index = Math.max(1, Math.floor(wave)) - 1;
  const scripted = config.waves.scripted[index];
  if (scripted) return scripted.labelId ? { kind: 'scripted', id: scripted.labelId } : null;

  const composition = waveComposition(config, wave);
  const total = composition.reduce((sum, entry) => sum + entry.count, 0);
  if (total === 0) return null;

  const dominant = composition.reduce((best, entry) => (entry.count > best.count ? entry : best));
  // Sans dominante nette, la vague est un mélange : le dire vaut mieux que de mettre en
  // avant un type qui ne représente qu'un tiers de ce qui arrive.
  if (dominant.count / total < 0.45) return { kind: 'mixed' };
  return { kind: 'tide', enemy: dominant.type };
}

/**
 * Composition lisible d'une vague, pour le HUD de debug, la référence et les tests.
 *
 * Le nom de chaque type d'ennemi est fourni par l'appelant (`labelOf`) et non lu dans la
 * config : les libellés ont quitté `balance.json` au Lot 5. Sans traducteur, la fonction
 * rend les identifiants — c'est exactement ce que veut un test, qui n'a pas à dépendre
 * d'une traduction.
 *
 * @param {object} config
 * @param {number} wave
 * @param {(type: string) => string} [labelOf]
 * @returns {string} par exemple `3× Goblin, 2× Wolf`
 */
export function describeWave(config, wave, labelOf = (type) => type) {
  return waveComposition(config, wave)
    .map((entry) => `${entry.count}× ${labelOf(entry.type)}`)
    .join(', ');
}
