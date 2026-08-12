import { describe, it, expect } from 'vitest';
import balance from '../src/config/balance.json';
import {
  parseBattleConfig,
  unitStats,
  unitMaxHp,
  supportBonus,
  enemyStats,
} from '../src/systems/battleConfig.js';

const config = parseBattleConfig(balance);

/** Copie profonde du balance réel, pour casser une clé sans polluer les autres tests. */
const clone = () => JSON.parse(JSON.stringify(balance));

describe('parseBattleConfig — validation', () => {
  it('lit le balance.json du jeu sans erreur', () => {
    expect(config.slotCount).toBeGreaterThanOrEqual(2);
    expect(config.tickMs).toBeGreaterThan(0);
    expect(Object.keys(config.units)).toEqual(
      expect.arrayContaining(['single', 'aoe', 'slow', 'support'])
    );
    expect(Object.keys(config.enemies)).toEqual(
      expect.arrayContaining(['basic', 'fast', 'tank'])
    );
  });

  it('couvre les quatre rôles du périmètre V1', () => {
    const roles = Object.values(config.units).map((unit) => unit.role);
    expect(new Set(roles)).toEqual(new Set(['damage', 'aoe', 'slow', 'support']));
  });

  it('refuse une section manquante plutôt que d’inventer un défaut', () => {
    for (const key of ['battle', 'units', 'enemies', 'waves']) {
      const broken = clone();
      delete broken[key];
      expect(() => parseBattleConfig(broken)).toThrow(new RegExp(key));
    }
  });

  it('refuse une valeur manquante, non numérique ou hors bornes', () => {
    const missing = clone();
    delete missing.battle.baseHp;
    expect(() => parseBattleConfig(missing)).toThrow(/baseHp/);

    const text = clone();
    text.units.single.damage = '8';
    expect(() => parseBattleConfig(text)).toThrow(/damage/);

    const negative = clone();
    negative.battle.slotCount = 0;
    expect(() => parseBattleConfig(negative)).toThrow(/slotCount/);

    const cap = clone();
    delete cap.battle.maxFieldUnits;
    expect(() => parseBattleConfig(cap)).toThrow(/maxFieldUnits/);

    const cooldown = clone();
    cooldown.battle.deployCooldownMs = 0;
    expect(() => parseBattleConfig(cooldown)).toThrow(/deployCooldownMs/);
  });

  it('exige les stats de combat mutuel introduites au Lot 2.5', () => {
    for (const key of ['hp', 'speed']) {
      const broken = clone();
      delete broken.units.single[key];
      expect(() => parseBattleConfig(broken)).toThrow(new RegExp(key));
    }
    for (const key of ['damage', 'attackRateMs', 'attackRange']) {
      const broken = clone();
      delete broken.enemies.basic[key];
      expect(() => parseBattleConfig(broken)).toThrow(new RegExp(key));
    }
    const aura = clone();
    delete aura.units.support.auraRadius;
    expect(() => parseBattleConfig(aura)).toThrow(/auraRadius/);

    const zone = clone();
    delete zone.units.slow.slowRadius;
    expect(() => parseBattleConfig(zone)).toThrow(/slowRadius/);
  });

  it('refuse un type inconnu dans le motif d’unités ou dans une vague', () => {
    const pattern = clone();
    pattern.battle.unitTypePattern = ['single', 'inexistant'];
    expect(() => parseBattleConfig(pattern)).toThrow(/inexistant/);

    const wave = clone();
    wave.waves.scripted[0] = [{ type: 'dragon', count: 2 }];
    expect(() => parseBattleConfig(wave)).toThrow(/dragon/);
  });

  it('refuse une unité offensive sans cadence', () => {
    const broken = clone();
    broken.units.single.fireRateMs = 0;
    expect(() => parseBattleConfig(broken)).toThrow(/fireRateMs/);
  });
});

describe('unitStats — courbe de tiers', () => {
  it('rend exactement les valeurs de balance.json au tier 1', () => {
    const stats = unitStats(config, 'single', 1);
    expect(stats.damage).toBeCloseTo(balance.units.single.damage);
    expect(stats.fireRateMs).toBeCloseTo(balance.units.single.fireRateMs);
    expect(stats.range).toBeCloseTo(balance.units.single.range);
  });

  it('applique la formule stat(1) × facteur^(tier - 1)', () => {
    const { damage, tierScaling } = balance.units.single;
    expect(unitStats(config, 'single', 5).damage).toBeCloseTo(damage * tierScaling.damage ** 4);
    expect(unitStats(config, 'single', 3).range).toBeCloseTo(
      balance.units.single.range * tierScaling.range ** 2
    );
  });

  it('fait monter les dégâts et descendre le délai de tir avec le tier', () => {
    const low = unitStats(config, 'single', 1);
    const high = unitStats(config, 'single', 8);
    expect(high.damage).toBeGreaterThan(low.damage);
    expect(high.fireRateMs).toBeLessThan(low.fireRateMs);
  });

  it('ne descend jamais sous un tick, même à tier maximum et pleinement soutenue', () => {
    const stats = unitStats(config, 'single', 11, { supportFireRate: 0.6 });
    expect(stats.fireRateMs).toBeGreaterThanOrEqual(config.tickMs);
  });

  it('plafonne le bonus de cadence apporté par les soutiens', () => {
    const capped = unitStats(config, 'single', 1, { supportFireRate: 5 });
    const atCap = unitStats(config, 'single', 1, {
      supportFireRate: config.maxSupportFireRateBonus,
    });
    expect(capped.fireRateMs).toBeCloseTo(atCap.fireRateMs);
    expect(capped.fireRateMs).toBeGreaterThan(0);
  });

  it('rend des PV et une vitesse de marche à chaque type', () => {
    for (const type of Object.keys(config.units)) {
      expect(unitStats(config, type, 1).hp).toBe(balance.units[type].hp);
      expect(unitStats(config, type, 1).speed).toBe(balance.units[type].speed);
      expect(unitMaxHp(config, type, 1)).toBe(balance.units[type].hp);
    }
  });

  it('garde la vitesse de marche indépendante du tier', () => {
    expect(unitStats(config, 'single', 11).speed).toBe(unitStats(config, 'single', 1).speed);
  });

  /**
   * L'intention de design du Lot 2.5, vérifiée sur les vraies valeurs : une unité de
   * tier N+1 doit valoir **nettement plus** que deux unités de tier N, sinon rien ne
   * pousse à préparer ses fusions avant d'envoyer.
   */
  it('rend un tier N+1 plus fort que deux tiers N, en PV comme en dégâts', () => {
    for (const type of Object.keys(config.units)) {
      for (let tier = 1; tier < 10; tier += 1) {
        const low = unitStats(config, type, tier);
        const high = unitStats(config, type, tier + 1);
        expect(high.hp).toBeGreaterThan(low.hp * 2);
        if (low.damage > 0) expect(high.damage).toBeGreaterThan(low.damage * 2);
      }
    }
  });

  it('ne donne ni zone ni ralentissement aux rôles qui n’en ont pas', () => {
    expect(unitStats(config, 'single', 3).splashRadius).toBe(0);
    expect(unitStats(config, 'single', 3).slowFactor).toBe(1);
    expect(unitStats(config, 'aoe', 3).splashRadius).toBeGreaterThan(0);
    expect(unitStats(config, 'slow', 3).slowDurationMs).toBeGreaterThan(0);
  });

  it('garde une force de ralentissement constante, seule la durée monte', () => {
    const low = unitStats(config, 'slow', 1);
    const high = unitStats(config, 'slow', 9);
    expect(high.slowFactor).toBe(low.slowFactor);
    expect(high.slowDurationMs).toBeGreaterThan(low.slowDurationMs);
  });

  it('laisse le soutien sans cadence de tir', () => {
    expect(unitStats(config, 'support', 5).fireRateMs).toBe(0);
  });

  it('refuse un type inconnu', () => {
    expect(() => unitStats(config, 'inexistant', 1)).toThrow();
  });
});

describe('supportBonus', () => {
  it('renvoie les fractions de balance.json au tier 1', () => {
    expect(supportBonus(config, 'support', 1)).toEqual({
      damage: balance.units.support.buff.damage,
      fireRate: balance.units.support.buff.fireRate,
    });
  });

  it('monte avec le tier', () => {
    const tier1 = supportBonus(config, 'support', 1);
    const tier6 = supportBonus(config, 'support', 6);
    expect(tier6.damage).toBeGreaterThan(tier1.damage);
    expect(tier6.fireRate).toBeGreaterThan(tier1.fireRate);
  });

  it('porte plus loin au fil des tiers', () => {
    expect(unitStats(config, 'support', 6).auraRadius).toBeGreaterThan(
      unitStats(config, 'support', 1).auraRadius
    );
  });

  it('est nul pour un type qui n’est pas un soutien', () => {
    expect(supportBonus(config, 'single', 5)).toEqual({ damage: 0, fireRate: 0 });
  });
});

describe('enemyStats — scaling par vague', () => {
  it('rend les valeurs brutes à la vague 1', () => {
    const stats = enemyStats(config, 'basic', 1);
    expect(stats.hp).toBe(balance.enemies.basic.hp);
    expect(stats.speed).toBeCloseTo(balance.enemies.basic.speed);
  });

  it('applique hpPerWave et speedPerWave de façon cumulée', () => {
    const { hpPerWave, speedPerWave } = balance.waves.scaling;
    const wave10 = enemyStats(config, 'basic', 10);
    expect(wave10.hp).toBe(Math.round(balance.enemies.basic.hp * hpPerWave ** 9));
    expect(wave10.speed).toBeCloseTo(balance.enemies.basic.speed * speedPerWave ** 9);
  });

  it('laisse les dégâts à la base constants', () => {
    expect(enemyStats(config, 'tank', 20).damageToBase).toBe(balance.enemies.tank.damageToBase);
  });

  it('fait monter les dégâts **aux unités**, pour qu’un haut tier ne soit pas immortel', () => {
    const { damagePerWave } = balance.waves.scaling;
    expect(enemyStats(config, 'basic', 1).damage).toBeCloseTo(balance.enemies.basic.damage);
    expect(enemyStats(config, 'basic', 8).damage).toBeCloseTo(
      balance.enemies.basic.damage * damagePerWave ** 7
    );
  });

  it('garde la cadence et la portée de contact constantes', () => {
    const wave1 = enemyStats(config, 'fast', 1);
    const wave15 = enemyStats(config, 'fast', 15);
    expect(wave15.attackRateMs).toBe(wave1.attackRateMs);
    expect(wave15.attackRange).toBe(wave1.attackRange);
  });

  it('garde une progression strictement croissante', () => {
    let previous = 0;
    for (let wave = 1; wave <= 30; wave += 1) {
      const hp = enemyStats(config, 'fast', wave).hp;
      expect(hp).toBeGreaterThanOrEqual(previous);
      previous = hp;
    }
    expect(previous).toBeGreaterThan(balance.enemies.fast.hp * 10);
  });
});

describe('cadre de la file de déploiement', () => {
  it('lit le rythme de sortie et le cap d’unités depuis balance.json', () => {
    expect(config.slotCount).toBe(balance.battle.slotCount);
    expect(config.deployCooldownMs).toBe(balance.battle.deployCooldownMs);
    expect(config.maxFieldUnits).toBe(balance.battle.maxFieldUnits);
    // Le cap doit laisser de la marge au-delà de la file, sinon il la bloquerait.
    expect(config.maxFieldUnits).toBeGreaterThan(config.slotCount);
  });
});
