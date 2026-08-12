#!/usr/bin/env node
/**
 * `npm run docs` — régénère `docs/reference.md` depuis `src/config/balance.json`.
 *
 * ```bash
 * npm run docs           # écrit docs/reference.md
 * npm run docs -- --check  # échoue si le fichier est périmé (sans l'écrire)
 * ```
 *
 * `--check` est là pour la CI et pour la relecture d'une PR : il répond à « ce dépôt
 * contient-il une référence à jour ? » sans modifier l'arbre de travail.
 *
 * `balance.json` est lu au système de fichiers plutôt qu'importé, comme le CLI du harness :
 * le script reste indépendant de la version de Node et de son support des attributs
 * d'import.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { generateReference } from './reference.js';

const BALANCE_URL = new URL('../config/balance.json', import.meta.url);
const OUTPUT_URL = new URL('../../docs/reference.md', import.meta.url);

export function main(argv = []) {
  const check = argv.includes('--check');
  const balance = JSON.parse(readFileSync(BALANCE_URL, 'utf8'));
  const content = `${generateReference(balance).trimEnd()}\n`;

  if (check) {
    let current = null;
    try {
      current = readFileSync(OUTPUT_URL, 'utf8');
    } catch {
      current = null;
    }
    if (current === content) {
      console.log('docs/reference.md est à jour.');
      return 0;
    }
    console.error(
      'docs/reference.md est périmé : `balance.json` a changé depuis la dernière génération.\n' +
        'Lancer `npm run docs` et committer le résultat.'
    );
    return 1;
  }

  writeFileSync(OUTPUT_URL, content, 'utf8');
  console.log(`docs/reference.md régénéré (${content.length} octets).`);
  return 0;
}

// Exécuté seulement en ligne de commande : les tests importent `generateReference` sans
// écrire de fichier.
const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entry === import.meta.url) process.exitCode = main(process.argv.slice(2));
