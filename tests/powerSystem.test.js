import { describe, it, expect, beforeEach } from 'vitest';
import balance from '../src/config/balance.json';
import { EventBus } from '../src/systems/eventBus.js';
import { BattleModel } from '../src/systems/BattleModel.js';
import { parseBattleConfig } from '../src/systems/battleConfig.js';
import {
  PowerSystem,
  parsePowersConfig,
  powerStats,
  powerSpawnChance,
  pickPowerType,
} from '../src/systems/PowerSystem.js';
import { neutralModifiers, applyEffect } from '../src/systems/modifiers.js';

/**
 * Tests des **pouvoirs actifs** (Lot 4), sans Phaser ni horloge.
 *
 * Trois questions, et ce sont celles qui décident si la mécanique est juste :
 *   - le **ciblage** tombe-t-il sur le bon paquet d'ennemis ?
 *   - les **montants** suivent-ils le tier et les améliorations, sans jamais dépasser les
 *     PV maximum d'une unité ?
 *   - la **temporisation** respecte-t-elle la télégraphie, y compris quand la partie
 *     s'arrête au milieu ?
 */

const config = parseBattleConfig(balance);
const powersConfig = parsePowersConfig(balance);

/** Champ de bataille nu, en phase de vague, prêt à recevoir unités et ennemis. */
function makeBattle(bus) {
  const battle = new BattleModel({ config, bus });
  battle.start();
  return battle;
}

/** Pose un ennemi à une progression donnée, sans passer par les vagues. */
function putEnemy(battle, progress, { hp = 100, type = 'basic' } = {}) {
  const enemy = {
    id: battle.nextEnemyId++,
    type,
    label: type,
    hp,
    maxHp: hp,
    speed: 0,
    damageToBase: 1,
    damage: 0,
    attackRateMs: 1000,
    attackRange: 1,
    cooldownMs: 0,
    progress,
    prevProgress: progress,
    slowFactor: 1,
    slowMsLeft: 0,
    wave: 1,
    spawnTick: -1,
  };
  battle.enemies.push(enemy);
  return enemy;
}

/** Pose une unité blessée à volonté, sans passer par la file de déploiement. */
function putUnit(battle, { hp = 50, maxHp = 100, progress = 900 } = {}) {
  const unit = {
    id: battle.nextUnitId++,
    type: 'single',
    tier: 1,
    hp,
    maxHp,
    progress,
    prevProgress: progress,
    cooldownMs: 0,
    engaged: false,
  };
  battle.units.push(unit);
  return unit;
}

describe('parsePowersConfig', () => {
  it('lit la section `powers` de balance.json', () => {
    expect(powersConfig.maxTier).toBeGreaterThanOrEqual(2);
    expect(powersConfig.spawnChance).toBeGreaterThan(0);
    expect(Object.keys(powersConfig.types)).toEqual(expect.arrayContaining(['heal', 'meteor']));
    expect(powersConfig.types.heal.kind).toBe('heal');
    expect(powersConfig.types.meteor.kind).toBe('blast');
  });

  it('refuse une config incomplète plutôt que d’inventer un défaut', () => {
    expect(() => parsePowersConfig({})).toThrow(/section `powers` manquante/);
    const broken = (mutate) => {
      const copy = JSON.parse(JSON.stringify(balance));
      mutate(copy);
      return () => parsePowersConfig(copy);
    };
    expect(broken((b) => delete b.powers.maxTier)).toThrow(/maxTier/);
    expect(broken((b) => delete b.powers.types.heal.amount)).toThrow(/amount/);
    expect(broken((b) => delete b.powers.types.meteor.blurb)).toThrow(/blurb/);
    expect(broken((b) => (b.powers.types.heal.kind = 'nawak'))).toThrow(/kind inconnu/);
    expect(broken((b) => (b.powers.types = {}))).toThrow(/vide/);
    // Un tirage sans aucun poids > 0 produirait des pouvoirs impossibles à faire apparaître.
    expect(
      broken((b) => {
        b.powers.types.heal.weight = 0;
        b.powers.types.meteor.weight = 0;
      })
    ).toThrow(/poids d’apparition/);
  });
});

describe('powerStats — la courbe par tier', () => {
  it('applique `stat(tier) = stat(1) × facteur^(tier-1)`', () => {
    const def = powersConfig.types.meteor;
    const tier3 = powerStats(powersConfig, 'meteor', 3);
    expect(tier3.amount).toBeCloseTo(def.amount * def.tierScaling.amount ** 2, 6);
    expect(tier3.radius).toBeCloseTo(def.radius * def.tierScaling.radius ** 2, 6);
  });

  it('« puissance des pouvoirs » multiplie le montant, jamais le rayon', () => {
    const mods = applyEffect(neutralModifiers(), { powerAmount: 1.5 }, 2);
    const plain = powerStats(powersConfig, 'meteor', 2);
    const boosted = powerStats(powersConfig, 'meteor', 2, mods);
    // Deux niveaux se composent par produit : 1,5² = ×2,25.
    expect(boosted.amount).toBeCloseTo(plain.amount * 2.25, 6);
    expect(boosted.radius).toBeCloseTo(plain.radius, 6);
  });

  it('refuse un type inconnu plutôt que de rendre des zéros', () => {
    expect(() => powerStats(powersConfig, 'nawak', 1)).toThrow(/type de pouvoir inconnu/);
  });
});

describe('apparition des pouvoirs', () => {
  it('« probabilité d’apparition » relève la chance, sans jamais tout emporter', () => {
    const base = powerSpawnChance(powersConfig);
    expect(base).toBeCloseTo(powersConfig.spawnChance, 6);
    expect(powerSpawnChance(powersConfig, { powerChance: 2 })).toBeCloseTo(base * 2, 6);
    // Le plafond protège l'existence même de l'armée : sans lui, un cumul d'améliorations
    // finirait par ne plus produire un seul item d'unité.
    expect(powerSpawnChance(powersConfig, { powerChance: 100 })).toBe(0.9);
  });

  it('pickPowerType respecte les poids et reste borné aux extrêmes du tirage', () => {
    const weights = [
      { type: 'a', weight: 30 },
      { type: 'b', weight: 70 },
    ];
    expect(pickPowerType(weights, () => 0)).toBe('a');
    expect(pickPowerType(weights, () => 0.99)).toBe('b');
    expect(pickPowerType(weights, () => 1)).toBe('b');
  });
});

describe('PowerSystem — le soin', () => {
  let bus;
  let battle;
  let powers;

  beforeEach(() => {
    bus = new EventBus();
    battle = makeBattle(bus);
    powers = new PowerSystem({ config: powersConfig, battle, bus });
  });

  it('soigne toutes les unités vivantes, et plafonne à leurs PV maximum', () => {
    const hurt = putUnit(battle, { hp: 10, maxHp: 100 });
    const nearlyFull = putUnit(battle, { hp: 95, maxHp: 100 });
    const amount = powerStats(powersConfig, 'heal', 1).amount;

    const resolved = [];
    bus.on('powerResolved', (payload) => resolved.push(payload));
    bus.emit('usePower', { type: 'heal', tier: 1 });

    expect(hurt.hp).toBe(Math.min(100, 10 + amount));
    expect(nearlyFull.hp).toBe(100);
    // Le récap ne compte que les PV **réellement** rendus : le débordement ne gonfle rien.
    expect(resolved).toHaveLength(1);
    expect(resolved[0].total).toBe(hurt.hp - 10 + 5);
    expect(battle.stats.powerHealing).toBe(resolved[0].total);
  });

  it('est immédiat : aucune télégraphie ne reste en attente', () => {
    putUnit(battle, { hp: 10, maxHp: 100 });
    powers.cast('heal', 1);
    expect(powers.pending).toHaveLength(0);
  });

  it('est refusé quand il n’y a pas une seule unité sur le champ', () => {
    expect(powers.canCast('heal')).toBe(false);
    expect(powers.cast('heal', 1)).toBeNull();
    putUnit(battle, { hp: 100, maxHp: 100 });
    // Une armée intacte reste soignable : c'est un jugement du joueur, pas une impossibilité.
    expect(powers.canCast('heal')).toBe(true);
  });
});

describe('PowerSystem — la météorite', () => {
  let bus;
  let battle;
  let powers;

  beforeEach(() => {
    bus = new EventBus();
    battle = makeBattle(bus);
    powers = new PowerSystem({ config: powersConfig, battle, bus });
  });

  it('vise le groupe le plus nombreux, pas le traînard le plus avancé', () => {
    const radius = powerStats(powersConfig, 'meteor', 1).radius;
    // Un paquet de quatre au milieu, un ennemi seul bien plus près de la base.
    for (const progress of [300, 320, 340, 360]) putEnemy(battle, progress);
    putEnemy(battle, 900);

    const center = powers.targetCenter(radius);
    expect(center).toBeGreaterThanOrEqual(300);
    expect(center).toBeLessThanOrEqual(360);
  });

  it('à nombre égal, choisit le groupe le plus avancé — donc le plus menaçant', () => {
    const radius = powerStats(powersConfig, 'meteor', 1).radius;
    for (const progress of [200, 220]) putEnemy(battle, progress);
    for (const progress of [700, 720]) putEnemy(battle, progress);

    expect(powers.targetCenter(radius)).toBeGreaterThanOrEqual(700);
  });

  it('frappe tout ce que couvre le rayon, et rien au-delà', () => {
    const stats = powerStats(powersConfig, 'meteor', 1);
    const hp = stats.amount * 3;
    const inside = putEnemy(battle, 500, { hp });
    const edge = putEnemy(battle, 500 + stats.radius * 0.9, { hp });
    const outside = putEnemy(battle, 500 + stats.radius * 2.5, { hp });

    powers.cast('meteor', 1);
    powers.update(stats.telegraphMs);

    expect(inside.hp).toBeCloseTo(hp - stats.amount, 6);
    expect(edge.hp).toBeCloseTo(hp - stats.amount, 6);
    expect(outside.hp).toBe(hp);
  });

  it('achève ce qu’elle tue, par le même chemin que le combat ordinaire', () => {
    const deaths = [];
    bus.on('enemyDeath', ({ enemy }) => deaths.push(enemy.id));
    const stats = powerStats(powersConfig, 'meteor', 1);
    const doomed = putEnemy(battle, 500, { hp: 1 });

    powers.cast('meteor', 1);
    powers.update(stats.telegraphMs);

    expect(deaths).toEqual([doomed.id]);
    expect(battle.enemies).toHaveLength(0);
    expect(battle.stats.enemiesKilled).toBe(1);
    expect(battle.stats.powerKills).toBe(1);
    // Dégâts **effectifs** : le surkill ne gonfle pas le récap.
    expect(battle.stats.powerDamage).toBe(1);
  });

  it('frappe plus fort à chaque tier', () => {
    const hp = 1e9;
    const damageAt = (tier) => {
      const localBus = new EventBus();
      const localBattle = makeBattle(localBus);
      const localPowers = new PowerSystem({ config: powersConfig, battle: localBattle, bus: localBus });
      const enemy = putEnemy(localBattle, 500, { hp });
      localPowers.cast('meteor', tier);
      localPowers.update(10_000);
      return hp - enemy.hp;
    };
    expect(damageAt(2)).toBeGreaterThan(damageAt(1));
    expect(damageAt(3)).toBeGreaterThan(damageAt(2));
  });

  it('est refusée quand le couloir est vide : l’item n’est pas gaspillé', () => {
    expect(powers.canCast('meteor')).toBe(false);
    expect(powers.cast('meteor', 1)).toBeNull();
    expect(powers.usedCount).toBe(0);
  });
});

describe('PowerSystem — la télégraphie', () => {
  let bus;
  let battle;
  let powers;

  beforeEach(() => {
    bus = new EventBus();
    battle = makeBattle(bus);
    powers = new PowerSystem({ config: powersConfig, battle, bus });
  });

  it('annonce la zone au tap et ne frappe qu’à l’échéance', () => {
    const stats = powerStats(powersConfig, 'meteor', 1);
    const enemy = putEnemy(battle, 500, { hp: 1e6 });
    const events = [];
    bus.on('powerCast', () => events.push('cast'));
    bus.on('powerResolved', () => events.push('resolved'));

    powers.cast('meteor', 1);
    expect(events).toEqual(['cast']);
    expect(enemy.hp).toBe(1e6);

    powers.update(stats.telegraphMs - 10);
    expect(events).toEqual(['cast']);

    powers.update(10);
    expect(events).toEqual(['cast', 'resolved']);
    expect(enemy.hp).toBeLessThan(1e6);
  });

  it('la zone est figée au tap : un ennemi qui s’en éloigne s’en sort', () => {
    const stats = powerStats(powersConfig, 'meteor', 1);
    const enemy = putEnemy(battle, 500, { hp: 1e6 });
    powers.cast('meteor', 1);

    // Il marche pendant l'annonce — c'est tout l'intérêt d'avoir un délai réel.
    enemy.progress = 500 + stats.radius * 3;
    powers.update(stats.telegraphMs);

    expect(enemy.hp).toBe(1e6);
  });

  it('n’explose pas après la fin de la partie : l’impact est annulé', () => {
    const stats = powerStats(powersConfig, 'meteor', 1);
    const enemy = putEnemy(battle, 500, { hp: 1e6 });
    const fizzled = [];
    bus.on('powerFizzled', (payload) => fizzled.push(payload));

    powers.cast('meteor', 1);
    battle.damageBase(config.baseHp);
    powers.update(stats.telegraphMs);

    expect(battle.over).toBe(true);
    expect(enemy.hp).toBe(1e6);
    expect(fizzled).toHaveLength(1);
    expect(powers.pending).toHaveLength(0);
  });

  it('se désabonne à la destruction — rien ne survit à une partie', () => {
    putEnemy(battle, 500);
    powers.destroy();
    bus.emit('usePower', { type: 'meteor', tier: 1 });
    expect(powers.usedCount).toBe(0);
    expect(bus.listenerCount('usePower')).toBe(0);
  });
});
