import { describe, it, expect } from 'vitest';
import balance from '../src/config/balance.json';
import { runPolicies } from '../src/sim/simulate.js';
import { POLICIES } from '../src/sim/policies.js';
import { TARGETS } from '../src/sim/targets.js';

/**
 * **Le garde-fou d'équilibrage du jeu.** Il échoue si un futur réglage de `balance.json`
 * casse une promesse du design — et c'est exactement ce qu'on lui demande.
 *
 * L'invariant central : **préparer bat spammer**. Tout le jeu repose dessus. Si envoyer
 * dix unités de tier 1 valait mieux que d'en fusionner deux en tier 4, la grille ne
 * servirait plus à rien et le jeu n'aurait plus de décision. Aucune valeur de
 * `balance.json` ne doit pouvoir inverser ça sans que la CI s'en aperçoive.
 *
 * Ces tests jouent de vraies parties (harness headless, cf. `src/sim/`), sur des graines
 * fixes : ils sont donc **déterministes** et un échec est reproductible à l'identique par
 * `npm run sim`.
 *
 * L'échantillon est volontairement petit (le suite de tests doit rester rapide) ; le
 * rapport complet se lit avec `npm run sim -- --games=30`.
 */

const GAMES = 8;
const SEED = 1;

const run = runPolicies({
  balance,
  policies: [POLICIES.spam, POLICIES.mixed, POLICIES.prepare],
  games: GAMES,
  seed: SEED,
});
const [spam, mixed, prepare] = run.policies;

describe('invariant d’équilibrage — merger bat spammer', () => {
  it('la politique « prépare » survit nettement plus longtemps que « spam »', () => {
    expect(prepare.waves.mean).toBeGreaterThanOrEqual(
      spam.waves.mean * TARGETS.mergeBeatsSpamRatio
    );
  });

  it('même le joueur médian, qui fusionne un peu, bat le spammeur', () => {
    expect(mixed.waves.mean).toBeGreaterThan(spam.waves.mean);
  });

  it('l’écart ne tient pas à une partie chanceuse : il vaut pour la pire des parties', () => {
    // Sans cette borne, un ratio de moyennes pourrait être porté par un seul run extrême.
    expect(prepare.waves.min).toBeGreaterThan(spam.waves.max);
  });
});

describe('le draft fait bien partie des parties mesurées', () => {
  it('chaque politique prend des améliorations en jouant', () => {
    // Sans ce test, une régression qui casserait le draft passerait inaperçue : le harness
    // continuerait de sortir des chiffres, simplement ceux d'un jeu sans draft.
    for (const policy of run.policies) {
      expect(policy.draftsPerGame).toBeGreaterThan(0);
    }
  });

  it('le joueur qui survit plus longtemps prend plus de cartes', () => {
    expect(prepare.draftsPerGame).toBeGreaterThan(spam.draftsPerGame);
  });
});

describe('objectifs chiffrés du Lot 3', () => {
  it('le joueur médian tombe dans la fenêtre de vagues visée', () => {
    expect(mixed.waves.mean).toBeGreaterThanOrEqual(TARGETS.minWave);
    expect(mixed.waves.mean).toBeLessThanOrEqual(TARGETS.maxWave);
  });

  it('sa partie dure entre trois et cinq minutes', () => {
    expect(mixed.durationMs.mean).toBeGreaterThanOrEqual(TARGETS.minDurationMs);
    expect(mixed.durationMs.mean).toBeLessThanOrEqual(TARGETS.maxDurationMs);
  });

  it('aucune politique ne survit indéfiniment : la formule infinie finit par gagner', () => {
    for (const policy of run.policies) {
      expect(policy.timedOut).toBe(0);
    }
  });
});

describe('économie de la grille', () => {
  it('le spammeur sature sa grille — c’est la punition visible de son jeu', () => {
    expect(spam.gridFullShare).toBeGreaterThan(0.3);
  });

  it('le joueur qui fusionne, lui, garde une grille respirable', () => {
    expect(mixed.gridFullShare).toBeLessThan(0.1);
  });
});
