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
 *   - `merge`  { tier, resultTier, index, from, to, item, consumed }
 *   - `full`   { }                                 la grille vient de se remplir
 *   - `unfull` { }                                 une case s'est libérée
 *
 * Contrat du Lot 2 : `merge.tier` est le tier **des deux items fusionnés**, donc le
 * tier de l'unité à faire apparaître sur la bande de combat (seed doc : « fusionner
 * deux items de tier N fait apparaître une unité de tier N »). L'item qui reste sur
 * la grille est de tier `resultTier === tier + 1`.
 */

import { GRID_COLS, GRID_ROWS, gridIndex, gridCoords } from './grid.js';
import { EventBus } from './eventBus.js';

/** Résultats possibles d'un lâcher d'item (`applyDrop`). */
export const DROP = {
  MERGE: 'merge',
  MOVE: 'move',
  /** Lâché sur sa propre case : rien à faire, l'item revient sans que ce soit une erreur. */
  CANCEL: 'cancel',
  INVALID: 'invalid',
};

export class GridModel {
  /**
   * @param {object} [options]
   * @param {number} [options.cols] Colonnes (5 par défaut, cf. seed doc)
   * @param {number} [options.rows] Lignes
   * @param {number} [options.maxTier] Tier maximum atteignable (vient de `balance.json`)
   * @param {EventBus} [options.bus] Bus partagé ; sinon le modèle en crée un
   */
  constructor({ cols = GRID_COLS, rows = GRID_ROWS, maxTier = 11, bus } = {}) {
    if (!Number.isInteger(cols) || cols <= 0) throw new RangeError('cols invalide');
    if (!Number.isInteger(rows) || rows <= 0) throw new RangeError('rows invalide');
    if (!Number.isInteger(maxTier) || maxTier < 2) throw new RangeError('maxTier invalide');

    this.cols = cols;
    this.rows = rows;
    this.maxTier = maxTier;
    this.events = bus ?? new EventBus();

    /** @type {(null|{id: number, tier: number})[]} Cases à plat, row-major. */
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
   * @param {number} tier Tier de l'item (1 -> maxTier)
   * @param {object} [options]
   * @param {boolean} [options.silent] N'émet pas `spawn` (utile pour un état initial)
   * @returns {{id: number, tier: number}|null} L'item créé, ou null si le placement est refusé
   */
  placeItem(index, tier, { silent = false } = {}) {
    if (!this.isEmpty(index)) return null;
    if (!this.isValidTier(tier)) return null;

    const item = { id: this.nextItemId++, tier };
    this.cells[index] = item;
    if (!silent) this.events.emit('spawn', { index, item });
    this.syncFullState();
    return item;
  }

  /** Vrai si `tier` est un tier d'item légal pour cette grille. */
  isValidTier(tier) {
    return Number.isInteger(tier) && tier >= 1 && tier <= this.maxTier;
  }

  /**
   * Fait apparaître un item d'un tier donné sur une case libre tirée au sort.
   *
   * @param {number} tier
   * @param {() => number} [rng] Générateur [0, 1), injectable pour les tests
   * @returns {{index: number, item: object}|null} null si la grille est pleine
   */
  spawn(tier, rng = Math.random) {
    const free = this.emptyIndices();
    if (free.length === 0) return null;

    const index = free[Math.min(free.length - 1, Math.floor(rng() * free.length))];
    const item = this.placeItem(index, tier);
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
    // Deux items identiques, et le résultat doit rester dans la plage de tiers.
    return source.tier === target.tier && source.tier < this.maxTier;
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

    const item = { id: this.nextItemId++, tier: resultTier };
    this.cells[from] = null;
    this.cells[to] = item;

    const payload = {
      tier,
      resultTier,
      index: to,
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
    // Case occupée par un item différent (ou déjà au tier max) : rien ne bouge.
    return {
      type: DROP.INVALID,
      reason: this.itemAt(to).tier === this.itemAt(from).tier ? 'tierMax' : 'tierDifferent',
    };
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
