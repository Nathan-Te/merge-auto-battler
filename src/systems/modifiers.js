/**
 * Modificateurs d'améliorations — **la règle du Lot 3.5**. Pur, sans Phaser.
 *
 * Une amélioration de draft ne change **jamais** une valeur de `balance.json` : elle
 * accumule un modificateur, et ce sont les lecteurs (`unitStats`, `DeployQueue`,
 * `ItemSpawner`, `UnitQueue`) qui l'appliquent au moment de lire. La raison est simple :
 * `balance.json` est importé **une fois** pour toute l'application, une mutation
 * survivrait donc à la partie et le « rejouer » repartirait avec les améliorations de la
 * partie précédente — exactement le bug que `GameSession.destroy()` rend impossible
 * partout ailleurs. Un modificateur, lui, meurt avec la session qui le porte.
 *
 * Deux familles de champs, et la famille décide de la façon dont les niveaux se cumulent :
 *
 *   - **multiplicatifs** (`unitDamage`, `deployCooldown`…) — neutres à 1, cumulés par
 *     produit. Prendre deux fois « +18 % de dégâts » donne 1,18² = ×1,39, jamais ×1,36 :
 *     une amélioration en pourcentage se compose, elle ne s'additionne pas ;
 *   - **additifs** (`slotBonus`, `baseHpBonus`, `spawnTierBonus`) — neutres à 0, cumulés
 *     par somme. Ce sont des quantités entières (une place, un tier, des PV), qu'un produit
 *     n'aurait aucun sens de composer.
 *
 * Les bonus **par type d'unité** (`byType.support.effect`) suivent la même règle,
 * multiplicativement, et se cumulent **par-dessus** les bonus globaux.
 */

/** Champs multiplicatifs, neutres à 1. */
export const MULTIPLIER_KEYS = [
  /** Dégâts de toutes les unités. */
  'unitDamage',
  /** Délai entre deux frappes : **< 1 = plus rapide**. */
  'unitFireRate',
  /** Portée de toutes les unités (et rayon d'aura du soutien). */
  'unitRange',
  /** PV des unités **à leur entrée en jeu** (une unité déjà posée garde les siens). */
  'unitHp',
  /** Rayons et durées d'effet (zone, ralentissement, buff de soutien). */
  'unitEffect',
  /** Cooldown de sortie de la file de déploiement : < 1 = ça part plus souvent. */
  'deployCooldown',
  /** Intervalle d'apparition des items sur la grille : < 1 = ça tombe plus vite. */
  'spawnInterval',
  /** Cooldown du bouton « passer » de la file de types. */
  'skipCooldown',
  /** Puissance des pouvoirs actifs : soin rendu et dégâts de zone (Lot 4). */
  'powerAmount',
  /** Probabilité qu'un item qui apparaît soit un pouvoir plutôt qu'une unité. */
  'powerChance',
];

/** Champs additifs, neutres à 0. */
export const ADDITIVE_KEYS = [
  /** Places supplémentaires dans la file de déploiement. */
  'slotBonus',
  /** PV de base gagnés (appliqués immédiatement, cf. `BattleModel.grantBaseHp`). */
  'baseHpBonus',
  /** Décalage du tier des items qui apparaissent sur la grille. */
  'spawnTierBonus',
];

/** Champs modifiables **par type d'unité**, tous multiplicatifs. */
export const TYPE_KEYS = ['damage', 'fireRate', 'range', 'hp', 'effect'];

/** Correspondance champ global → champ par type, pour la combinaison des deux. */
const GLOBAL_TO_TYPE = {
  damage: 'unitDamage',
  fireRate: 'unitFireRate',
  range: 'unitRange',
  hp: 'unitHp',
  effect: 'unitEffect',
};

/** Modificateurs neutres : appliqués, ils ne changent **rien**. */
export function neutralModifiers() {
  const mods = { byType: {} };
  for (const key of MULTIPLIER_KEYS) mods[key] = 1;
  for (const key of ADDITIVE_KEYS) mods[key] = 0;
  return mods;
}

/** Facteurs neutres pour un type d'unité. */
function neutralTypeEntry() {
  const entry = {};
  for (const key of TYPE_KEYS) entry[key] = 1;
  return entry;
}

/**
 * Valide l'effet déclaré par une amélioration de `balance.json`.
 *
 * Comme les autres parseurs du projet, celui-ci **refuse** ce qu'il ne comprend pas plutôt
 * que de l'ignorer : une clé mal orthographiée dans `balance.json` doit crier au
 * chargement, pas produire une carte qui ne fait rien au milieu d'une partie.
 *
 * @param {object} raw Effet brut
 * @param {string} path Chemin, pour le message d'erreur
 * @returns {object} L'effet normalisé
 */
export function parseEffect(raw, path) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`balance.json : ${path} doit être un objet d'effet`);
  }

  const effect = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'byType') {
      effect.byType = parseByType(value, `${path}.byType`);
      continue;
    }
    if (!MULTIPLIER_KEYS.includes(key) && !ADDITIVE_KEYS.includes(key)) {
      throw new Error(`balance.json : ${path}.${key} n'est pas un modificateur connu`);
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`balance.json : ${path}.${key} doit être un nombre`);
    }
    if (MULTIPLIER_KEYS.includes(key) && value <= 0) {
      throw new Error(`balance.json : ${path}.${key} est un facteur, il doit être > 0`);
    }
    effect[key] = value;
  }

  if (Object.keys(effect).length === 0) {
    throw new Error(`balance.json : ${path} ne déclare aucun modificateur`);
  }
  return effect;
}

function parseByType(raw, path) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`balance.json : ${path} doit être un objet`);
  }
  const byType = {};
  for (const [type, entry] of Object.entries(raw)) {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`balance.json : ${path}.${type} invalide`);
    }
    const parsed = {};
    for (const [key, value] of Object.entries(entry)) {
      if (!TYPE_KEYS.includes(key)) {
        throw new Error(
          `balance.json : ${path}.${type}.${key} inconnu (attendu : ${TYPE_KEYS.join(', ')})`
        );
      }
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new Error(`balance.json : ${path}.${type}.${key} doit être un facteur > 0`);
      }
      parsed[key] = value;
    }
    byType[type] = parsed;
  }
  return byType;
}

/**
 * Cumule un effet sur des modificateurs, `times` fois (une fois par niveau pris).
 *
 * Rend un **nouvel** objet : les modificateurs d'une session sont remplacés, jamais mutés
 * en place, ce qui rend un instantané (`recap()`, affichage) sûr à conserver.
 *
 * @param {object} mods Modificateurs de départ
 * @param {object} effect Effet normalisé (`parseEffect`)
 * @param {number} [times] Nombre de niveaux pris
 * @returns {object} Nouveaux modificateurs
 */
export function applyEffect(mods, effect, times = 1) {
  const next = { ...mods, byType: { ...mods.byType } };
  if (times <= 0) return next;

  for (const key of MULTIPLIER_KEYS) {
    if (effect[key] === undefined) continue;
    next[key] = mods[key] * effect[key] ** times;
  }
  for (const key of ADDITIVE_KEYS) {
    if (effect[key] === undefined) continue;
    next[key] = mods[key] + effect[key] * times;
  }

  for (const [type, entry] of Object.entries(effect.byType ?? {})) {
    const current = next.byType[type] ?? neutralTypeEntry();
    const merged = { ...current };
    for (const key of TYPE_KEYS) {
      if (entry[key] === undefined) continue;
      merged[key] = current[key] * entry[key] ** times;
    }
    next.byType[type] = merged;
  }

  return next;
}

/**
 * Facteurs effectifs d'un type d'unité : les bonus globaux **fois** les bonus qui le
 * visent nommément.
 *
 * @param {object} mods Modificateurs
 * @param {string} type Id du type d'unité
 * @returns {{damage: number, fireRate: number, range: number, hp: number, effect: number}}
 */
export function typeModifiers(mods, type) {
  const specific = mods?.byType?.[type];
  const result = {};
  for (const key of TYPE_KEYS) {
    const global = mods?.[GLOBAL_TO_TYPE[key]] ?? 1;
    result[key] = global * (specific?.[key] ?? 1);
  }
  return result;
}

export default neutralModifiers;
