/**
 * `GameSession` — le pont grille → champ de bataille, et l'état complet d'**une** partie.
 * **Aucune dépendance à Phaser.**
 *
 * C'est ici que vivent les règles qui appartiennent aux deux moitiés du jeu à la fois,
 * et nulle part ailleurs (surtout pas dans une scène) :
 *
 *   - **tap = envoi** : taper un item de la grille le consomme et met une unité de son
 *     tier en file de déploiement, du type dicté par `UnitQueue` ;
 *   - **glisser = merge ou déplacement** : un merge ne produit plus rien côté combat,
 *     il ne fait que monter un item d'un tier. Rien ne part automatiquement.
 *   - **file pleine** : le tap est refusé (`SESSION_TAP.BLOCKED` + `tapRejected`), l'item
 *     reste sur la grille. Ce n'est jamais durable : la file se vide au cooldown. Les
 *     merges et les déplacements, eux, restent libres **en permanence**.
 *
 * La chaîne complète, entièrement branchée sur le bus :
 *
 * ```
 * tap ──`enqueueUnit`──▶ DeployQueue ──`deployUnit`──▶ BattleModel
 * ```
 *
 * Une session possède ses modèles et ses abonnements ; `destroy()` les retire tous.
 * Rejouer = détruire la session et en construire une neuve : aucun état ne survit, ce
 * qui rend le bug classique du « rejouer » impossible par construction (et testable
 * sans Phaser — cf. `tests/gameSession.test.js`).
 */

import { EventBus } from './eventBus.js';
import { GridModel, DROP } from './GridModel.js';
import { ItemSpawner, parseSpawnerConfig } from './itemSpawner.js';
import { BattleModel } from './BattleModel.js';
import { DeployQueue } from './DeployQueue.js';
import { parseBattleConfig } from './battleConfig.js';
import { parseInputConfig } from './tapGesture.js';
import { UnitQueue } from './unitQueue.js';

/** Issues d'un lâcher d'item sur la grille — celles de `GridModel`, telles quelles. */
export const SESSION_DROP = { ...DROP };

/** Issues d'un tap sur la grille. */
export const SESSION_TAP = {
  /** L'item est parti en file de déploiement. */
  SENT: 'sent',
  /** File de déploiement pleine : l'item reste en place. */
  BLOCKED: 'blocked',
  /** Case vide, index hors grille, partie finie. */
  INVALID: 'invalid',
};

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
    this.inputConfig = parseInputConfig(balance);

    this.events = bus ?? new EventBus();
    this.grid = new GridModel({ maxTier: this.spawnerConfig.maxTier, bus: this.events });
    this.battle = new BattleModel({ config: this.battleConfig, bus: this.events });
    this.deployQueue = new DeployQueue({
      config: this.battleConfig,
      bus: this.events,
      // Le cap d'unités du champ retient la sortie sans consommer le cooldown.
      canDeploy: () => this.battle.canAcceptUnit(),
    });
    this.spawner = new ItemSpawner({ config: this.spawnerConfig, model: this.grid, rng });
    this.unitQueue = new UnitQueue(this.battleConfig.unitTypePattern);

    this.mergeCount = 0;
    this.sentCount = 0;
    this.destroyed = false;

    /** @type {(() => void)[]} Désabonnements, rejoués par `destroy()`. */
    this.unsubscribes = [this.events.on('merge', () => this.onGridMerge())];
  }

  /** Démarre la partie : items de départ, puis compte à rebours de la vague 1. */
  start() {
    this.spawner.fillInitial();
    this.battle.start();
    return this;
  }

  /** Avance le combat et le cooldown de sortie. La grille, elle, est pilotée par un timer. */
  update(dtMs) {
    if (this.destroyed) return 0;
    const steps = this.battle.update(dtMs);
    if (!this.battle.over) this.deployQueue.update(dtMs);
    return steps;
  }

  get over() {
    return this.battle.over;
  }

  // ------------------------------------------------------------------ grille

  /**
   * Point d'entrée du **glisser** sur la grille : merge ou déplacement.
   *
   * Depuis le Lot 2.5, la session ne s'interpose plus — un merge est toujours autorisé,
   * puisqu'il ne produit plus d'unité.
   *
   * @returns {{type: string, [k: string]: any}} `type` ∈ SESSION_DROP
   */
  applyDrop(from, to) {
    return this.grid.applyDrop(from, to);
  }

  /**
   * Point d'entrée du **tap** sur la grille : l'item part en file de déploiement.
   *
   * Le refus se décide **avant** de retirer l'item : rien ne doit disparaître de la
   * grille pour une unité que la file n'accepterait pas.
   *
   * @param {number} index Case tapée
   * @returns {{type: string, [k: string]: any}} `type` ∈ SESSION_TAP
   */
  applyTap(index) {
    if (this.destroyed || this.over) return { type: SESSION_TAP.INVALID, reason: 'partieFinie' };

    const item = this.grid.itemAt(index);
    if (item === null) return { type: SESSION_TAP.INVALID, reason: 'caseVide' };

    if (!this.deployQueue.canAccept()) {
      const blocked = { type: SESSION_TAP.BLOCKED, reason: 'fileDeploiementPleine', index };
      this.events.emit('tapRejected', blocked);
      return blocked;
    }

    const tier = item.tier;
    const unitType = this.unitQueue.take();
    this.grid.removeItem(index);
    this.sentCount += 1;

    // `origin` remonte jusqu'au rendu : c'est ce qui lui permet de faire voler l'item
    // depuis sa case de grille vers son slot de déploiement.
    this.events.emit('enqueueUnit', { tier, type: unitType, origin: { kind: 'tap', gridIndex: index } });
    return { type: SESSION_TAP.SENT, tier, unitType, index };
  }

  onGridMerge() {
    // Le merge ne fait plus que monter un item d'un tier : côté combat, il ne déclenche
    // rien. Seul le compteur de debug s'en souvient.
    this.mergeCount += 1;
  }

  /** Tente une apparition d'item — appelé par le timer de la scène. */
  trySpawnItem() {
    if (this.destroyed || this.over) return null;
    return this.spawner.trySpawn();
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
      queueLength: this.deployQueue.slots.length,
      slotCount: this.battleConfig.slotCount,
      cooldownRatio: this.deployQueue.cooldownRatio(),
      fieldUnits: this.battle.unitCount(),
      maxFieldUnits: this.battleConfig.maxFieldUnits,
      mergeCount: this.mergeCount,
      sentCount: this.sentCount,
      /** File de déploiement pleine : le prochain tap sera refusé. */
      blocked: !this.deployQueue.canAccept(),
    };
  }

  /** Retire tous les abonnements de la session. À appeler avant d'en créer une neuve. */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const off of this.unsubscribes) off();
    this.unsubscribes = [];
    this.deployQueue.destroy();
    this.battle.destroy();
  }
}

export default GameSession;
