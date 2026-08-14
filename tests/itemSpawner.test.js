import { describe, it, expect } from 'vitest';
import {
  ItemSpawner,
  parseSpawnerConfig,
  parseTierWeights,
  pickSpawnTier,
  spawnDelayMs,
  shiftTierWeights,
  fillPressureFactor,
  parseFillPressure,
} from '../src/systems/itemSpawner.js';
import { GridModel } from '../src/systems/GridModel.js';
import balance from '../src/config/balance.json';
import { parsePowersConfig } from '../src/systems/PowerSystem.js';
import { makeRng } from '../src/systems/rng.js';

const VALID = {
  itemSpawner: {
    maxTier: 11,
    startingItems: 3,
    firstSpawnDelayMs: 500,
    intervalMs: 2000,
    minIntervalMs: 800,
    intervalDecay: 0.9,
    fillPressure: { startFill: 0.5, stopFill: 0.85, maxFactor: 10, exponent: 2 },
    spawnTierWeights: { 1: 80, 2: 20 },
  },
};

const withSpawner = (patch) => ({ itemSpawner: { ...VALID.itemSpawner, ...patch } });

describe('parseSpawnerConfig', () => {
  it('lit le balance.json du dépôt', () => {
    const config = parseSpawnerConfig(balance);
    expect(config.maxTier).toBe(11);
    expect(config.tierWeights.length).toBeGreaterThan(0);
    expect(config.minIntervalMs).toBeLessThanOrEqual(config.intervalMs);
  });

  it('crie sur une section manquante plutôt que d’inventer un défaut', () => {
    expect(() => parseSpawnerConfig({})).toThrow(/itemSpawner/);
    expect(() => parseSpawnerConfig(null)).toThrow(/itemSpawner/);
  });

  it('crie sur une clé manquante, non numérique ou hors bornes', () => {
    const { intervalMs, ...withoutInterval } = VALID.itemSpawner;
    expect(() => parseSpawnerConfig({ itemSpawner: withoutInterval })).toThrow(/intervalMs/);
    expect(() => parseSpawnerConfig(withSpawner({ startingItems: '3' }))).toThrow(
      /startingItems/
    );
    expect(() => parseSpawnerConfig(withSpawner({ startingItems: 1.5 }))).toThrow(/entier/);
    expect(() => parseSpawnerConfig(withSpawner({ intervalDecay: 1.4 }))).toThrow(
      /intervalDecay/
    );
  });

  it('refuse un plancher d’intervalle supérieur à l’intervalle initial', () => {
    expect(() => parseSpawnerConfig(withSpawner({ minIntervalMs: 5000 }))).toThrow(
      /minIntervalMs/
    );
  });
});

describe('parseTierWeights', () => {
  it('normalise et trie les poids, en écartant les poids nuls', () => {
    expect(parseTierWeights({ 2: 10, 1: 90, 3: 0 }, 11)).toEqual([
      { tier: 1, weight: 90 },
      { tier: 2, weight: 10 },
    ]);
  });

  it('refuse un tier hors plage ou un jeu de poids vide', () => {
    expect(() => parseTierWeights({ 12: 10 }, 11)).toThrow(/tier de spawn/);
    expect(() => parseTierWeights({ 0: 10 }, 11)).toThrow(/tier de spawn/);
    expect(() => parseTierWeights({ 1: 0 }, 11)).toThrow(/aucun poids/);
    expect(() => parseTierWeights(undefined, 11)).toThrow(/spawnTierWeights/);
  });
});

describe('pickSpawnTier', () => {
  const weights = [
    { tier: 1, weight: 80 },
    { tier: 2, weight: 20 },
  ];

  it('respecte les bornes du tirage pondéré', () => {
    expect(pickSpawnTier(weights, () => 0)).toBe(1);
    expect(pickSpawnTier(weights, () => 0.799)).toBe(1);
    expect(pickSpawnTier(weights, () => 0.8)).toBe(2);
    expect(pickSpawnTier(weights, () => 0.999)).toBe(2);
    // Filet de sécurité si un rng renvoie exactement 1.
    expect(pickSpawnTier(weights, () => 1)).toBe(2);
  });

  it('ne fait apparaître que les tiers listés : les tiers hauts s’obtiennent par fusion', () => {
    const rng = (() => {
      let i = 0;
      return () => (i++ % 100) / 100;
    })();
    const tiers = new Set(Array.from({ length: 200 }, () => pickSpawnTier(weights, rng)));
    expect([...tiers].sort()).toEqual([1, 2]);
  });
});

describe('spawnDelayMs', () => {
  const config = parseSpawnerConfig(VALID);

  it('part de l’intervalle initial et décroît à chaque apparition', () => {
    expect(spawnDelayMs(config, 0)).toBe(2000);
    expect(spawnDelayMs(config, 1)).toBeCloseTo(1800);
    expect(spawnDelayMs(config, 2)).toBeCloseTo(1620);
  });

  it('ne descend jamais sous le plancher', () => {
    expect(spawnDelayMs(config, 1000)).toBe(config.minIntervalMs);
  });
});

describe('ItemSpawner', () => {
  const config = parseSpawnerConfig(VALID);
  const build = (rng = () => 0) => {
    const model = new GridModel({ maxTier: config.maxTier });
    return { model, spawner: new ItemSpawner({ config, model, rng }) };
  };

  it('pose les items de départ sur des cases distinctes', () => {
    const { model, spawner } = build(() => 0.5);
    const spawned = spawner.fillInitial();

    expect(spawned).toHaveLength(config.startingItems);
    expect(model.count()).toBe(config.startingItems);
    expect(new Set(spawned.map((s) => s.index)).size).toBe(config.startingItems);
  });

  it('accélère à mesure que les items apparaissent', () => {
    const { spawner } = build();
    const first = spawner.nominalDelayMs();
    spawner.trySpawn();
    spawner.trySpawn();
    expect(spawner.nominalDelayMs()).toBeLessThan(first);
  });

  it('ne pose plus rien quand la grille est pleine, et reprend dès qu’une case se libère', () => {
    const { model, spawner } = build(() => 0);
    for (let i = 0; i < 25; i += 1) model.placeItem(i, 4);

    expect(spawner.trySpawn()).toBeNull();
    expect(spawner.spawnCount).toBe(0);

    model.removeItem(10);
    expect(spawner.trySpawn().index).toBe(10);
    expect(spawner.spawnCount).toBe(1);
  });

  it('s’arrête proprement si la grille sature pendant le remplissage initial', () => {
    const model = new GridModel({ maxTier: config.maxTier, cols: 1, rows: 2 });
    const spawner = new ItemSpawner({ config, model, rng: () => 0 });

    expect(spawner.fillInitial()).toHaveLength(2);
    expect(model.isFull()).toBe(true);
  });
});

describe('shiftTierWeights — « Gisement riche » (Lot 3.5)', () => {
  const weights = [
    { tier: 1, weight: 85 },
    { tier: 2, weight: 15 },
  ];

  it('rend la liste inchangée sans bonus', () => {
    expect(shiftTierWeights(weights, 0, 11)).toBe(weights);
  });

  it('décale les tiers d’un cran par niveau, en gardant les poids', () => {
    expect(shiftTierWeights(weights, 1, 11)).toEqual([
      { tier: 2, weight: 85 },
      { tier: 3, weight: 15 },
    ]);
    expect(shiftTierWeights(weights, 3, 11)).toEqual([
      { tier: 4, weight: 85 },
      { tier: 5, weight: 15 },
    ]);
  });

  it('fusionne les entrées qui retombent sur le même tier au plafond', () => {
    // Sans la fusion, deux lignes du même tier fausseraient le tirage pondéré.
    expect(shiftTierWeights(weights, 20, 3)).toEqual([{ tier: 3, weight: 100 }]);
  });
});

describe('spawnDelayMs — facteur d’amélioration', () => {
  const config = parseSpawnerConfig(balance);

  it('accélère aussi le plancher : « Extraction » doit servir en fin de partie', () => {
    // Le plancher est atteint dès la trentaine d'items, soit avant le premier draft. Un
    // facteur qui ne s'appliquerait qu'à la courbe ne ferait donc jamais rien.
    expect(spawnDelayMs(config, 5000, 1)).toBe(config.minIntervalMs);
    expect(spawnDelayMs(config, 5000, 0.5)).toBeCloseTo(config.minIntervalMs * 0.5, 6);
  });
});


describe('ItemSpawner — les deux familles (Lot 4)', () => {
  const config = parseSpawnerConfig(balance);
  const powers = parsePowersConfig(balance);

  const build = (rng, { getModifiers } = {}) => {
    const model = new GridModel({
      maxTier: config.maxTier,
      powerMaxTier: powers.maxTier,
    });
    return {
      model,
      spawner: new ItemSpawner({ config, model, rng, powers, getModifiers }),
    };
  };

  it('sans config de pouvoirs, ne produit que des items d’unité — et ne tire rien de plus', () => {
    // Un spawner d'avant le Lot 4 doit produire exactement la même suite : c'est ce qui
    // garde les bancs d'essai comparables d'un lot à l'autre.
    const model = new GridModel({ maxTier: config.maxTier });
    const plain = new ItemSpawner({ config, model, rng: makeRng(3) });
    const withPowers = build(makeRng(3)).spawner;

    plain.trySpawn();
    withPowers.trySpawn();
    expect(model.itemAt(model.cells.findIndex(Boolean)).family).toBe('unit');
    expect(plain.spawnedByFamily.power).toBe(0);
  });

  it('respecte la probabilité annoncée, sur un échantillon seedé', () => {
    const { spawner, model } = build(makeRng(7));
    let powerCount = 0;
    for (let i = 0; i < 600; i += 1) {
      const result = spawner.trySpawn();
      if (result === null) continue;
      if (result.item.family === 'power') powerCount += 1;
      // La grille est vidée à chaque tour : on mesure le tirage, pas la saturation.
      model.removeItem(result.index);
    }
    const share = powerCount / 600;
    // Tolérance large à dessein : le test protège l'ordre de grandeur (et surtout le fait
    // que les deux familles apparaissent), pas la troisième décimale d'un tirage.
    expect(share).toBeGreaterThan(powers.spawnChance * 0.6);
    expect(share).toBeLessThan(powers.spawnChance * 1.4);
  });

  it('produit les deux types de pouvoirs', () => {
    const { spawner, model } = build(makeRng(11));
    const seen = new Set();
    for (let i = 0; i < 400; i += 1) {
      const result = spawner.trySpawn();
      if (result === null) continue;
      if (result.item.power) seen.add(result.item.power);
      model.removeItem(result.index);
    }
    expect([...seen].sort()).toEqual(['heal', 'meteor']);
  });

  it('« résonance » relève la part des pouvoirs, à graine égale', () => {
    const measure = (modifiers) => {
      const { spawner, model } = build(makeRng(5), { getModifiers: () => modifiers });
      let count = 0;
      for (let i = 0; i < 400; i += 1) {
        const result = spawner.trySpawn();
        if (result === null) continue;
        if (result.item.family === 'power') count += 1;
        model.removeItem(result.index);
      }
      return count;
    };
    expect(measure({ powerChance: 2 })).toBeGreaterThan(measure(null));
  });

  it('« gisement riche » ne fait jamais naître un pouvoir au-dessus de son plafond', () => {
    // Un décalage énorme pousserait le tirage bien au-delà du tier maximum des pouvoirs :
    // sans écrêtage, `placeItem` refuserait et l'apparition serait silencieusement perdue.
    const { spawner, model } = build(makeRng(2), { getModifiers: () => ({ spawnTierBonus: 20 }) });
    let powersSeen = 0;
    for (let i = 0; i < 200; i += 1) {
      const result = spawner.trySpawn();
      expect(result).not.toBeNull();
      if (result.item.family === 'power') {
        powersSeen += 1;
        expect(result.item.tier).toBeLessThanOrEqual(powers.maxTier);
      }
      model.removeItem(result.index);
    }
    expect(powersSeen).toBeGreaterThan(0);
  });

  it('compte ses apparitions par famille', () => {
    const { spawner, model } = build(makeRng(4));
    for (let i = 0; i < 50; i += 1) {
      const result = spawner.trySpawn();
      model.removeItem(result.index);
    }
    const { unit, power } = spawner.spawnedByFamily;
    expect(unit + power).toBe(50);
    expect(power).toBeGreaterThan(0);
  });
});

describe('fillPressureFactor — la courbe de régulation (Lot 4.5)', () => {
  const curve = { startFill: 0.4, stopFill: 0.8, maxFactor: 10, exponent: 2 };

  it('ne freine pas du tout tant que la grille respire', () => {
    expect(fillPressureFactor(curve, 0)).toBe(1);
    expect(fillPressureFactor(curve, 0.2)).toBe(1);
    expect(fillPressureFactor(curve, curve.startFill)).toBe(1);
  });

  it('freine à fond au-delà du seuil d’arrêt, grille pleine comprise', () => {
    expect(fillPressureFactor(curve, curve.stopFill)).toBe(curve.maxFactor);
    expect(fillPressureFactor(curve, 0.95)).toBe(curve.maxFactor);
    expect(fillPressureFactor(curve, 1)).toBe(curve.maxFactor);
  });

  it('monte continûment entre les deux, sans marche d’escalier', () => {
    const at = (fill) => fillPressureFactor(curve, fill);
    // 60 % = mi-chemin des deux seuils : avec un exposant 2, le quart du freinage total.
    expect(at(0.6)).toBeCloseTo(1 + 9 * 0.25, 6);
    expect(at(0.7)).toBeCloseTo(1 + 9 * 0.5625, 6);
    // Strictement croissante, et continue aux deux bornes.
    let previous = 0;
    for (let fill = 0; fill <= 1.0001; fill += 0.02) {
      const value = at(fill);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
    expect(at(curve.startFill + 0.0001)).toBeCloseTo(1, 3);
    expect(at(curve.stopFill - 0.0001)).toBeCloseTo(curve.maxFactor, 2);
  });

  it('la courbure retarde le freinage : un exposant élevé ne coûte rien tôt', () => {
    const gentle = { ...curve, exponent: 3 };
    const linear = { ...curve, exponent: 1 };
    expect(fillPressureFactor(gentle, 0.5)).toBeLessThan(fillPressureFactor(linear, 0.5));
    // Les deux se rejoignent aux bornes : la courbure change le chemin, pas la destination.
    expect(fillPressureFactor(gentle, 0.8)).toBe(fillPressureFactor(linear, 0.8));
  });

  it('refuse une courbe incohérente plutôt que de l’interpréter', () => {
    expect(() => parseFillPressure(undefined)).toThrow(/fillPressure manquant/);
    expect(() => parseFillPressure({ ...curve, stopFill: 0.3 })).toThrow(/stopFill/);
    expect(() => parseFillPressure({ ...curve, maxFactor: 0.5 })).toThrow(/maxFactor/);
    expect(() => parseFillPressure({ startFill: 0.4, stopFill: 0.8, maxFactor: 10 })).toThrow(
      /exponent/
    );
  });
});

describe('ItemSpawner — cadence régulée par le remplissage', () => {
  const config = parseSpawnerConfig(balance);

  const build = () => {
    const model = new GridModel({ maxTier: config.maxTier });
    return { model, spawner: new ItemSpawner({ config, model, rng: () => 0 }) };
  };

  /** Remplit la grille jusqu'au taux visé, sans passer par le spawner. */
  const fillTo = (model, ratio) => {
    const target = Math.round(model.size * ratio);
    for (let i = 0; i < target; i += 1) model.placeItem(i, 1, { silent: true });
  };

  it('rend l’intervalle nominal tant que la grille est sous le seuil', () => {
    const { model, spawner } = build();
    fillTo(model, config.fillPressure.startFill / 2);
    expect(spawner.currentDelayMs()).toBeCloseTo(spawner.nominalDelayMs(), 6);
    expect(spawner.pressureFactor()).toBe(1);
  });

  it('étire l’intervalle à mesure que la grille se remplit', () => {
    const { model, spawner } = build();
    const nominal = spawner.nominalDelayMs();

    fillTo(model, 0.5);
    const half = spawner.currentDelayMs();
    expect(half).toBeGreaterThan(nominal);

    // Chaque palier freine davantage : la régulation est monotone.
    for (let i = Math.round(model.size * 0.5); i < Math.round(model.size * 0.72); i += 1) {
      model.placeItem(i, 1, { silent: true });
    }
    expect(spawner.currentDelayMs()).toBeGreaterThan(half);
  });

  it('atteint le quasi-arrêt à partir du seuil haut', () => {
    const { model, spawner } = build();
    fillTo(model, config.fillPressure.stopFill);
    expect(spawner.currentDelayMs()).toBeCloseTo(
      spawner.nominalDelayMs() * config.fillPressure.maxFactor,
      6
    );
  });

  it('reprend la cadence nominale dès que la grille se vide', () => {
    const { model, spawner } = build();
    fillTo(model, 0.9);
    expect(spawner.pressureFactor()).toBe(config.fillPressure.maxFactor);

    for (let i = 0; i < model.size; i += 1) model.removeItem(i);
    expect(spawner.pressureFactor()).toBe(1);
    expect(spawner.currentDelayMs()).toBeCloseTo(spawner.nominalDelayMs(), 6);
  });

  it('se compose avec la progression de la partie, sans l’écraser', () => {
    // Les deux courbes se multiplient : l'accélération de fin de partie reste visible sous
    // le frein, et le frein reste visible malgré l'accélération.
    const { model, spawner } = build();
    const earlyEmpty = spawner.currentDelayMs();

    spawner.spawnCount = 400; // largement au plancher d'intervalle
    const lateEmpty = spawner.currentDelayMs();
    expect(lateEmpty).toBeLessThan(earlyEmpty);

    fillTo(model, config.fillPressure.stopFill);
    const lateFull = spawner.currentDelayMs();
    expect(lateFull).toBeCloseTo(lateEmpty * config.fillPressure.maxFactor, 6);
    // Même freinée à fond en fin de partie, la cadence reste plus rapide qu'un début de
    // partie freiné à fond : la pression monte bien avec la partie.
    spawner.spawnCount = 0;
    expect(lateFull).toBeLessThan(spawner.currentDelayMs());
  });

  it('« Extraction » accélère la cadence régulée comme la nominale', () => {
    const model = new GridModel({ maxTier: config.maxTier });
    const spawner = new ItemSpawner({
      config,
      model,
      rng: () => 0,
      getModifiers: () => ({ spawnInterval: 0.5 }),
    });
    const plain = new ItemSpawner({ config, model, rng: () => 0 });
    fillTo(model, 0.6);
    expect(spawner.currentDelayMs()).toBeCloseTo(plain.currentDelayMs() * 0.5, 6);
  });
});
