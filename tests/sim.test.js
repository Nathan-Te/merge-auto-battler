import { describe, it, expect } from 'vitest';
import balance from '../src/config/balance.json';
import { makeRng } from '../src/systems/rng.js';
import { simulateGame, runPolicy, mean, stdDev, median } from '../src/sim/simulate.js';
import { POLICIES, findMerge, findHighest, findLowest, resolvePolicies } from '../src/sim/policies.js';
import { formatDuration, formatReport, evaluateTargets } from '../src/sim/report.js';
import { runMatchup, SQUADS } from '../src/sim/matchups.js';
import { GridModel } from '../src/systems/GridModel.js';
import { parseArgs } from '../src/sim/cli.js';

/**
 * Tests du harness lui-même. Un outil de mesure faux est pire que pas d'outil : c'est sur
 * ses chiffres qu'on règle `balance.json`, donc son **déterminisme** est la première chose
 * à vérifier.
 */

describe('makeRng', () => {
  it('rejoue exactement la même suite à graine égale', () => {
    const a = Array.from({ length: 20 }, makeRng(42));
    const b = Array.from({ length: 20 }, makeRng(42));
    expect(a).toEqual(b);
  });

  it('donne des suites différentes à graines différentes', () => {
    expect(Array.from({ length: 8 }, makeRng(1))).not.toEqual(Array.from({ length: 8 }, makeRng(2)));
  });

  it('reste dans [0, 1)', () => {
    const rng = makeRng(7);
    for (let i = 0; i < 500; i += 1) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('simulateGame — déterminisme', () => {
  it('deux parties de même graine sont identiques jusqu’au dernier compteur', () => {
    const options = { balance, policy: POLICIES.mixed, seed: 123 };
    expect(simulateGame(options)).toEqual(simulateGame(options));
  });

  it('des graines différentes produisent des parties différentes', () => {
    const first = simulateGame({ balance, policy: POLICIES.mixed, seed: 1 });
    const second = simulateGame({ balance, policy: POLICIES.mixed, seed: 2 });
    // Le résultat final peut coïncider ; le déroulé, lui, ne doit pas.
    expect(first.recap.merges + first.recap.sent).not.toBe(
      second.recap.merges + second.recap.sent
    );
  });

  it('joue une vraie partie : elle se termine, avec des vagues et des envois', () => {
    const result = simulateGame({ balance, policy: POLICIES.mixed, seed: 5 });
    expect(result.timedOut).toBe(false);
    expect(result.wavesCleared).toBeGreaterThan(0);
    expect(result.recap.sent).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThan(0);
  });
});

describe('simulateGame — drafts (Lot 3.5)', () => {
  /**
   * La partie **gèle** sur un draft : si le harness ne choisissait pas, il tournerait
   * jusqu'à son garde-fou de durée en croyant mesurer une survie infinie. C'est le piège
   * numéro un de ce lot, et il vaut un test à lui seul.
   */
  it('choisit des cartes et ne se bloque jamais sur un draft', () => {
    const result = simulateGame({ balance, policy: POLICIES.mixed, seed: 11 });
    expect(result.timedOut).toBe(false);
    expect(result.drafted.length).toBeGreaterThan(0);
    expect(result.recap.upgrades.length).toBeGreaterThan(0);
  });

  it('prend une amélioration toutes les `everyWaves` vagues, pas davantage', () => {
    const result = simulateGame({ balance, policy: POLICIES.mixed, seed: 11 });
    const expected = Math.floor(result.wavesCleared / balance.draft.everyWaves);
    // La dernière vague peut tomber avant que son draft ne s'ouvre : on borne, sans exiger
    // l'égalité stricte.
    expect(result.drafted.length).toBeLessThanOrEqual(expected);
    expect(result.drafted.length).toBeGreaterThanOrEqual(expected - 1);
  });

  it('rejoue les mêmes choix de draft à graine égale', () => {
    const options = { balance, policy: POLICIES.prepare, seed: 77 };
    expect(simulateGame(options).drafted).toEqual(simulateGame(options).drafted);
  });

  it('agrège les drafts dans le rapport de politique', () => {
    const run = runPolicy({ balance, policy: POLICIES.mixed, games: 3, seed: 21 });
    expect(run.draftsPerGame).toBeGreaterThan(0);
    const total = Object.values(run.draftCounts).reduce((sum, value) => sum + value, 0);
    expect(total).toBeCloseTo(run.draftsPerGame * run.games, 6);
  });

  it('respecte le choix d’une politique qui sait drafter', () => {
    // Une politique peut imposer son build : le tirage aléatoire n'est qu'un défaut.
    const stubborn = {
      ...POLICIES.mixed,
      draft: (cards) => cards[cards.length - 1].id,
    };
    const result = simulateGame({ balance, policy: stubborn, seed: 31 });
    expect(result.drafted.length).toBeGreaterThan(0);
  });
});

describe('politiques', () => {
  const gridWith = (tiers) => {
    const grid = new GridModel({ maxTier: balance.itemSpawner.maxTier });
    tiers.forEach((tier, index) => {
      if (tier > 0) grid.placeItem(index, tier, { silent: true });
    });
    return grid;
  };

  it('findMerge choisit la paire du plus bas tier', () => {
    const grid = gridWith([3, 3, 1, 1, 5]);
    expect(findMerge(grid, 11)).toMatchObject({ tier: 1, from: 2, to: 3 });
  });

  it('findMerge ignore les items déjà au tier maximum', () => {
    const grid = gridWith([11, 11]);
    expect(findMerge(grid, 11)).toBeNull();
  });

  it('findHighest et findLowest tranchent les égalités par le plus petit index', () => {
    const grid = gridWith([2, 4, 4, 1, 1]);
    expect(findHighest(grid)).toMatchObject({ index: 1, tier: 4 });
    expect(findLowest(grid)).toMatchObject({ index: 3, tier: 1 });
  });

  it('« spam » ne fusionne jamais — c’est ce qui en fait l’anti-modèle', () => {
    const result = simulateGame({ balance, policy: POLICIES.spam, seed: 9 });
    expect(result.actions.merge).toBe(0);
    expect(result.recap.merges).toBe(0);
  });

  it('« prépare » n’envoie rien en dessous de son tier cible', () => {
    const result = simulateGame({ balance, policy: POLICIES.prepare, seed: 9 });
    const tiersSent = Object.keys(result.recap.sentByTier).map(Number);
    expect(Math.min(...tiersSent)).toBeGreaterThanOrEqual(POLICIES.prepare.sendTier);
  });

  it('resolvePolicies refuse un identifiant inconnu plutôt que de l’ignorer', () => {
    expect(() => resolvePolicies(['spam'])).not.toThrow();
    expect(() => resolvePolicies(['nawak'])).toThrow(/politique inconnue/);
  });
});

describe('agrégation', () => {
  it('moyenne, écart-type et médiane', () => {
    expect(mean([2, 4, 6])).toBe(4);
    expect(stdDev([4, 4, 4])).toBe(0);
    expect(stdDev([2, 6])).toBe(2);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });

  it('sur liste vide, rend 0 plutôt que NaN', () => {
    expect(mean([])).toBe(0);
    expect(stdDev([])).toBe(0);
    expect(median([])).toBe(0);
  });

  it('runPolicy joue le nombre de parties demandé, sur des graines consécutives', () => {
    const report = runPolicy({ balance, policy: POLICIES.spam, games: 3, seed: 10 });
    expect(report.results.map((result) => result.seed)).toEqual([10, 11, 12]);
    expect(report.waves.min).toBeLessThanOrEqual(report.waves.max);
    expect(report.gridItemsAvg).toBeGreaterThan(0);
  });
});

describe('rapport', () => {
  it('met les durées en minutes', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(123_000)).toBe('2:03');
    expect(formatDuration(600_000)).toBe('10:00');
  });

  it('rend un tableau lisible et annote les objectifs', () => {
    const run = {
      games: 2,
      seed: 1,
      policies: [
        {
          policy: 'spam',
          label: 'Spam',
          summary: 's',
          waves: { mean: 5, stdDev: 0, median: 5, min: 5, max: 5 },
          durationMs: { mean: 120_000 },
          damageShare: { single: 1 },
          sentByTier: { 1: 10 },
          blockedTaps: 0,
          gridFullShare: 0.5,
          gridItemsAvg: 20,
          timedOut: 0,
        },
      ],
    };
    const text = formatReport(run);
    expect(text).toContain('Spam');
    expect(text).toContain('2:00');
    expect(text).toContain('pleine 50% du temps');
  });

  it('evaluateTargets marque l’invariant en échec quand le spam gagne', () => {
    const build = (id, waves) => ({
      policy: id,
      label: id,
      waves: { mean: waves, stdDev: 0, median: waves, min: waves, max: waves },
      durationMs: { mean: 200_000 },
      damageShare: {},
      sentByTier: {},
      blockedTaps: 0,
      timedOut: 0,
    });
    const checks = evaluateTargets(
      { policies: [build('spam', 10), build('prepare', 6)] },
      { mergeBeatsSpamRatio: 1.4, minWave: 8, maxWave: 12, minDurationMs: 0, maxDurationMs: 1e9 }
    );
    expect(checks.find((check) => check.label.includes('merge bat spam')).ok).toBe(false);
  });
});

describe('bancs d’essai', () => {
  it('oppose une escouade à une vague et rend une mesure exploitable', () => {
    const result = runMatchup({ balance, squad: SQUADS[0], wave: 5, tier: 4 });
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.baseDamage).toBeGreaterThanOrEqual(0);
    expect(result.enemiesKilled).toBeGreaterThan(0);
  });

  it('est déterministe, comme le reste du harness', () => {
    const once = runMatchup({ balance, squad: SQUADS[1], wave: 7, tier: 3 });
    const twice = runMatchup({ balance, squad: SQUADS[1], wave: 7, tier: 3 });
    expect(once).toEqual(twice);
  });

  it('une escouade de tier élevé laisse passer moins qu’une de tier bas', () => {
    const weak = runMatchup({ balance, squad: SQUADS[0], wave: 9, tier: 2 });
    const strong = runMatchup({ balance, squad: SQUADS[0], wave: 9, tier: 6 });
    expect(strong.baseDamage).toBeLessThan(weak.baseDamage);
  });
});

describe('ligne de commande', () => {
  it('lit les options et garde des défauts utilisables', () => {
    expect(parseArgs([])).toMatchObject({ games: 20, seed: 1, json: false });
    expect(parseArgs(['--games=5', '--seed=7', '--json'])).toMatchObject({
      games: 5,
      seed: 7,
      json: true,
    });
    expect(parseArgs(['--policies=spam,prepare']).policies).toEqual(['spam', 'prepare']);
  });

  it('refuse une option inconnue ou une valeur absurde', () => {
    expect(() => parseArgs(['--nawak'])).toThrow(/option inconnue/);
    expect(() => parseArgs(['--games=0'])).toThrow(/entier positif/);
  });
});
