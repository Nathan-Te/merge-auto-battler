import { describe, it, expect } from 'vitest';
import {
  ItemSpawner,
  parseSpawnerConfig,
  parseTierWeights,
  pickSpawnTier,
  spawnDelayMs,
  shiftTierWeights,
} from '../src/systems/itemSpawner.js';
import { GridModel } from '../src/systems/GridModel.js';
import balance from '../src/config/balance.json';

const VALID = {
  itemSpawner: {
    maxTier: 11,
    startingItems: 3,
    firstSpawnDelayMs: 500,
    intervalMs: 2000,
    minIntervalMs: 800,
    intervalDecay: 0.9,
    gridFullRetryMs: 400,
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
    const first = spawner.nextDelayMs();
    spawner.trySpawn();
    spawner.trySpawn();
    expect(spawner.nextDelayMs()).toBeLessThan(first);
  });

  it('met le spawn en pause quand la grille est pleine, puis reprend', () => {
    const { model, spawner } = build(() => 0);
    for (let i = 0; i < 25; i += 1) model.placeItem(i, 4);

    expect(spawner.trySpawn()).toBeNull();
    expect(spawner.nextDelayMs()).toBe(config.gridFullRetryMs);
    expect(spawner.spawnCount).toBe(0);

    model.removeItem(10);
    expect(spawner.nextDelayMs()).not.toBe(config.gridFullRetryMs);
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

