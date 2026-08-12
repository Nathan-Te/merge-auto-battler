#!/usr/bin/env node
/**
 * `npm run docs` — régénère la référence depuis `src/config/balance.json`.
 *
 * ```bash
 * npm run docs             # écrit docs/reference.md (fr) et docs/reference.en.md
 * npm run docs -- --check  # échoue si l'un des deux est périmé (sans les écrire)
 * ```
 *
 * `--check` est là pour la CI et pour la relecture d'une PR : il répond à « ce dépôt
 * contient-il une référence à jour ? » sans modifier l'arbre de travail.
 *
 * ## Pourquoi deux fichiers depuis le Lot 5
 *
 * Le jeu sort **en anglais**, mais la documentation du projet est en français et s'adresse à
 * une personne. On génère donc les deux : `reference.md` reste la référence de travail en
 * français, `reference.en.md` porte exactement les mêmes nombres avec les libellés que voit
 * le joueur. C'est utile bien au-delà du symbole — la description d'une carte de draft est
 * ce qu'on relit pour rédiger la fiche du portail, et la relire en anglais évite de la
 * retraduire à la main une seconde fois.
 *
 * Les libellés ayant quitté `balance.json`, ils viennent des dictionnaires de `src/i18n/`.
 * Ils sont lus **au système de fichiers** plutôt qu'importés, comme `balance.json` : le
 * script reste indépendant du support des attributs d'import de Node.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { generateReference } from './reference.js';
import { PLURAL_RULES, makeTranslator } from '../i18n/format.js';

const BALANCE_URL = new URL('../config/balance.json', import.meta.url);
const LOCALE_URLS = {
  fr: new URL('../i18n/fr.json', import.meta.url),
  en: new URL('../i18n/en.json', import.meta.url),
};

/** Une sortie par langue. Le français reste `reference.md` : c'est la doc de travail. */
const OUTPUTS = [
  { locale: 'fr', url: new URL('../../docs/reference.md', import.meta.url), name: 'docs/reference.md' },
  {
    locale: 'en',
    url: new URL('../../docs/reference.en.md', import.meta.url),
    name: 'docs/reference.en.md',
  },
];

function readJson(url) {
  return JSON.parse(readFileSync(url, 'utf8'));
}

export function main(argv = []) {
  const check = argv.includes('--check');
  const balance = readJson(BALANCE_URL);
  const dictionaries = Object.fromEntries(
    Object.entries(LOCALE_URLS).map(([locale, url]) => [locale, readJson(url)])
  );

  const stale = [];
  for (const output of OUTPUTS) {
    // Repli sur l'anglais, comme en jeu : une clé oubliée en français produit la phrase
    // anglaise plutôt qu'un trou dans la référence.
    const t = makeTranslator(
      dictionaries[output.locale],
      dictionaries.en,
      PLURAL_RULES[output.locale]
    );
    const content = `${generateReference(balance, { t }).trimEnd()}\n`;

    if (check) {
      let current = null;
      try {
        current = readFileSync(output.url, 'utf8');
      } catch {
        current = null;
      }
      if (current !== content) stale.push(output.name);
      continue;
    }

    writeFileSync(output.url, content, 'utf8');
    console.log(`${output.name} régénéré (${content.length} octets).`);
  }

  if (!check) return 0;

  if (stale.length === 0) {
    console.log(`${OUTPUTS.map((output) => output.name).join(' et ')} sont à jour.`);
    return 0;
  }
  console.error(
    `${stale.join(', ')} périmé(s) : \`balance.json\` ou un dictionnaire de src/i18n/ a changé\n` +
      'depuis la dernière génération. Lancer `npm run docs` et committer le résultat.'
  );
  return 1;
}

// Exécuté seulement en ligne de commande : les tests importent `generateReference` sans
// écrire de fichier.
const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entry === import.meta.url) process.exitCode = main(process.argv.slice(2));
