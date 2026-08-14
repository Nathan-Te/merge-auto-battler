/**
 * `PowerSystem` — les pouvoirs actifs du Lot 4. **Aucune dépendance à Phaser.**
 *
 * Un pouvoir est un item d'une **seconde famille** sur la grille (cf. `GridModel`) : il se
 * fusionne avec ses semblables comme n'importe quel item, et un tap le consomme pour un
 * effet immédiat sur la bataille — pas de file de déploiement, pas de cooldown. La rareté
 * du tirage et la case de grille immobilisée sont tout son coût, et c'est ce qui fait de
 * « garder une case pour un pouvoir » un vrai arbitrage.
 *
 * ## Le contrat, en un événement
 *
 * ```js
 * events.emit('usePower', { type, tier, origin });   // émis par GameSession, au tap
 * ```
 *
 * `PowerSystem` s'y abonne et ne lit rien d'autre du joueur. Il possède **la résolution**
 * (ciblage, montants, temporisation) et rien de la boucle de jeu : c'est `GameSession` qui
 * l'avance, donc un draft ouvert gèle une météorite en vol comme il gèle tout le reste.
 *
 * ## Deux temps, à dessein
 *
 * Un pouvoir à zone se résout en deux temps séparés par `telegraphMs` : le **ciblage** est
 * figé au tap et annoncé (`powerCast`), l'**impact** tombe ensuite (`powerResolved`). Le
 * délai n'est pas un artifice de rendu, c'est du jeu : les ennemis continuent d'avancer
 * pendant la télégraphie, donc viser le paquet le plus avancé n'attrape pas exactement les
 * mêmes ennemis selon leur vitesse. Il vit pour cette raison dans `balance.json` et non dans
 * `juice.json` — ce qui s'y règle, c'est l'apparence de la zone, jamais sa durée.
 *
 * Un pouvoir instantané (`telegraphMs: 0`, le soin) émet les deux événements dans la foulée.
 *
 * ## Ciblage automatique
 *
 * Pas de visée manuelle en V1 : le glisser reste réservé à la fusion. La zone se pose donc
 * sur le **groupe le plus menaçant** — celui qui compte le plus d'ennemis dans le rayon du
 * pouvoir, et à nombre égal le plus avancé, donc le plus près de la base. Un rush serré est
 * ainsi toujours une bonne cible, et un traînard isolé n'attire jamais la météorite loin de
 * la vraie menace.
 *
 * ## Événements émis
 *   - `powerCast`     { type, tier, kind, center, radius, amount, telegraphMs, origin }
 *   - `powerResolved` { type, tier, kind, center, radius, amount, hits, killed, healed, total }
 *   - `powerFizzled`  { type, tier, reason }   la partie s'est terminée pendant la télégraphie
 */

import { EventBus } from './eventBus.js';
import { ITEM_FAMILY } from './GridModel.js';

/** Effets reconnus, et clés supplémentaires que chacun exige. */
const KIND_KEYS = {
  /** Soigne toutes les unités vivantes du champ. */
  heal: [],
  /** Dégâts de zone sur le groupe d'ennemis le plus menaçant. */
  blast: [],
};

/**
 * Valide et normalise la section `powers` de `balance.json`.
 *
 * Comme les autres parseurs du projet, il **refuse** ce qu'il ne comprend pas plutôt que
 * d'inventer un défaut : un pouvoir dont l'effet est mal orthographié doit crier au
 * chargement, pas produire un item qui ne fait rien au milieu d'une partie.
 *
 * @param {object} balance Contenu de `balance.json`
 * @returns {{maxTier: number, spawnChance: number, types: object,
 *            weights: {type: string, weight: number}[]}}
 */
export function parsePowersConfig(balance) {
  const raw = balance?.powers;
  if (!raw || typeof raw !== 'object') {
    throw new Error('balance.json : section `powers` manquante');
  }

  const num = (obj, path, key, { min = 0, max = Infinity, integer = false } = {}) => {
    const value = obj?.[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`balance.json : ${path}.${key} manquant ou non numérique`);
    }
    if (integer && !Number.isInteger(value)) {
      throw new Error(`balance.json : ${path}.${key} doit être entier`);
    }
    if (value < min || value > max) {
      throw new Error(`balance.json : ${path}.${key} hors bornes [${min}, ${max}]`);
    }
    return value;
  };

  if (!raw.types || typeof raw.types !== 'object' || Array.isArray(raw.types)) {
    throw new Error('balance.json : powers.types doit être un objet');
  }
  const ids = Object.keys(raw.types);
  if (ids.length === 0) throw new Error('balance.json : powers.types est vide');

  const types = {};
  const weights = [];
  for (const id of ids) {
    const def = raw.types[id];
    const path = `powers.types.${id}`;
    if (!def || typeof def !== 'object') throw new Error(`balance.json : ${path} invalide`);
    if (!KIND_KEYS[def.kind]) {
      throw new Error(
        `balance.json : ${path}.kind inconnu « ${def.kind} » (attendu : ${Object.keys(KIND_KEYS).join(', ')})`
      );
    }
    const tierScaling = def.tierScaling;
    if (!tierScaling || typeof tierScaling !== 'object') {
      throw new Error(`balance.json : ${path}.tierScaling manquant`);
    }

    // Aucun libellé ici depuis le Lot 5 : le nom et la description d'un pouvoir sont du
    // texte affiché, donc ils vivent dans `src/i18n/` sous `powers.<id>`.
    const power = {
      id,
      kind: def.kind,
      weight: num(def, path, 'weight', { min: 0 }),
      /** Montant de l'effet au tier 1 : PV rendus, ou dégâts infligés. */
      amount: num(def, path, 'amount', { min: 0 }),
      /** Rayon de la zone, en unités de couloir. Nul pour un effet qui ne vise pas. */
      radius: num(def, path, 'radius', { min: 0 }),
      /** Délai entre l'annonce de la zone et l'impact — du jeu, pas du décor. */
      telegraphMs: num(def, path, 'telegraphMs', { min: 0, max: 3000 }),
      tierScaling: {
        amount: num(tierScaling, `${path}.tierScaling`, 'amount', { min: 1, max: 4 }),
        radius: num(tierScaling, `${path}.tierScaling`, 'radius', { min: 1, max: 4 }),
      },
    };
    for (const key of KIND_KEYS[def.kind]) num(def, path, key, { min: 0 });

    types[id] = power;
    if (power.weight > 0) weights.push({ type: id, weight: power.weight });
  }

  if (weights.length === 0) {
    throw new Error('balance.json : aucun pouvoir n’a un poids d’apparition > 0');
  }

  return {
    maxTier: num(raw, 'powers', 'maxTier', { min: 2, integer: true }),
    /** Probabilité qu'un item qui apparaît soit un pouvoir plutôt qu'un item d'unité. */
    spawnChance: num(raw, 'powers', 'spawnChance', { min: 0, max: 0.9 }),
    types,
    weights,
  };
}

/**
 * Montants effectifs d'un pouvoir, tier et améliorations comprises.
 *
 * Même règle que `unitStats` : `stat(tier) = stat(1) × facteur^(tier-1)`, et les
 * améliorations de draft sont des **facteurs appliqués ici**, jamais des valeurs réécrites
 * dans `balance.json`. Seul le montant suit `powerAmount` — le rayon, lui, est une
 * **distance**, et « + puissance » ne doit pas vouloir dire « + grand » sans le dire.
 *
 * @param {object} config Config normalisée (`parsePowersConfig`)
 * @param {string} type Id du pouvoir
 * @param {number} tier
 * @param {object} [modifiers] Modificateurs de draft (`src/systems/modifiers.js`)
 * @returns {{id: string, kind: string, amount: number, radius: number,
 *            telegraphMs: number}}
 */
export function powerStats(config, type, tier, modifiers = null) {
  const def = config.types[type];
  if (!def) throw new Error(`type de pouvoir inconnu « ${type} »`);

  const steps = Math.max(0, tier - 1);
  return {
    id: def.id,
    kind: def.kind,
    amount: def.amount * def.tierScaling.amount ** steps * (modifiers?.powerAmount ?? 1),
    radius: def.radius * def.tierScaling.radius ** steps,
    telegraphMs: def.telegraphMs,
  };
}

/**
 * Probabilité effective qu'un item qui apparaît soit un pouvoir.
 *
 * Bornée à 0,9 : au-delà, la grille ne produirait quasiment plus d'items d'unité et
 * l'armée cesserait d'exister — une amélioration cumulée ne doit pas pouvoir supprimer une
 * moitié du jeu.
 */
export function powerSpawnChance(config, modifiers = null) {
  return Math.min(0.9, Math.max(0, config.spawnChance * (modifiers?.powerChance ?? 1)));
}

/**
 * Tirage pondéré du type de pouvoir qui apparaît.
 *
 * @param {{type: string, weight: number}[]} weights
 * @param {() => number} [rng] Générateur [0, 1), injectable pour les tests
 * @returns {string}
 */
export function pickPowerType(weights, rng = Math.random) {
  const total = weights.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = rng() * total;
  for (const entry of weights) {
    roll -= entry.weight;
    if (roll < 0) return entry.type;
  }
  // Filet de sécurité si rng() rend exactement 1 : le dernier de la liste.
  return weights[weights.length - 1].type;
}

export class PowerSystem {
  /**
   * @param {object} options
   * @param {object} options.config Config normalisée (`parsePowersConfig`)
   * @param {import('./BattleModel.js').BattleModel} options.battle Champ de bataille, dont
   *   le système lit l'état et à qui il demande d'appliquer les effets — le système ne
   *   touche jamais une unité ni un ennemi lui-même
   * @param {EventBus} [options.bus] Bus partagé ; sinon le système en crée un
   * @param {() => object} [options.getModifiers] Accès aux modificateurs de draft
   */
  constructor({ config, battle, bus, getModifiers = null } = {}) {
    if (!config) throw new Error('PowerSystem attend une config');
    if (!battle) throw new Error('PowerSystem attend un BattleModel');
    this.config = config;
    this.battle = battle;
    this.events = bus ?? new EventBus();
    this.getModifiers = getModifiers;

    /** @type {object[]} Impacts annoncés, en attente de leur télégraphie. */
    this.pending = [];
    /** Pouvoirs utilisés, par type — lu par le récap de fin de partie. */
    this.usedByType = {};
    this.usedCount = 0;

    this.unsubscribe = this.events.on('usePower', ({ type, tier, origin }) =>
      this.cast(type, tier, origin)
    );
  }

  /** Retire l'abonnement au bus. Appelé par `GameSession.destroy()`. */
  destroy() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.pending.length = 0;
  }

  /** Modificateurs de draft en vigueur, ou null. */
  modifiers() {
    return this.getModifiers?.() ?? null;
  }

  /** Montants effectifs d'un pouvoir, améliorations comprises. */
  statsFor(type, tier) {
    return powerStats(this.config, type, tier, this.modifiers());
  }

  /** Tier maximum d'un item de pouvoir. */
  get maxTier() {
    return this.config.maxTier;
  }

  /**
   * Vrai si le pouvoir a **quelque chose à faire** en cet instant.
   *
   * Le seul refus est l'absence totale de cible : une météorite sans un ennemi sur le
   * couloir, un soin sans une unité sur le champ. Ce n'est pas de la bienveillance
   * excessive — c'est le pendant de « pas de cooldown » : le coût d'un pouvoir est sa
   * rareté, et perdre un item rare sur un mistap pendant une pause serait une punition que
   * rien n'annonce. En revanche, soigner une armée intacte reste **permis** : c'est un
   * jugement du joueur, pas une impossibilité.
   *
   * @param {string} type
   * @returns {boolean}
   */
  canCast(type) {
    const def = this.config.types[type];
    if (!def || this.battle.over) return false;
    if (def.kind === 'heal') return this.battle.units.length > 0;
    return this.battle.enemies.length > 0;
  }

  /**
   * Déclenche un pouvoir : la cible est figée maintenant, l'impact tombe après la
   * télégraphie.
   *
   * @param {string} type
   * @param {number} tier
   * @param {object} [origin] Métadonnée opaque (case de grille), transmise au rendu
   * @returns {object|null} L'impact en attente, ou null si le pouvoir n'avait pas de cible
   */
  cast(type, tier, origin = null) {
    if (!this.canCast(type)) return null;

    const stats = this.statsFor(type, tier);
    const center = stats.kind === 'blast' ? this.targetCenter(stats.radius) : null;
    if (stats.kind === 'blast' && center === null) return null;

    this.usedCount += 1;
    this.usedByType[type] = (this.usedByType[type] ?? 0) + 1;

    const cast = {
      type,
      tier,
      kind: stats.kind,
      center,
      radius: stats.radius,
      amount: stats.amount,
      telegraphMs: stats.telegraphMs,
      origin,
    };
    this.events.emit('powerCast', cast);

    if (stats.telegraphMs <= 0) {
      this.resolve(cast);
      return cast;
    }
    this.pending.push({ ...cast, remainingMs: stats.telegraphMs });
    return cast;
  }

  /**
   * Centre de la zone : le groupe d'ennemis **le plus menaçant**.
   *
   * On teste chaque ennemi comme centre possible et on garde celui dont le rayon couvre le
   * plus de monde ; à nombre égal, le plus avancé l'emporte, parce qu'à menace égale c'est
   * lui qui touchera la base en premier. Le coût est quadratique, mais il est payé **une
   * fois par pouvoir lancé**, pas une fois par tick.
   *
   * @param {number} radius
   * @returns {number|null} Progression du centre, ou null s'il n'y a aucun ennemi
   */
  targetCenter(radius) {
    const enemies = this.battle.enemies;
    if (enemies.length === 0) return null;

    let best = null;
    let bestCount = -1;
    for (const candidate of enemies) {
      let count = 0;
      for (const other of enemies) {
        if (Math.abs(other.progress - candidate.progress) <= radius) count += 1;
      }
      if (count > bestCount || (count === bestCount && candidate.progress > best)) {
        bestCount = count;
        best = candidate.progress;
      }
    }
    return best;
  }

  /**
   * Fait avancer les télégraphies en attente.
   *
   * Appelé par `GameSession.update()` — donc jamais pendant un draft, exactement comme le
   * combat : un impact ne doit pas tomber pendant que le joueur lit trois cartes.
   *
   * @param {number} dtMs
   */
  update(dtMs) {
    if (this.pending.length === 0) return;
    if (!Number.isFinite(dtMs) || dtMs <= 0) return;

    // Parcours à l'envers : on retire pendant l'itération.
    for (let i = this.pending.length - 1; i >= 0; i -= 1) {
      const cast = this.pending[i];
      // Partie finie pendant la télégraphie : l'impact n'a plus de sens, et le rendu doit
      // pouvoir effacer sa zone plutôt que de la laisser à l'écran.
      if (this.battle.over) {
        this.pending.splice(i, 1);
        this.events.emit('powerFizzled', { type: cast.type, tier: cast.tier, reason: 'partieFinie' });
        continue;
      }
      cast.remainingMs -= dtMs;
      if (cast.remainingMs > 0) continue;
      this.pending.splice(i, 1);
      this.resolve(cast);
    }
  }

  /** Applique l'effet d'un pouvoir et annonce ce qu'il a produit. */
  resolve(cast) {
    const result =
      cast.kind === 'heal'
        ? this.battle.healUnits(cast.amount)
        : this.battle.blast(cast.center, cast.radius, cast.amount);

    this.events.emit('powerResolved', {
      type: cast.type,
      tier: cast.tier,
      kind: cast.kind,
      center: cast.center,
      radius: cast.radius,
      amount: cast.amount,
      hits: result.hits ?? [],
      killed: result.killed ?? 0,
      healed: result.healed ?? [],
      total: result.total ?? result.dealt ?? 0,
    });
    return result;
  }

  /** Récapitulatif des pouvoirs utilisés — purement descriptif. */
  recap() {
    return { used: this.usedCount, byType: { ...this.usedByType } };
  }
}

/** Famille d'items à laquelle appartiennent les pouvoirs, réexportée par commodité. */
export const POWER_FAMILY = ITEM_FAMILY.POWER;

export default PowerSystem;
