import { describe, it, expect } from 'vitest';
import balance from '../src/config/balance.json';
import { parseBattleConfig } from '../src/systems/battleConfig.js';
import {
  waveComposition,
  waveSpawnOrder,
  waveEnemyCount,
  waveSpawnGapMs,
  waveLabel,
  describeWave,
} from '../src/systems/waves.js';

const config = parseBattleConfig(balance);
const scriptedCount = balance.waves.scripted.length;

describe('waveComposition', () => {
  it('rend exactement la composition scriptée pour les premières vagues', () => {
    for (let wave = 1; wave <= scriptedCount; wave += 1) {
      expect(waveComposition(config, wave)).toEqual(balance.waves.scripted[wave - 1].composition);
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
  it('respecte la cadence déclarée par une vague scriptée, sans la faire dériver', () => {
    balance.waves.scripted.forEach((wave, index) => {
      if (typeof wave.spawnGapMs === 'number') {
        expect(waveSpawnGapMs(config, index + 1)).toBe(wave.spawnGapMs);
      }
    });
  });

  it('resserre les vagues générées, jusqu’à un plancher', () => {
    const firstGenerated = scriptedCount + 1;
    expect(waveSpawnGapMs(config, firstGenerated + 10)).toBeLessThan(
      waveSpawnGapMs(config, firstGenerated)
    );
    expect(waveSpawnGapMs(config, 500)).toBe(balance.waves.scaling.minSpawnGapMs);
  });

  it('sépare bien les textures : un rush arrive plus serré qu’un mur', () => {
    const gaps = balance.waves.scripted.map((_, index) => waveSpawnGapMs(config, index + 1));
    const rush = Math.min(...gaps);
    const wall = Math.max(...gaps);
    // Sans cet écart, toutes les vagues auraient le même goût quel que soit leur contenu.
    expect(wall).toBeGreaterThan(rush * 2);
  });
});

describe('waveLabel', () => {
  it('donne sa texture écrite à la main à chaque vague scriptée', () => {
    for (let wave = 1; wave <= scriptedCount; wave += 1) {
      expect(waveLabel(config, wave)).toBe(balance.waves.scripted[wave - 1].label ?? '');
    }
  });

  it('en dérive une pour les vagues générées : l’annonce ne s’éteint pas en vague 11', () => {
    // L'annonce du Lot 3.5 doit valoir pour **toutes** les vagues, formule comprise :
    // une bannière muette au moment où la difficulté décolle serait le pire moment.
    for (let wave = scriptedCount + 1; wave <= scriptedCount + 6; wave += 1) {
      expect(waveLabel(config, wave).length).toBeGreaterThan(0);
    }
  });

  it('annonce la dominante quand il y en a une, « mixte » sinon', () => {
    const only = { ...config, waves: { ...config.waves, scripted: [], infinite: [{ type: 'tank', count: 5 }] } };
    expect(waveLabel(only, 1)).toBe('Marée de tanks');

    const even = {
      ...config,
      waves: {
        ...config.waves,
        scripted: [],
        infinite: [
          { type: 'basic', count: 5 },
          { type: 'fast', count: 5 },
          { type: 'tank', count: 5 },
        ],
      },
    };
    expect(waveLabel(even, 1)).toBe('Vague mixte');
  });
});

describe('describeWave', () => {
  it('rend un libellé lisible avec les noms de balance.json', () => {
    expect(describeWave(config, 1)).toBe(`3× ${balance.enemies.basic.label}`);
    expect(describeWave(config, 3)).toContain(balance.enemies.fast.label);
  });
});
