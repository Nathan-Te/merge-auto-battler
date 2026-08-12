import { describe, it, expect, beforeEach } from 'vitest';
import { parseBattleConfig } from '../src/systems/battleConfig.js';
import { BattleModel, UNIT_DROP, PHASE } from '../src/systems/BattleModel.js';

/**
 * Config de test : des nombres ronds pour que chaque assertion se calcule de tête.
 * Couloir de 1000 unités, tick de 100 ms, donc un ennemi à 100 u/s avance de 10 par tick
 * et met exactement 100 ticks à atteindre la base.
 */
const TEST_BALANCE = {
  battle: {
    tickMs: 100,
    maxTicksPerFrame: 5,
    laneLength: 1000,
    slotCount: 4,
    queueSize: 2,
    baseHp: 100,
    unitTypePattern: ['single'],
    unitBuff: { damage: 2, fireRateMs: 0.5, range: 1, effect: 2 },
    maxSupportFireRateBonus: 0.6,
  },
  units: {
    single: {
      label: 'Mono',
      role: 'damage',
      damage: 10,
      fireRateMs: 1000,
      range: 1000,
      tierScaling: { damage: 2, fireRateMs: 1, range: 1, effect: 1 },
    },
    aoe: {
      label: 'Zone',
      role: 'aoe',
      damage: 5,
      fireRateMs: 1000,
      range: 1000,
      splashRadius: 100,
      tierScaling: { damage: 1, fireRateMs: 1, range: 1, effect: 1 },
    },
    slow: {
      label: 'Ralenti',
      role: 'slow',
      damage: 1,
      fireRateMs: 1000,
      range: 1000,
      slowFactor: 0.5,
      slowDurationMs: 1000,
      tierScaling: { damage: 1, fireRateMs: 1, range: 1, effect: 1 },
    },
    support: {
      label: 'Soutien',
      role: 'support',
      damage: 0,
      fireRateMs: 0,
      range: 0,
      buff: { damage: 1, fireRate: 0.5 },
      tierScaling: { damage: 1, fireRateMs: 1, range: 1, effect: 1 },
    },
  },
  enemies: {
    basic: { label: 'Basique', hp: 100, speed: 100, damageToBase: 10 },
    fast: { label: 'Rapide', hp: 10, speed: 200, damageToBase: 5 },
    tank: { label: 'Tank', hp: 1000, speed: 50, damageToBase: 50 },
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

/** Pose une unité directement dans un slot (le pont grille → bande est testé ailleurs). */
function placeUnit(model, slot, { type = 'single', tier = 1, buffed = false } = {}) {
  const unit = { id: model.nextUnitId++, type, tier, buffed, slot, cooldownMs: 0 };
  model.slots[slot] = unit;
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

  it('ne considère pas une vague terminée tant qu’il reste des ennemis à faire apparaître', () => {
    const wave = makeModel({ waves: { scripted: [[{ type: 'basic', count: 3 }]] } });
    wave.start();
    runTicks(wave, 2);
    wave.killEnemy(wave.enemies[0]);
    wave.tick();
    expect(wave.phase).toBe(PHASE.WAVE);
    expect(wave.wavesCleared).toBe(0);
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
        scaling: { hpPerWave: 2, speedPerWave: 1.5 },
      },
    });
    scaled.start();
    scaled.tick();
    scaled.tick();
    expect(scaled.enemies[0].maxHp).toBe(100);

    scaled.killEnemy(scaled.enemies[0]);
    scaled.tick(); // fin de vague 1
    scaled.tick(); // vague 2
    scaled.tick(); // premier ennemi de la vague 2
    expect(scaled.enemies[0].maxHp).toBe(200);
    expect(scaled.enemies[0].speed).toBeCloseTo(150);
  });
});

/**
 * Les tests de combat pilotent les ennemis à la main : la vague est repoussée très loin
 * pour qu'aucune apparition automatique ne vienne brouiller les assertions.
 */
function makeCombatModel(patch) {
  const model = makeModel(deepMerge({ waves: { firstWaveDelayMs: 10_000_000 } }, patch));
  model.start();
  return model;
}

describe('BattleModel — combat', () => {
  it('tire sur l’ennemi le plus avancé à portée', () => {
    const model = makeCombatModel();
    placeUnit(model, 0);

    const behind = model.spawnEnemy('basic');
    const ahead = model.spawnEnemy('basic');
    behind.progress = 100;
    ahead.progress = 400;

    const shots = record(model, 'shot');
    model.tick();

    expect(shots).toHaveLength(1);
    expect(shots[0].target).toBe(ahead);
    expect(ahead.hp).toBe(90);
    expect(behind.hp).toBe(100);
  });

  it('ignore les ennemis hors de portée, même très avancés', () => {
    const model = makeCombatModel({ units: { single: { range: 100 } } });
    placeUnit(model, 0); // slot 0 -> position 125

    const far = model.spawnEnemy('basic');
    far.progress = 800;
    const near = model.spawnEnemy('basic');
    near.progress = 150;

    const shots = record(model, 'shot');
    model.tick();
    expect(shots[0].target).toBe(near);
  });

  it('peut achever un ennemi qui a déjà dépassé l’unité', () => {
    const model = makeCombatModel({ units: { single: { range: 100 } } });
    placeUnit(model, 0); // position 125

    const passed = model.spawnEnemy('basic');
    passed.progress = 200;

    const shots = record(model, 'shot');
    model.tick();
    expect(shots).toHaveLength(1);
    expect(shots[0].target).toBe(passed);
  });

  it('respecte la cadence de tir, tick après tick', () => {
    const model = makeCombatModel();
    placeUnit(model, 0);
    const enemy = model.spawnEnemy('basic');
    enemy.progress = 200;

    const shots = record(model, 'shot');
    runTicks(model, 10);
    // 1000 ms de cadence, 100 ms par tick : un tir au premier tick, puis un tous les 10.
    expect(shots).toHaveLength(1);
    model.tick();
    expect(shots).toHaveLength(2);
  });

  it('reste prête à tirer tant qu’aucun ennemi n’est à portée', () => {
    const model = makeCombatModel();
    const unit = placeUnit(model, 0);

    runTicks(model, 30);
    expect(unit.cooldownMs).toBe(0);

    const shots = record(model, 'shot');
    model.spawnEnemy('basic').progress = 200;
    model.tick();
    expect(shots).toHaveLength(1);
  });

  it('tue l’ennemi dont les PV tombent à zéro et émet `enemyDeath`', () => {
    const model = makeCombatModel({ units: { single: { damage: 100 } } });
    placeUnit(model, 0);

    const deaths = record(model, 'enemyDeath');
    const enemy = model.spawnEnemy('basic');
    enemy.progress = 200;

    model.tick();
    expect(deaths).toHaveLength(1);
    expect(deaths[0].enemy).toBe(enemy);
    expect(model.enemies).toHaveLength(0);
  });

  it('monte en dégâts avec le tier', () => {
    const model = makeCombatModel();
    placeUnit(model, 0, { tier: 3 }); // 10 × 2^2

    const enemy = model.spawnEnemy('tank');
    enemy.progress = 200;
    model.tick();
    expect(enemy.hp).toBe(1000 - 40);
  });

  it('touche tous les ennemis dans le rayon de la zone, et eux seuls', () => {
    const model = makeCombatModel();
    placeUnit(model, 0, { type: 'aoe' });

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

  it('ralentit sa cible pendant la durée configurée, puis la relâche', () => {
    const model = makeCombatModel();
    placeUnit(model, 0, { type: 'slow' });

    const enemy = model.spawnEnemy('basic');
    enemy.progress = 200;

    model.tick(); // tir + ralentissement, puis déplacement à vitesse réduite
    expect(enemy.slowFactor).toBe(0.5);
    expect(enemy.progress).toBeCloseTo(205);

    runTicks(model, 9); // le ralentissement expire (1000 ms)
    expect(enemy.slowFactor).toBe(1);
  });

  it('ne laisse pas un ralentissement court écraser un ralentissement long', () => {
    const model = makeCombatModel();
    placeUnit(model, 0, { type: 'slow', buffed: true }); // effect ×2 -> durée 2000 ms
    placeUnit(model, 1, { type: 'slow' }); // durée 1000 ms, tire sur la même cible

    const enemy = model.spawnEnemy('basic');
    enemy.progress = 300;
    model.tick();

    expect(enemy.slowFactor).toBe(0.5);
    expect(enemy.slowMsLeft).toBeGreaterThanOrEqual(1900);
  });

  it('fait buffer les slots voisins par un soutien, et eux seuls', () => {
    const model = makeCombatModel();
    placeUnit(model, 0);
    placeUnit(model, 1, { type: 'support' });
    placeUnit(model, 3);

    // buff.damage = 1 -> +100 % pour le slot 0 (voisin), rien pour le slot 3.
    expect(model.statsFor(model.slots[0]).damage).toBeCloseTo(20);
    expect(model.statsFor(model.slots[3]).damage).toBeCloseTo(10);
    expect(model.statsFor(model.slots[0]).fireRateMs).toBeCloseTo(500);
  });

  it('multiplie les stats d’une unité renforcée', () => {
    const model = makeModel();
    const plain = placeUnit(model, 0);
    const buffed = placeUnit(model, 2, { buffed: true });
    expect(model.statsFor(buffed).damage).toBeCloseTo(model.statsFor(plain).damage * 2);
    expect(model.statsFor(buffed).fireRateMs).toBeCloseTo(500);
  });
});

describe('BattleModel — accueil des unités', () => {
  let model;
  beforeEach(() => {
    model = makeModel();
    model.start();
  });

  it('remplit les slots dans l’ordre, du plus éloigné de la base au plus proche', () => {
    const spawns = record(model, 'unitSpawn');
    for (let i = 0; i < 4; i += 1) model.addUnit(1, 'single');

    expect(model.slots.map((unit) => unit.slot)).toEqual([0, 1, 2, 3]);
    expect(spawns.map((payload) => payload.slot)).toEqual([0, 1, 2, 3]);
    expect(model.unitCount()).toBe(4);
  });

  it('transmet l’origine du vol telle quelle au rendu', () => {
    const spawns = record(model, 'unitSpawn');
    model.addUnit(2, 'single', { kind: 'merge', gridIndex: 17 });
    expect(spawns[0].origin).toEqual({ kind: 'merge', gridIndex: 17 });
    expect(spawns[0].unit).toMatchObject({ tier: 2, type: 'single', buffed: false });
  });

  it('met les unités en surplus dans la file d’attente', () => {
    const queued = record(model, 'unitQueued');
    for (let i = 0; i < 6; i += 1) model.addUnit(1, 'single');

    expect(model.unitCount()).toBe(4);
    expect(model.pending).toHaveLength(2);
    expect(queued.map((payload) => payload.position)).toEqual([0, 1]);
  });

  it('refuse une unité de plus quand la bande et la file sont pleines', () => {
    const rejected = record(model, 'unitRejected');
    for (let i = 0; i < 6; i += 1) model.addUnit(1, 'single');

    expect(model.canAcceptUnit()).toBe(false);
    expect(model.addUnit(1, 'single')).toBeNull();
    expect(rejected).toHaveLength(1);
    expect(model.pending).toHaveLength(2);
  });

  it('accepte tant qu’il reste un slot ou une place en file', () => {
    for (let i = 0; i < 5; i += 1) {
      expect(model.canAcceptUnit()).toBe(true);
      model.addUnit(1, 'single');
    }
    expect(model.canAcceptUnit()).toBe(true);
    model.addUnit(1, 'single');
    expect(model.canAcceptUnit()).toBe(false);
  });

  it('n’accepte plus rien après le game over', () => {
    model.endGame();
    expect(model.addUnit(1, 'single')).toBeNull();
  });
});

describe('BattleModel — geste sur la bande', () => {
  let model;
  beforeEach(() => {
    model = makeModel();
    model.start();
  });

  it('déplace une unité vers un slot libre', () => {
    const unit = placeUnit(model, 0);
    const moves = record(model, 'unitMove');

    expect(model.applyUnitDrop(0, 2)).toMatchObject({ type: UNIT_DROP.MOVE });
    expect(model.slots[0]).toBeNull();
    expect(model.slots[2]).toBe(unit);
    expect(unit.slot).toBe(2);
    expect(moves).toHaveLength(1);
  });

  it('échange deux unités qui ne peuvent pas fusionner', () => {
    const a = placeUnit(model, 0, { tier: 1 });
    const b = placeUnit(model, 3, { tier: 5 });

    expect(model.applyUnitDrop(0, 3)).toMatchObject({ type: UNIT_DROP.SWAP });
    expect(model.slots[0]).toBe(b);
    expect(model.slots[3]).toBe(a);
    expect(a.slot).toBe(3);
    expect(b.slot).toBe(0);
  });

  it('fusionne deux unités identiques adjacentes en une version renforcée', () => {
    placeUnit(model, 1, { tier: 4 });
    const target = placeUnit(model, 2, { tier: 4 });
    const merges = record(model, 'unitMerge');

    const result = model.applyUnitDrop(1, 2);
    expect(result.type).toBe(UNIT_DROP.MERGE);
    expect(model.slots[1]).toBeNull();
    expect(model.slots[2]).toBe(target);
    expect(target.buffed).toBe(true);
    expect(target.tier).toBe(4);
    expect(merges).toHaveLength(1);
  });

  it('refuse de fusionner des unités non adjacentes, de types ou de tiers différents', () => {
    placeUnit(model, 0, { tier: 2 });
    placeUnit(model, 3, { tier: 2 });
    expect(model.canMergeUnits(0, 3)).toBe(false);
    expect(model.applyUnitDrop(0, 3).type).toBe(UNIT_DROP.SWAP);

    const model2 = makeModel();
    placeUnit(model2, 0, { tier: 2 });
    placeUnit(model2, 1, { tier: 3 });
    expect(model2.canMergeUnits(0, 1)).toBe(false);

    const model3 = makeModel();
    placeUnit(model3, 0, { type: 'aoe', tier: 2 });
    placeUnit(model3, 1, { type: 'single', tier: 2 });
    expect(model3.canMergeUnits(0, 1)).toBe(false);
  });

  it('ne renforce qu’une fois : une unité ★ ne refusionne pas', () => {
    placeUnit(model, 0, { tier: 2 });
    placeUnit(model, 1, { tier: 2, buffed: true });
    expect(model.canMergeUnits(0, 1)).toBe(false);
    expect(model.applyUnitDrop(0, 1).type).toBe(UNIT_DROP.SWAP);
  });

  it('fait entrer une unité en attente dans le slot libéré par une fusion', () => {
    for (let i = 0; i < 4; i += 1) model.addUnit(3, 'single');
    model.addUnit(7, 'single'); // part en file
    expect(model.pending).toHaveLength(1);

    const spawns = record(model, 'unitSpawn');
    model.applyUnitDrop(0, 1);

    expect(model.pending).toHaveLength(0);
    expect(spawns).toHaveLength(1);
    expect(spawns[0].origin).toEqual({ kind: 'queue' });
    expect(spawns[0].unit.tier).toBe(7);
    expect(model.unitCount()).toBe(4);
  });

  it('rend un résultat neutre sur les gestes sans effet', () => {
    placeUnit(model, 1);
    expect(model.applyUnitDrop(1, 1).type).toBe(UNIT_DROP.CANCEL);
    expect(model.applyUnitDrop(0, 1).type).toBe(UNIT_DROP.INVALID);
    expect(model.applyUnitDrop(1, 99).type).toBe(UNIT_DROP.INVALID);
    expect(model.applyUnitDrop(-1, 1).type).toBe(UNIT_DROP.INVALID);
  });
});

describe('BattleModel — remise à zéro', () => {
  it('efface tout l’état d’une partie précédente', () => {
    const model = makeModel();
    model.start();
    runTicks(model, 5);
    model.addUnit(4, 'single');
    model.spawnEnemy('basic');
    model.damageBase(50);

    model.reset();

    expect(model.baseHp).toBe(100);
    expect(model.enemies).toEqual([]);
    expect(model.slots.every((slot) => slot === null)).toBe(true);
    expect(model.pending).toEqual([]);
    expect(model.wave).toBe(0);
    expect(model.wavesCleared).toBe(0);
    expect(model.tickCount).toBe(0);
    expect(model.phase).toBe(PHASE.IDLE);
    expect(model.over).toBe(false);
  });
});
