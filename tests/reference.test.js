import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import balance from '../src/config/balance.json';
import { generateReference, describeEffect } from '../src/tools/reference.js';
import { createTranslator } from '../src/i18n/index.js';
import { unitStats } from '../src/systems/battleConfig.js';
import { parseBattleConfig } from '../src/systems/battleConfig.js';

/**
 * `docs/reference.md` est **généré**, jamais écrit à la main : c'est ce qui l'empêche de
 * mentir. Ces tests vérifient les deux moitiés de cette promesse — que le générateur dit
 * bien ce que contient `balance.json`, et que le fichier commité est à jour.
 */

const REFERENCE_PATH = new URL('../docs/reference.md', import.meta.url);
const ENGLISH_PATH = new URL('../docs/reference.en.md', import.meta.url);
// La référence de travail est en français ; le jeu, lui, sort en anglais. Les deux fichiers
// portent exactement les mêmes nombres, et les deux sont vérifiés.
const generated = generateReference(balance, { t: createTranslator('fr') });
const generatedEnglish = generateReference(balance, { t: createTranslator('en') });

describe('docs/reference.md — le fichier commité', () => {
  it('est à jour : `npm run docs` ne le changerait pas', () => {
    // Ce test **est** la règle de `CLAUDE.md` (« toute livraison qui touche `balance.json`
    // régénère la référence »), appliquée par la CI plutôt que par la mémoire.
    const committed = readFileSync(REFERENCE_PATH, 'utf8');
    expect(committed).toBe(`${generated.trimEnd()}\n`);
  });

  it('a son jumeau anglais à jour, avec les libellés que voit le joueur', () => {
    const committed = readFileSync(ENGLISH_PATH, 'utf8');
    expect(committed).toBe(`${generatedEnglish.trimEnd()}\n`);
  });

  it('se présente comme généré, pour que personne ne l’édite', () => {
    expect(generated).toMatch(/Fichier généré/);
    expect(generated).toMatch(/npm run docs/);
  });
});

describe('generateReference — contenu', () => {
  it('couvre les quatre sections attendues', () => {
    for (const heading of [
      '## Unités',
      '## Ennemis',
      '## Vagues',
      '## Améliorations (draft)',
      '## Économie de la grille',
    ]) {
      expect(generated).toContain(heading);
    }
  });

  it('liste tous les types d’unités et d’ennemis de balance.json', () => {
    // Les libellés viennent des dictionnaires de `src/i18n/` depuis le Lot 5, mais les
    // **identifiants** viennent toujours de `balance.json` : c'est lui qui décide de ce qui
    // existe, et la référence doit tout couvrir.
    const fr = createTranslator('fr');
    for (const id of Object.keys(balance.units)) {
      expect(generated).toContain(`${fr(`units.${id}.label`)} — \`${id}\``);
    }
    for (const id of Object.keys(balance.enemies)) {
      expect(generated).toContain(fr(`enemies.${id}.label`));
    }
  });

  it('liste toutes les améliorations, avec leurs niveaux et leurs valeurs', () => {
    const fr = createTranslator('fr');
    for (const upgrade of balance.draft.upgrades) {
      expect(generated).toContain(`**${fr(`draft.upgrades.${upgrade.id}.label`)}** (\`${upgrade.id}\`)`);
      expect(generated).toContain(fr(`draft.upgrades.${upgrade.id}.description`));
    }
  });

  it('n’écrit jamais une clé de traduction brute — signe d’un libellé oublié', () => {
    for (const rendered of [generated, generatedEnglish]) {
      expect(rendered).not.toMatch(/\b(units|powers|enemies|draft\.upgrades|waves\.labels)\.[a-z]+\.(label|blurb|description)\b/i);
    }
  });

  it('donne des stats **calculées par les formules du jeu**, pas recopiées', () => {
    const config = parseBattleConfig(balance);
    // Le tier 3 du mono-cible ne figure nulle part dans `balance.json` : s'il apparaît dans
    // la référence, c'est bien qu'elle est passée par `unitStats`.
    const damage = unitStats(config, 'single', 3).damage;
    expect(damage).not.toBe(balance.units.single.damage);
    expect(generated).toContain(String(Math.round(damage * 10) / 10));
  });

  it('annonce les vagues générées, pas seulement les scriptées', () => {
    expect(generated).toContain('*(générée)*');
    // La texture d'une vague générée est dérivée de sa composition (cf. `waveLabel`).
    expect(generated).toMatch(/\| 11 \*\(générée\)\* \|/);
  });

  it('reflète la version de balance.json', () => {
    expect(generated).toContain(`**${balance.version}**`);
  });
});

describe('describeEffect', () => {
  it('rend un facteur en pourcentage lisible, signe compris', () => {
    expect(describeEffect({ unitDamage: 1.18 })).toContain('+18 %');
    expect(describeEffect({ unitFireRate: 0.88 })).toContain('−12 %');
  });

  it('rend les quantités entières telles quelles', () => {
    expect(describeEffect({ slotBonus: 1 })).toContain('`slotBonus` +1');
  });

  it('nomme le type visé par un bonus ciblé', () => {
    const described = describeEffect({ byType: { support: { effect: 1.35 } } });
    expect(described).toContain('support');
    expect(described).toContain('effect ×1.35');
  });
});
