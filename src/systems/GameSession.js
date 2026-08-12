/**
 * `GameSession` — le pont grille → bande, et l'état complet d'**une** partie.
 * **Aucune dépendance à Phaser.**
 *
 * C'est ici que vivent les règles qui appartiennent aux deux moitiés du jeu à la fois,
 * et nulle part ailleurs (surtout pas dans une scène) :
 *
 *   - une fusion de grille de tier N fait naître une unité de tier N sur la bande, du
 *     type dicté par `UnitQueue` ;
 *   - une fusion de grille est **refusée** quand la bande *et* la file d'attente sont
 *     pleines — c'est la boucle de pression du Lot 2 : le joueur doit fusionner ses
 *     unités pour débloquer sa grille.
 *
 * Une session possède ses modèles et ses abonnements ; `destroy()` les retire tous.
 * Rejouer = détruire la session et en construire une neuve : aucun état ne survit, ce
 * qui rend le bug classique du « rejouer » impossible par construction (et testable
 * sans Phaser — cf. `tests/gameSession.test.js`).
 */

import { EventBus } from './eventBus.js';
import { GridModel, DROP } from './GridModel.js';
import { ItemSpawner, parseSpawnerConfig } from './itemSpawner.js';
import { BattleModel, UNIT_DROP } from './BattleModel.js';
import { parseBattleConfig } from './battleConfig.js';
import { UnitQueue } from './unitQueue.js';

/**
 * Issues d'un lâcher d'item sur la grille, du point de vue de la session : celles de
 * `GridModel`, plus le refus propre au Lot 2.
 */
export const SESSION_DROP = { ...DROP, BLOCKED: 'blocked' };

export class GameSession {
  /**
   * @param {object} options
   * @param {object} options.balance Contenu de `balance.json`
   * @param {EventBus} [options.bus] Bus partagé ; sinon la session en crée un
   * @param {() => number} [options.rng] Générateur [0, 1), injectable pour les tests
   */
  constructor({ balance, bus, rng = Math.random } = {}) {
    this.spawnerConfig = parseSpawnerConfig(balance);
    this.battleConfig = parseBattleConfig(balance);

    this.events = bus ?? new EventBus();
    this.grid = new GridModel({ maxTier: this.spawnerConfig.maxTier, bus: this.events });
    this.battle = new BattleModel({ config: this.battleConfig, bus: this.events });
    this.spawner = new ItemSpawner({ config: this.spawnerConfig, model: this.grid, rng });
    this.unitQueue = new UnitQueue(this.battleConfig.unitTypePattern);

    this.mergeCount = 0;
    this.destroyed = false;

    /** @type {(() => void)[]} Désabonnements, rejoués par `destroy()`. */
    this.unsubscribes = [
      // Le pont proprement dit : la session écoute le contrat `merge { tier }` du Lot 1
      // sans que `GridModel` ait à connaître l'existence de la bande.
      this.events.on('merge', (payload) => this.onGridMerge(payload)),
    ];
  }

  /** Démarre la partie : items de départ, puis compte à rebours de la vague 1. */
  start() {
    this.spawner.fillInitial();
    this.battle.start();
    return this;
  }

  /** Avance la simulation de combat. La grille, elle, est pilotée par un timer. */
  update(dtMs) {
    if (this.destroyed) return 0;
    return this.battle.update(dtMs);
  }

  get over() {
    return this.battle.over;
  }

  // ------------------------------------------------------------------ grille

  /**
   * Point d'entrée du geste de drag sur la grille. La scène demande, la session décide.
   *
   * @returns {{type: string, [k: string]: any}} `type` ∈ SESSION_DROP
   */
  applyDrop(from, to) {
    // Le refus se décide **avant** la fusion : l'item ne doit pas disparaître de la
    // grille pour produire une unité que la bande n'accepterait pas.
    if (this.grid.canMerge(from, to) && !this.battle.canAcceptUnit()) {
      const blocked = { type: SESSION_DROP.BLOCKED, reason: 'bandePleine', from, to };
      this.events.emit('mergeBlocked', blocked);
      return blocked;
    }
    return this.grid.applyDrop(from, to);
  }

  onGridMerge({ tier, index }) {
    this.mergeCount += 1;
    // `origin` remonte jusqu'au rendu : c'est ce qui lui permet de faire voler l'item
    // depuis sa case de grille vers son slot.
    this.battle.addUnit(tier, this.unitQueue.take(), { kind: 'merge', gridIndex: index });
  }

  /** Tente une apparition d'item — appelé par le timer de la scène. */
  trySpawnItem() {
    if (this.destroyed || this.over) return null;
    return this.spawner.trySpawn();
  }

  // ------------------------------------------------------------------ bande

  /** Point d'entrée du geste de drag sur la bande. */
  applyUnitDrop(from, to) {
    return this.battle.applyUnitDrop(from, to);
  }

  // ------------------------------------------------------------------ lecture HUD

  /**
   * État lisible en un appel, pour le HUD — la scène n'a pas à fouiller les modèles.
   */
  hud() {
    const nextTypes = this.unitQueue.preview(2).map((type) => this.battleConfig.units[type].label);
    return {
      baseHp: this.battle.baseHp,
      maxBaseHp: this.battle.maxBaseHp,
      wave: this.battle.wave,
      wavesCleared: this.battle.wavesCleared,
      phase: this.battle.phase,
      nextUnitType: this.unitQueue.peek(),
      nextUnitLabel: nextTypes[0],
      followingUnitLabel: nextTypes[1],
      queueLength: this.battle.pending.length,
      queueSize: this.battleConfig.queueSize,
      mergeCount: this.mergeCount,
      blocked: !this.battle.canAcceptUnit(),
    };
  }

  /** Retire tous les abonnements de la session. À appeler avant d'en créer une neuve. */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const off of this.unsubscribes) off();
    this.unsubscribes = [];
  }
}

export { UNIT_DROP };
export default GameSession;
