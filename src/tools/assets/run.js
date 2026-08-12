#!/usr/bin/env node
/**
 * `npm run assets` — la chaîne complète, de la planche brute au jeu habillé.
 *
 * ```
 * assets-src/*.png  →  découpe  →  détourage  →  rognage  →  normalisation  →  atlas WebP
 *      + manifest.json                                                        + gallery
 * ```
 *
 * **Tout asset entre par `assets-src/`.** Rien ne se dépose à la main dans `public/assets/`,
 * qui est **entièrement généré** : le pipeline y écrit, y supprime ce qui n'a plus de source,
 * et le CI recommit le résultat. Un fichier posé directement là disparaîtrait au prochain
 * passage, sans prévenir — et personne ne saurait d'où il venait.
 *
 * ## Idempotence
 *
 * Le CI recommit les sorties : si deux exécutions du même `assets-src/` produisaient des
 * octets différents, chaque passage créerait un commit, qui déclencherait le passage
 * suivant. La boucle est cassée par une **empreinte des entrées** (`public/assets/.build.json`) :
 * manifest + contenu de chaque fichier source + version du pipeline. Empreinte inchangée et
 * sorties présentes ⇒ on ne réencode rien. C'est plus solide que de parier sur le
 * déterminisme au bit près de l'encodeur WebP, qui dépend de la version de libvips
 * installée — donc de la machine.
 *
 * ## Options
 *
 * ```bash
 * npm run assets              # régénère si les entrées ont changé
 * npm run assets -- --check   # ne rien écrire ; sort en 1 si les sorties sont périmées
 * npm run assets -- --force   # réencode tout, même à empreinte inchangée
 * ```
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseManifest } from './manifest.js';
import { fitSize, keyOutBackground, sliceRects, trimBounds } from './imageOps.js';
import { packFrames, toAtlasJson } from './pack.js';
import { formatBytes, renderGallery } from './gallery.js';
import { expectedSprites } from '../../render/skinNames.js';

/**
 * Version du pipeline : elle entre dans l'empreinte des entrées.
 *
 * **À incrémenter dès qu'un changement de code modifie les pixels produits** (détourage,
 * rognage, packing, encodage). Sans ça, une amélioration du détourage ne serait jamais
 * appliquée aux planches déjà traitées : l'empreinte des sources n'aurait pas bougé.
 */
const PIPELINE_VERSION = 1;

const ROOT = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const SRC_DIR = path.join(ROOT, 'assets-src');
const OUT_DIR = path.join(ROOT, 'public', 'assets');
const GALLERY_FILE = path.join(ROOT, 'public', 'gallery', 'index.html');
const BUILD_FILE = path.join(OUT_DIR, '.build.json');

/** Extensions recopiées telles quelles depuis `assets-src/audio` et `assets-src/fonts`. */
const AUDIO_EXTENSIONS = new Set(['.webm', '.ogg', '.mp3', '.m4a', '.wav']);
const FONT_EXTENSIONS = new Set(['.woff2', '.woff', '.ttf', '.otf']);

// --------------------------------------------------------------------------- utilitaires

function parseArgs(argv) {
  return {
    check: argv.includes('--check'),
    force: argv.includes('--force'),
    quiet: argv.includes('--quiet'),
  };
}

/** Liste récursive des fichiers d'un dossier, triée — l'ordre entre dans l'empreinte. */
async function listFiles(dir) {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(full)));
    else files.push(full);
  }
  return files;
}

/** Empreinte des entrées : contenu de chaque source + version du pipeline. */
async function hashInputs(files) {
  const hash = createHash('sha256');
  hash.update(`pipeline:${PIPELINE_VERSION}\n`);
  for (const file of files) {
    hash.update(path.relative(ROOT, file).split(path.sep).join('/'));
    hash.update('\0');
    hash.update(await readFile(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

/**
 * Écrit un fichier **seulement s'il change**.
 *
 * Un `writeFile` inconditionnel réécrit l'horodatage et, sur un dépôt où le CI committe les
 * sorties, produit un diff vide à chaque passage.
 *
 * @returns {boolean} true si le contenu a changé
 */
async function writeIfChanged(file, content, { check }) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  if (existsSync(file)) {
    const current = await readFile(file);
    if (current.equals(buffer)) return false;
  }
  if (!check) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, buffer);
  }
  return true;
}

/** Charge `sharp` avec un message utile s'il manque (il n'est installé qu'en dev). */
async function loadSharp() {
  try {
    return (await import('sharp')).default;
  } catch {
    throw new Error(
      "sharp est introuvable — c'est une dépendance de développement du pipeline d'assets.\n" +
        'Installe les dépendances avec `npm ci`, puis relance `npm run assets`.'
    );
  }
}

// --------------------------------------------------------------------------- découpe

/**
 * Découpe, détoure, rogne et normalise toutes les cases d'une planche.
 *
 * @returns {{name: string, category: string, width: number, height: number,
 *            data: Buffer, sheet: string}[]}
 */
async function processSheet(sharp, sheet, warnings) {
  const file = path.join(SRC_DIR, sheet.file);
  if (!existsSync(file)) {
    throw new Error(
      `« ${sheet.file} » est décrite dans le manifest mais absente de assets-src/ — ` +
        `dépose la planche, ou retire son entrée de sheets`
    );
  }

  const source = sharp(file).ensureAlpha();
  const meta = await source.metadata();
  const { data } = await source.raw().toBuffer({ resolveWithObject: true });
  const rects = sliceRects({
    width: meta.width,
    height: meta.height,
    cols: sheet.cols,
    rows: sheet.rows,
    margin: sheet.margin,
    spacing: sheet.spacing,
  });

  const sprites = [];
  for (let index = 0; index < rects.length; index += 1) {
    const cell = sheet.cells[index];
    if (!cell?.name) continue;
    const rect = rects[index];

    // Copie de la sous-image : un seul décodage pour toute la planche, puis de
    // l'arithmétique. Extraire case par case avec sharp redécoderait le PNG à chaque fois.
    const cellData = Buffer.allocUnsafe(rect.width * rect.height * 4);
    for (let y = 0; y < rect.height; y += 1) {
      const from = ((rect.y + y) * meta.width + rect.x) * 4;
      data.copy(cellData, y * rect.width * 4, from, from + rect.width * 4);
    }

    keyOutBackground(cellData, { width: rect.width, height: rect.height }, sheet.keying);

    const bounds = sheet.trim
      ? trimBounds(cellData, { width: rect.width, height: rect.height })
      : { x: 0, y: 0, width: rect.width, height: rect.height };
    if (!bounds) {
      warnings.push(
        `« ${cell.name} » (${sheet.file}, case ${index + 1}) est entièrement transparente ` +
          `après détourage — case vide, ou keying.tolerance trop haut`
      );
      continue;
    }

    const target = fitSize(bounds, sheet.size);
    const pixels = await sharp(cellData, {
      raw: { width: rect.width, height: rect.height, channels: 4 },
    })
      .extract({ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height })
      .resize(target.width, target.height, { fit: 'fill', kernel: 'lanczos3' })
      .raw()
      .toBuffer();

    sprites.push({
      name: cell.name,
      category: sheet.category,
      width: target.width,
      height: target.height,
      data: pixels,
      sheet: sheet.file,
    });
  }

  return sprites;
}

// --------------------------------------------------------------------------- atlas

/** Compose un atlas par catégorie et l'encode en WebP. */
async function buildAtlas(sharp, category, sprites, atlasConfig) {
  const packed = packFrames(
    sprites.map((sprite) => ({ name: sprite.name, width: sprite.width, height: sprite.height })),
    { maxSize: atlasConfig.maxSize, padding: atlasConfig.padding }
  );

  const byName = new Map(sprites.map((sprite) => [sprite.name, sprite]));
  const composites = packed.frames.map((frame) => {
    const sprite = byName.get(frame.name);
    return {
      input: sprite.data,
      raw: { width: sprite.width, height: sprite.height, channels: 4 },
      left: frame.x,
      top: frame.y,
    };
  });

  const image = await sharp({
    create: {
      width: packed.width,
      height: packed.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    // `alphaQuality: 100` est délibéré : le canal alpha porte le détourage, et une alpha
    // compressée rend des bords sales sur le fond sombre du jeu — ce qu'on ne voit ni sur
    // la planche d'origine ni dans un éditeur d'image.
    .webp({ quality: atlasConfig.quality, alphaQuality: 100, effort: 6 })
    .toBuffer();

  return { packed, buffer: image };
}

// --------------------------------------------------------------------------- exécution

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const log = (message) => {
    if (!options.quiet) console.log(message);
  };

  const manifestFile = path.join(SRC_DIR, 'manifest.json');
  const manifest = existsSync(manifestFile)
    ? parseManifest(JSON.parse(await readFile(manifestFile, 'utf8')))
    : parseManifest({});

  if (!existsSync(manifestFile)) {
    log('assets-src/manifest.json est absent : aucune planche à découper (greybox conservé).');
  }

  const sources = await listFiles(SRC_DIR);
  const inputHash = await hashInputs(sources);

  const previous = existsSync(BUILD_FILE)
    ? JSON.parse(await readFile(BUILD_FILE, 'utf8'))
    : null;
  const outputsPresent =
    previous?.outputs?.every((relative) => existsSync(path.join(ROOT, relative))) ?? false;

  if (!options.force && previous?.inputHash === inputHash && outputsPresent) {
    log(`Assets à jour (empreinte ${inputHash.slice(0, 12)}) — rien à réencoder.`);
    await report(previous, log);
    return 0;
  }

  if (options.check) {
    console.error(
      'Les assets générés sont périmés par rapport à assets-src/.\n' +
        'Lance `npm run assets` et committe public/assets/ et public/gallery/.'
    );
    return 1;
  }

  const sharp = await loadSharp();
  const warnings = [];

  // --- découpe de toutes les planches
  const sprites = [];
  for (const sheet of manifest.sheets) {
    sprites.push(...(await processSheet(sharp, sheet, warnings)));
  }

  // --- un atlas par catégorie
  const byCategory = new Map();
  for (const sprite of sprites) {
    if (!byCategory.has(sprite.category)) byCategory.set(sprite.category, []);
    byCategory.get(sprite.category).push(sprite);
  }

  const outputs = [];
  const atlases = [];
  const galleryGroups = [];

  for (const category of [...byCategory.keys()].sort()) {
    const list = byCategory.get(category);
    const { packed, buffer } = await buildAtlas(sharp, category, list, manifest.atlas);

    const imageName = `atlas-${category}.webp`;
    const jsonName = `atlas-${category}.json`;
    const imageFile = path.join(OUT_DIR, imageName);
    const jsonFile = path.join(OUT_DIR, jsonName);

    await writeIfChanged(imageFile, buffer, options);
    await writeIfChanged(
      jsonFile,
      `${JSON.stringify(
        toAtlasJson({
          image: imageName,
          width: packed.width,
          height: packed.height,
          frames: packed.frames,
        }),
        null,
        2
      )}\n`,
      options
    );

    outputs.push(path.relative(ROOT, imageFile), path.relative(ROOT, jsonFile));
    atlases.push({
      name: category,
      image: imageName,
      json: jsonName,
      width: packed.width,
      height: packed.height,
      bytes: buffer.length,
      count: list.length,
    });

    // Poids par sprite : la part de l'atlas proportionnelle à la surface occupée. C'est une
    // estimation, et la galerie l'affiche comme telle (« ≈ ») — un sprite dans un atlas
    // n'a pas de poids propre, mais un ordre de grandeur suffit à repérer l'intrus.
    const totalArea = packed.frames.reduce((sum, frame) => sum + frame.width * frame.height, 0);
    galleryGroups.push({
      category,
      sprites: [...packed.frames]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((frame) => ({
          name: frame.name,
          atlas: `../assets/${imageName}`,
          x: frame.x,
          y: frame.y,
          width: frame.width,
          height: frame.height,
          bytes: Math.round((buffer.length * frame.width * frame.height) / Math.max(1, totalArea)),
        })),
    });
  }

  // --- audio et polices : recopiés tels quels, mais comptés dans le budget
  const extras = [];
  const audio = await copyPassthrough(
    path.join(SRC_DIR, manifest.audio.dir),
    path.join(OUT_DIR, 'audio'),
    AUDIO_EXTENSIONS,
    options,
    outputs
  );
  if (audio.files.length > 0) extras.push({ label: `audio (${audio.files.length})`, bytes: audio.bytes });

  const fonts = await copyPassthrough(
    path.join(SRC_DIR, manifest.fonts.dir),
    path.join(OUT_DIR, 'fonts'),
    FONT_EXTENSIONS,
    options,
    outputs
  );
  if (fonts.files.length > 0) extras.push({ label: `polices (${fonts.files.length})`, bytes: fonts.bytes });

  // --- index d'exécution : ce que le jeu charge au démarrage
  const balance = JSON.parse(await readFile(path.join(ROOT, 'src/config/balance.json'), 'utf8'));
  const expected = expectedSprites({ balance, bands: manifest.tierBands });
  const produced = new Set(sprites.map((sprite) => sprite.name));
  const missing = expected.filter((entry) => !produced.has(entry.name)).map((entry) => entry.name);
  const expectedNames = new Set(expected.map((entry) => entry.name));
  const orphans = [...produced].filter((name) => !expectedNames.has(name)).sort();

  const index = {
    _generated: 'npm run assets — ne pas éditer à la main',
    atlases: atlases.map((atlas) => ({ key: atlas.name, image: atlas.image, json: atlas.json })),
    tierBands: manifest.tierBands,
    audio: audio.files,
    fonts: fonts.files,
    // Nom de sprite → clé d'atlas. C'est **le** service rendu au rendu : `skin.js` a besoin
    // des deux pour poser une image (`scene.add.image(x, y, atlasKey, frameName)`), et il
    // ne doit pas avoir à deviner dans quelle planche un sprite a été rangé — c'est une
    // décision du manifest, qui peut changer sans que le jeu en sache rien.
    frames: Object.fromEntries(
      [...sprites]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((sprite) => [sprite.name, sprite.category])
    ),
  };
  const indexFile = path.join(OUT_DIR, 'index.json');
  await writeIfChanged(indexFile, `${JSON.stringify(index, null, 2)}\n`, options);
  outputs.push(path.relative(ROOT, indexFile));

  // --- galerie
  const atlasBytes = atlases.reduce((sum, atlas) => sum + atlas.bytes, 0);
  const extraBytes = extras.reduce((sum, extra) => sum + extra.bytes, 0);
  const totalBytes = atlasBytes + extraBytes;

  const html = renderGallery({
    // Horodatage volontairement **à la journée** : à la seconde, chaque exécution du
    // pipeline produirait un diff de la galerie même sans changement d'asset.
    generatedAt: new Date().toISOString().slice(0, 10),
    atlases,
    groups: galleryGroups,
    extras,
    totalBytes,
    budgetKb: manifest.budgetKb,
    missing,
    orphans,
  });
  await writeIfChanged(GALLERY_FILE, html, options);
  outputs.push(path.relative(ROOT, GALLERY_FILE));

  // --- ménage : les sorties d'un passage précédent qui n'ont plus de source
  const stale = (previous?.outputs ?? []).filter((relative) => !outputs.includes(relative));
  for (const relative of stale) {
    const file = path.join(ROOT, relative);
    if (existsSync(file)) await rm(file);
    log(`Supprimé (plus de source) : ${relative}`);
  }

  const build = {
    _generated: 'npm run assets — ne pas éditer à la main',
    inputHash,
    pipelineVersion: PIPELINE_VERSION,
    outputs: outputs.sort(),
    atlases: atlases.map(({ name, bytes, width, height, count }) => ({ name, bytes, width, height, count })),
    extras,
    totalBytes,
    budgetKb: manifest.budgetKb,
    missing,
    orphans,
  };
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(BUILD_FILE, `${JSON.stringify(build, null, 2)}\n`);

  for (const warning of warnings) console.warn(`Attention : ${warning}`);
  await report(build, log);
  return totalBytes > manifest.budgetKb.max * 1024 ? 1 : 0;
}

/** Recopie un dossier d'assets déjà au bon format (audio, polices). */
async function copyPassthrough(from, to, extensions, options, outputs) {
  const files = [];
  let bytes = 0;
  for (const file of await listFiles(from)) {
    const extension = path.extname(file).toLowerCase();
    if (!extensions.has(extension)) continue;
    const relative = path.relative(from, file).split(path.sep).join('/');
    const destination = path.join(to, relative);
    const content = await readFile(file);
    await writeIfChanged(destination, content, options);
    outputs.push(path.relative(ROOT, destination));
    files.push(relative);
    bytes += content.length;
  }
  return { files: files.sort(), bytes };
}

/** Rapport de poids — sur la sortie standard, et dans le résumé de job du CI. */
async function report(build, log) {
  const lines = [
    '',
    `Atlas      : ${build.atlases.length}`,
    ...build.atlases.map(
      (atlas) =>
        `  ${atlas.name.padEnd(12)} ${String(atlas.count).padStart(3)} sprites  ` +
        `${atlas.width}×${atlas.height}  ${formatBytes(atlas.bytes)}`
    ),
    ...build.extras.map((extra) => `  ${extra.label.padEnd(12)} ${formatBytes(extra.bytes)}`),
    '',
    `Poids total : ${formatBytes(build.totalBytes)} ` +
      `(cible ${formatBytes(build.budgetKb.target * 1024)}, ` +
      `limite ${formatBytes(build.budgetKb.max * 1024)})`,
  ];

  if (build.missing.length > 0) {
    lines.push(
      `Manquants   : ${build.missing.length} sprite(s) — greybox conservé pour ceux-là.`
    );
  }
  if (build.orphans.length > 0) {
    lines.push(`Orphelins   : ${build.orphans.length} sprite(s) que le jeu n'utilise pas.`);
  }
  lines.push('', 'Galerie : public/gallery/index.html (servie sur /gallery/ une fois déployée).');

  for (const line of lines) log(line);

  if (process.env.GITHUB_STEP_SUMMARY) {
    await writeFile(
      process.env.GITHUB_STEP_SUMMARY,
      `### Assets\n\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n`,
      { flag: 'a' }
    );
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`\n${error.message}\n`);
    process.exitCode = 1;
  });
