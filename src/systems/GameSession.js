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
 * Le Lot 3.5 ajoute la **boucle de décision** par-dessus, et elle vit ici aussi :
 *
 *   - **annonce de vague** — `BattleModel` annonce la composition à venir pendant chaque
 *     pause, formule infinie comprise (`hud().countdown`) ;
 *   - **file de types active** — trois types visibles, et `skipUnitType()` défausse la tête
 *     contre un cooldown ;
 *   - **draft** — toutes les `draft.everyWaves` vagues, la partie **gèle** (`draftPending`)
 *     et trois cartes attendent un choix. Les améliorations sont des **modificateurs**
 *     appliqués par-dessus `balance.json`, jamais des valeurs réécrites : elles meurent
 *     donc avec la session, comme tout le reste.
 *
 * Le Lot 4 ajoute la dernière mécanique de la V1, et elle tient dans une branche du tap :
 *
 *   - **tap sur un pouvoir** — la grille produit deux familles d'items (cf. `GridModel`).
 *     Taper un item de **pouvoir** ne met rien en file : il est consommé sur-le-champ et la
 *     session émet `usePower`, que `PowerSystem` résout. Ni file, ni cooldown — la rareté
 *     du tirage et la case immobilisée sont tout le coût, ce qui fait de « garder une case
 *     pour un pouvoir » un arbitrage plutôt qu'un automatisme.
 *
 * ```
 * tap sur un item d'unité  ──`enqueueUnit`──▶ DeployQueue ──`deployUnit`──▶ BattleModel
 * tap sur un item de pouvoir ──`usePower`──▶ PowerSystem ──────────────────▶ BattleModel
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
import { DraftSystem, parseDraftConfig } from './DraftSystem.js';
import { PowerSystem, parsePowersConfig } from './PowerSystem.js';
import { ITEM_FAMILY } from './GridModel.js';

/** Issues d'un lâcher d'item sur la grille — celles de `GridModel`, telles quelles. */
export const SESSION_DROP = { ...DROP };

/** Issues d'un tap sur la grille. */
export const SESSION_TAP = {
  /** L'item est parti en file de déploiement. */
  SENT: 'sent',
  /** Un pouvoir a été utilisé : effet immédiat, ni file ni cooldown (Lot 4). */
  POWER: 'power',
  /** File de déploiement pleine, ou pouvoir sans cible : l'item reste en place. */
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
  constructor({ balance, bus, rng = Math.random, draftRng = rng } = {}) {
    this.spawnerConfig = parseSpawnerConfig(balance);
    this.battleConfig = parseBattleConfig(balance);
    this.inputConfig = parseInputConfig(balance);
    this.draftConfig = parseDraftConfig(balance);
    this.powersConfig = parsePowersConfig(balance);

    this.events = bus ?? new EventBus();
    this.draft = new DraftSystem({ config: this.draftConfig, bus: this.events, rng: draftRng });
    // Un seul accès aux modificateurs, partagé par tous les systèmes : ils lisent l'état
    // **courant** du draft, ce qui fait qu'une carte prise s'applique au tick suivant sans
    // que personne n'ait à propager quoi que ce soit.
    const getModifiers = () => this.draft.modifiers;

    this.grid = new GridModel({
      maxTier: this.spawnerConfig.maxTier,
      powerMaxTier: this.powersConfig.maxTier,
      bus: this.events,
    });
    this.battle = new BattleModel({ config: this.battleConfig, bus: this.events, getModifiers });
    this.powers = new PowerSystem({
      config: this.powersConfig,
      battle: this.battle,
      bus: this.events,
      getModifiers,
    });
    this.deployQueue = new DeployQueue({
      config: this.battleConfig,
      bus: this.events,
      // Le cap d'unités du champ retient la sortie sans consommer le cooldown.
      canDeploy: () => this.battle.canAcceptUnit(),
      getModifiers,
    });
    this.spawner = new ItemSpawner({
      config: this.spawnerConfig,
      model: this.grid,
      rng,
      getModifiers,
      powers: this.powersConfig,
    });
    this.unitQueue = new UnitQueue(this.battleConfig.unitTypePattern, {
      skipCooldownMs: this.battleConfig.skipCooldownMs,
      getModifiers,
    });

    /** Cartes proposées, tant que le joueur n'a pas choisi. Null hors draft. */
    this.pendingDraft = null;
    this.mergeCount = 0;
    this.sentCount = 0;
    /** Envois par tier — lu par le récap de fin de partie et par le harness. */
    this.sentByTier = {};
    /** Pouvoirs utilisés, total et par type — même usage descriptif (Lot 4). */
    this.powersUsed = 0;
    this.powersByType = {};
    this.blockedTaps = 0;
    this.destroyed = false;

    /**
     * Horloge d'apparition des items. Elle vit **ici** et non dans la scène : le harness
     * headless (`npm run sim`) doit produire exactement le même rythme que le jeu, sinon
     * ses conclusions d'équilibrage ne valent rien. La scène se contente d'appeler
     * `update(delta)`.
     *
     * Décompte simple pour le **tout premier** item (`firstSpawnDelayMs`), puis jauge
     * d'avancement pour les suivants — cf. `updateSpawner`.
     */
    this.spawnTimerMs = this.spawner.firstDelayMs();
    /**
     * Avancement vers la prochaine apparition, de 0 à 1.
     *
     * Une **jauge** plutôt qu'un compte à rebours, parce que l'intervalle change en cours de
     * route (Lot 4.5 : il dépend du remplissage de la grille). Un compte à rebours figerait
     * la valeur au moment où il est armé — une grille pleine programmerait vingt secondes
     * d'attente, et le joueur qui la vide juste après les subirait quand même.
     */
    this.spawnProgress = 0;

    /**
     * Observation de la grille — c'est ce qui dit si le rythme d'apparition est accordé au
     * cooldown de sortie : une grille pleine en permanence est une famine de cases, une
     * grille vide une famine d'items. Purement descriptif (cf. `recap()`).
     */
    this.gridFullMs = 0;
    this.gridSampleAccMs = 0;
    this.gridSampleCount = 0;
    this.gridItemSum = 0;

    /** @type {(() => void)[]} Désabonnements, rejoués par `destroy()`. */
    this.unsubscribes = [
      this.events.on('merge', () => this.onGridMerge()),
      this.events.on('waveCleared', ({ wave }) => this.onWaveCleared(wave)),
    ];
  }

  /** Démarre la partie : items de départ, puis compte à rebours de la vague 1. */
  start() {
    this.spawner.fillInitial();
    this.battle.start();
    return this;
  }

  /**
   * Avance le combat, le cooldown de sortie, le cooldown de « passer » et l'apparition des
   * items.
   *
   * **Un draft ouvert gèle tout** : ni combat, ni sortie de file, ni apparition d'item, ni
   * cooldown de « passer ». La pause est décidée ici, en un seul endroit — sinon un
   * compteur oublié continuerait de tourner pendant que le joueur lit ses trois cartes,
   * et le choix se paierait en temps de jeu.
   */
  update(dtMs) {
    if (this.destroyed || this.pendingDraft) return 0;

    const steps = this.battle.update(dtMs);
    // Le tick qui vient de passer a pu vider une vague et ouvrir un draft : la file et le
    // spawner ne doivent pas avancer d'une frame de plus.
    if (!this.battle.over && !this.pendingDraft) {
      this.deployQueue.update(dtMs);
      this.unitQueue.update(dtMs);
      // Les télégraphies de pouvoir avancent au même rythme que tout le reste : un impact ne
      // tombe donc jamais pendant un draft, et le mode debug à ×4 les accélère comme le
      // combat qu'elles visent.
      this.powers.update(dtMs);
      this.updateSpawner(dtMs);
      this.sampleGrid(dtMs);
    }
    return steps;
  }

  // ------------------------------------------------------------------ draft

  /**
   * Fin de vague : toutes les `draft.everyWaves` vagues, la partie s'arrête et propose
   * trois améliorations.
   *
   * Le draft s'ouvre **après** que `BattleModel` a lancé le compte à rebours de la vague
   * suivante : le joueur retrouve donc sa préparation entière en refermant les cartes, et
   * non un compte à rebours entamé pendant qu'il lisait.
   */
  onWaveCleared(wave) {
    if (this.destroyed || this.battle.over) return;
    if (!this.draft.isDraftWave(wave)) return;

    const cards = this.draft.offer();
    // Pool épuisé (toutes les améliorations au niveau maximum) : pas de draft vide, la
    // partie continue simplement.
    if (cards.length === 0) return;

    this.pendingDraft = cards;
    this.battle.paused = true;
    this.events.emit('draftOffer', { wave, cards });
  }

  /**
   * Prend une des cartes proposées et relance la partie.
   *
   * Refuse une carte qui n'est pas dans l'offre en cours : le choix vient d'une scène
   * Phaser, et une carte périmée (double-tap, écran resté ouvert) ne doit pas pouvoir
   * s'appliquer.
   *
   * @param {string} id
   * @returns {object|null} La carte prise, ou null si le choix est refusé
   */
  chooseDraft(id) {
    if (!this.pendingDraft) return null;
    if (!this.pendingDraft.some((card) => card.id === id)) return null;

    const chosen = this.draft.choose(id);
    if (!chosen) return null;

    // Effet immédiat : les modificateurs décrivent des facteurs permanents, les PV de base
    // sont un gain **ponctuel** qu'il faut poser sur le modèle.
    const heal = chosen.effect.baseHpBonus;
    if (heal > 0) this.battle.grantBaseHp(heal);

    this.pendingDraft = null;
    this.battle.paused = false;
    this.events.emit('draftResume', { chosen });
    return chosen;
  }

  /** Vrai tant qu'un draft attend un choix : la partie est gelée. */
  get draftPending() {
    return this.pendingDraft !== null;
  }

  /**
   * Échantillonne l'occupation de la grille. Le temps « grille pleine » est compté
   * exactement (le modèle connaît déjà son état), l'occupation moyenne est échantillonnée
   * au quart de seconde — inutile de compter 25 cases 60 fois par seconde pour une
   * statistique de fin de partie.
   */
  sampleGrid(dtMs) {
    if (this.grid.wasFull) this.gridFullMs += dtMs;

    this.gridSampleAccMs += dtMs;
    if (this.gridSampleAccMs < 250) return;
    this.gridSampleAccMs = 0;
    this.gridSampleCount += 1;
    this.gridItemSum += this.grid.count();
  }

  /**
   * Fait tourner l'horloge d'apparition des items.
   *
   * Deux régimes. Le premier item attend `firstSpawnDelayMs`, en décompte simple. Les
   * suivants avancent une **jauge** : chaque milliseconde en remplit une fraction de
   * l'intervalle **courant**, relu à chaque pas. C'est ce qui rend la régulation du
   * Lot 4.5 réversible — le rythme reprend dès que la grille se vide, sans attendre la fin
   * d'un délai décidé quand elle était pleine.
   *
   * Le temps est consommé par morceaux plutôt que d'un bloc : à vitesse ×4 ou après une
   * frame longue, un `dtMs` peut couvrir plusieurs intervalles, et chacun doit être calculé
   * avec le remplissage qu'il aura vraiment. La terminaison est garantie : un intervalle est
   * toujours > 0, et chaque tour consomme soit tout le temps restant, soit une apparition.
   */
  updateSpawner(dtMs) {
    if (!Number.isFinite(dtMs) || dtMs <= 0) return;

    let remaining = dtMs;

    // Régime 1 — le tout premier item. Un délai fixe, que la régulation n'a pas à toucher :
    // la grille sort du remplissage initial, son taux ne veut encore rien dire.
    if (this.spawnTimerMs > 0) {
      if (remaining < this.spawnTimerMs) {
        this.spawnTimerMs -= remaining;
        return;
      }
      remaining -= this.spawnTimerMs;
      this.spawnTimerMs = 0;
      this.spawner.trySpawn();
    }

    // Régime 2 — la jauge régulée.
    while (remaining > 0) {
      const delay = this.spawner.currentDelayMs();
      const needed = (1 - this.spawnProgress) * delay;

      if (remaining < needed) {
        this.spawnProgress += remaining / delay;
        return;
      }
      remaining -= needed;

      // Grille pleine : l'apparition est **retenue**, pas perdue. La jauge reste à fond et
      // l'item tombe à la frame où une case se libère — c'est le dernier cran de la
      // régulation, et le seul qui soit un arrêt franc.
      if (this.spawner.trySpawn() === null) {
        this.spawnProgress = 1;
        return;
      }
      this.spawnProgress = 0;
    }
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
    // Draft ouvert : la partie est gelée, rien ne part au combat. Les merges, eux, restent
    // libres — ils ne produisent rien et ne consomment aucun créneau.
    if (this.pendingDraft) return { type: SESSION_TAP.INVALID, reason: 'draftEnCours' };

    const item = this.grid.itemAt(index);
    if (item === null) return { type: SESSION_TAP.INVALID, reason: 'caseVide' };

    // Deux familles, deux taps — et le test vient **avant** celui de la file, parce qu'un
    // pouvoir ne passe pas par elle : une file pleine n'a jamais à empêcher un soin.
    if (item.family === ITEM_FAMILY.POWER) return this.applyPowerTap(index, item);

    if (!this.deployQueue.canAccept()) {
      this.blockedTaps += 1;
      const blocked = { type: SESSION_TAP.BLOCKED, reason: 'fileDeploiementPleine', index };
      this.events.emit('tapRejected', blocked);
      return blocked;
    }

    const tier = item.tier;
    const unitType = this.unitQueue.take();
    this.grid.removeItem(index);
    this.sentCount += 1;
    this.sentByTier[tier] = (this.sentByTier[tier] ?? 0) + 1;

    // `origin` remonte jusqu'au rendu : c'est ce qui lui permet de faire voler l'item
    // depuis sa case de grille vers son slot de déploiement.
    this.events.emit('enqueueUnit', { tier, type: unitType, origin: { kind: 'tap', gridIndex: index } });
    return { type: SESSION_TAP.SENT, tier, unitType, index };
  }

  /**
   * Tap sur un item de **pouvoir** : effet immédiat, pas de file, pas de cooldown.
   *
   * Le refus se décide, ici aussi, **avant** de retirer l'item : un pouvoir sans la moindre
   * cible (une météorite sans un ennemi, un soin sans une unité) ne consomme rien et laisse
   * l'item sur la grille. C'est le pendant de « pas de cooldown » — le coût d'un pouvoir est
   * sa rareté, et le perdre sur un mistap pendant une pause serait une punition que rien
   * n'annonce.
   *
   * @param {number} index Case tapée
   * @param {object} item Item de pouvoir présent sur cette case
   * @returns {{type: string, [k: string]: any}}
   */
  applyPowerTap(index, item) {
    if (!this.powers.canCast(item.power)) {
      this.blockedTaps += 1;
      const blocked = {
        type: SESSION_TAP.BLOCKED,
        reason: 'aucuneCible',
        index,
        power: item.power,
      };
      this.events.emit('tapRejected', blocked);
      return blocked;
    }

    const tier = item.tier;
    const power = item.power;
    this.grid.removeItem(index);
    this.powersUsed += 1;
    this.powersByType[power] = (this.powersByType[power] ?? 0) + 1;

    // Le contrat du Lot 4, et le seul chemin par lequel un pouvoir s'exécute. `origin`
    // remonte jusqu'au rendu, qui fait partir l'item de sa case vers la bataille — un trajet
    // volontairement distinct du vol vers les slots de déploiement.
    this.events.emit('usePower', { type: power, tier, origin: { kind: 'tap', gridIndex: index } });
    return { type: SESSION_TAP.POWER, power, tier, index };
  }

  /**
   * Défausse le type de tête de la file de types (bouton « passer »).
   *
   * @returns {{type: string, next: string}|null} Le type défaussé et celui qui prend sa
   *   place, ou null si le cooldown n'est pas écoulé
   */
  skipUnitType() {
    if (this.destroyed || this.over || this.pendingDraft) return null;
    const discarded = this.unitQueue.skip();
    if (discarded === null) return null;

    const result = { type: discarded, next: this.unitQueue.peek() };
    this.events.emit('unitTypeSkipped', result);
    return result;
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
    // Trois types annoncés depuis le Lot 3.5 : la tête (celle que le prochain tap
    // enverra) et les deux suivantes. C'est ce qui rend « passer » lisible — on voit ce
    // qu'on gagne en défaussant.
    const nextTypes = this.unitQueue.preview(3).map((type) => ({
      type,
      label: this.battleConfig.units[type].label,
    }));
    return {
      baseHp: this.battle.baseHp,
      maxBaseHp: this.battle.maxBaseHp,
      wave: this.battle.wave,
      wavesCleared: this.battle.wavesCleared,
      phase: this.battle.phase,
      nextUnitType: nextTypes[0].type,
      nextUnitLabel: nextTypes[0].label,
      followingUnitLabel: nextTypes[1].label,
      /** Les trois prochains types, tête en premier. */
      nextTypes,
      /** Bouton « passer » : disponible et avancement de son cooldown. */
      canSkip: this.unitQueue.canSkip(),
      skipRatio: this.unitQueue.skipRatio(),
      /** Vague à venir, avec sa composition — l'annonce du Lot 3.5. */
      countdown: this.battle.countdown(),
      queueLength: this.deployQueue.slots.length,
      slotCount: this.deployQueue.slotCount(),
      cooldownRatio: this.deployQueue.cooldownRatio(),
      fieldUnits: this.battle.unitCount(),
      maxFieldUnits: this.battleConfig.maxFieldUnits,
      mergeCount: this.mergeCount,
      sentCount: this.sentCount,
      powersUsed: this.powersUsed,
      /** File de déploiement pleine : le prochain tap sera refusé. */
      blocked: !this.deployQueue.canAccept(),
      /** Draft en attente d'un choix : la partie est gelée. */
      draftPending: this.draftPending,
    };
  }

  /**
   * Récapitulatif d'une partie — lu par le récap de fin de partie (`?debug=1`) et par le
   * rapport du harness (`npm run sim`). Purement descriptif : aucune règle ne s'en sert.
   *
   * @returns {{wave: number, wavesCleared: number, durationMs: number, baseHp: number,
   *            merges: number, sent: number, blockedTaps: number,
   *            sentByTier: Record<number, number>, upgrades: object[], skips: number,
   *            damageByType: Record<string, number>,
   *            killsByType: Record<string, number>, unitsLost: number,
   *            enemiesKilled: number, enemiesLeaked: number}}
   */
  recap() {
    const { stats } = this.battle;
    return {
      wave: this.battle.wave,
      wavesCleared: this.battle.wavesCleared,
      durationMs: stats.elapsedMs,
      baseHp: this.battle.baseHp,
      maxBaseHp: this.battle.maxBaseHp,
      merges: this.mergeCount,
      sent: this.sentCount,
      blockedTaps: this.blockedTaps,
      sentByTier: { ...this.sentByTier },
      /** Pouvoirs utilisés — l'autre moitié du build, depuis le Lot 4. */
      powersUsed: this.powersUsed,
      powersByType: { ...this.powersByType },
      powerDamage: stats.powerDamage,
      powerKills: stats.powerKills,
      powerHealing: stats.powerHealing,
      /** Libellés des pouvoirs, pour que l'écran de fin n'ait pas à les connaître. */
      powerLabels: Object.fromEntries(
        Object.entries(this.powersConfig.types).map(([type, def]) => [type, def.label])
      ),
      /** Le **build** de la partie : c'est ce qui donne envie d'en tenter un autre. */
      upgrades: this.draft.chosen(),
      skips: this.unitQueue.skipCount,
      damageByType: { ...stats.damageByType },
      killsByType: { ...stats.killsByType },
      /** Libellés des types, pour que l'écran de fin n'ait pas à les connaître. */
      unitLabels: Object.fromEntries(
        Object.entries(this.battleConfig.units).map(([type, def]) => [type, def.label])
      ),
      unitsDeployed: stats.unitsDeployed,
      unitsLost: stats.unitsLost,
      /** Part du temps où la grille était pleine (0 → 1). */
      gridFullShare: stats.elapsedMs > 0 ? this.gridFullMs / stats.elapsedMs : 0,
      /** Nombre moyen d'items sur la grille (sur 25 cases). */
      gridItemsAvg: this.gridSampleCount > 0 ? this.gridItemSum / this.gridSampleCount : 0,
      enemiesKilled: stats.enemiesKilled,
      enemiesLeaked: stats.enemiesLeaked,
    };
  }

  /** Retire tous les abonnements de la session. À appeler avant d'en créer une neuve. */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const off of this.unsubscribes) off();
    this.unsubscribes = [];
    this.deployQueue.destroy();
    this.powers.destroy();
    this.battle.destroy();
  }
}

export default GameSession;
