/**
 * Spawner d'items — logique pure, pilotée par `balance.json`. Aucune dépendance à
 * Phaser : la scène se contente de rythmer les appels avec un timer.
 *
 * Deux responsabilités, testables séparément :
 *   - **quel tier** apparaît (tirage pondéré sur `spawnTierWeights`) ;
 *   - **quand** il apparaît (intervalle initial qui décroît vers un plancher).
 *
 * Aucune valeur n'est écrite en dur ici : `parseSpawnerConfig` refuse une config
 * incomplète plutôt que d'inventer un défaut (règle de `balance.schema.md`).
 */

/**
 * Valide et normalise la section `itemSpawner` de `balance.json`.
 *
 * @param {object} balance Contenu de `balance.json`
 * @returns {{maxTier: number, startingItems: number, firstSpawnDelayMs: number,
 *           intervalMs: number, minIntervalMs: number, intervalDecay: number,
 *           gridFullRetryMs: number, tierWeights: {tier: number, weight: number}[]}}
 */
export function parseSpawnerConfig(balance) {
  const raw = balance?.itemSpawner;
  if (!raw || typeof raw !== 'object') {
    throw new Error('balance.json : section `itemSpawner` manquante');
  }

  const number = (key, { min = 0, max = Infinity, integer = false } = {}) => {
    const value = raw[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`balance.json : itemSpawner.${key} manquant ou non numérique`);
    }
    if (integer && !Number.isInteger(value)) {
      throw new Error(`balance.json : itemSpawner.${key} doit être entier`);
    }
    if (value < min || value > max) {
      throw new Error(`balance.json : itemSpawner.${key} hors bornes [${min}, ${max}]`);
    }
    return value;
  };

  const maxTier = number('maxTier', { min: 2, integer: true });
  const config = {
    maxTier,
    startingItems: number('startingItems', { min: 0, integer: true }),
    firstSpawnDelayMs: number('firstSpawnDelayMs', { min: 0 }),
    intervalMs: number('intervalMs', { min: 1 }),
    minIntervalMs: number('minIntervalMs', { min: 1 }),
    // Facteur appliqué à l'intervalle après chaque apparition : < 1 = accélération.
    intervalDecay: number('intervalDecay', { min: 0.5, max: 1 }),
    gridFullRetryMs: number('gridFullRetryMs', { min: 16 }),
    tierWeights: parseTierWeights(raw.spawnTierWeights, maxTier),
  };

  if (config.minIntervalMs > config.intervalMs) {
    throw new Error('balance.json : itemSpawner.minIntervalMs doit être <= intervalMs');
  }
  return config;
}

/**
 * Normalise `spawnTierWeights` (`{ "1": 85, "2": 15 }`) en liste triée.
 *
 * @returns {{tier: number, weight: number}[]}
 */
export function parseTierWeights(weights, maxTier) {
  if (!weights || typeof weights !== 'object') {
    throw new Error('balance.json : itemSpawner.spawnTierWeights manquant');
  }
  const entries = Object.entries(weights)
    .map(([tier, weight]) => ({ tier: Number(tier), weight }))
    .filter(({ weight }) => weight > 0);

  for (const { tier, weight } of entries) {
    if (!Number.isInteger(tier) || tier < 1 || tier > maxTier) {
      throw new Error(`balance.json : tier de spawn invalide « ${tier} »`);
    }
    if (typeof weight !== 'number' || !Number.isFinite(weight)) {
      throw new Error(`balance.json : poids de spawn invalide pour le tier ${tier}`);
    }
  }
  if (entries.length === 0) {
    throw new Error('balance.json : itemSpawner.spawnTierWeights ne contient aucun poids > 0');
  }
  return entries.sort((a, b) => a.tier - b.tier);
}

/**
 * Tirage pondéré du tier d'un item qui apparaît.
 *
 * @param {{tier: number, weight: number}[]} tierWeights
 * @param {() => number} [rng] Générateur [0, 1), injectable pour les tests
 * @returns {number} Tier tiré
 */
export function pickSpawnTier(tierWeights, rng = Math.random) {
  const total = tierWeights.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = rng() * total;
  for (const entry of tierWeights) {
    roll -= entry.weight;
    if (roll < 0) return entry.tier;
  }
  // Filet de sécurité si rng() renvoie exactement 1 : dernier tier de la liste.
  return tierWeights[tierWeights.length - 1].tier;
}

/**
 * Intervalle avant la prochaine apparition, après `spawnCount` items déjà apparus.
 *
 * Courbe géométrique bornée : `intervalMs * decay^spawnCount`, plancher
 * `minIntervalMs`. Le réglage du rythme se fait donc entièrement dans
 * `balance.json`, sans toucher au code.
 *
 * @param {object} config Config normalisée (`parseSpawnerConfig`)
 * @param {number} spawnCount Nombre d'items déjà apparus
 * @returns {number} Délai en millisecondes
 */
export function spawnDelayMs(config, spawnCount, intervalFactor = 1) {
  const steps = Math.max(0, spawnCount);
  const raw = config.intervalMs * config.intervalDecay ** steps;
  // Le facteur d'amélioration s'applique **aussi au plancher** : sinon « Extraction »
  // n'aurait aucun effet passé la trentaine d'items, c'est-à-dire dès la vague 3, donc
  // pile au moment où la carte devient prenable.
  return Math.max(config.minIntervalMs * intervalFactor, raw * intervalFactor);
}

/**
 * Décale les tiers d'apparition d'un cran par niveau de « gisement riche », sans dépasser
 * le tier maximum. Les **poids** ne bougent pas : c'est la même distribution, plus haut.
 *
 * @param {{tier: number, weight: number}[]} tierWeights
 * @param {number} bonus Décalage (0 = inchangé)
 * @param {number} maxTier
 * @returns {{tier: number, weight: number}[]}
 */
export function shiftTierWeights(tierWeights, bonus, maxTier) {
  if (!(bonus > 0)) return tierWeights;

  // Deux entrées peuvent retomber sur le même tier une fois plafonnées : on les fusionne
  // plutôt que de laisser deux lignes du même tier fausser le tirage pondéré.
  const merged = new Map();
  for (const entry of tierWeights) {
    const tier = Math.min(maxTier, entry.tier + bonus);
    merged.set(tier, (merged.get(tier) ?? 0) + entry.weight);
  }
  return [...merged.entries()]
    .map(([tier, weight]) => ({ tier, weight }))
    .sort((a, b) => a.tier - b.tier);
}

/**
 * Pilote les apparitions sur un `GridModel`. Ne connaît ni le temps réel ni Phaser :
 * la scène appelle `trySpawn()` quand son timer sonne, et lit `nextDelayMs()` pour
 * reprogrammer le suivant.
 */
export class ItemSpawner {
  /**
   * @param {object} options
   * @param {object} options.config Config normalisée (`parseSpawnerConfig`)
   * @param {import('./GridModel.js').GridModel} options.model
   * @param {() => number} [options.rng]
   */
  constructor({ config, model, rng = Math.random, getModifiers = null }) {
    this.config = config;
    this.model = model;
    this.rng = rng;
    /** Modificateurs de draft (cadence, tier d'apparition), ou null. */
    this.getModifiers = getModifiers;
    /** Nombre d'items effectivement apparus depuis le début de la partie. */
    this.spawnCount = 0;
  }

  /** Délai avant la prochaine apparition, grille pleine comprise. */
  nextDelayMs() {
    if (this.model.isFull()) return this.config.gridFullRetryMs;
    return spawnDelayMs(this.config, this.spawnCount, this.getModifiers?.()?.spawnInterval ?? 1);
  }

  /** Poids de tirage en vigueur, décalés par « gisement riche » le cas échéant. */
  tierWeights() {
    return shiftTierWeights(
      this.config.tierWeights,
      this.getModifiers?.()?.spawnTierBonus ?? 0,
      this.config.maxTier
    );
  }

  /** Délai avant la toute première apparition. */
  firstDelayMs() {
    return this.config.firstSpawnDelayMs;
  }

  /**
   * Tente une apparition sur une case libre.
   *
   * @returns {{index: number, item: object}|null} null si la grille est pleine
   */
  trySpawn() {
    if (this.model.isFull()) return null;
    const tier = pickSpawnTier(this.tierWeights(), this.rng);
    const result = this.model.spawn(tier, this.rng);
    if (result !== null) this.spawnCount += 1;
    return result;
  }

  /**
   * Remplit la grille de ses items de départ.
   *
   * @returns {object[]} Les apparitions réalisées (moins que demandé si la grille sature)
   */
  fillInitial() {
    const spawned = [];
    for (let i = 0; i < this.config.startingItems; i += 1) {
      const result = this.trySpawn();
      if (result === null) break;
      spawned.push(result);
    }
    return spawned;
  }
}

export default ItemSpawner;
