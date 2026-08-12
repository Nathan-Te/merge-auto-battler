/**
 * `DraftSystem` — le draft roguelite du Lot 3.5. **Aucune dépendance à Phaser.**
 *
 * Toutes les `draft.everyWaves` vagues, la partie s'arrête et propose `draft.cardsPerOffer`
 * améliorations : le joueur en prend une, elle vaut pour le reste de la partie. C'est ce
 * qui donne à une seconde partie une raison d'exister — un build à tenter, pas seulement un
 * meilleur score.
 *
 * Trois règles, toutes testables sans horloge :
 *
 *   - **jamais de mutation.** Une amélioration produit des **modificateurs**
 *     (`src/systems/modifiers.js`) appliqués par-dessus `balance.json` au moment de lire.
 *     `balance.json` est importé une fois pour toute l'application : le muter ferait
 *     survivre les améliorations d'une partie à la suivante.
 *   - **tirage seedé, sans doublon dans une même offre.** Le générateur est injecté, donc
 *     le harness rejoue exactement les mêmes offres à graine égale.
 *   - **niveaux.** Une amélioration a un `maxLevel` ; une fois épuisée elle sort du pool.
 *     Le pool ne peut donc pas s'assécher en silence : `offer()` rend simplement moins de
 *     cartes s'il ne reste plus rien, et zéro carte veut dire « pas de draft ».
 *
 * ## Événements émis
 *   - `draftChosen` { id, label, level, maxLevel, modifiers, effect }
 */

import { EventBus } from './eventBus.js';
import { neutralModifiers, applyEffect, parseEffect } from './modifiers.js';

/**
 * Valide et normalise la section `draft` de `balance.json`.
 *
 * @param {object} balance Contenu de `balance.json`
 * @returns {{everyWaves: number, cardsPerOffer: number, upgrades: object[]}}
 */
export function parseDraftConfig(balance) {
  const raw = balance?.draft;
  if (!raw || typeof raw !== 'object') {
    throw new Error('balance.json : section `draft` manquante');
  }

  const int = (key, min) => {
    const value = raw[key];
    if (!Number.isInteger(value) || value < min) {
      throw new Error(`balance.json : draft.${key} doit être un entier >= ${min}`);
    }
    return value;
  };

  if (!Array.isArray(raw.upgrades) || raw.upgrades.length === 0) {
    throw new Error('balance.json : draft.upgrades doit être une liste non vide');
  }

  const seen = new Set();
  const upgrades = raw.upgrades.map((entry, index) => {
    const path = `draft.upgrades[${index}]`;
    if (!entry || typeof entry !== 'object') throw new Error(`balance.json : ${path} invalide`);
    for (const key of ['id', 'label', 'description', 'icon']) {
      if (typeof entry[key] !== 'string' || entry[key].length === 0) {
        throw new Error(`balance.json : ${path}.${key} manquant`);
      }
    }
    if (seen.has(entry.id)) {
      throw new Error(`balance.json : ${path}.id « ${entry.id} » en double`);
    }
    seen.add(entry.id);
    if (!Number.isInteger(entry.maxLevel) || entry.maxLevel < 1) {
      throw new Error(`balance.json : ${path}.maxLevel doit être un entier >= 1`);
    }
    return {
      id: entry.id,
      label: entry.label,
      description: entry.description,
      /** Clé de forme greybox (`src/render/draftIcons.js`) — purement visuel. */
      icon: entry.icon,
      maxLevel: entry.maxLevel,
      effect: parseEffect(entry.effect, `${path}.effect`),
    };
  });

  const cardsPerOffer = int('cardsPerOffer', 1);
  if (cardsPerOffer > upgrades.length) {
    throw new Error('balance.json : draft.cardsPerOffer dépasse la taille du pool');
  }

  return { everyWaves: int('everyWaves', 1), cardsPerOffer, upgrades };
}

export class DraftSystem {
  /**
   * @param {object} options
   * @param {object} options.config Config normalisée (`parseDraftConfig`)
   * @param {EventBus} [options.bus] Bus partagé ; sinon le système en crée un
   * @param {() => number} [options.rng] Générateur [0, 1), injectable pour les tests
   */
  constructor({ config, bus, rng = Math.random } = {}) {
    if (!config) throw new Error('DraftSystem attend une config');
    this.config = config;
    this.events = bus ?? new EventBus();
    this.rng = rng;

    /** @type {Map<string, number>} Niveau pris par amélioration. */
    this.levels = new Map();
    /** Modificateurs cumulés — remplacés, jamais mutés (cf. `modifiers.js`). */
    this.modifiers = neutralModifiers();
  }

  /** Amélioration par son id, ou null. */
  upgrade(id) {
    return this.config.upgrades.find((entry) => entry.id === id) ?? null;
  }

  /** Niveau déjà pris pour une amélioration (0 si jamais prise). */
  levelOf(id) {
    return this.levels.get(id) ?? 0;
  }

  /** Améliorations encore prenables (niveau < `maxLevel`). */
  available() {
    return this.config.upgrades.filter((entry) => this.levelOf(entry.id) < entry.maxLevel);
  }

  /**
   * Tire une offre : `cardsPerOffer` améliorations **distinctes**, dans un ordre seedé.
   *
   * Le tirage est un mélange de Fisher-Yates tronqué plutôt qu'un tirage avec rejet : à pool
   * presque épuisé, le rejet pourrait boucler longtemps, le mélange se termine toujours.
   *
   * @returns {{id: string, label: string, description: string, icon: string,
   *            level: number, maxLevel: number, effect: object}[]}
   */
  offer() {
    const pool = this.available();
    const count = Math.min(this.config.cardsPerOffer, pool.length);

    for (let i = 0; i < count; i += 1) {
      const j = i + Math.floor(this.rng() * (pool.length - i));
      // `rng()` peut valoir presque 1 : on borne plutôt que de laisser passer un index hors
      // tableau une fois sur quelques millions de tirages.
      const pick = Math.min(pool.length - 1, j);
      [pool[i], pool[pick]] = [pool[pick], pool[i]];
    }

    return pool.slice(0, count).map((entry) => this.describe(entry));
  }

  /** Carte affichable d'une amélioration : sa définition + son niveau **à venir**. */
  describe(entry) {
    const level = this.levelOf(entry.id);
    return {
      id: entry.id,
      label: entry.label,
      description: entry.description,
      icon: entry.icon,
      /** Niveau qu'aurait l'amélioration une fois cette carte prise. */
      level: level + 1,
      maxLevel: entry.maxLevel,
      effect: entry.effect,
    };
  }

  /**
   * Prend une amélioration : le niveau monte d'un cran et les modificateurs se recalculent.
   *
   * @param {string} id
   * @returns {object|null} La carte prise, ou null (id inconnu ou niveau maximum atteint)
   */
  choose(id) {
    const entry = this.upgrade(id);
    if (!entry) return null;

    const level = this.levelOf(id);
    if (level >= entry.maxLevel) return null;

    this.levels.set(id, level + 1);
    this.modifiers = applyEffect(this.modifiers, entry.effect, 1);

    const chosen = {
      id: entry.id,
      label: entry.label,
      description: entry.description,
      icon: entry.icon,
      level: level + 1,
      maxLevel: entry.maxLevel,
      effect: entry.effect,
      modifiers: this.modifiers,
    };
    this.events.emit('draftChosen', chosen);
    return chosen;
  }

  /**
   * Améliorations prises, dans l'ordre du pool — c'est **le build de la partie**, lu par le
   * récap de fin de partie.
   *
   * @returns {{id: string, label: string, level: number, maxLevel: number}[]}
   */
  chosen() {
    return this.config.upgrades
      .filter((entry) => this.levelOf(entry.id) > 0)
      .map((entry) => ({
        id: entry.id,
        label: entry.label,
        level: this.levelOf(entry.id),
        maxLevel: entry.maxLevel,
      }));
  }

  /** Vrai si la vague qui vient de tomber doit ouvrir un draft. */
  isDraftWave(wave) {
    return wave > 0 && wave % this.config.everyWaves === 0;
  }
}

export default DraftSystem;
