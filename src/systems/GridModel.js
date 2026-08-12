/**
 * `GridModel` — état et règles de la grille de merge. **Aucune dépendance à Phaser.**
 *
 * Le modèle ne connaît ni pixels, ni sprites, ni pointeurs : il raisonne en index
 * de cases (à plat, row-major — cf. `src/systems/grid.js`) et émet des événements
 * sur un `EventBus`. Le rendu (scène Phaser) observe ces événements et se contente
 * de les mettre en images. Toute règle de gameplay vit ici, et est testée ici.
 *
 * Événements émis :
 *   - `spawn`  { index, item }                     un item apparaît sur une case libre
 *   - `move`   { from, to, item }                  un item change de case
 *   - `swap`   { from, to, source, target, reason } deux items échangent leur case
 *   - `merge`  { tier, resultTier, index, from, to, item, consumed }
 *   - `full`   { }                                 la grille vient de se remplir
 *   - `unfull` { }                                 une case s'est libérée
 *
 * Contrat du Lot 2 : `merge.tier` est le tier **des deux items fusionnés**, donc le
 * tier de l'unité à faire apparaître sur la bande de combat (seed doc : « fusionner
 * deux items de tier N fait apparaître une unité de tier N »). L'item qui reste sur
 * la grille est de tier `resultTier === tier + 1`.
 *
 * ## Deux familles d'items (Lot 4)
 *
 * Un item porte, en plus de son tier, une **famille** : `unit` (l'item historique, qu'un tap
 * envoie en file de déploiement) ou `power` (un pouvoir actif, qu'un tap consomme pour un
 * effet immédiat sur la bataille). Un item de pouvoir porte en plus son **type** (`heal`,
 * `meteor`…).
 *
 * La règle de fusion est la même pour tout le monde, avec une identité élargie : deux items
 * fusionnent s'ils ont **le même tier, la même famille et le même type de pouvoir**. Il n'y
 * a donc **aucun merge croisé** — ni entre familles, ni entre deux pouvoirs différents. Le
 * modèle ne connaît rien du contenu de ces chaînes : c'est `balance.json` qui les définit,
 * la grille ne fait que les comparer.
 *
 * ## Lâcher sur une case occupée : fusion, sinon échange
 *
 * Deux items qui ne fusionnent pas **échangent leur place**. Un lâcher n'est donc jamais
 * perdu, et ranger sa grille devient un geste à part entière : rapprocher deux futurs
 * partenaires, dégager un coin, sortir un pouvoir du chemin. Avant, il fallait passer par
 * une case vide — et quand la grille est pleine, il n'y en a pas, c'est-à-dire exactement
 * au moment où on a le plus besoin de réorganiser.
 */

import { GRID_COLS, GRID_ROWS, gridIndex, gridCoords } from './grid.js';
import { EventBus } from './eventBus.js';

/** Familles d'items présentes sur la grille. */
export const ITEM_FAMILY = {
  /** Item d'unité : un tap le met en file de déploiement. */
  UNIT: 'unit',
  /** Item de pouvoir : un tap le consomme pour un effet immédiat. */
  POWER: 'power',
};

/** Résultats possibles d'un lâcher d'item (`applyDrop`). */
export const DROP = {
  MERGE: 'merge',
  MOVE: 'move',
  /** Les deux items échangent leur case : la fusion était impossible, le rangement non. */
  SWAP: 'swap',
  /** Lâché sur sa propre case : rien à faire, l'item revient sans que ce soit une erreur. */
  CANCEL: 'cancel',
  INVALID: 'invalid',
};

/**
 * Vrai si deux items sont de la **même sorte** — même famille, et même type de pouvoir le
 * cas échéant. C'est la moitié « identité » de la règle de fusion ; l'autre est le tier.
 */
export function sameKind(a, b) {
  return a.family === b.family && a.power === b.power;
}

export class GridModel {
  /**
   * @param {object} [options]
   * @param {number} [options.cols] Colonnes (5 par défaut, cf. seed doc)
   * @param {number} [options.rows] Lignes
   * @param {number} [options.maxTier] Tier maximum atteignable (vient de `balance.json`)
   * @param {number} [options.powerMaxTier] Plafond propre aux pouvoirs — ils montent moins
   *   haut que les items d'unité, faute de quoi le dernier tier serait hors d'atteinte et
   *   deux pouvoirs plafonnés resteraient collés sur la grille sans pouvoir fusionner
   * @param {EventBus} [options.bus] Bus partagé ; sinon le modèle en crée un
   */
  constructor({ cols = GRID_COLS, rows = GRID_ROWS, maxTier = 11, powerMaxTier = maxTier, bus } = {}) {
    if (!Number.isInteger(cols) || cols <= 0) throw new RangeError('cols invalide');
    if (!Number.isInteger(rows) || rows <= 0) throw new RangeError('rows invalide');
    if (!Number.isInteger(maxTier) || maxTier < 2) throw new RangeError('maxTier invalide');
    if (!Number.isInteger(powerMaxTier) || powerMaxTier < 2 || powerMaxTier > maxTier) {
      throw new RangeError('powerMaxTier invalide');
    }

    this.cols = cols;
    this.rows = rows;
    this.maxTier = maxTier;
    this.powerMaxTier = powerMaxTier;
    this.events = bus ?? new EventBus();

    /** @type {(null|{id: number, tier: number, family: string, power: ?string})[]} Cases à plat, row-major. */
    this.cells = new Array(cols * rows).fill(null);
    this.nextItemId = 1;
    /** Mémorisé pour n'émettre `full` / `unfull` que sur transition. */
    this.wasFull = false;
  }

  // ------------------------------------------------------------------ lecture

  get size() {
    return this.cols * this.rows;
  }

  /** Vrai si l'index désigne une case de la grille. */
  isValidIndex(index) {
    return Number.isInteger(index) && index >= 0 && index < this.size;
  }

  /** Index à plat depuis des coordonnées de case, ou -1 hors grille. */
  indexOf(x, y) {
    const index = gridIndex(x, y, this.cols);
    return index >= this.size ? -1 : index;
  }

  /** Coordonnées de case depuis un index à plat, ou null. */
  coordsOf(index) {
    if (!this.isValidIndex(index)) return null;
    return gridCoords(index, this.cols);
  }

  /** Item présent sur une case, ou null (case vide ou index invalide). */
  itemAt(index) {
    return this.isValidIndex(index) ? this.cells[index] : null;
  }

  isEmpty(index) {
    return this.isValidIndex(index) && this.cells[index] === null;
  }

  /** Index de toutes les cases libres, dans l'ordre de la grille. */
  emptyIndices() {
    const free = [];
    for (let i = 0; i < this.cells.length; i += 1) if (this.cells[i] === null) free.push(i);
    return free;
  }

  isFull() {
    return this.cells.every((cell) => cell !== null);
  }

  /** Nombre d'items présents. */
  count() {
    return this.cells.reduce((total, cell) => total + (cell === null ? 0 : 1), 0);
  }

  // ------------------------------------------------------------------ mutation

  /**
   * Place un item sur une case libre, sans passer par le spawner (tests, setup).
   *
   * @param {number} index Case cible
   * @param {number} tier Tier de l'item (1 -> maxTier de sa famille)
   * @param {object} [options]
   * @param {boolean} [options.silent] N'émet pas `spawn` (utile pour un état initial)
   * @param {string} [options.family] Famille (`ITEM_FAMILY`), `unit` par défaut
   * @param {?string} [options.power] Type de pouvoir, pour la famille `power`
   * @returns {{id: number, tier: number, family: string, power: ?string}|null} L'item créé,
   *   ou null si le placement est refusé
   */
  placeItem(index, tier, { silent = false, family = ITEM_FAMILY.UNIT, power = null } = {}) {
    if (!this.isEmpty(index)) return null;
    if (!this.isValidTier(tier, family)) return null;
    // Un pouvoir sans type ne pourrait fusionner avec rien : c'est un item mort sur la
    // grille, donc un refus plutôt qu'un placement.
    if (family === ITEM_FAMILY.POWER && typeof power !== 'string') return null;

    const item = {
      id: this.nextItemId++,
      tier,
      family,
      power: family === ITEM_FAMILY.POWER ? power : null,
    };
    this.cells[index] = item;
    if (!silent) this.events.emit('spawn', { index, item });
    this.syncFullState();
    return item;
  }

  /** Tier maximum atteignable par une famille d'items. */
  maxTierOf(family) {
    return family === ITEM_FAMILY.POWER ? this.powerMaxTier : this.maxTier;
  }

  /** Vrai si `tier` est un tier légal pour cette famille sur cette grille. */
  isValidTier(tier, family = ITEM_FAMILY.UNIT) {
    return Number.isInteger(tier) && tier >= 1 && tier <= this.maxTierOf(family);
  }

  /**
   * Fait apparaître un item d'un tier donné sur une case libre tirée au sort.
   *
   * @param {number} tier
   * @param {() => number} [rng] Générateur [0, 1), injectable pour les tests
   * @param {{family?: string, power?: ?string}} [kind] Famille et type de l'item
   * @returns {{index: number, item: object}|null} null si la grille est pleine
   */
  spawn(tier, rng = Math.random, kind = {}) {
    const free = this.emptyIndices();
    if (free.length === 0) return null;

    const index = free[Math.min(free.length - 1, Math.floor(rng() * free.length))];
    const item = this.placeItem(index, tier, kind);
    return item === null ? null : { index, item };
  }

  /**
   * Déplace un item vers une case **libre**.
   *
   * @returns {boolean} false si le déplacement est impossible (case occupée, index invalide…)
   */
  moveItem(from, to) {
    if (from === to) return false;
    const item = this.itemAt(from);
    if (item === null || !this.isEmpty(to)) return false;

    this.cells[from] = null;
    this.cells[to] = item;
    this.events.emit('move', { from, to, item });
    return true;
  }

  /** Vrai si lâcher l'item de `from` sur `to` produit une fusion. */
  canMerge(from, to) {
    if (from === to) return false;
    const source = this.itemAt(from);
    const target = this.itemAt(to);
    if (source === null || target === null) return false;
    // Deux items de la même sorte et du même tier, et le résultat doit rester dans la plage
    // de tiers de cette famille. Un item d'unité et un pouvoir de même tier ne fusionnent
    // donc jamais, pas plus que deux pouvoirs de types différents.
    if (!sameKind(source, target)) return false;
    return source.tier === target.tier && source.tier < this.maxTierOf(source.family);
  }

  /**
   * Fusionne l'item de `from` dans celui de `to`.
   *
   * Les deux items disparaissent, un item de tier+1 apparaît sur `to`.
   *
   * @returns {{tier: number, resultTier: number, index: number}|null} null si la fusion est illégale
   */
  merge(from, to) {
    if (!this.canMerge(from, to)) return null;

    const source = this.cells[from];
    const target = this.cells[to];
    const tier = source.tier;
    const resultTier = tier + 1;

    const item = {
      id: this.nextItemId++,
      tier: resultTier,
      // La sorte se conserve : fusionner deux météorites donne une météorite, jamais autre
      // chose. `canMerge` a déjà garanti que les deux items sont de la même sorte.
      family: source.family,
      power: source.power,
    };
    this.cells[from] = null;
    this.cells[to] = item;

    const payload = {
      tier,
      resultTier,
      index: to,
      family: item.family,
      power: item.power,
      from,
      to,
      item,
      // Les deux items disparus, dans l'ordre « celui qu'on a traîné, puis la cible » :
      // le rendu s'en sert pour retrouver ses vues et les détruire.
      consumed: [source, target],
    };
    this.events.emit('merge', payload);
    this.syncFullState();
    return payload;
  }

  /**
   * Point d'entrée du geste de drag : décide ce que produit le lâcher d'un item
   * de `from` sur `to`, et l'applique.
   *
   * C'est **la** règle du jeu côté grille — la scène ne fait qu'appeler ceci avec
   * la case la plus proche du centre de l'item lâché.
   *
   * @returns {{type: string, [k: string]: any}} `type` ∈ DROP
   */
  applyDrop(from, to) {
    if (this.itemAt(from) === null) return { type: DROP.INVALID, reason: 'sourceVide' };
    if (!this.isValidIndex(to)) return { type: DROP.INVALID, reason: 'horsGrille' };
    if (from === to) return { type: DROP.CANCEL };

    if (this.canMerge(from, to)) {
      return { type: DROP.MERGE, ...this.merge(from, to) };
    }
    if (this.isEmpty(to)) {
      this.moveItem(from, to);
      return { type: DROP.MOVE, from, to };
    }
    // Case occupée par un item qui ne fusionne pas : les deux **échangent leur place**.
    // Un lâcher n'est donc jamais perdu, et ranger sa grille — rapprocher deux futurs
    // partenaires, dégager un coin — devient un geste à part entière plutôt qu'un
    // enchaînement de déplacements vers des cases vides.
    return { type: DROP.SWAP, ...this.swapItems(from, to) };
  }

  /**
   * Échange les items de deux cases occupées.
   *
   * @returns {{from: number, to: number, source: object, target: object, reason: string}|null}
   *   null si l'une des deux cases est vide
   */
  swapItems(from, to) {
    if (from === to) return null;
    const source = this.itemAt(from);
    const target = this.itemAt(to);
    if (source === null || target === null) return null;

    this.cells[from] = target;
    this.cells[to] = source;
    // `reason` dit **pourquoi** ces deux-là n'ont pas fusionné. Le rendu n'en a pas besoin
    // — il anime le même échange dans tous les cas — mais les tests et le diagnostic, si.
    const payload = { from, to, source, target, reason: this.refusalReason(source, target) };
    this.events.emit('swap', payload);
    return payload;
  }

  /** Pourquoi deux items occupant des cases voisines n'ont pas fusionné. */
  refusalReason(source, target) {
    if (source.family !== target.family) return 'familleDifferente';
    if (source.power !== target.power) return 'pouvoirDifferent';
    if (source.tier !== target.tier) return 'tierDifferent';
    return 'tierMax';
  }

  /** Retire l'item d'une case. @returns {object|null} l'item retiré */
  removeItem(index) {
    const item = this.itemAt(index);
    if (item === null) return null;
    this.cells[index] = null;
    this.events.emit('remove', { index, item });
    this.syncFullState();
    return item;
  }

  /** Vide la grille (sans émettre : sert aux redémarrages de scène). */
  reset() {
    this.cells.fill(null);
    this.wasFull = false;
  }

  // ------------------------------------------------------------------ interne

  /**
   * Émet `full` / `unfull` uniquement sur transition : le rendu peut se contenter
   * de démarrer/arrêter son feedback sans compter les cases lui-même.
   */
  syncFullState() {
    const full = this.isFull();
    if (full === this.wasFull) return;
    this.wasFull = full;
    this.events.emit(full ? 'full' : 'unfull', {});
  }
}

export default GridModel;
