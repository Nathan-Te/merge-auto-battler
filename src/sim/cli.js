#!/usr/bin/env node
/**
 * `npm run sim` — joue des parties automatiques et sort un rapport d'équilibrage.
 *
 * ```bash
 * npm run sim                                   # 20 parties par politique, graine 1
 * npm run sim -- --games=50 --seed=7            # échantillon plus large, autre graine
 * npm run sim -- --policies=spam,prepare        # comparer deux politiques seulement
 * npm run sim -- --json > rapport.json          # sortie machine (CI, diff entre réglages)
 * ```
 *
 * Le rapport est **reproductible** : mêmes graines + même `balance.json` = mêmes chiffres.
 * C'est ce qui permet de valider un réglage en secondes au lieu d'un playtest par valeur.
 *
 * `balance.json` est lu au système de fichiers plutôt qu'importé : le CLI reste
 * indépendant de la version de Node et de son support des attributs d'import.
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { runPolicies } from './simulate.js';
import { runMatchups } from './matchups.js';
import { formatReport, formatMatchups } from './report.js';
import { POLICY_IDS, resolvePolicies } from './policies.js';
import { TARGETS } from './targets.js';

/** Lit `--clé=valeur` et `--drapeau` depuis `argv`. */
export function parseArgs(argv) {
  const options = {
    games: 20,
    seed: 1,
    policies: POLICY_IDS,
    json: false,
    help: false,
    matchups: false,
    tier: 4,
  };

  for (const arg of argv) {
    const [rawKey, rawValue] = arg.replace(/^--/, '').split('=');
    switch (rawKey) {
      case 'games':
      case 'seed':
      case 'tier': {
        const value = Number(rawValue);
        if (!Number.isFinite(value) || value < 1) {
          throw new Error(`--${rawKey} attend un entier positif`);
        }
        options[rawKey] = Math.floor(value);
        break;
      }
      case 'policies':
        options.policies = String(rawValue ?? '')
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean);
        break;
      case 'json':
        options.json = true;
        break;
      case 'matchups':
        options.matchups = true;
        break;
      case 'help':
      case 'h':
        options.help = true;
        break;
      default:
        throw new Error(`option inconnue « ${arg} »`);
    }
  }
  return options;
}

const USAGE = `npm run sim -- [options]

  --games=N        parties par politique (défaut : 20)
  --seed=N         graine de la première partie (défaut : 1)
  --policies=a,b   politiques à jouer (défaut : ${POLICY_IDS.join(',')})
  --matchups       matrice « quel type d'unité contre quelle vague »
  --tier=N         tier des unités des bancs d'essai (défaut : 4)
  --json           sortie JSON complète au lieu du rapport texte
  --help           cette aide`;

export function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`${error.message}\n\n${USAGE}`);
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    console.log(USAGE);
    return;
  }

  const balance = JSON.parse(readFileSync(new URL('../config/balance.json', import.meta.url), 'utf8'));

  if (options.matchups) {
    const matrix = runMatchups({ balance, tier: options.tier });
    console.log(options.json ? JSON.stringify(matrix, null, 2) : formatMatchups(matrix));
    return;
  }

  const run = runPolicies({
    balance,
    policies: resolvePolicies(options.policies),
    games: options.games,
    seed: options.seed,
  });

  if (options.json) {
    // Les parties individuelles sont retirées : un rapport JSON sert à comparer deux
    // réglages, pas à rejouer 60 parties ligne à ligne (les graines suffisent pour ça).
    const compact = { ...run, policies: run.policies.map(({ results, ...rest }) => rest) };
    console.log(JSON.stringify(compact, null, 2));
    return;
  }

  console.log(formatReport(run, { targets: TARGETS }));
}

// Exécuté **seulement** en ligne de commande : les tests importent `parseArgs` sans
// déclencher une simulation ni lire l'`argv` de vitest.
const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entry === import.meta.url) main(process.argv.slice(2));
