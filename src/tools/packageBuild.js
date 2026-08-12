#!/usr/bin/env node
/**
 * `npm run package` — fabrique le **zip de soumission** Crazy Games à partir de `dist/`.
 *
 * ```bash
 * npm run build && npm run package
 * ```
 *
 * Le portail attend une archive dont `index.html` est **à la racine**, pas dans un
 * sous-dossier : c'est l'erreur classique (`zip -r jeu.zip dist/` produit `dist/index.html`
 * et le portail refuse l'archive sans dire pourquoi). On zippe donc le *contenu* de `dist/`.
 *
 * Le zip est aussi produit par le CI et déposé en artefact de build : c'est ce qui permet de
 * le récupérer **depuis un téléphone**, sans machine de développement — même logique que la
 * galerie d'assets.
 *
 * ## Pourquoi shell plutôt qu'une bibliothèque
 *
 * `zip` est présent sur macOS, sur Linux et sur les runners GitHub. Ajouter une dépendance
 * npm pour écrire un format qu'un binaire système écrit déjà coûterait plus cher à
 * maintenir que l'unique message d'erreur qu'on affiche quand il manque.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const DIST = path.join(ROOT, 'dist');
const OUT_DIR = path.join(ROOT, 'release');

/** Poids lisible — le même vocabulaire que le pipeline d'assets. */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} Mo`;
}

function directorySize(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? directorySize(full) : statSync(full).size;
  }
  return total;
}

export function main() {
  if (!existsSync(DIST)) {
    console.error('dist/ est absent — lance `npm run build` avant `npm run package`.');
    return 1;
  }
  if (!existsSync(path.join(DIST, 'index.html'))) {
    console.error('dist/index.html est absent : le build est incomplet.');
    return 1;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const zipPath = path.join(OUT_DIR, 'merge-battler.zip');
  // Une archive d'un build précédent serait **complétée**, pas remplacée : `zip` ajoute au
  // lieu d'écraser, et on livrerait des fichiers qui n'existent plus.
  if (existsSync(zipPath)) rmSync(zipPath);

  try {
    execFileSync(
      'zip',
      [
        '-r',
        '-q',
        // `-X` : pas de métadonnées propres à la machine (dates de création, attributs
        // macOS). L'archive ne doit décrire que le jeu.
        '-X',
        zipPath,
        '.',
        // Les artefacts de macOS et des éditeurs n'ont rien à faire dans une soumission.
        '-x',
        '.DS_Store',
        '-x',
        '__MACOSX/*',
        // La galerie d'assets est un **outil de revue interne** : elle est déployée avec le
        // jeu sur GitHub Pages (c'est là qu'on la consulte depuis un téléphone), mais elle
        // n'a rien à faire sur le portail — ni son poids, ni ses noms de fichiers internes.
        '-x',
        'gallery/*',
        // Empreinte des entrées du pipeline : utile au dépôt, sans objet pour le joueur.
        '-x',
        'assets/.build.json',
      ],
      { cwd: DIST, stdio: ['ignore', 'inherit', 'inherit'] }
    );
  } catch (error) {
    console.error(
      `La commande \`zip\` a échoué (${error.message}).\n` +
        'Installe-la (`apt install zip`, `brew install zip`), ou récupère le zip produit par\n' +
        'le CI : il est déposé en artefact sur chaque build de `main`.'
    );
    return 1;
  }

  const zipped = statSync(zipPath).size;
  const raw = directorySize(DIST);
  console.log(
    [
      `Archive : ${path.relative(ROOT, zipPath)}`,
      `  contenu décompressé : ${formatBytes(raw)}`,
      `  archive             : ${formatBytes(zipped)}`,
      '',
      '`index.html` est à la racine de l’archive, comme l’exige le portail.',
      'Étapes de soumission : voir la section « Publication » du README.',
    ].join('\n')
  );
  return 0;
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) process.exitCode = main();
