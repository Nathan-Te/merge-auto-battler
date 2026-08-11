import { describe, it, expect } from 'vitest';
import balance from '../src/config/balance.json';
import { parseBattleConfig } from '../src/systems/battleConfig.js';
import {
  waveComposition,
  waveSpawnOrder,
  waveEnemyCount,
  waveSpawnGapMs,
  describeWave,
} from '../src/systems/waves.js';

const config = parseBattleConfig(balance);
const scriptedCount = balance.waves.scripted.length;

describe('waveComposition', () => {
  it('rend exactement la composition scriptée pour les premières vagues', () => {
    for (let wave = 1; wave <= scriptedCount; wave += 1) {
      expect(waveComposition(config, wave)).toEqual(balance.waves.scripted[wave - 1]);
    }
  });

  it('rend le modèle infini tel quel pour la première vague générée', () => {
    expect(waveComposition(config, scriptedCount + 1)).toEqual(balance.waves.infinite);
  });

  it('fait grossir les vagues générées, sans jamais s’arrêter', () => {
    const first = waveEnemyCount(config, scriptedCount + 1);
    const later = waveEnemyCount(config, scriptedCount + 12);
    expect(later).toBeGreaterThan(first);
    expect(waveEnemyCount(config, 200)).toBeGreaterThan(0);
  });

  it('plafonne le nombre d’ennemis par entrée (garde-fou anti-explosion)', () => {
    for (const entry of waveComposition(config, 500)) {
      expect(entry.count).toBeLessThanOrEqual(balance.waves.scaling.maxCountPerEntry);
    }
  });

  it('ne laisse jamais le modèle muter la config chargée', () => {
    const composition = waveComposition(config, 1);
    composition[0].count = 999;
    expect(waveComposition(config, 1)[0].count).not.toBe(999);
  });

  it('traite les numéros de vague absurdes comme la vague 1', () => {
    expect(waveComposition(config, 0)).toEqual(waveComposition(config, 1));
    expect(waveComposition(config, -5)).toEqual(waveComposition(config, 1));
  });
});

describe('waveSpawnOrder', () => {
  it('déplie la composition en un ennemi par entrée, dans l’ordre déclaré', () => {
    const order = waveSpawnOrder(config, 3);
    const composition = waveComposition(config, 3);
    expect(order).toHaveLength(waveEnemyCount(config, 3));
    expect(order[0]).toBe(composition[0].type);
    expect(order[order.length - 1]).toBe(composition[composition.length - 1].type);
  });

  it('introduit les trois types d’ennemis au fil des vagues scriptées', () => {
    const types = new Set();
    for (let wave = 1; wave <= scriptedCount; wave += 1) {
      for (const type of waveSpawnOrder(config, wave)) types.add(type);
    }
    expect(types).toEqual(new Set(['basic', 'fast', 'tank']));
  });
});

describe('waveSpawnGapMs', () => {
  it('resserre les apparitions vague après vague, jusqu’à un plancher', () => {
    expect(waveSpawnGapMs(config, 1)).toBeCloseTo(balance.waves.spawnGapMs);
    expect(waveSpawnGapMs(config, 10)).toBeLessThan(waveSpawnGapMs(config, 1));
    expect(waveSpawnGapMs(config, 500)).toBe(balance.waves.scaling.minSpawnGapMs);
  });
});

describe('describeWave', () => {
  it('rend un libellé lisible avec les noms de balance.json', () => {
    expect(describeWave(config, 1)).toBe(`3× ${balance.enemies.basic.label}`);
    expect(describeWave(config, 3)).toContain(balance.enemies.fast.label);
  });
});
