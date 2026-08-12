import { describe, expect, it } from 'vitest';

import balance from '../src/config/balance.json';
import en from '../src/i18n/en.json';
import fr from '../src/i18n/fr.json';
import {
  LOCALES,
  createTranslator,
  currentLocale,
  detectLocale,
  setLocale,
  t,
} from '../src/i18n/index.js';
import { compositionText, makeTranslator, waveLabelText } from '../src/i18n/format.js';
import { parseBattleConfig } from '../src/systems/battleConfig.js';
import { parseDraftConfig } from '../src/systems/DraftSystem.js';
import { parsePowersConfig } from '../src/systems/PowerSystem.js';
import { waveLabel } from '../src/systems/waves.js';

/**
 * Le Lot 5 sort le jeu **en anglais**, et déplace tous les libellés de `balance.json` vers
 * les dictionnaires. Deux risques nouveaux, tous deux couverts ici :
 *
 *   - une clé oubliée dans une langue, qui ne se verrait qu'en jouant dans cette langue ;
 *   - un identifiant ajouté à `balance.json` (un pouvoir, une carte de draft) sans son
 *     libellé, qui afficherait la clé brute au milieu d'une carte.
 *
 * Le second est le plus important : c'est le seul lien qui reste entre le fichier
 * d'équilibrage et les dictionnaires, et rien d'autre ne le vérifie.
 */

/** Toutes les clés terminales d'un dictionnaire, en notation pointée. */
function flatten(node, prefix = '') {
  const keys = [];
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object') keys.push(...flatten(value, path));
    else keys.push(path);
  }
  return keys;
}

describe('dictionnaires', () => {
  it('le français couvre exactement les mêmes clés que l’anglais', () => {
    const english = flatten(en).sort();
    const french = flatten(fr).sort();

    // Rendus en deux listes plutôt qu'en comparaison brute : le message d'échec nomme la
    // clé manquante, ce qui est toute la valeur du test.
    expect(french.filter((key) => !english.includes(key))).toEqual([]);
    expect(english.filter((key) => !french.includes(key))).toEqual([]);
  });

  it('ne laisse aucune traduction vide', () => {
    for (const [locale, dictionary] of Object.entries(LOCALES)) {
      for (const key of flatten(dictionary)) {
        const value = key.split('.').reduce((node, part) => node[part], dictionary);
        expect(`${locale}:${key}:${value}`).not.toMatch(/:$/);
      }
    }
  });
});

describe('couverture de balance.json', () => {
  const config = parseBattleConfig(balance);
  const powers = parsePowersConfig(balance);
  const draft = parseDraftConfig(balance);

  /** Chaque identifiant de `balance.json` doit avoir son libellé dans **les deux** langues. */
  const expectations = [
    ...Object.keys(config.units).flatMap((id) => [`units.${id}.label`, `units.${id}.blurb`]),
    ...Object.keys(config.enemies).flatMap((id) => [
      `enemies.${id}.label`,
      `enemies.${id}.plural`,
    ]),
    ...Object.keys(powers.types).flatMap((id) => [`powers.${id}.label`, `powers.${id}.blurb`]),
    ...draft.upgrades.flatMap((entry) => [
      `draft.upgrades.${entry.id}.label`,
      `draft.upgrades.${entry.id}.description`,
    ]),
    ...balance.waves.scripted
      .filter((wave) => wave.labelId)
      .map((wave) => `waves.labels.${wave.labelId}`),
  ];

  for (const locale of Object.keys(LOCALES)) {
    it(`traduit tous les identifiants de balance.json en « ${locale} »`, () => {
      const translate = createTranslator(locale);
      const missing = expectations.filter((key) => translate(key) === key);
      expect(missing).toEqual([]);
    });
  }
});

describe('detectLocale', () => {
  it('sort en anglais par défaut', () => {
    expect(detectLocale()).toBe('en');
    expect(detectLocale({ languages: ['de-DE', 'es'] })).toBe('en');
  });

  it('suit le navigateur quand sa langue est connue', () => {
    expect(detectLocale({ languages: ['fr-FR', 'en-US'] })).toBe('fr');
  });

  it('ne compare que la racine — la plupart des navigateurs annoncent une région', () => {
    for (const tag of ['fr-CA', 'fr_FR', 'FR', 'fr']) {
      expect(detectLocale({ languages: [tag] })).toBe('fr');
    }
  });

  it('respecte l’ordre de préférence du navigateur', () => {
    expect(detectLocale({ languages: ['en-GB', 'fr-FR'] })).toBe('en');
  });

  it('laisse `?lang=` forcer la langue, pour tester sur un téléphone', () => {
    expect(detectLocale({ search: '?lang=fr', languages: ['en-US'] })).toBe('fr');
    expect(detectLocale({ search: '?debug=1&lang=fr' })).toBe('fr');
  });

  it('ignore une langue inconnue dans l’URL plutôt que de rendre le jeu muet', () => {
    expect(detectLocale({ search: '?lang=klingon', languages: ['fr'] })).toBe('fr');
  });
});

describe('traduction', () => {
  it('remplit les gabarits', () => {
    const translate = createTranslator('en');
    expect(translate('hud.baseHp', { current: 80, max: 100 })).toBe('HP 80/100');
  });

  it('accorde le pluriel des deux côtés', () => {
    const english = createTranslator('en');
    expect(english('gameOver.score', { count: 1 })).toBe('1 wave survived');
    expect(english('gameOver.score', { count: 12 })).toBe('12 waves survived');

    const french = createTranslator('fr');
    expect(french('gameOver.score', { count: 1 })).toBe('1 vague survécue');
    expect(french('gameOver.score', { count: 12 })).toBe('12 vagues survécues');
  });

  it('retombe sur l’anglais quand une clé manque dans la langue active', () => {
    const partial = makeTranslator({ hud: { skip: 'passer' } }, en);
    expect(partial('hud.skip')).toBe('passer');
    expect(partial('gameOver.title')).toBe(en.gameOver.title);
  });

  it('rend la clé plutôt qu’un blanc quand elle manque partout', () => {
    // Un panneau vide, personne ne le signale ; une clé affichée en clair se répare.
    expect(createTranslator('en')('nothing.here.at.all')).toBe('nothing.here.at.all');
  });

  it('laisse le gabarit visible quand un paramètre manque', () => {
    expect(createTranslator('en')('hud.wave')).toContain('{wave}');
  });
});

describe('mise en mots des vagues', () => {
  const config = parseBattleConfig(balance);

  it('nomme les vagues scriptées dans les deux langues', () => {
    const first = waveLabel(config, 1);
    expect(waveLabelText(first, createTranslator('en'))).toBe('First contact');
    expect(waveLabelText(first, createTranslator('fr'))).toBe('Découverte');
  });

  it('nomme aussi les vagues générées — l’annonce ne s’éteint pas en vague 11', () => {
    const scripted = balance.waves.scripted.length;
    for (const locale of Object.keys(LOCALES)) {
      const translate = createTranslator(locale);
      for (const wave of [scripted + 1, scripted + 9, scripted + 40]) {
        const text = waveLabelText(waveLabel(config, wave), translate);
        expect(text.length).toBeGreaterThan(0);
        // Une clé brute serait le signe d'une texture générée sans libellé.
        expect(text).not.toContain('waves.labels');
      }
    }
  });

  it('rend une composition lisible', () => {
    expect(compositionText([{ type: 'basic', count: 3 }], createTranslator('en'))).toBe('3× Goblin');
    expect(compositionText([{ type: 'tank', count: 2 }], createTranslator('fr'))).toBe('2× Ogre');
  });

  it('rend une chaîne vide pour une vague sans texture, sans planter', () => {
    expect(waveLabelText(null, createTranslator('en'))).toBe('');
  });
});

describe('langue active', () => {
  it('bascule globalement et revient', () => {
    const before = currentLocale();
    setLocale('fr');
    expect(currentLocale()).toBe('fr');
    expect(t('hud.skip')).toBe('passer');

    setLocale('en');
    expect(t('hud.skip')).toBe('skip');
    setLocale(before);
  });

  it('retombe sur l’anglais si on lui donne une langue inconnue', () => {
    setLocale('klingon');
    expect(currentLocale()).toBe('en');
  });
});
