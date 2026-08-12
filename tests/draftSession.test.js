import { describe, it, expect, beforeEach } from 'vitest';
import balance from '../src/config/balance.json';
import { GameSession, SESSION_TAP } from '../src/systems/GameSession.js';
import { makeRng } from '../src/systems/rng.js';
import { PHASE } from '../src/systems/BattleModel.js';

/**
 * La **boucle de décision** du Lot 3.5, vue depuis la session : annonce de vague, file de
 * types active, draft qui gèle la partie, et rejouabilité.
 *
 * Tout est déterministe et sans horloge : `session.update(dtMs)` prend le temps écoulé,
 * exactement comme la scène Phaser.
 */

const EVERY = balance.draft.everyWaves;
const SKIP_COOLDOWN = balance.battle.skipCooldownMs;

function makeSession(overrides) {
  // `rng: () => 0` fige le spawner d'items ; `draftRng` reste seedé, pour de vraies offres.
  return new GameSession({ balance, rng: () => 0, draftRng: makeRng(5), ...overrides });
}

/** Amène la session au bout d'une vague, sans jouer la vague. */
function clearWave(session, wave) {
  session.battle.wave = wave;
  session.battle.phase = PHASE.WAVE;
  session.battle.spawnQueue.length = 0;
  session.battle.enemies.length = 0;
  session.battle.stepWaveEnd();
}

describe('draft — ouverture', () => {
  let session;
  beforeEach(() => {
    session = makeSession().start();
  });

  it('s’ouvre à la fin de chaque `everyWaves` vagues, et pas entre', () => {
    const offers = [];
    session.events.on('draftOffer', (payload) => offers.push(payload));

    clearWave(session, EVERY - 1);
    expect(offers).toHaveLength(0);
    expect(session.draftPending).toBe(false);

    clearWave(session, EVERY);
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ wave: EVERY });
    expect(offers[0].cards).toHaveLength(balance.draft.cardsPerOffer);
    expect(session.draftPending).toBe(true);
  });

  it('gèle **tout** tant qu’aucune carte n’est prise', () => {
    clearWave(session, EVERY);

    const battle = session.battle;
    const before = {
      tick: battle.tickCount,
      elapsed: battle.stats.elapsedMs,
      phaseTimer: battle.phaseTimerMs,
      spawnTimer: session.spawnTimerMs,
    };

    for (let i = 0; i < 40; i += 1) expect(session.update(100)).toBe(0);

    expect(battle.tickCount).toBe(before.tick);
    expect(battle.stats.elapsedMs).toBe(before.elapsed);
    // Le compte à rebours de la vague suivante ne s'entame pas : le joueur retrouve sa
    // préparation entière en refermant les cartes.
    expect(battle.phaseTimerMs).toBe(before.phaseTimer);
    expect(session.spawnTimerMs).toBe(before.spawnTimer);
  });

  it('ne laisse rien partir au combat pendant qu’un draft attend', () => {
    clearWave(session, EVERY);
    session.grid.placeItem(0, 3, { silent: true });
    expect(session.applyTap(0)).toMatchObject({ type: SESSION_TAP.INVALID });
    expect(session.grid.itemAt(0)).not.toBeNull();
    expect(session.skipUnitType()).toBeNull();
  });

  it('reprend exactement où la partie s’était arrêtée', () => {
    clearWave(session, EVERY);
    const timer = session.battle.phaseTimerMs;

    session.chooseDraft(session.pendingDraft[0].id);

    expect(session.draftPending).toBe(false);
    expect(session.battle.paused).toBe(false);
    expect(session.battle.phaseTimerMs).toBe(timer);
    expect(session.update(100)).toBe(1);
  });

  it('refuse une carte qui n’est pas dans l’offre — un double-tap ne prend pas deux fois', () => {
    clearWave(session, EVERY);
    const offered = session.pendingDraft.map((card) => card.id);
    const outsider = balance.draft.upgrades.map((u) => u.id).find((id) => !offered.includes(id));

    expect(session.chooseDraft(outsider)).toBeNull();
    expect(session.draftPending).toBe(true);

    expect(session.chooseDraft(offered[0])).not.toBeNull();
    // La seconde tentative tombe : l'offre a été fermée par la première.
    expect(session.chooseDraft(offered[1])).toBeNull();
    expect(session.draft.chosen()).toHaveLength(1);
  });

  it('n’ouvre pas un draft vide quand le pool est épuisé', () => {
    for (const upgrade of balance.draft.upgrades) {
      for (let level = 0; level < upgrade.maxLevel; level += 1) session.draft.choose(upgrade.id);
    }
    clearWave(session, EVERY);
    expect(session.draftPending).toBe(false);
    expect(session.battle.paused).toBe(false);
  });
});

describe('draft — effets', () => {
  it('« File élargie » ouvre la place tout de suite, sans vider la file', () => {
    const session = makeSession().start();
    const before = session.deployQueue.slotCount();

    session.grid.placeItem(0, 1, { silent: true });
    session.applyTap(0);
    const queued = session.deployQueue.slots.length;

    session.draft.choose('slot');
    expect(session.deployQueue.slotCount()).toBe(before + 1);
    expect(session.deployQueue.slots).toHaveLength(queued);
  });

  it('« Fortifications » monte le plafond de PV **et** en rend autant', () => {
    const session = makeSession().start();
    session.battle.damageBase(40);
    const { baseHp, maxBaseHp } = session.battle;

    clearWave(session, EVERY);
    const bonus = balance.draft.upgrades.find((u) => u.id === 'fortify').effect.baseHpBonus;
    // On force l'offre à contenir la carte visée : ce test porte sur son effet, pas sur le
    // tirage (couvert ailleurs).
    session.pendingDraft = [session.draft.describe(session.draft.upgrade('fortify'))];
    session.chooseDraft('fortify');

    expect(session.battle.maxBaseHp).toBe(maxBaseHp + bonus);
    expect(session.battle.baseHp).toBe(baseHp + bonus);
  });

  it('« Fortifications » ne dépasse jamais le plafond quand la base est intacte', () => {
    const session = makeSession().start();
    const bonus = balance.draft.upgrades.find((u) => u.id === 'fortify').effect.baseHpBonus;
    session.draft.choose('fortify');
    session.battle.grantBaseHp(bonus);
    expect(session.battle.baseHp).toBeLessThanOrEqual(session.battle.maxBaseHp);
  });

  it('« Sortie rapide » raccourcit le cooldown de la file', () => {
    const session = makeSession().start();
    const before = session.deployQueue.cooldownDurationMs();
    session.draft.choose('deploy');
    expect(session.deployQueue.cooldownDurationMs()).toBeCloseTo(before * 0.88, 6);
  });

  it('« Gisement riche » fait apparaître les items un tier plus haut', () => {
    const session = makeSession({ rng: makeRng(3) }).start();
    session.draft.choose('richVein');
    const tiers = session.spawner.tierWeights().map((entry) => entry.tier);
    expect(Math.min(...tiers)).toBe(Math.min(...session.spawnerConfig.tierWeights.map((e) => e.tier)) + 1);
  });

  it('« Extraction » accélère l’apparition, plancher compris', () => {
    const session = makeSession().start();
    session.spawner.spawnCount = 500; // largement au plancher
    const before = session.spawner.nominalDelayMs();
    session.draft.choose('extraction');
    expect(session.spawner.nominalDelayMs()).toBeLessThan(before);
  });
});

describe('file de types — bouton « passer »', () => {
  let session;
  beforeEach(() => {
    session = makeSession().start();
  });

  it('annonce trois types, tête en premier', () => {
    const { nextTypes } = session.hud();
    expect(nextTypes).toHaveLength(3);
    expect(nextTypes.map((entry) => entry.type)).toEqual(
      balance.battle.unitTypePattern.slice(0, 3)
    );
    expect(nextTypes[0].label).toBe(balance.units[nextTypes[0].type].label);
  });

  it('défausse la tête : la file avance sans qu’aucune unité ne parte', () => {
    const pattern = balance.battle.unitTypePattern;
    const spawned = [];
    session.events.on('enqueueUnit', (payload) => spawned.push(payload));

    const result = session.skipUnitType();

    expect(result).toEqual({ type: pattern[0], next: pattern[1] });
    expect(session.hud().nextUnitType).toBe(pattern[1]);
    expect(spawned).toHaveLength(0);
  });

  it('se recharge, et refuse tant qu’il n’est pas prêt', () => {
    expect(session.hud().canSkip).toBe(true);
    session.skipUnitType();

    expect(session.hud().canSkip).toBe(false);
    expect(session.skipUnitType()).toBeNull();
    expect(session.hud().skipRatio).toBeLessThan(1);

    session.update(SKIP_COOLDOWN - 100);
    expect(session.hud().canSkip).toBe(false);
    session.update(200);
    expect(session.hud().canSkip).toBe(true);
    expect(session.skipUnitType()).not.toBeNull();
  });

  it('« Réflexe » raccourcit son cooldown', () => {
    const factor = balance.draft.upgrades.find((u) => u.id === 'reflex').effect.skipCooldown;
    session.draft.choose('reflex');
    session.skipUnitType();

    session.update(SKIP_COOLDOWN * factor + 1);
    expect(session.hud().canSkip).toBe(true);
  });

  it('compte les défausses dans le récap', () => {
    session.skipUnitType();
    session.update(SKIP_COOLDOWN);
    session.skipUnitType();
    expect(session.recap().skips).toBe(2);
  });
});

describe('annonce de vague', () => {
  it('annonce la composition dès la vague 1', () => {
    const session = makeSession();
    const countdowns = [];
    session.events.on('waveCountdown', (payload) => countdowns.push(payload));
    session.start();

    expect(countdowns).toHaveLength(1);
    expect(countdowns[0].wave).toBe(1);
    expect(countdowns[0].composition).toEqual(balance.waves.scripted[0].composition);
    expect(countdowns[0].total).toBe(3);
  });

  it('annonce aussi les vagues de la **formule infinie**', () => {
    const session = makeSession().start();
    const scripted = balance.waves.scripted.length;

    for (const wave of [scripted + 1, scripted + 5, scripted + 20]) {
      const preview = session.battle.wavePreview(wave);
      expect(preview.composition.length).toBeGreaterThan(0);
      expect(preview.total).toBeGreaterThan(0);
      expect(preview.label.length).toBeGreaterThan(0);
      expect(preview.description).toMatch(/×/);
    }
  });

  it('bascule sur ce qu’il **reste** dès que la vague est lancée', () => {
    const session = makeSession().start();
    while (session.battle.phase === PHASE.PAUSE) session.update(200);

    const total = balance.waves.scripted[0].composition[0].count;
    // Rien n'est encore apparu : tout reste à venir.
    expect(session.hud().countdown).toMatchObject({ pending: false, wave: 1, total });

    // Un ennemi apparu et vivant reste compté : il « arrive encore », il n'est pas passé.
    while (session.battle.enemies.length === 0) session.update(200);
    expect(session.battle.enemies.length).toBeGreaterThan(0);
    expect(session.hud().countdown.total).toBe(total);

    // Un ennemi tué disparaît du décompte, celui qui attend son tour non.
    const killed = session.battle.enemies[0];
    session.battle.killEnemy(killed);
    expect(session.hud().countdown.total).toBe(total - 1);
  });

  it('garde l’ordre des icônes de la composition annoncée', () => {
    const session = makeSession().start();
    session.battle.startWave(3); // 5 basiques puis 4 rapides
    session.battle.spawnEnemy('fast');

    const types = session.battle.waveRemaining().composition.map((entry) => entry.type);
    // Le rapide apparu ne remonte pas devant les basiques : un compteur qui se déplace en
    // cours de vague ne se lit plus.
    expect(types).toEqual(['basic', 'fast']);
  });

  it('donne au HUD le temps qui reste, et le remet à zéro pendant la vague', () => {
    const session = makeSession().start();
    const total = balance.waves.firstWaveDelayMs;

    expect(session.hud().countdown).toMatchObject({ pending: true, wave: 1, totalMs: total });
    session.update(1000);
    expect(session.hud().countdown.remainingMs).toBeLessThan(total);

    // Par petits pas : `maxTicksPerFrame` borne le rattrapage, un seul grand `update()`
    // jetterait le reste du temps (c'est le garde-fou anti-onglet-masqué).
    while (session.battle.phase === PHASE.PAUSE) session.update(200);
    expect(session.battle.phase).toBe(PHASE.WAVE);
    const during = session.hud().countdown;
    expect(during.pending).toBe(false);
    expect(during.remainingMs).toBe(0);
    // Pendant une vague, l'annonce décrit **la vague en cours** : le bandeau ne doit pas
    // afficher la suivante alors que celle-ci n'est pas finie.
    expect(during.wave).toBe(1);
  });
});

describe('rejouabilité — deux parties d’affilée', () => {
  it('la seconde partie repart sans une seule amélioration de la première', () => {
    const first = makeSession().start();
    clearWave(first, EVERY);
    first.chooseDraft(first.pendingDraft[0].id);
    first.draft.choose('fortify');
    first.draft.choose('slot');

    const enriched = {
      slots: first.deployQueue.slotCount(),
      maxHp: first.battle.maxBaseHp,
      upgrades: first.recap().upgrades.length,
    };
    expect(enriched.upgrades).toBeGreaterThan(0);
    first.destroy();

    const second = makeSession().start();
    expect(second.draft.chosen()).toEqual([]);
    expect(second.deployQueue.slotCount()).toBe(balance.battle.slotCount);
    expect(second.battle.maxBaseHp).toBe(balance.battle.baseHp);
    expect(second.unitQueue.skipCount).toBe(0);
    expect(second.recap().upgrades).toEqual([]);

    // Et surtout : la première session, détruite, ne pilote plus rien.
    expect(second.deployQueue.cooldownDurationMs()).toBe(balance.battle.deployCooldownMs);
  });

  it('une session détruite ne réagit plus à la fin d’une vague', () => {
    const session = makeSession().start();
    session.destroy();
    session.events.emit('waveCleared', { wave: EVERY, wavesCleared: EVERY });
    expect(session.draftPending).toBe(false);
  });
});
