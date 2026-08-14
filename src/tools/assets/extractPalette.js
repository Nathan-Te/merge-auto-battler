#!/usr/bin/env node
/**
 * `npm run palette` — extrait la **palette partagée** du pack de référence.
 *
 * ```
 * assets-src/<planches de référence>  →  couleurs opaques distinctes  →  assets-src/palette.json
 * ```
 *
 * C'est le seul producteur de ce fichier, et il n'est **pas** branché sur `npm run assets` :
 * changer la palette est une décision de direction artistique, pas un effet de bord d'un
 * build. Elle se lance à la main, et son diff se relit (cf. `palette.js`).
 *
 * Les planches de référence sont nommées dans `assets-src/manifest.json`, clé
 * `palette.sources`. Ce sont les **packs**, pas les générations IA : une génération porte
 * des dizaines de milliers de teintes, et l'extraction refuse d'en faire une palette.
 *
 * ```bash
 * npm run palette              # (ré)écrit assets-src/palette.json
 * npm run palette -- --check   # ne rien écrire ; sort en 1 si le fichier est périmé
 * ```
 */

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseManifest } from './manifest.js';
import { detectPixelScale } from './pixelOps.js';
import { extractPalette, renderPalette } from './palette.js';

const ROOT = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const SRC_DIR = path.join(ROOT, 'assets-src');

async function main() {
  const check = process.argv.includes('--check');

  const manifestFile = path.join(SRC_DIR, 'manifest.json');
  if (!existsSync(manifestFile)) {
    throw new Error('assets-src/manifest.json est absent : rien ne dit quelles planches font référence.');
  }
  const manifest = parseManifest(JSON.parse(await readFile(manifestFile, 'utf8')));
  const sources = manifest.palette.sources;

  if (sources.length === 0) {
    throw new Error(
      'assets-src/manifest.json : palette.sources est vide.\n' +
        'Nomme-y la ou les planches de pack qui font référence, par exemple :\n' +
        '  "palette": { "file": "palette.json", "sources": ["mon-pack.png"] }'
    );
  }

  const sharp = (await import('sharp')).default;
  const images = [];
  for (const name of sources) {
    const file = path.join(SRC_DIR, name);
    if (!existsSync(file)) {
      throw new Error(
        `« ${name} » est cité dans palette.sources mais absent de assets-src/ — ` +
          `dépose la planche, ou corrige le nom.`
      );
    }
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const scale = detectPixelScale(data, info);
    // Le facteur d'agrandissement n'ajoute aucune couleur : on extrait sur la planche telle
    // quelle. On l'affiche quand même, parce que c'est **la** vérification qui compte —
    // une référence en ×1 sur une planche censée être un pack veut dire qu'elle n'est pas
    // du pixel art, et la palette qui en sortirait serait fausse.
    console.log(`  ${name.padEnd(28)} ${info.width}×${info.height}  natif ×${scale}`);
    if (scale === 1 && Math.max(info.width, info.height) > 256) {
      console.warn(
        `    Attention : aucune grille de pixels détectée sur « ${name} ». ` +
          `Est-ce bien une planche de pack, et non une génération IA ?`
      );
    }
    images.push({ data });
  }

  const colors = extractPalette(images);
  const content = renderPalette({
    colors,
    sources,
    nativeSize: manifest.pixel.nativeSize,
  });

  const target = path.join(SRC_DIR, manifest.palette.file);
  const current = existsSync(target) ? await readFile(target, 'utf8') : null;

  if (current === content) {
    console.log(`\nPalette à jour : ${colors.length} couleurs — rien à réécrire.`);
    return 0;
  }

  if (check) {
    console.error(
      `\nassets-src/${manifest.palette.file} est périmé par rapport aux planches de référence.\n` +
        'Lance `npm run palette` et committe le fichier.'
    );
    return 1;
  }

  await writeFile(target, content);
  console.log(
    `\nPalette écrite : ${colors.length} couleurs dans assets-src/${manifest.palette.file}` +
      `${current === null ? '' : ` (au lieu de ${JSON.parse(current).colors?.length ?? '?'})`}.` +
      '\nRelance `npm run assets` : les sources non natives seront requantifiées.'
  );
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`\n${error.message}\n`);
    process.exitCode = 1;
  });
