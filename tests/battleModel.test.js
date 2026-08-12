import { describe, it, expect, beforeEach } from 'vitest';
import { parseBattleConfig } from '../src/systems/battleConfig.js';
import { BattleModel, PHASE } from '../src/systems/BattleModel.js';
import { EventBus } from '../src/systems/eventBus.js';

/**
 * Config de test : des nombres ronds pour que chaque assertion se calcule de tête.
 * Couloir de 1000 unités, tick de 100 ms, donc un ennemi à 100 u/s avance de 10 par tick
 * et met exactement 100 ticks à atteindre la base.
 *
 * Les unités entrent à la progression 1000 (la base) et marchent vers 0 ; les ennemis
 * font le trajet inverse.
 */
const TEST_BALANCE = {
  battle: {
    tickMs: 100,
    maxTicksPerFrame: 5,
    laneLength: 1000,
    slotCount: 4,
    deployCooldownMs: 1000,
    maxFieldUnits: 6,
    baseHp: 100,
    unitTypePattern: ['single'],
    maxSupportFireRateBonus: 0.6,
  },
  units: {
    single: {
      label: 'Mono',
      role: 'damage',
      hp: 100,
      speed: 100,
      damage: 10,
      fireRateMs: 1000,
      range: 200,
      tierScaling: { hp: 2, damage: 2, fireRateMs: 1, range: 1, effect: 1 },
    },
    aoe: {
      label: 'Zone',
      role: 'aoe',
      hp: 100,
      speed: 100,
      damage: 5,
      fireRateMs: 1000,
      range: 200,
      splashRadius: 100,
      tierScaling: { hp: 1, damage: 1, fireRateMs: 1, range: 1, effect: 1 },
    },
    slow: {
      label: 'Ralenti',
      role: 'slow',
      hp: 100,
      speed: 100,
      damage: 1,
      fireRateMs: 1000,
      range: 200,
      slowFactor: 0.5,
      slowDurationMs: 1000,
      slowRadius: 100,
      tierScaling: { hp: 1, damage: 1, fireRateMs: 1, range: 1, effect: 1 },
    },
    support: {
      label: 'Soutien',
      role: 'support',
      hp: 100,
      speed: 100,
      damage: 0,
      fireRateMs: 0,
      range: 150,
      auraRadius: 100,
      buff: { damage: 1, fireRate: 0.5 },
      tierScaling: { hp: 1, damage: 1, fireRateMs: 1, range: 1, effect: 1 },
    },
  },
  enemies: {
    basic: {
      label: 'Basique',
      hp: 100,
      speed: 100,
      damageToBase: 10,
      damage: 10,
      attackRateMs: 1000,
      attackRange: 50,
    },
    fast: {
      label: 'Rapide',
      hp: 10,
      speed: 200,
      damageToBase: 5,
      damage: 5,
      attackRateMs: 500,
      attackRange: 50,
    },
    tank: {
      label: 'Tank',
      hp: 1000,
      speed: 50,
      damageToBase: 50,
      damage: 50,
      attackRateMs: 1000,
      attackRange: 50,
    },
  },
  waves: {
    firstWaveDelayMs: 0,
    interWavePauseMs: 1000,
    spawnGapMs: 1000,
    scripted: [[{ type: 'basic', count: 1 }], [{ type: 'basic', count: 2 }]],
    infinite: [{ type: 'basic', count: 2 }],
    scaling: {
      hpPerWave: 1,
      speedPerWave: 1,
      damagePerWave: 1,
      countPerWave: 1,
      spawnGapPerWave: 1,
      minSpawnGapMs: 100,
      maxCountPerEntry: 10,
    },
  },
};

/** Fusion profonde, pour ne surcharger qu'une poignée de clés par test. */
function deepMerge(base, patch) {
  const result = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(patch ?? {})) {
    result[key] =
      value && typeof value === 'object' && !Array.isArray(value)
        ? deepMerge(base?.[key] ?? {}, value)
        : value;
  }
  return result;
}

function makeModel(patch) {
  return new BattleModel({ config: parseBattleConfig(deepMerge(TEST_BALANCE, patch)) });
}

/** Collecte les événements émis, pour les assertions. */
function record(model, type) {
  const received = [];
  model.events.on(type, (payload) => received.push(payload));
  return received;
}

function runTicks(model, count) {
  for (let i = 0; i < count; i += 1) model.tick();
}

/** Pose une unité directement à une position de couloir donnée. */
function placeUnit(model, progress, { type = 'single', tier = 1 } = {}) {
  const unit = model.spawnUnit(tier, type);
  unit.progress = progress;
  unit.prevProgress = progress;
  return unit;
}

describe('BattleModel — tick logique fixe', () => {
  it('ne simule rien tant que la partie n’a pas démarré', () => {
    const model = makeModel();
    expect(model.phase).toBe(PHASE.IDLE);
    expect(model.update(5000)).toBe(0);
    expect(model.tickCount).toBe(0);
  });

  it('exécute un nombre entier de pas et garde le reste pour la frame suivante', () => {
    const model = makeModel();
    model.start();

    expect(model.update(250)).toBe(2);
    expect(model.tickCount).toBe(2);
    expect(model.alpha).toBeCloseTo(0.5);

    expect(model.update(50)).toBe(1);
    expect(model.tickCount).toBe(3);
    expect(model.alpha).toBeCloseTo(0);
  });

  it('avance à l’identique quel que soit le découpage du temps réel', () => {
    const steady = makeModel();
    const jittery = makeModel();
    steady.start();
    jittery.start();

    // Même durée totale (3 s), découpée en frames irrégulières mais toutes sous le
    // plafond de rattrapage — au-delà, le modèle jette volontairement le retard.
    for (let i = 0; i < 30; i += 1) steady.update(100);
    for (const dt of [16, 84, 33, 67, 250, 50, 100, 400, 500, 400, 100, 500, 500]) {
      jittery.update(dt);
    }

    expect(jittery.tickCount).toBe(steady.tickCount);
    expect(jittery.enemies.map((e) => e.progress)).toEqual(steady.enemies.map((e) => e.progress));
  });

  it('jette le retard plutôt que de rattraper un onglet resté masqué', () => {
    const model = makeModel();
    model.start();
    expect(model.update(60_000)).toBe(TEST_BALANCE.battle.maxTicksPerFrame);
    expect(model.accumulatorMs).toBe(0);
  });

  it('ignore un delta absurde', () => {
    const model = makeModel();
    model.start();
    expect(model.update(0)).toBe(0);
    expect(model.update(-5)).toBe(0);
    expect(model.update(NaN)).toBe(0);
  });
});

describe('BattleModel — vagues', () => {
  let model;
  beforeEach(() => {
    model = makeModel();
  });

  it('annonce la vague 1 au démarrage, puis la lance après le compte à rebours', () => {
    const countdowns = record(model, 'waveCountdown');
    const starts = record(model, 'waveStart');

    model.start();
    expect(countdowns).toEqual([{ wave: 1, delayMs: 0 }]);
    expect(model.phase).toBe(PHASE.PAUSE);

    model.tick();
    expect(model.phase).toBe(PHASE.WAVE);
    expect(starts).toHaveLength(1);
    expect(starts[0].wave).toBe(1);
    expect(starts[0].description).toBe('1× Basique');
  });

  it('respecte le délai avant la première vague', () => {
    const delayed = makeModel({ waves: { firstWaveDelayMs: 1000 } });
    delayed.start();
    runTicks(delayed, 9);
    expect(delayed.phase).toBe(PHASE.PAUSE);
    delayed.tick();
    expect(delayed.phase).toBe(PHASE.WAVE);
  });

  it('fait apparaître les ennemis un par un, espacés de spawnGapMs', () => {
    const wave2 = makeModel({
      waves: { scripted: [[{ type: 'basic', count: 3 }]], spawnGapMs: 500 },
    });
    const spawns = record(wave2, 'enemySpawn');
    wave2.start();

    runTicks(wave2, 2); // tick 1 : lancement de la vague ; tick 2 : premier ennemi
    expect(spawns).toHaveLength(1);

    runTicks(wave2, 4); // 400 ms plus tard : toujours un seul
    expect(spawns).toHaveLength(1);

    wave2.tick();
    expect(spawns).toHaveLength(2);
  });

  it('termine la vague quand tous les ennemis sont apparus et morts', () => {
    const cleared = record(model, 'waveCleared');
    model.start();
    runTicks(model, 2);
    expect(model.enemies).toHaveLength(1);

    model.killEnemy(model.enemies[0]);
    model.tick();

    expect(cleared).toEqual([{ wave: 1, wavesCleared: 1 }]);
    expect(model.phase).toBe(PHASE.PAUSE);
    expect(model.wavesCleared).toBe(1);
  });

  it('enchaîne sur la vague suivante après la pause', () => {
    model.start();
    runTicks(model, 2);
    model.killEnemy(model.enemies[0]);
    model.tick(); // fin de vague 1 -> pause de 1000 ms

    runTicks(model, 10);
    expect(model.wave).toBe(2);
    expect(model.phase).toBe(PHASE.WAVE);
  });

  it('continue indéfiniment au-delà des vagues scriptées', () => {
    const infinite = makeModel({ waves: { interWavePauseMs: 0 } });
    infinite.start();
    // Un joueur parfait : tout ce qui apparaît meurt dans le tick suivant.
    for (let i = 0; i < 2000 && infinite.wavesCleared < 12; i += 1) {
      infinite.tick();
      for (const enemy of [...infinite.enemies]) infinite.killEnemy(enemy);
    }
    expect(infinite.wavesCleared).toBeGreaterThanOrEqual(12);
    expect(infinite.wave).toBeGreaterThan(TEST_BALANCE.waves.scripted.length);
    expect(infinite.over).toBe(false);
  });
});

describe('BattleModel — ennemis et base', () => {
  it('fait avancer les ennemis de speed × tick à chaque pas', () => {
    const model = makeModel();
    model.start();
    runTicks(model, 2);

    const enemy = model.enemies[0];
    expect(enemy.progress).toBe(0);
    model.tick();
    expect(enemy.progress).toBeCloseTo(10);
    runTicks(model, 4);
    expect(enemy.progress).toBeCloseTo(50);
    expect(enemy.prevProgress).toBeCloseTo(40);
  });

  it('retire l’ennemi arrivé à la base et lui inflige ses dégâts', () => {
    const model = makeModel();
    const leaks = record(model, 'enemyLeak');
    const damages = record(model, 'baseDamage');
    model.start();
    runTicks(model, 2);

    runTicks(model, 100);
    expect(model.enemies).toHaveLength(0);
    expect(leaks).toHaveLength(1);
    expect(damages[0]).toMatchObject({ amount: 10, baseHp: 90, maxBaseHp: 100 });
    expect(model.baseHp).toBe(90);
  });

  it('déclenche le game over quand la base tombe à zéro', () => {
    const model = makeModel({ battle: { baseHp: 25 } });
    const overs = record(model, 'gameOver');
    model.start();
    model.tick();

    for (let i = 0; i < 3; i += 1) {
      const enemy = model.spawnEnemy('basic');
      enemy.progress = 990;
    }
    runTicks(model, 2);

    expect(model.baseHp).toBe(0);
    expect(model.over).toBe(true);
    expect(model.phase).toBe(PHASE.OVER);
    expect(overs).toHaveLength(1);
    expect(overs[0]).toMatchObject({ wave: 1 });
  });

  it('n’émet le game over qu’une fois et gèle la simulation', () => {
    const model = makeModel({ battle: { baseHp: 10 } });
    const overs = record(model, 'gameOver');
    model.start();
    model.tick();
    model.spawnEnemy('basic').progress = 1000;
    model.tick();

    const ticksAtDeath = model.tickCount;
    model.update(10_000);
    expect(overs).toHaveLength(1);
    expect(model.tickCount).toBe(ticksAtDeath);
  });

  it('applique le scaling de vague aux ennemis qui apparaissent', () => {
    const scaled = makeModel({
      waves: {
        interWavePauseMs: 0,
        scripted: [[{ type: 'basic', count: 1 }]],
        scaling: { hpPerWave: 2, speedPerWave: 1.5, damagePerWave: 3 },
      },
    });
    scaled.start();
    scaled.tick();
    scaled.tick();
    expect(scaled.enemies[0].maxHp).toBe(100);
    expect(scaled.enemies[0].damage).toBeCloseTo(10);

    scaled.killEnemy(scaled.enemies[0]);
    scaled.tick(); // fin de vague 1
    scaled.tick(); // vague 2
    scaled.tick(); // premier ennemi de la vague 2
    expect(scaled.enemies[0].maxHp).toBe(200);
    expect(scaled.enemies[0].speed).toBeCloseTo(150);
    expect(scaled.enemies[0].damage).toBeCloseTo(30);
  });
});

/**
 * Les tests de combat pilotent les combattants à la main : la vague est repoussée très
 * loin pour qu'aucune apparition automatique ne vienne brouiller les assertions.
 */
function makeCombatModel(patch) {
  const model = makeModel(deepMerge({ waves: { firstWaveDelayMs: 10_000_000 } }, patch));
  model.start();
  return model;
}

describe('BattleModel — entrée des unités', () => {
  it('ne fait entrer une unité que par l’événement `deployUnit`', () => {
    const bus = new EventBus();
    const model = new BattleModel({ config: parseBattleConfig(TEST_BALANCE), bus });
    const spawns = record(model, 'unitSpawn');

    bus.emit('deployUnit', { tier: 3, type: 'single', origin: { kind: 'deploy' } });

    expect(model.units).toHaveLength(1);
    expect(model.units[0]).toMatchObject({ tier: 3, type: 'single' });
    expect(spawns[0].origin).toEqual({ kind: 'deploy' });
  });

  it('fait entrer l’unité au bout « base » du couloir, PV pleins', () => {
    const model = makeCombatModel();
    const unit = model.spawnUnit(2, 'single');
    // hp(tier 2) = 100 × 2 = 200
    expect(unit).toMatchObject({ progress: 1000, prevProgress: 1000, hp: 200, maxHp: 200 });
  });

  it('plafonne le nombre d’unités simultanées et le signale', () => {
    const model = makeCombatModel();
    const rejected = record(model, 'unitRejected');

    for (let i = 0; i < TEST_BALANCE.battle.maxFieldUnits; i += 1) {
      expect(model.canAcceptUnit()).toBe(true);
      expect(model.spawnUnit(1, 'single')).not.toBeNull();
    }

    expect(model.canAcceptUnit()).toBe(false);
    expect(model.spawnUnit(1, 'single')).toBeNull();
    expect(model.units).toHaveLength(TEST_BALANCE.battle.maxFieldUnits);
    expect(rejected).toHaveLength(1);
  });

  it('n’accepte plus rien après le game over', () => {
    const model = makeCombatModel();
    model.endGame();
    expect(model.canAcceptUnit()).toBe(false);
    expect(model.spawnUnit(1, 'single')).toBeNull();
  });

  it('se désabonne du bus à la destruction', () => {
    const bus = new EventBus();
    const model = new BattleModel({ config: parseBattleConfig(TEST_BALANCE), bus });
    model.destroy();
    bus.emit('deployUnit', { tier: 1, type: 'single' });
    expect(model.units).toHaveLength(0);
  });
});

describe('BattleModel — marche des deux camps', () => {
  it('fait marcher les unités vers les ennemis tant que personne n’est à portée', () => {
    const model = makeCombatModel();
    const unit = model.spawnUnit(1, 'single');

    model.tick();
    expect(unit.progress).toBeCloseTo(990); // 100 u/s × 0,1 s, vers l'entrée du couloir
    runTicks(model, 4);
    expect(unit.progress).toBeCloseTo(950);
    expect(unit.engaged).toBe(false);
  });

  it('arrête l’unité à distance de tir, sans la coller à l’ennemi', () => {
    const model = makeCombatModel();
    const unit = placeUnit(model, 500);
    const enemy = model.spawnEnemy('basic');
    enemy.progress = 250; // à 250, hors de la portée de 200

    model.tick();
    expect(unit.progress).toBeCloseTo(490);

    unit.progress = 440; // à 190 de l'ennemi : à portée
    model.tick();
    expect(unit.progress).toBe(440); // elle ne bouge plus
    expect(unit.engaged).toBe(true);
  });

  it('ne laisse pas une unité dépasser l’entrée des ennemis', () => {
    const model = makeCombatModel();
    const unit = placeUnit(model, 50);
    runTicks(model, 20);
    expect(unit.progress).toBe(0);
  });

  it('arrête l’ennemi au contact d’une unité au lieu de le laisser filer', () => {
    const model = makeCombatModel();
    placeUnit(model, 400);
    const enemy = model.spawnEnemy('basic');
    enemy.progress = 370; // dans la portée de contact (50)

    model.tick(); // le tick d'apparition ne compte pas
    model.tick();
    expect(enemy.progress).toBe(370);
  });
});

describe('BattleModel — combat mutuel', () => {
  it('inflige des dégâts dans les deux sens quand personne ne meurt', () => {
    const model = makeCombatModel({ units: { single: { hp: 1000 } } });
    const unit = placeUnit(model, 400);
    const enemy = model.spawnEnemy('basic');
    enemy.progress = 380;
    enemy.hp = 1000;

    model.tick(); // l'ennemi vient d'apparaître : il ne frappe pas encore
    model.tick();

    expect(enemy.hp).toBeLessThan(1000);
    expect(unit.hp).toBeLessThan(1000);
  });

  it('tue l’unité dont les PV tombent à zéro et émet `unitDeath`', () => {
    const model = makeCombatModel({ units: { single: { hp: 10 } } });
    const deaths = record(model, 'unitDeath');
    const unit = placeUnit(model, 400);
    const enemy = model.spawnEnemy('tank'); // 50 de dégâts
    enemy.progress = 390;

    runTicks(model, 2);

    expect(deaths).toHaveLength(1);
    expect(deaths[0].unit).toBe(unit);
    expect(model.units).toHaveLength(0);
  });

  it('tue l’ennemi dont les PV tombent à zéro et émet `enemyDeath`', () => {
    const model = makeCombatModel({ units: { single: { damage: 100 } } });
    const deaths = record(model, 'enemyDeath');
    placeUnit(model, 400);
    const enemy = model.spawnEnemy('basic');
    enemy.progress = 300;

    model.tick();
    expect(deaths).toHaveLength(1);
    expect(deaths[0].enemy).toBe(enemy);
    expect(model.enemies).toHaveLength(0);
  });

  it('émet `enemyAttack` avec sa cible et l’issue du coup', () => {
    const model = makeCombatModel({ units: { single: { hp: 5 } } });
    const attacks = record(model, 'enemyAttack');
    const unit = placeUnit(model, 400);
    const enemy = model.spawnEnemy('basic');
    enemy.progress = 390;

    runTicks(model, 2);
    expect(attacks).toHaveLength(1);
    expect(attacks[0]).toMatchObject({ enemy, unit, damage: 10, killed: true });
  });

  it('respecte la cadence des deux camps, tick après tick', () => {
    const model = makeCombatModel({ units: { single: { hp: 10_000 } } });
    const unitAttacks = record(model, 'unitAttack');
    const enemyAttacks = record(model, 'enemyAttack');
    placeUnit(model, 400);
    const enemy = model.spawnEnemy('basic');
    enemy.progress = 390;
    enemy.hp = 10_000;

    runTicks(model, 10);
    // 1000 ms de cadence, 100 ms par tick : une frappe puis une toutes les 10.
    expect(unitAttacks).toHaveLength(1);
    expect(enemyAttacks).toHaveLength(1);

    model.tick();
    expect(unitAttacks).toHaveLength(2);
    expect(enemyAttacks).toHaveLength(2);
  });

  it('vise l’ennemi le plus proche, à portée', () => {
    const model = makeCombatModel();
    placeUnit(model, 500);

    const near = model.spawnEnemy('basic');
    const far = model.spawnEnemy('basic');
    near.progress = 400;
    far.progress = 340;

    const attacks = record(model, 'unitAttack');
    model.tick();
    expect(attacks).toHaveLength(1);
    expect(attacks[0].target).toBe(near);
  });

  it('ignore les ennemis hors de portée', () => {
    const model = makeCombatModel();
    const unit = placeUnit(model, 500);
    const far = model.spawnEnemy('basic');
    far.progress = 100;

    const attacks = record(model, 'unitAttack');
    model.tick();
    expect(attacks).toHaveLength(0);
    expect(unit.progress).toBeCloseTo(490); // elle avance vers lui
  });

  it('monte en dégâts et en PV avec le tier', () => {
    const model = makeCombatModel();
    const tier3 = placeUnit(model, 400, { tier: 3 }); // 10 × 2², 100 × 2²
    expect(tier3.maxHp).toBe(400);

    const enemy = model.spawnEnemy('tank');
    enemy.progress = 350;
    model.tick();
    expect(enemy.hp).toBe(1000 - 40);
  });

  it('touche tous les ennemis dans le rayon de la zone, et eux seuls', () => {
    const model = makeCombatModel();
    placeUnit(model, 500, { type: 'aoe' });

    const target = model.spawnEnemy('tank');
    const near = model.spawnEnemy('tank');
    const far = model.spawnEnemy('tank');
    target.progress = 400;
    near.progress = 340;
    far.progress = 200;

    model.tick();
    expect(target.hp).toBe(995);
    expect(near.hp).toBe(995);
    expect(far.hp).toBe(1000);
  });

  it('ralentit toute la zone autour de sa cible, puis la relâche', () => {
    const model = makeCombatModel();
    placeUnit(model, 500, { type: 'slow' });

    const target = model.spawnEnemy('basic');
    const near = model.spawnEnemy('basic');
    const far = model.spawnEnemy('basic');
    target.progress = 400;
    near.progress = 330;
    far.progress = 100;

    model.tick();
    expect(target.slowFactor).toBe(0.5);
    expect(near.slowFactor).toBe(0.5);
    expect(far.slowFactor).toBe(1);

    // Le ralentisseur retombé, plus rien ne renouvelle l'effet : il expire (1000 ms).
    model.killUnit(model.units[0]);
    runTicks(model, 11);
    expect(target.slowFactor).toBe(1);
  });

  it('ne laisse pas un ralentissement court écraser un ralentissement long', () => {
    const model = makeCombatModel();
    placeUnit(model, 500, { type: 'slow', tier: 1 });
    const enemy = model.spawnEnemy('basic');
    enemy.progress = 450;

    model.tick();
    enemy.slowMsLeft = 5000; // un ralentissement bien plus long est déjà en cours
    model.tick();
    expect(enemy.slowMsLeft).toBeGreaterThanOrEqual(4800);
  });
});

describe('BattleModel — aura du soutien', () => {
  it('buffe les alliés dans son aura, et eux seuls', () => {
    const model = makeCombatModel();
    const near = placeUnit(model, 400);
    const far = placeUnit(model, 700);
    placeUnit(model, 450, { type: 'support' }); // aura de 100

    // buff.damage = 1 -> +100 % pour l'unité à 50, rien pour celle à 250.
    expect(model.statsFor(near).damage).toBeCloseTo(20);
    expect(model.statsFor(far).damage).toBeCloseTo(10);
    expect(model.statsFor(near).fireRateMs).toBeCloseTo(500);
  });

  it('suit ses alliés : l’aura se fait et se défait avec la marche', () => {
    const model = makeCombatModel();
    const ally = placeUnit(model, 400);
    const support = placeUnit(model, 700, { type: 'support' });

    expect(model.statsFor(ally).damage).toBeCloseTo(10);
    support.progress = 460;
    expect(model.statsFor(ally).damage).toBeCloseTo(20);
  });

  it('ne frappe jamais, mais garde sa distance face aux ennemis', () => {
    const model = makeCombatModel();
    const support = placeUnit(model, 400, { type: 'support' });
    const attacks = record(model, 'unitAttack');

    const enemy = model.spawnEnemy('basic');
    enemy.progress = 300; // à 100, dans son standoff de 150

    model.tick();
    expect(attacks).toHaveLength(0);
    expect(support.progress).toBe(400);
    expect(support.engaged).toBe(true);
  });
});

describe('BattleModel — remise à zéro', () => {
  it('efface tout l’état d’une partie précédente', () => {
    const model = makeModel();
    model.start();
    runTicks(model, 5);
    model.spawnUnit(4, 'single');
    model.spawnEnemy('basic');
    model.damageBase(50);

    model.reset();

    expect(model.baseHp).toBe(100);
    expect(model.enemies).toEqual([]);
    expect(model.units).toEqual([]);
    expect(model.wave).toBe(0);
    expect(model.wavesCleared).toBe(0);
    expect(model.tickCount).toBe(0);
    expect(model.phase).toBe(PHASE.IDLE);
    expect(model.over).toBe(false);
  });
});

/**
 * Outils d'équilibrage du Lot 3 : ils vivent dans le modèle (donc testables sans Phaser),
 * mais ne sont **jamais** un état de jeu — seul `?debug=1` les allume.
 */
describe('BattleModel — outils de debug', () => {
  it('base invincible : le coup est annoncé, les PV ne bougent pas', () => {
    const model = makeModel();
    const events = [];
    model.events.on('baseDamage', (payload) => events.push(payload));

    model.invincible = true;
    model.damageBase(40);

    expect(model.baseHp).toBe(model.maxBaseHp);
    expect(model.over).toBe(false);
    // Le rendu doit quand même réagir, sinon on règle à l'aveugle.
    expect(events).toEqual([
      { amount: 0, blocked: true, baseHp: model.maxBaseHp, maxBaseHp: model.maxBaseHp },
    ]);
  });

  it('base invincible : rien ne peut plus finir la partie', () => {
    const model = makeModel();
    model.invincible = true;
    model.damageBase(model.maxBaseHp * 10);
    expect(model.over).toBe(false);
  });

  it('saut de vague : vide les ennemis vivants et la file d’apparition', () => {
    const model = makeModel();
    model.start();
    model.startWave(3);
    model.tick();
    expect(model.enemies.length).toBeGreaterThan(0);

    const deaths = [];
    model.events.on('enemyDeath', (payload) => deaths.push(payload));
    expect(model.skipWave()).toBe(true);

    expect(model.enemies).toHaveLength(0);
    expect(model.spawnQueue).toHaveLength(0);
    // Le rendu nettoie ses vues par `enemyDeath`, marqué pour ne pas être confondu
    // avec une vraie mort.
    expect(deaths.every((payload) => payload.skipped)).toBe(true);
  });

  it('saut de vague : la vague suivante démarre par le chemin normal du modèle', () => {
    const model = makeModel();
    model.start();
    model.startWave(2);
    model.tick();
    model.skipWave();
    model.tick();

    expect(model.phase).toBe(PHASE.PAUSE);
    expect(model.wavesCleared).toBe(2);
  });

  it('saut de vague pendant la pause : écourte le compte à rebours', () => {
    const model = makeModel();
    model.start();
    expect(model.phase).toBe(PHASE.PAUSE);

    model.skipWave();
    model.tick();
    expect(model.wave).toBe(1);
  });

  it('saut de vague refusé après le game over', () => {
    const model = makeModel();
    model.start();
    model.endGame();
    expect(model.skipWave()).toBe(false);
  });
});

describe('BattleModel — comptabilité de fin de partie', () => {
  it('compte les dégâts par type d’unité, sans surkill', () => {
    const model = makeModel();
    model.start();
    model.startWave(1);
    model.tick();

    const enemy = model.enemies[0];
    const hpBefore = enemy.hp;
    const unit = model.spawnUnit(9, 'single'); // largement de quoi tuer d'un coup
    unit.progress = enemy.progress;
    model.tick();

    // Les dégâts comptés s'arrêtent aux PV réellement retirés.
    expect(model.stats.damageByType.single).toBeLessThanOrEqual(hpBefore);
    expect(model.stats.damageByType.single).toBeGreaterThan(0);
    expect(model.stats.killsByType.single).toBe(1);
    expect(model.stats.enemiesKilled).toBe(1);
  });

  it('compte les unités déployées par tier, et celles qui tombent', () => {
    const model = makeModel();
    const unit = model.spawnUnit(3, 'single');
    model.spawnUnit(3, 'aoe');
    model.spawnUnit(5, 'slow');

    expect(model.stats.unitsDeployed).toBe(3);
    expect(model.stats.deployedByTier).toEqual({ 3: 2, 5: 1 });

    model.killUnit(unit);
    expect(model.stats.unitsLost).toBe(1);
  });

  it('mesure la durée de la partie en temps de jeu, pas en temps réel', () => {
    const model = makeModel();
    model.start();
    for (let i = 0; i < 10; i += 1) model.update(100);
    expect(model.stats.elapsedMs).toBe(1000);
  });

  it('ne compte pas le temps jeté après un gel — la durée reste celle du jeu vécu', () => {
    const model = makeModel();
    model.start();
    // 10 ticks demandés d'un coup, 5 exécutés (`maxTicksPerFrame`), le retard est jeté.
    model.update(1000);
    expect(model.stats.elapsedMs).toBe(
      TEST_BALANCE.battle.maxTicksPerFrame * TEST_BALANCE.battle.tickMs
    );
  });
});
