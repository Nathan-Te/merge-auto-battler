/**
 * `BattleModel` — état et règles de la bande de combat. **Aucune dépendance à Phaser.**
 *
 * Même contrat que `GridModel` (cf. `CLAUDE.md`) : le modèle raisonne en unités de
 * couloir et en ticks, émet sur un `EventBus`, et n'appelle jamais le rendu. Toute la
 * logique de combat vit ici, et c'est ici qu'elle est testée.
 *
 * ## Tick logique fixe
 *
 * `update(dtMs)` accumule le temps réel et exécute des pas **de durée fixe**
 * (`battle.tickMs`, 100 ms = 10 Hz) : la simulation est donc identique quel que soit le
 * framerate, et rejouable à l'identique dans vitest sans horloge. Le rendu interpole
 * entre `enemy.prevProgress` et `enemy.progress` avec `model.alpha`.
 *
 * ## Événements émis
 *
 *   - `waveCountdown` { wave, delayMs }        pause avant la vague à venir
 *   - `waveStart`     { wave, composition, description }
 *   - `waveCleared`   { wave, wavesCleared }
 *   - `enemySpawn`    { enemy }
 *   - `enemyDeath`    { enemy }                tué par les unités
 *   - `enemyLeak`     { enemy, damage }        a atteint la base
 *   - `baseDamage`    { amount, baseHp, maxBaseHp }
 *   - `shot`          { slot, unit, target, hits, splashRadius }
 *   - `unitSpawn`     { unit, slot, origin }   une unité prend place sur la bande
 *   - `unitQueued`    { unit, position, origin }  bande pleine : l'unité attend
 *   - `unitMove`      { unit, from, to }
 *   - `unitSwap`      { from, to }
 *   - `unitMerge`     { slot, unit, consumed }
 *   - `unitRejected`  { reason }               ni slot ni place en file
 *   - `gameOver`      { wave, wavesCleared }
 */

import { EventBus } from './eventBus.js';
import { unitStats, supportBonus, slotLanePosition, enemyStats } from './battleConfig.js';
import { waveSpawnOrder, waveSpawnGapMs, waveComposition, describeWave } from './waves.js';

/** Résultats possibles d'un lâcher d'unité sur la bande (`applyUnitDrop`). */
export const UNIT_DROP = {
  MERGE: 'merge',
  MOVE: 'move',
  SWAP: 'swap',
  CANCEL: 'cancel',
  INVALID: 'invalid',
};

/** Phases de la partie. */
export const PHASE = {
  IDLE: 'idle',
  PAUSE: 'pause',
  WAVE: 'wave',
  OVER: 'over',
};

export class BattleModel {
  /**
   * @param {object} options
   * @param {object} options.config Config normalisée (`parseBattleConfig`)
   * @param {EventBus} [options.bus] Bus partagé ; sinon le modèle en crée un
   */
  constructor({ config, bus } = {}) {
    if (!config) throw new Error('BattleModel attend une config');
    this.config = config;
    this.events = bus ?? new EventBus();
    this.reset();
  }

  /** Remet la bande dans son état de début de partie, sans émettre. */
  reset() {
    const { config } = this;

    this.maxBaseHp = config.baseHp;
    this.baseHp = config.baseHp;
    /** @type {(null|object)[]} Slots d'unités, indexés de 0 (loin de la base) à N-1. */
    this.slots = new Array(config.slotCount).fill(null);
    /** @type {object[]} Unités en attente d'un slot libre (bande pleine). */
    this.pending = [];
    /** @type {object[]} Ennemis vivants, dans l'ordre d'apparition. */
    this.enemies = [];

    this.wave = 0;
    this.wavesCleared = 0;
    this.phase = PHASE.IDLE;
    this.phaseTimerMs = 0;
    /** @type {string[]} Types restant à faire apparaître dans la vague en cours. */
    this.spawnQueue = [];
    this.spawnTimerMs = 0;
    this.spawnGapMs = config.waves.spawnGapMs;

    this.accumulatorMs = 0;
    this.tickCount = 0;
    this.nextUnitId = 1;
    this.nextEnemyId = 1;
    this.over = false;
  }

  /** Démarre la partie : compte à rebours avant la vague 1. */
  start() {
    this.phase = PHASE.PAUSE;
    this.phaseTimerMs = this.config.waves.firstWaveDelayMs;
    this.events.emit('waveCountdown', { wave: 1, delayMs: this.phaseTimerMs });
  }

  // ------------------------------------------------------------------ boucle

  /**
   * Avance la simulation du temps réel écoulé, par pas fixes.
   *
   * @param {number} dtMs Temps réel écoulé depuis le dernier appel
   * @returns {number} Nombre de ticks exécutés
   */
  update(dtMs) {
    if (this.over || this.phase === PHASE.IDLE) return 0;
    if (!Number.isFinite(dtMs) || dtMs <= 0) return 0;

    this.accumulatorMs += dtMs;

    let steps = 0;
    while (this.accumulatorMs >= this.config.tickMs && steps < this.config.maxTicksPerFrame) {
      this.accumulatorMs -= this.config.tickMs;
      this.tick();
      steps += 1;
      if (this.over) break;
    }

    // Onglet masqué, gel du GPU, point d'arrêt : plutôt que de rattraper des minutes de
    // simulation d'un coup (et de tuer le joueur pendant son absence), on jette le retard.
    if (this.accumulatorMs >= this.config.tickMs) this.accumulatorMs = 0;
    return steps;
  }

  /** Fraction du tick courant déjà écoulée — le rendu interpole avec. */
  get alpha() {
    if (this.over) return 1;
    return Math.min(1, this.accumulatorMs / this.config.tickMs);
  }

  /** Un pas de simulation de `tickMs`. C'est l'unique horloge du combat. */
  tick() {
    if (this.over) return;
    this.tickCount += 1;

    this.stepPhase();
    this.stepUnits();
    this.stepEnemies();
    this.stepWaveEnd();
  }

  // ------------------------------------------------------------------ vagues

  stepPhase() {
    const { tickMs } = this.config;

    if (this.phase === PHASE.PAUSE) {
      this.phaseTimerMs -= tickMs;
      if (this.phaseTimerMs <= 0) this.startWave(this.wave + 1);
      return;
    }

    if (this.phase === PHASE.WAVE && this.spawnQueue.length > 0) {
      this.spawnTimerMs -= tickMs;
      if (this.spawnTimerMs <= 0) {
        this.spawnEnemy(this.spawnQueue.shift());
        this.spawnTimerMs = this.spawnGapMs;
      }
    }
  }

  startWave(wave) {
    this.wave = wave;
    this.phase = PHASE.WAVE;
    this.spawnQueue = waveSpawnOrder(this.config, wave);
    this.spawnGapMs = waveSpawnGapMs(this.config, wave);
    // Le premier ennemi arrive tout de suite : le bandeau « Vague N » a déjà servi de
    // temps d'anticipation pendant la pause.
    this.spawnTimerMs = 0;
    this.events.emit('waveStart', {
      wave,
      composition: waveComposition(this.config, wave),
      description: describeWave(this.config, wave),
    });
  }

  stepWaveEnd() {
    if (this.phase !== PHASE.WAVE) return;
    if (this.spawnQueue.length > 0 || this.enemies.length > 0) return;

    this.wavesCleared = this.wave;
    this.events.emit('waveCleared', { wave: this.wave, wavesCleared: this.wavesCleared });

    this.phase = PHASE.PAUSE;
    this.phaseTimerMs = this.config.waves.interWavePauseMs;
    this.events.emit('waveCountdown', { wave: this.wave + 1, delayMs: this.phaseTimerMs });
  }

  // ------------------------------------------------------------------ ennemis

  spawnEnemy(type) {
    const stats = enemyStats(this.config, type, this.wave);
    const enemy = {
      id: this.nextEnemyId++,
      type,
      label: stats.label,
      hp: stats.hp,
      maxHp: stats.hp,
      speed: stats.speed,
      damageToBase: stats.damageToBase,
      progress: 0,
      prevProgress: 0,
      /** Multiplicateur de vitesse courant (1 = pas ralenti). */
      slowFactor: 1,
      slowMsLeft: 0,
      wave: this.wave,
      /** Tick d'apparition : un ennemi n'avance pas le tick où il entre en scène. */
      spawnTick: this.tickCount,
    };
    this.enemies.push(enemy);
    this.events.emit('enemySpawn', { enemy });
    return enemy;
  }

  stepEnemies() {
    const { tickMs, laneLength } = this.config;
    const seconds = tickMs / 1000;

    // Parcours à l'envers : on retire pendant l'itération (mort ou arrivée à la base).
    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      const enemy = this.enemies[i];
      // Apparu à ce tick : il entre au bout du couloir, il n'avance qu'au tick suivant.
      if (enemy.spawnTick === this.tickCount) continue;

      if (enemy.slowMsLeft > 0) {
        enemy.slowMsLeft -= tickMs;
        if (enemy.slowMsLeft <= 0) {
          enemy.slowMsLeft = 0;
          enemy.slowFactor = 1;
        }
      }

      enemy.prevProgress = enemy.progress;
      enemy.progress += enemy.speed * enemy.slowFactor * seconds;

      if (enemy.progress >= laneLength) {
        enemy.progress = laneLength;
        this.enemies.splice(i, 1);
        this.events.emit('enemyLeak', { enemy, damage: enemy.damageToBase });
        this.damageBase(enemy.damageToBase);
        if (this.over) return;
      }
    }
  }

  damageBase(amount) {
    if (amount <= 0 || this.over) return;
    this.baseHp = Math.max(0, this.baseHp - amount);
    this.events.emit('baseDamage', {
      amount,
      baseHp: this.baseHp,
      maxBaseHp: this.maxBaseHp,
    });
    if (this.baseHp <= 0) this.endGame();
  }

  endGame() {
    if (this.over) return;
    this.over = true;
    this.phase = PHASE.OVER;
    this.accumulatorMs = 0;
    this.events.emit('gameOver', { wave: this.wave, wavesCleared: this.wavesCleared });
  }

  // ------------------------------------------------------------------ unités

  /** Position d'un slot le long du couloir, en unités de couloir. */
  slotPosition(slot) {
    return slotLanePosition(this.config, slot);
  }

  /**
   * Bonus cumulés apportés par les soutiens **voisins** d'un slot (k-1 et k+1).
   *
   * @returns {{damage: number, fireRate: number}}
   */
  supportBonusFor(slot) {
    let damage = 0;
    let fireRate = 0;
    for (const neighbour of [slot - 1, slot + 1]) {
      const unit = this.slots[neighbour];
      if (!unit) continue;
      const bonus = supportBonus(this.config, unit.type, unit.tier, { buffed: unit.buffed });
      damage += bonus.damage;
      fireRate += bonus.fireRate;
    }
    return { damage, fireRate };
  }

  /** Stats effectives d'une unité en place, soutiens voisins compris. */
  statsFor(unit) {
    const bonus = this.supportBonusFor(unit.slot);
    return unitStats(this.config, unit.type, unit.tier, {
      buffed: unit.buffed,
      supportDamage: bonus.damage,
      supportFireRate: bonus.fireRate,
    });
  }

  stepUnits() {
    const { tickMs } = this.config;

    for (const unit of this.slots) {
      if (!unit) continue;
      const stats = this.statsFor(unit);
      if (stats.fireRateMs <= 0) continue; // soutien : ne tire jamais

      if (unit.cooldownMs > 0) unit.cooldownMs = Math.max(0, unit.cooldownMs - tickMs);
      if (unit.cooldownMs > 0) continue;

      const target = this.findTarget(unit, stats.range);
      // Sans cible, l'unité reste prête à tirer : pas de cadence gâchée à l'arrivée
      // du premier ennemi.
      if (!target) continue;

      this.fire(unit, stats, target);
      unit.cooldownMs = stats.fireRateMs;
    }
  }

  /**
   * Cible d'une unité : l'ennemi **le plus avancé** à portée (distance de couloir).
   *
   * La portée est absolue : une unité peut achever un ennemi qui l'a déjà dépassée.
   */
  findTarget(unit, range) {
    const position = this.slotPosition(unit.slot);
    let best = null;
    for (const enemy of this.enemies) {
      if (Math.abs(enemy.progress - position) > range) continue;
      if (best === null || enemy.progress > best.progress) best = enemy;
    }
    return best;
  }

  fire(unit, stats, target) {
    const hits = [];

    const apply = (enemy) => {
      enemy.hp -= stats.damage;
      if (stats.role === 'slow') this.applySlow(enemy, stats);
      hits.push({ enemy, damage: stats.damage, killed: enemy.hp <= 0 });
    };

    apply(target);
    if (stats.role === 'aoe' && stats.splashRadius > 0) {
      for (const enemy of this.enemies) {
        if (enemy === target) continue;
        if (Math.abs(enemy.progress - target.progress) <= stats.splashRadius) apply(enemy);
      }
    }

    this.events.emit('shot', {
      unit,
      slot: unit.slot,
      from: this.slotPosition(unit.slot),
      target,
      hits,
      role: stats.role,
      splashRadius: stats.splashRadius,
    });

    for (const hit of hits) {
      if (hit.killed) this.killEnemy(hit.enemy);
    }
  }

  applySlow(enemy, stats) {
    // Un ralentissement plus fort remplace le précédent ; à force égale ou moindre, il
    // ne fait qu'en prolonger la durée. Sans cette règle, un ralentisseur de tier 1
    // annulerait le travail d'un tier 8.
    if (enemy.slowMsLeft <= 0 || stats.slowFactor < enemy.slowFactor) {
      enemy.slowFactor = stats.slowFactor;
    }
    enemy.slowMsLeft = Math.max(enemy.slowMsLeft, stats.slowDurationMs);
  }

  killEnemy(enemy) {
    const index = this.enemies.indexOf(enemy);
    if (index === -1) return; // déjà retiré par une autre touche de la même salve
    this.enemies.splice(index, 1);
    this.events.emit('enemyDeath', { enemy });
  }

  // ------------------------------------------------------------------ pont grille → bande

  /** Index du premier slot libre, ou -1 si la bande est pleine. */
  freeSlotIndex() {
    return this.slots.indexOf(null);
  }

  /** Nombre d'unités en place. */
  unitCount() {
    return this.slots.reduce((total, unit) => total + (unit ? 1 : 0), 0);
  }

  /**
   * Vrai si une fusion de grille peut produire une unité **maintenant** : un slot libre,
   * ou de la place dans la file d'attente.
   *
   * C'est la condition que `GameSession` interroge avant d'autoriser une fusion sur la
   * grille — voir la boucle de pression décrite dans `CLAUDE.md`.
   */
  canAcceptUnit() {
    return this.freeSlotIndex() !== -1 || this.pending.length < this.config.queueSize;
  }

  /**
   * Fait naître une unité du tier donné, avec le type dicté par la file de types.
   *
   * @param {number} tier Tier de l'unité (= tier des deux items fusionnés)
   * @param {string} type Type d'unité (fourni par `UnitQueue`, cf. `GameSession`)
   * @param {object} [origin] Métadonnée opaque transmise telle quelle dans l'événement :
   *   le rendu s'en sert pour savoir d'où faire voler l'item (case de grille ou file).
   * @returns {{unit: object, slot: number|null, queued: boolean}|null} null si refusé
   */
  addUnit(tier, type, origin = null) {
    if (this.over) return null;

    const unit = {
      id: this.nextUnitId++,
      type,
      tier,
      buffed: false,
      slot: -1,
      cooldownMs: 0,
    };

    const slot = this.freeSlotIndex();
    if (slot !== -1) {
      this.placeUnit(unit, slot, origin);
      return { unit, slot, queued: false };
    }

    if (this.pending.length < this.config.queueSize) {
      this.pending.push(unit);
      this.events.emit('unitQueued', { unit, position: this.pending.length - 1, origin });
      return { unit, slot: null, queued: true };
    }

    this.events.emit('unitRejected', { reason: 'fileEtBandePleines', tier, type });
    return null;
  }

  placeUnit(unit, slot, origin = null) {
    unit.slot = slot;
    this.slots[slot] = unit;
    this.events.emit('unitSpawn', { unit, slot, origin });
  }

  /**
   * Fait entrer la première unité en attente sur un slot libre, s'il y en a un.
   * Appelé après chaque libération de slot (fusion d'unités).
   */
  flushPending() {
    while (this.pending.length > 0) {
      const slot = this.freeSlotIndex();
      if (slot === -1) return;
      const unit = this.pending.shift();
      this.placeUnit(unit, slot, { kind: 'queue' });
    }
  }

  // ------------------------------------------------------------------ geste sur la bande

  /** Vrai si lâcher l'unité de `from` sur `to` produit une fusion renforcée. */
  canMergeUnits(from, to) {
    const source = this.slots[from];
    const target = this.slots[to];
    if (!source || !target || from === to) return false;
    // Adjacence des slots : c'est la mécanique du seed doc, et c'est ce qui donne du
    // sens au placement (les unités se déplacent et s'échangent pour se rapprocher).
    if (Math.abs(from - to) !== 1) return false;
    // Un seul niveau de renfort en V1.
    return source.type === target.type && source.tier === target.tier && !source.buffed && !target.buffed;
  }

  /**
   * Point d'entrée du drag sur la bande — le pendant de `GridModel.applyDrop`.
   *
   * Quatre issues : fusion (unités identiques adjacentes), déplacement (slot libre),
   * échange (slot occupé non fusionnable) ou refus. L'échange est ce qui évite
   * l'impasse « bande pleine, aucune paire adjacente » : le joueur peut toujours
   * réorganiser pour rapprocher deux unités identiques.
   *
   * @returns {{type: string, [k: string]: any}} `type` ∈ UNIT_DROP
   */
  applyUnitDrop(from, to) {
    if (!this.isValidSlot(from) || this.slots[from] === null) {
      return { type: UNIT_DROP.INVALID, reason: 'slotSourceVide' };
    }
    if (!this.isValidSlot(to)) return { type: UNIT_DROP.INVALID, reason: 'horsBande' };
    if (from === to) return { type: UNIT_DROP.CANCEL };

    if (this.canMergeUnits(from, to)) return { type: UNIT_DROP.MERGE, ...this.mergeUnits(from, to) };
    if (this.slots[to] === null) {
      this.moveUnit(from, to);
      return { type: UNIT_DROP.MOVE, from, to };
    }
    this.swapUnits(from, to);
    return { type: UNIT_DROP.SWAP, from, to };
  }

  isValidSlot(slot) {
    return Number.isInteger(slot) && slot >= 0 && slot < this.slots.length;
  }

  moveUnit(from, to) {
    const unit = this.slots[from];
    if (!unit || this.slots[to] !== null) return false;
    this.slots[from] = null;
    this.slots[to] = unit;
    unit.slot = to;
    this.events.emit('unitMove', { unit, from, to });
    return true;
  }

  swapUnits(from, to) {
    const source = this.slots[from];
    const target = this.slots[to];
    if (!source || !target) return false;
    this.slots[from] = target;
    this.slots[to] = source;
    source.slot = to;
    target.slot = from;
    this.events.emit('unitSwap', { from, to, source, target });
    return true;
  }

  /**
   * Fusionne deux unités identiques adjacentes en une version renforcée (★).
   *
   * @returns {{slot: number, unit: object, consumed: object[]}|null}
   */
  mergeUnits(from, to) {
    if (!this.canMergeUnits(from, to)) return null;

    const source = this.slots[from];
    const target = this.slots[to];

    target.buffed = true;
    // La cadence repart de zéro : sans ça, le renfort offrirait un tir gratuit.
    target.cooldownMs = 0;
    this.slots[from] = null;

    const payload = { slot: to, unit: target, consumed: [source, target], from, to };
    this.events.emit('unitMerge', payload);
    // Un slot vient de se libérer : la file d'attente peut se vider d'un cran.
    this.flushPending();
    return payload;
  }
}

export default BattleModel;
