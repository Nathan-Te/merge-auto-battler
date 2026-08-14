import { describe, it, expect } from 'vitest';
import balance from '../src/config/balance.json';
import { DraftSystem, parseDraftConfig } from '../src/systems/DraftSystem.js';
import {
  neutralModifiers,
  applyEffect,
  typeModifiers,
  parseEffect,
} from '../src/systems/modifiers.js';
import { makeRng } from '../src/systems/rng.js';
import { parseBattleConfig, unitStats, supportBonus } from '../src/systems/battleConfig.js';

/**
 * Tests du draft roguelite du Lot 3.5.
 *
 * Deux promesses y sont vérifiées plus que le reste, parce que tout le lot repose dessus :
 *
 *   - **une amélioration ne mute jamais `balance.json`.** Le fichier est importé une fois
 *     pour toute l'application : une mutation ferait survivre les améliorations d'une
 *     partie à la suivante, ce que le « rejouer » du jeu rend par ailleurs impossible ;
 *   - **le tirage est seedé et sans doublon.** Sans ça, le harness ne serait plus
 *     reproductible et une offre pourrait proposer deux fois la même carte.
 */

const CONFIG = parseDraftConfig(balance);

function makeDraft(seed = 1, config = CONFIG) {
  return new DraftSystem({ config, rng: makeRng(seed) });
}

describe('parseDraftConfig', () => {
  it('lit la section `draft` de balance.json', () => {
    expect(CONFIG.everyWaves).toBeGreaterThanOrEqual(1);
    expect(CONFIG.cardsPerOffer).toBe(3);
    expect(CONFIG.upgrades.length).toBeGreaterThanOrEqual(10);
  });

  it('refuse une section manquante plutôt que d’inventer un pool vide', () => {
    expect(() => parseDraftConfig({})).toThrow(/draft/);
  });

  it('refuse un identifiant en double : deux cartes identiques seraient indistinguables', () => {
    const doubled = {
      draft: {
        ...balance.draft,
        upgrades: [balance.draft.upgrades[0], balance.draft.upgrades[0]],
      },
    };
    expect(() => parseDraftConfig(doubled)).toThrow(/double/);
  });

  it('refuse un modificateur inconnu — une clé mal orthographiée doit crier', () => {
    expect(() => parseEffect({ unitDammage: 1.2 }, 'x')).toThrow(/modificateur/);
  });

  it('refuse un facteur nul ou négatif', () => {
    expect(() => parseEffect({ unitDamage: 0 }, 'x')).toThrow(/facteur/);
  });

  it('refuse une offre plus large que le pool', () => {
    expect(() =>
      parseDraftConfig({ draft: { ...balance.draft, cardsPerOffer: 99 } })
    ).toThrow(/pool/);
  });
});

describe('DraftSystem — tirage', () => {
  it('propose exactement `cardsPerOffer` cartes, toutes différentes', () => {
    const draft = makeDraft();
    const cards = draft.offer();
    expect(cards).toHaveLength(CONFIG.cardsPerOffer);
    expect(new Set(cards.map((card) => card.id)).size).toBe(cards.length);
  });

  it('rejoue exactement la même offre à graine égale', () => {
    const a = makeDraft(42).offer().map((card) => card.id);
    const b = makeDraft(42).offer().map((card) => card.id);
    expect(a).toEqual(b);
  });

  it('donne des offres différentes à graines différentes', () => {
    const offers = [7, 8, 9, 10].map((seed) => makeDraft(seed).offer().map((c) => c.id).join(','));
    expect(new Set(offers).size).toBeGreaterThan(1);
  });

  it('ne propose plus une amélioration arrivée à son niveau maximum', () => {
    const draft = makeDraft();
    const entry = CONFIG.upgrades.find((upgrade) => upgrade.maxLevel === 2);
    draft.choose(entry.id);
    draft.choose(entry.id);

    expect(draft.levelOf(entry.id)).toBe(entry.maxLevel);
    expect(draft.choose(entry.id)).toBeNull();
    expect(draft.available().map((u) => u.id)).not.toContain(entry.id);

    for (let i = 0; i < 40; i += 1) {
      expect(draft.offer().map((card) => card.id)).not.toContain(entry.id);
    }
  });

  it('rend moins de cartes plutôt qu’un doublon quand le pool s’épuise', () => {
    // Pool de deux améliorations à un niveau : la troisième offre ne peut plus rien tirer.
    const config = parseDraftConfig({
      draft: {
        everyWaves: 1,
        cardsPerOffer: 2,
        upgrades: balance.draft.upgrades.slice(0, 2).map((u) => ({ ...u, maxLevel: 1 })),
      },
    });
    const draft = makeDraft(3, config);

    expect(draft.offer()).toHaveLength(2);
    draft.choose(config.upgrades[0].id);
    expect(draft.offer()).toHaveLength(1);
    draft.choose(config.upgrades[1].id);
    expect(draft.offer()).toHaveLength(0);
  });

  it('annonce le niveau **à venir** sur chaque carte', () => {
    const draft = makeDraft();
    const entry = CONFIG.upgrades.find((upgrade) => upgrade.maxLevel >= 2);
    expect(draft.describe(entry).level).toBe(1);
    draft.choose(entry.id);
    expect(draft.describe(entry).level).toBe(2);
  });

  it('ouvre un draft toutes les `everyWaves` vagues, et jamais à la vague 0', () => {
    const draft = makeDraft();
    expect(draft.isDraftWave(0)).toBe(false);
    expect(draft.isDraftWave(CONFIG.everyWaves)).toBe(true);
    expect(draft.isDraftWave(CONFIG.everyWaves * 2)).toBe(true);
    expect(draft.isDraftWave(CONFIG.everyWaves + 1)).toBe(false);
  });
});

describe('DraftSystem — cumul des modificateurs', () => {
  it('part de modificateurs neutres : sans draft, rien ne change', () => {
    const draft = makeDraft();
    const stats = unitStats(parseBattleConfig(balance), 'single', 3, { modifiers: draft.modifiers });
    const plain = unitStats(parseBattleConfig(balance), 'single', 3);
    expect(stats).toEqual(plain);
  });

  it('compose les facteurs par produit, jamais par somme', () => {
    const draft = makeDraft();
    draft.choose('power');
    draft.choose('power');
    // Deux fois « +18 % » vaut ×1,3924, pas ×1,36.
    expect(draft.modifiers.unitDamage).toBeCloseTo(1.18 ** 2, 6);
  });

  it('additionne les quantités entières (places, PV, tiers)', () => {
    const draft = makeDraft();
    draft.choose('slot');
    draft.choose('slot');
    expect(draft.modifiers.slotBonus).toBe(2);
  });

  it('ne mute **jamais** balance.json', () => {
    const before = JSON.stringify(balance);
    const draft = makeDraft();
    for (const upgrade of CONFIG.upgrades) draft.choose(upgrade.id);
    expect(JSON.stringify(balance)).toBe(before);
  });

  it('remplace ses modificateurs au lieu de les muter : un instantané reste valable', () => {
    const draft = makeDraft();
    const snapshot = draft.modifiers;
    draft.choose('power');
    expect(snapshot.unitDamage).toBe(1);
    expect(draft.modifiers).not.toBe(snapshot);
  });

  it('cumule un bonus de type **par-dessus** le bonus global', () => {
    const mods = applyEffect(
      applyEffect(neutralModifiers(), { unitRange: 1.14 }),
      { byType: { support: { range: 1.2 } } }
    );
    expect(typeModifiers(mods, 'support').range).toBeCloseTo(1.14 * 1.2, 6);
    // Les autres types ne reçoivent que le global : un bonus ciblé reste ciblé.
    expect(typeModifiers(mods, 'single').range).toBeCloseTo(1.14, 6);
  });

  it('liste le build joué, avec les niveaux', () => {
    const draft = makeDraft();
    draft.choose('power');
    draft.choose('power');
    draft.choose('slot');
    expect(draft.chosen()).toEqual([
      { id: 'power', level: 2, maxLevel: 3 },
      { id: 'slot', level: 1, maxLevel: 2 },
    ]);
  });

  it('émet `draftChosen` avec les modificateurs à jour', () => {
    const draft = makeDraft();
    const seen = [];
    draft.events.on('draftChosen', (payload) => seen.push(payload));
    draft.choose('fireRate');
    expect(seen).toHaveLength(1);
    expect(seen[0].id).toBe('fireRate');
    expect(seen[0].modifiers.unitFireRate).toBeCloseTo(0.88, 6);
  });

  it('ignore un identifiant inconnu', () => {
    expect(makeDraft().choose('nexistePas')).toBeNull();
  });
});

describe('les modificateurs traversent bien les formules de stats', () => {
  const config = parseBattleConfig(balance);

  it('« Puissance » monte les dégâts, « Cadence » descend le délai de frappe', () => {
    const mods = applyEffect(applyEffect(neutralModifiers(), { unitDamage: 1.18 }), {
      unitFireRate: 0.88,
    });
    const base = unitStats(config, 'single', 4);
    const buffed = unitStats(config, 'single', 4, { modifiers: mods });

    expect(buffed.damage).toBeCloseTo(base.damage * 1.18, 6);
    expect(buffed.fireRateMs).toBeCloseTo(base.fireRateMs * 0.88, 6);
  });

  it('« Portée » élargit aussi l’aura du soutien : c’est une distance, pas un effet', () => {
    const mods = applyEffect(neutralModifiers(), { unitRange: 1.14 });
    const base = unitStats(config, 'support', 3);
    const buffed = unitStats(config, 'support', 3, { modifiers: mods });
    expect(buffed.auraRadius).toBeCloseTo(base.auraRadius * 1.14, 6);
  });

  it('« Étendard » ne buffe que le soutien', () => {
    const mods = applyEffect(neutralModifiers(), {
      byType: { support: { effect: 1.35 } },
    });
    const base = supportBonus(config, 'support', 2);
    const buffed = supportBonus(config, 'support', 2, mods);
    expect(buffed.damage).toBeCloseTo(base.damage * 1.35, 6);

    // Le rayon de zone du type `aoe`, lui, ne bouge pas.
    expect(unitStats(config, 'aoe', 3, { modifiers: mods }).splashRadius).toBeCloseTo(
      unitStats(config, 'aoe', 3).splashRadius,
      6
    );
  });

  it('la cadence améliorée ne descend jamais sous un tick logique', () => {
    let mods = neutralModifiers();
    for (let i = 0; i < 20; i += 1) mods = applyEffect(mods, { unitFireRate: 0.5 });
    expect(unitStats(config, 'single', 8, { modifiers: mods }).fireRateMs).toBe(config.tickMs);
  });
});
