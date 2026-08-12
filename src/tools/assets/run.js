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
import { keyOutBackground, sliceRects, trimBounds } from './imageOps.js';
import {
  detectPixelScale,
  fitNativeSize,
  offPaletteColors,
  pixelize,
  resampleNearest,
  thresholdAlpha,
} from './pixelOps.js';
import { parsePalette } from './palette.js';
import { packFrames, toAtlasJson } from './pack.js';
import { formatBytes, renderGallery } from './gallery.js';
import { expectedSprites } from '../../render/skinNames.js';

/**
 * Version du pipeline : elle entre dans l'empreinte des entrées.
 *
 * **À incrémenter dès qu'un changement de code modifie les pixels produits** (détourage,
 * rognage, pixelisation, packing, encodage). Sans ça, une amélioration ne serait jamais
 * appliquée aux planches déjà traitées : l'empreinte des sources n'aurait pas bougé.
 *
 * 2 — bascule en pixel art : réduction à la résolution native, seuillage alpha,
 *     quantification vers la palette partagée, atlas WebP sans perte.
 */
const PIPELINE_VERSION = 2;

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

/**
 * Fichiers de `assets-src/` qui ne produisent **aucun pixel** : la documentation.
 *
 * Ils sont exclus de l'empreinte. Sans ça, corriger une phrase de `manifest.md` invaliderait
 * le cache, forcerait un réencodage complet de tous les atlas et ferait committer au CI des
 * images identiques — un diff de plusieurs centaines de kilo-octets pour une virgule.
 */
const DOC_EXTENSIONS = new Set(['.md', '.txt']);

/** Empreinte des entrées : contenu de chaque source + version du pipeline. */
async function hashInputs(files) {
  const hash = createHash('sha256');
  hash.update(`pipeline:${PIPELINE_VERSION}\n`);
  for (const file of files) {
    if (DOC_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
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
 * Lignes de crédit des planches de pack, dédoublées et triées.
 *
 * Deux planches d'un même pack — un pack « héros » et un pack « monstres » du même auteur —
 * ne doivent produire qu'une ligne à l'écran de crédits : c'est une attribution, pas un
 * inventaire de fichiers.
 */
function creditLines(sheets) {
  const seen = new Map();
  for (const sheet of sheets) {
    if (!sheet.credit) continue;
    const key = [sheet.credit.author, sheet.credit.pack, sheet.credit.license].join('|');
    if (!seen.has(key)) seen.set(key, sheet.credit);
  }
  return [...seen.values()].sort((a, b) => a.author.localeCompare(b.author));
}

/** Extrait un rectangle d'un buffer RGBA. */
function crop(data, size, rect) {
  const out = new Uint8ClampedArray(rect.width * rect.height * 4);
  for (let y = 0; y < rect.height; y += 1) {
    const from = ((rect.y + y) * size.width + rect.x) * 4;
    out.set(data.subarray(from, from + rect.width * 4), y * rect.width * 4);
  }
  return out;
}

/**
 * Ramène une planche **native** à ×1.
 *
 * Un pack est presque toujours livré agrandi — les deux planches de référence du projet
 * sont en ×4. Le facteur est **mesuré sur les pixels** plutôt que lu dans le nom du fichier,
 * qui ment (elles s'appellent « 3x » et « 4x » et sont toutes les deux en ×4).
 *
 * La réduction se fait **avant la découpe**, pas après : la grille du manifest (`margin`,
 * `spacing`) s'exprime alors dans les pixels que voit l'auteur du pack — « 1 px de marge,
 * 2 px de gouttière » — et non dans ceux de l'export.
 */
function toNativeScale(data, size, sheet, warnings) {
  const detected = detectPixelScale(data, size);
  const scale = sheet.scale ?? detected;

  if (scale > 1 && (size.width % scale !== 0 || size.height % scale !== 0)) {
    throw new Error(
      `« ${sheet.file} » : impossible de réduire une planche de ${size.width}×${size.height} px ` +
        `d'un facteur ${scale} — il ne divise pas ses dimensions. Corrige "scale", ou retire-le ` +
        `pour laisser le pipeline le mesurer (il a mesuré ×${detected}).`
    );
  }
  if (sheet.scale !== null && sheet.scale !== detected) {
    warnings.push(
      `« ${sheet.file} » : le manifest force scale ${sheet.scale}, mais les pixels disent ` +
        `×${detected}. Retire "scale" si tu n'as pas de raison précise de le forcer.`
    );
  }
  if (scale === 1 && Math.max(size.width, size.height) > 128) {
    warnings.push(
      `« ${sheet.file} » est déclarée native mais aucune grille de pixels n'y est détectable — ` +
        `si c'est une génération IA, retire "native": true pour qu'elle soit pixelisée.`
    );
  }

  if (scale === 1) return { data, size, scale };
  const target = { width: size.width / scale, height: size.height / scale };
  return { data: resampleNearest(data, size, target), size: target, scale };
}

/**
 * Découpe, détoure, rogne et **pixelise** toutes les cases d'une planche.
 *
 * Deux chemins, et c'est toute la bascule en pixel art :
 *
 * ```
 * native (pack)   →  réduction à ×1  →  découpe  →  rognage  →  seuillage alpha
 * non native (IA) →  découpe  →  détourage  →  rognage  →  réduction à la résolution
 *                    native  →  seuillage alpha  →  quantification vers la palette
 * ```
 *
 * La différence tient en une phrase : **un pack ne se retouche pas**, il définit la
 * référence ; tout le reste doit y être ramené. On ne quantifie donc jamais une source
 * native — on se contente de **signaler** ses couleurs hors palette dans la galerie, ce qui
 * est le bon geste quand la palette elle-même sort de là.
 *
 * Plus aucun redimensionnement ne passe par `sharp` : la pixelisation est de l'arithmétique
 * sur des buffers, donc identique d'une machine à l'autre. C'est un gain d'idempotence en
 * prime — la sortie ne dépend plus de la version de libvips pour les pixels, seulement pour
 * l'encodage.
 *
 * @returns {{name: string, category: string, width: number, height: number,
 *            data: Uint8ClampedArray, sheet: string, native: boolean, offPalette: number}[]}
 */
async function processSheet(sharp, sheet, { palette, pixel }, warnings) {
  const file = path.join(SRC_DIR, sheet.file);
  if (!existsSync(file)) {
    throw new Error(
      `« ${sheet.file} » est décrite dans le manifest mais absente de assets-src/ — ` +
        `dépose la planche, ou retire son entrée de sheets`
    );
  }

  const source = sharp(file).ensureAlpha();
  const meta = await source.metadata();
  const raw = await source.raw().toBuffer();

  let sheetData = raw;
  let sheetSize = { width: meta.width, height: meta.height };
  if (sheet.native) {
    const reduced = toNativeScale(sheetData, sheetSize, sheet, warnings);
    sheetData = reduced.data;
    sheetSize = reduced.size;
  }

  const rects = sliceRects({
    width: sheetSize.width,
    height: sheetSize.height,
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
    let data = crop(sheetData, sheetSize, rect);
    let size = { width: rect.width, height: rect.height };

    if (sheet.keyOut) keyOutBackground(data, size, sheet.keying);

    const bounds = sheet.trim ? trimBounds(data, size) : { x: 0, y: 0, ...size };
    if (!bounds) {
      warnings.push(
        `« ${cell.name} » (${sheet.file}, case ${index + 1}) est entièrement transparente ` +
          `après détourage — case vide, ou keying.tolerance trop haut`
      );
      continue;
    }
    data = crop(data, size, bounds);
    size = { width: bounds.width, height: bounds.height };

    if (sheet.native) {
      // Un pack passe sans transformation. Le seuillage est le seul geste, et il ne change
      // rien à une planche conforme : le pixel art n'a pas de demi-transparence, donc
      // l'appliquer ne fait que vérifier que c'est bien le cas.
      thresholdAlpha(data, pixel.alphaThreshold);
      if (Math.max(size.width, size.height) > sheet.size) {
        warnings.push(
          `« ${cell.name} » (${sheet.file}) fait ${size.width}×${size.height} pixels d'art, ` +
            `au-delà des ${sheet.size} attendus pour la catégorie « ${sheet.category} ». ` +
            `Une source native n'est jamais redimensionnée : ajuste sizes.${sheet.category}, ` +
            `ou la découpe.`
        );
      }
    } else {
      const result = pixelize({
        data,
        size,
        target: fitNativeSize(size, sheet.size),
        resample: sheet.resample,
        palette: palette?.colors ?? null,
        alphaThreshold: pixel.alphaThreshold,
      });
      data = result.data;
      size = result.size;

      // Le seuillage peut vider une rangée de bord : on rogne une seconde fois pour que le
      // sprite soit cadré sur ses pixels réels et non sur un halo qui n'existe plus.
      const after = sheet.trim ? trimBounds(data, size, 1) : { x: 0, y: 0, ...size };
      if (!after) {
        warnings.push(
          `« ${cell.name} » (${sheet.file}) disparaît à la pixelisation — le dessin est trop ` +
            `fin pour ${sheet.size} pixels d'art, ou pixel.alphaThreshold est trop haut.`
        );
        continue;
      }
      data = crop(data, size, after);
      size = { width: after.width, height: after.height };
    }

    sprites.push({
      name: cell.name,
      category: sheet.category,
      width: size.width,
      height: size.height,
      data,
      sheet: sheet.file,
      native: sheet.native,
      // Sur une source native on ne quantifie pas : la seule chose utile est de dire
      // combien de teintes sortent de la palette partagée, et de le montrer en galerie.
      offPalette: palette ? offPaletteColors(data, palette.colors).length : 0,
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
      input: Buffer.from(sprite.data.buffer, sprite.data.byteOffset, sprite.data.byteLength),
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
    // **Sans perte, et ce n'est pas un luxe.** Toute la chaîne vient de ramener l'image sur
    // cent teintes et sur une alpha binaire ; un encodage avec perte réinventerait des
    // dizaines de milliers de couleurs intermédiaires et redonnerait des bords flous, à la
    // toute dernière étape et sans que rien ne le signale. Le coût est nul : des aplats de
    // 16 px se compressent mieux sans perte qu'avec.
    //
    // `alphaQuality: 100` reste posé pour le cas où quelqu'un repasse `lossless` à false
    // pour comparer un poids : le canal alpha porte le détourage, et une alpha compressée
    // rend des bords sales sur le fond sombre du jeu.
    .webp({
      lossless: atlasConfig.lossless,
      quality: atlasConfig.quality,
      alphaQuality: 100,
      effort: 6,
    })
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

  // --- palette partagée : la seconde règle d'or de la direction artistique
  const paletteFile = path.join(SRC_DIR, manifest.palette.file);
  let palette = null;
  if (manifest.palette.quantize && existsSync(paletteFile)) {
    palette = parsePalette(JSON.parse(await readFile(paletteFile, 'utf8')));
  } else if (manifest.palette.quantize && manifest.sheets.some((sheet) => !sheet.native)) {
    // Pas fatal, mais il faut le dire fort : sans palette, chaque planche IA garde ses
    // propres teintes et l'écran devient un patchwork — exactement ce que la règle interdit.
    warnings.push(
      `assets-src/${manifest.palette.file} est absent : les planches non natives ne sont pas ` +
        `quantifiées. Lance \`npm run palette\` et committe le fichier.`
    );
  }

  // --- découpe et pixelisation de toutes les planches
  const sprites = [];
  for (const sheet of manifest.sheets) {
    sprites.push(...(await processSheet(sharp, sheet, { palette, pixel: manifest.pixel }, warnings)));
  }

  // Une source native hors palette n'est pas corrigée (un pack ne se retouche pas) : elle
  // est annoncée, sprite par sprite, dans la galerie et sur la sortie standard.
  for (const sprite of sprites) {
    if (sprite.native && sprite.offPalette > 0) {
      warnings.push(
        `« ${sprite.name} » (${sprite.sheet}) porte ${sprite.offPalette} teinte(s) absentes de ` +
          `la palette partagée. Si cette planche fait référence, ajoute-la à palette.sources ` +
          `et relance \`npm run palette\`.`
      );
    }
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
    const spriteByName = new Map(list.map((sprite) => [sprite.name, sprite]));
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
          native: spriteByName.get(frame.name)?.native ?? false,
          offPalette: spriteByName.get(frame.name)?.offPalette ?? 0,
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
    /**
     * La résolution native, transmise au rendu. C'est elle qui lui permet de choisir un
     * **multiple entier** à l'affichage (`src/systems/pixelScale.js`) au lieu de mettre un
     * sprite à une taille arbitraire, ce qui casserait sa grille de pixels.
     */
    pixel: { nativeSize: manifest.pixel.nativeSize },
    /**
     * Crédits des packs, recopiés depuis la clé `credit` des planches natives et dédoublés.
     *
     * Ils transitent par l'index plutôt que par `src/config/credits.json` parce que c'est le
     * seul chemin qui ne peut pas mentir : le manifest **refuse** une planche native sans
     * auteur ni licence, donc tout pack présent dans un atlas a sa ligne ici, par
     * construction. Une recopie à la main marcherait au premier pack et dériverait au
     * troisième — et une licence oubliée ne se voit pas, elle se découvre.
     */
    credits: creditLines(manifest.sheets),
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
    pixel: { nativeSize: manifest.pixel.nativeSize },
    palette: palette ? { colors: palette.hex, sources: palette.sources } : null,
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
  // Le dépassement de budget **avertit** ici et **échoue** dans le CI, sur le poids réel de
  // `dist/`. Une seule barrière, et posée sur ce qui est vraiment téléchargé : le pipeline
  // ne voit ni le bundle JavaScript ni la compression du serveur, donc il ne peut pas
  // trancher tout seul — et le faire échouer ici priverait de la galerie au moment précis où
  // l'on cherche quel asset alléger.
  return 0;
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
  if (build.totalBytes > build.budgetKb.max * 1024) {
    lines.push(
      `ATTENTION : le budget dur de ${formatBytes(build.budgetKb.max * 1024)} est dépassé — ` +
        `le build échouera. Leviers, dans l'ordre : atlas.quality, sizes.<catégorie>, ` +
        `longueur de la musique.`
    );
  } else if (build.totalBytes > build.budgetKb.target * 1024) {
    lines.push(`Note : au-dessus de la cible de ${formatBytes(build.budgetKb.target * 1024)}.`);
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
