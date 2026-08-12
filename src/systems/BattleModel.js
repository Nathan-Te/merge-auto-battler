/**
 * `BattleModel` — état et règles du champ de bataille. **Aucune dépendance à Phaser.**
 *
 * Même contrat que `GridModel` (cf. `CLAUDE.md`) : le modèle raisonne en unités de
 * couloir et en ticks, émet sur un `EventBus`, et n'appelle jamais le rendu. Toute la
 * logique de combat vit ici, et c'est ici qu'elle est testée.
 *
 * ## Combat mutuel (Lot 2.5)
 *
 * Il n'y a plus de banc de tir : les unités **entrent par la base** (progression
 * `laneLength`) et marchent vers les ennemis (progression décroissante), les ennemis
 * entrent à l'autre bout (progression 0) et marchent vers la base. Les deux camps
 * s'arrêtent quand un adversaire est à portée, et se frappent mutuellement — les unités
 * ont des PV et meurent. Ce qui perce atteint la base.
 *
 * Le rôle décide de la portée d'arrêt : `single` / `aoe` / `slow` s'arrêtent à leur
 * `range` et frappent, le `support` s'arrête à sa `range` (distance de sécurité) sans
 * jamais frapper et projette son aura sur les alliés à `auraRadius`.
 *
 * ## Tick logique fixe
 *
 * `update(dtMs)` accumule le temps réel et exécute des pas **de durée fixe**
 * (`battle.tickMs`, 100 ms = 10 Hz) : la simulation est donc identique quel que soit le
 * framerate, et rejouable à l'identique dans vitest sans horloge. Le rendu interpole
 * entre `prevProgress` et `progress` avec `model.alpha`, pour les deux camps.
 *
 * ## Événements émis
 *
 *   - `waveCountdown` { wave, delayMs, composition, label, description, spawnGapMs, total }
 *                                              pause avant la vague à venir, **annoncée**
 *   - `waveStart`     { wave, composition, description }
 *   - `waveCleared`   { wave, wavesCleared }
 *   - `enemySpawn`    { enemy }
 *   - `enemyDeath`    { enemy }                tué par les unités
 *   - `enemyLeak`     { enemy, damage }        a atteint la base
 *   - `enemyAttack`   { enemy, unit, damage, killed }
 *   - `baseDamage`    { amount, blocked, baseHp, maxBaseHp }  `blocked` = base invincible (debug)
 *   - `baseHeal`      { amount, baseHp, maxBaseHp }  amélioration « Fortifications »
 *   - `unitSpawn`     { unit, origin }         une unité entre sur le champ de bataille
 *   - `unitAttack`    { unit, from, target, hits, role, splashRadius }
 *   - `unitDeath`     { unit }
 *   - `unitRejected`  { reason, tier, type }   champ de bataille saturé (`maxFieldUnits`)
 *   - `gameOver`      { wave, wavesCleared }
 *
 * ## Événement consommé
 *
 *   - `deployUnit` { tier, type, origin } — émis par `DeployQueue` quand son cooldown de
 *     sortie expire. C'est **le seul** chemin par lequel une unité entre en jeu ; le
 *     modèle s'y abonne lui-même et se désabonne dans `destroy()`.
 */

import { EventBus } from './eventBus.js';
import { unitStats, supportBonus, enemyStats } from './battleConfig.js';
import {
  waveSpawnOrder,
  waveSpawnGapMs,
  waveComposition,
  describeWave,
  waveLabel,
} from './waves.js';

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
  constructor({ config, bus, getModifiers = null } = {}) {
    if (!config) throw new Error('BattleModel attend une config');
    this.config = config;
    this.events = bus ?? new EventBus();
    /**
     * Modificateurs de draft, lus **à chaque calcul de stat**. Injectés plutôt que
     * possédés : le modèle ne connaît pas le draft, il applique ce que la session lui
     * donne — et `null` (le défaut) veut dire « valeurs de `balance.json` telles quelles ».
     */
    this.getModifiers = getModifiers;
    this.reset();

    // Contrat du Lot 2.5 : une unité n'entre en jeu que par `deployUnit`.
    this.unsubscribe = this.events.on('deployUnit', ({ tier, type, origin }) =>
      this.spawnUnit(tier, type, origin)
    );
  }

  /** Remet le champ de bataille dans son état de début de partie, sans émettre. */
  reset() {
    const { config } = this;

    /**
     * Base invulnérable — **outil de debug uniquement** (`?debug=1`), jamais un état de
     * jeu : il sert à observer une vague de bout en bout sans mourir pendant le réglage.
     */
    this.invincible = false;
    /**
     * Tick suspendu — c'est le draft (Lot 3.5) qui le lève et le baisse, via `GameSession`.
     * Le drapeau vit ici plutôt que dans la session parce que l'arrêt doit être **franc** :
     * une frame peut couvrir plusieurs ticks, et sans ce test la vague suivante avancerait
     * d'un demi-pas pendant que le joueur choisit sa carte.
     */
    this.paused = false;
    /**
     * Comptabilité de fin de partie : c'est ce que lit le récap de debug et le rapport du
     * harness (`npm run sim`). Aucun effet sur les règles — on ne fait qu'observer.
     */
    this.stats = {
      /** Dégâts **effectifs** infligés aux ennemis, par type d'unité (sans surkill). */
      damageByType: {},
      /** Ennemis achevés, par type d'unité responsable du coup fatal. */
      killsByType: {},
      /** Unités entrées sur le champ, par tier. */
      deployedByTier: {},
      unitsDeployed: 0,
      unitsLost: 0,
      enemiesKilled: 0,
      enemiesLeaked: 0,
      baseDamageTaken: 0,
      /** Temps de jeu simulé, en ms (ticks × `tickMs`) — la durée réelle d'une partie. */
      elapsedMs: 0,
    };
    for (const type of Object.keys(config.units)) {
      this.stats.damageByType[type] = 0;
      this.stats.killsByType[type] = 0;
    }

    this.maxBaseHp = config.baseHp;
    this.baseHp = config.baseHp;
    /** @type {object[]} Unités du joueur sur le champ, dans l'ordre d'entrée. */
    this.units = [];
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
    /** Durée du compte à rebours en cours — le HUD en fait une jauge. */
    this.countdownTotalMs = config.waves.firstWaveDelayMs;

    this.accumulatorMs = 0;
    this.tickCount = 0;
    this.nextUnitId = 1;
    this.nextEnemyId = 1;
    this.over = false;
  }

  /** Démarre la partie : compte à rebours avant la vague 1. */
  start() {
    this.phase = PHASE.PAUSE;
    this.openCountdown(1, this.config.waves.firstWaveDelayMs);
  }

  /**
   * Ouvre un compte à rebours de préparation et **annonce la vague à venir**.
   *
   * L'annonce porte la composition, pas seulement le numéro : c'est ce qui permet au joueur
   * de croiser « ce qui arrive » et « ce que la file de types propose » — la décision
   * centrale posée au Lot 3.5. La composition vient de `waveComposition()`, qui la calcule
   * aussi bien pour les vagues scriptées que pour celles de la **formule infinie**.
   */
  openCountdown(wave, delayMs) {
    this.phaseTimerMs = delayMs;
    this.countdownTotalMs = delayMs;
    this.events.emit('waveCountdown', { wave, delayMs, ...this.wavePreview(wave) });
  }

  /**
   * Fiche d'une vague : composition, libellé de texture, cadence. Purement descriptif —
   * c'est ce que lisent le bandeau d'annonce et le HUD.
   *
   * @param {number} wave
   * @returns {{wave: number, composition: {type: string, count: number}[], label: string,
   *            description: string, spawnGapMs: number, total: number}}
   */
  wavePreview(wave) {
    const composition = waveComposition(this.config, wave);
    return {
      wave,
      composition,
      label: waveLabel(this.config, wave),
      description: describeWave(this.config, wave),
      spawnGapMs: waveSpawnGapMs(this.config, wave),
      total: composition.reduce((sum, entry) => sum + entry.count, 0),
    };
  }

  /**
   * Ce qu'il **reste** de la vague en cours : les ennemis pas encore apparus plus ceux
   * encore en vie, par type.
   *
   * C'est ce que lit le bandeau compact pendant le combat. La composition annoncée avant la
   * vague répond à « qu'est-ce qui arrive ? » ; celle-ci répond à « qu'est-ce qui arrive
   * **encore** ? », et c'est la question qu'on se pose une fois la vague lancée.
   *
   * Les types sont rendus dans l'ordre de la composition annoncée, pour que les icônes ne
   * changent pas de place en cours de vague — un compteur qui se déplace ne se lit plus.
   *
   * @returns {{wave: number, composition: {type: string, count: number}[], label: string,
   *            description: string, spawnGapMs: number, total: number}}
   */
  waveRemaining() {
    const counts = new Map();
    for (const type of this.spawnQueue) counts.set(type, (counts.get(type) ?? 0) + 1);
    for (const enemy of this.enemies) counts.set(enemy.type, (counts.get(enemy.type) ?? 0) + 1);

    const announced = waveComposition(this.config, this.wave);
    const composition = announced
      .map((entry) => ({ type: entry.type, count: counts.get(entry.type) ?? 0 }))
      .filter((entry) => entry.count > 0);
    // Un type qui n'était pas annoncé ne peut pas exister, mais on ne perd rien à ne pas en
    // dépendre : le décompte reste juste même si la composition change un jour.
    for (const [type, count] of counts) {
      if (!announced.some((entry) => entry.type === type)) composition.push({ type, count });
    }

    return {
      wave: this.wave,
      composition,
      label: waveLabel(this.config, this.wave),
      description: composition
        .map((entry) => `${entry.count}× ${this.config.enemies[entry.type].label}`)
        .join(', '),
      spawnGapMs: this.spawnGapMs,
      total: composition.reduce((sum, entry) => sum + entry.count, 0),
    };
  }

  /**
   * Ce que le HUD affiche en continu.
   *
   * Deux régimes, deux questions : pendant une **pause**, la vague à venir et le temps qui
   * reste pour s'y préparer ; pendant une **vague**, ce qu'il en reste à encaisser.
   */
  countdown() {
    const pending = this.phase === PHASE.PAUSE;
    if (pending) {
      return {
        pending: true,
        remainingMs: Math.max(0, this.phaseTimerMs),
        totalMs: this.countdownTotalMs,
        ...this.wavePreview(this.wave + 1),
      };
    }
    return {
      pending: false,
      remainingMs: 0,
      totalMs: this.countdownTotalMs,
      ...this.waveRemaining(),
    };
  }

  /** Retire l'abonnement au bus. Appelé par `GameSession.destroy()`. */
  destroy() {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  // ------------------------------------------------------------------ boucle

  /**
   * Avance la simulation du temps réel écoulé, par pas fixes.
   *
   * @param {number} dtMs Temps réel écoulé depuis le dernier appel
   * @returns {number} Nombre de ticks exécutés
   */
  update(dtMs) {
    if (this.over || this.paused || this.phase === PHASE.IDLE) return 0;
    if (!Number.isFinite(dtMs) || dtMs <= 0) return 0;

    this.accumulatorMs += dtMs;

    let steps = 0;
    while (this.accumulatorMs >= this.config.tickMs && steps < this.config.maxTicksPerFrame) {
      this.accumulatorMs -= this.config.tickMs;
      this.tick();
      steps += 1;
      // Un tick peut vider une vague et ouvrir un draft : les ticks suivants de la frame
      // ne doivent pas passer quand même.
      if (this.over || this.paused) break;
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
    this.stats.elapsedMs += this.config.tickMs;

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
      // Texture de la vague (« Rush », « Mur de tanks »…) : le bandeau l'annonce, ce qui
      // laisse au joueur une chance de préparer le bon type d'unité.
      label: waveLabel(this.config, wave),
    });
  }

  stepWaveEnd() {
    if (this.phase !== PHASE.WAVE) return;
    if (this.spawnQueue.length > 0 || this.enemies.length > 0) return;

    this.wavesCleared = this.wave;
    this.events.emit('waveCleared', { wave: this.wave, wavesCleared: this.wavesCleared });

    this.phase = PHASE.PAUSE;
    this.openCountdown(this.wave + 1, this.config.waves.interWavePauseMs);
  }

  // ------------------------------------------------------------------ unités

  /** Vrai si le champ de bataille peut accueillir une unité de plus. */
  canAcceptUnit() {
    return !this.over && this.units.length < this.config.maxFieldUnits;
  }

  /** Nombre d'unités sur le champ de bataille. */
  unitCount() {
    return this.units.length;
  }

  /**
   * Fait entrer une unité sur le champ de bataille, au bout « base » du couloir.
   *
   * Appelé par l'abonnement à `deployUnit` — jamais directement par une scène.
   *
   * @param {number} tier
   * @param {string} type
   * @param {object} [origin] Métadonnée opaque transmise telle quelle au rendu
   * @returns {object|null} L'unité créée, ou null si le champ est saturé
   */
  spawnUnit(tier, type, origin = null) {
    if (!this.canAcceptUnit()) {
      this.events.emit('unitRejected', { reason: 'champPlein', tier, type });
      return null;
    }

    // Les PV sont figés **à l'entrée** : une amélioration de blindage prise plus tard ne
    // soigne pas rétroactivement une unité déjà au combat.
    const maxHp = unitStats(this.config, type, tier, { modifiers: this.modifiers() }).hp;
    const unit = {
      id: this.nextUnitId++,
      type,
      tier,
      hp: maxHp,
      maxHp,
      // Les unités remontent le couloir : elles entrent à la base et marchent vers 0.
      progress: this.config.laneLength,
      prevProgress: this.config.laneLength,
      cooldownMs: 0,
      engaged: false,
    };
    this.units.push(unit);
    this.stats.unitsDeployed += 1;
    this.stats.deployedByTier[tier] = (this.stats.deployedByTier[tier] ?? 0) + 1;
    this.events.emit('unitSpawn', { unit, origin });
    return unit;
  }

  /**
   * Bonus cumulés apportés par les soutiens **à portée d'aura** d'une unité.
   *
   * @returns {{damage: number, fireRate: number}}
   */
  supportBonusFor(unit) {
    const modifiers = this.modifiers();
    let damage = 0;
    let fireRate = 0;
    for (const other of this.units) {
      if (other === unit) continue;
      const def = this.config.units[other.type];
      if (!def || def.role !== 'support') continue;
      const radius = unitStats(this.config, other.type, other.tier, { modifiers }).auraRadius;
      if (Math.abs(other.progress - unit.progress) > radius) continue;
      const bonus = supportBonus(this.config, other.type, other.tier, modifiers);
      damage += bonus.damage;
      fireRate += bonus.fireRate;
    }
    return { damage, fireRate };
  }

  /** Modificateurs de draft en vigueur, ou null si la partie n'en a aucun. */
  modifiers() {
    return this.getModifiers?.() ?? null;
  }

  /** Stats effectives d'une unité sur le champ, auras et améliorations comprises. */
  statsFor(unit) {
    const bonus = this.supportBonusFor(unit);
    return unitStats(this.config, unit.type, unit.tier, {
      supportDamage: bonus.damage,
      supportFireRate: bonus.fireRate,
      modifiers: this.modifiers(),
    });
  }

  stepUnits() {
    const { tickMs } = this.config;
    const seconds = tickMs / 1000;

    // Parcours à l'envers : une unité peut mourir pendant l'itération.
    for (let i = this.units.length - 1; i >= 0; i -= 1) {
      const unit = this.units[i];
      const stats = this.statsFor(unit);

      // La cadence tourne même sans cible : pas de temps de frappe gâché à l'arrivée
      // du premier ennemi.
      if (unit.cooldownMs > 0) unit.cooldownMs = Math.max(0, unit.cooldownMs - tickMs);

      const target = this.findEnemyFor(unit, stats.range);
      unit.prevProgress = unit.progress;
      unit.engaged = target !== null;

      if (!target) {
        // Personne à portée : l'unité avance vers l'entrée des ennemis et y tient la ligne.
        unit.progress = Math.max(0, unit.progress - stats.speed * seconds);
        continue;
      }

      if (stats.fireRateMs <= 0) continue; // soutien : tient sa distance, ne frappe jamais
      if (unit.cooldownMs > 0) continue;

      this.unitAttack(unit, stats, target);
      unit.cooldownMs = stats.fireRateMs;
    }
  }

  /**
   * Cible d'une unité : l'ennemi **le plus proche** dans sa portée (distance de couloir).
   *
   * La portée est absolue : une unité peut achever un ennemi qui l'a déjà dépassée. À
   * égale distance, c'est l'ennemi le plus avancé — donc le plus menaçant — qui est visé.
   */
  findEnemyFor(unit, range) {
    let best = null;
    let bestDistance = Infinity;
    for (const enemy of this.enemies) {
      const distance = Math.abs(enemy.progress - unit.progress);
      if (distance > range) continue;
      if (distance < bestDistance || (distance === bestDistance && enemy.progress > best.progress)) {
        best = enemy;
        bestDistance = distance;
      }
    }
    return best;
  }

  unitAttack(unit, stats, target) {
    const hits = [];

    const apply = (enemy) => {
      // Dégâts **effectifs** : le surkill ne doit pas gonfler le récap de fin de partie,
      // sinon un mono-cible qui achève tout paraîtrait deux fois plus utile qu'il n'est.
      const dealt = Math.max(0, Math.min(enemy.hp, stats.damage));
      enemy.hp -= stats.damage;
      const killed = enemy.hp <= 0;
      this.stats.damageByType[unit.type] += dealt;
      if (killed) this.stats.killsByType[unit.type] += 1;
      hits.push({ enemy, damage: stats.damage, killed });
    };

    apply(target);
    if (stats.role === 'aoe' && stats.splashRadius > 0) {
      for (const enemy of this.enemies) {
        if (enemy === target) continue;
        if (Math.abs(enemy.progress - target.progress) <= stats.splashRadius) apply(enemy);
      }
    }
    // Le ralentisseur frappe une cible mais **ralentit en zone** : c'est ce qui lui donne
    // sa valeur face à un groupe, à défaut de dégâts.
    if (stats.role === 'slow') {
      this.applySlow(target, stats);
      for (const enemy of this.enemies) {
        if (enemy === target) continue;
        if (Math.abs(enemy.progress - target.progress) <= stats.slowRadius) {
          this.applySlow(enemy, stats);
        }
      }
    }

    this.events.emit('unitAttack', {
      unit,
      from: unit.progress,
      target,
      hits,
      role: stats.role,
      splashRadius: stats.role === 'slow' ? stats.slowRadius : stats.splashRadius,
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

  /** Inflige des dégâts à une unité, et la retire si elle tombe. */
  damageUnit(unit, amount) {
    unit.hp -= amount;
    if (unit.hp > 0) return false;
    this.killUnit(unit);
    return true;
  }

  killUnit(unit) {
    const index = this.units.indexOf(unit);
    if (index === -1) return; // déjà retirée par un autre attaquant du même tick
    this.units.splice(index, 1);
    this.stats.unitsLost += 1;
    this.events.emit('unitDeath', { unit });
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
      damage: stats.damage,
      attackRateMs: stats.attackRateMs,
      attackRange: stats.attackRange,
      cooldownMs: 0,
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
      // Apparu à ce tick : il entre au bout du couloir, il n'agit qu'au tick suivant.
      if (enemy.spawnTick === this.tickCount) continue;

      if (enemy.slowMsLeft > 0) {
        enemy.slowMsLeft -= tickMs;
        if (enemy.slowMsLeft <= 0) {
          enemy.slowMsLeft = 0;
          enemy.slowFactor = 1;
        }
      }
      if (enemy.cooldownMs > 0) enemy.cooldownMs = Math.max(0, enemy.cooldownMs - tickMs);

      const target = this.findUnitFor(enemy);
      enemy.prevProgress = enemy.progress;

      if (target) {
        // Au contact : l'ennemi s'arrête et frappe. C'est ce qui retient une vague loin
        // de la base tant que des unités tiennent la ligne.
        if (enemy.cooldownMs <= 0) {
          const killed = this.damageUnit(target, enemy.damage);
          enemy.cooldownMs = enemy.attackRateMs;
          this.events.emit('enemyAttack', { enemy, unit: target, damage: enemy.damage, killed });
        }
        continue;
      }

      enemy.progress += enemy.speed * enemy.slowFactor * seconds;

      if (enemy.progress >= laneLength) {
        enemy.progress = laneLength;
        this.enemies.splice(i, 1);
        this.stats.enemiesLeaked += 1;
        this.events.emit('enemyLeak', { enemy, damage: enemy.damageToBase });
        this.damageBase(enemy.damageToBase);
        if (this.over) return;
      }
    }
  }

  /** Unité la plus proche d'un ennemi, dans sa portée de contact. */
  findUnitFor(enemy) {
    let best = null;
    let bestDistance = Infinity;
    for (const unit of this.units) {
      const distance = Math.abs(unit.progress - enemy.progress);
      if (distance > enemy.attackRange) continue;
      if (distance < bestDistance) {
        best = unit;
        bestDistance = distance;
      }
    }
    return best;
  }

  killEnemy(enemy) {
    const index = this.enemies.indexOf(enemy);
    if (index === -1) return; // déjà retiré par une autre touche de la même salve
    this.enemies.splice(index, 1);
    this.stats.enemiesKilled += 1;
    this.events.emit('enemyDeath', { enemy });
  }

  /**
   * Vide la vague en cours — **outil de debug uniquement** (`?debug=1`).
   *
   * Les ennemis vivants sont retirés comme s'ils étaient tués (le rendu nettoie ses vues
   * par `enemyDeath`), la file d'apparition est jetée, et une pause en cours est écourtée.
   * Le passage à la vague suivante reste celui du modèle : `stepWaveEnd` le décide au tick
   * d'après, exactement comme si le joueur avait tout nettoyé.
   *
   * @returns {boolean} false si la partie est finie
   */
  skipWave() {
    if (this.over) return false;

    this.spawnQueue.length = 0;
    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      const enemy = this.enemies[i];
      this.enemies.splice(i, 1);
      this.events.emit('enemyDeath', { enemy, skipped: true });
    }
    // En pause : le compte à rebours saute et la vague suivante démarre au tick suivant.
    if (this.phase === PHASE.PAUSE) this.phaseTimerMs = 0;
    return true;
  }

  // ------------------------------------------------------------------ base

  damageBase(amount) {
    if (amount <= 0 || this.over) return;

    // Base invulnérable (debug) : le coup est annoncé — le rendu doit réagir, sinon on
    // règle à l'aveugle — mais les PV ne bougent pas.
    if (this.invincible) {
      this.events.emit('baseDamage', {
        amount: 0,
        blocked: true,
        baseHp: this.baseHp,
        maxBaseHp: this.maxBaseHp,
      });
      return;
    }

    this.baseHp = Math.max(0, this.baseHp - amount);
    this.stats.baseDamageTaken += amount;
    this.events.emit('baseDamage', {
      amount,
      blocked: false,
      baseHp: this.baseHp,
      maxBaseHp: this.maxBaseHp,
    });
    if (this.baseHp <= 0) this.endGame();
  }

  /**
   * Renforce la base : le maximum monte, et **autant de PV sont rendus**.
   *
   * C'est l'effet immédiat de l'amélioration « Fortifications » : une carte qui ne ferait
   * que monter le plafond serait presque sans valeur quand on la prend à 20 PV, c'est-à-dire
   * exactement au moment où on la choisit.
   *
   * @param {number} amount
   * @returns {number} PV effectivement rendus
   */
  grantBaseHp(amount) {
    if (!(amount > 0) || this.over) return 0;
    this.maxBaseHp += amount;
    const before = this.baseHp;
    this.baseHp = Math.min(this.maxBaseHp, this.baseHp + amount);
    this.events.emit('baseHeal', {
      amount: this.baseHp - before,
      baseHp: this.baseHp,
      maxBaseHp: this.maxBaseHp,
    });
    return this.baseHp - before;
  }

  endGame() {
    if (this.over) return;
    this.over = true;
    this.phase = PHASE.OVER;
    this.accumulatorMs = 0;
    this.events.emit('gameOver', { wave: this.wave, wavesCleared: this.wavesCleared });
  }
}

export default BattleModel;
