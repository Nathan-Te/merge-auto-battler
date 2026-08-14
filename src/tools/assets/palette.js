/**
 * **La palette partagée** — lecture, validation, extraction.
 *
 * Deuxième règle d'or de la direction artistique : *une seule palette pour tout le jeu*,
 * extraite du pack de référence. Elle vit dans `assets-src/palette.json`, elle est
 * **committée**, et elle est **générée** par `npm run palette` — jamais écrite à la main.
 *
 * ## Pourquoi une palette committée plutôt que calculée à chaque build
 *
 * Trois raisons, dans l'ordre d'importance :
 *
 *   - **elle se relit.** C'est une liste de cent teintes qu'on peut ouvrir, comparer,
 *     discuter. Une palette recalculée à chaque passage du pipeline serait invisible, et on
 *     ne s'apercevrait de sa dérive qu'en voyant un sprite virer au mauve ;
 *   - **elle ne bouge pas toute seule.** Ajouter une planche de pack ne doit pas redéfinir
 *     en silence les couleurs de tous les sprites déjà quantifiés. Un changement de palette
 *     est une décision de direction artistique : il se prend, se lance à la main, et se relit
 *     dans un diff ;
 *   - **elle entre dans l'empreinte des entrées** du pipeline comme n'importe quelle source,
 *     donc une palette modifiée fait bien réencoder ce qu'il faut.
 *
 * ## Format
 *
 * ```json
 * {
 *   "_generated": "npm run palette — ne pas éditer à la main",
 *   "nativeSize": 16,
 *   "sources": ["Basic Holy 3x.png"],
 *   "colors": ["#1d1d1c", "#2a2236", "…"]
 * }
 * ```
 *
 * Les couleurs sont triées, en minuscules, sur six chiffres : deux extractions des mêmes
 * planches rendent le **même fichier**, donc aucun diff parasite.
 */

/** Alpha à partir duquel un pixel compte dans l'extraction. Voir `thresholdAlpha`. */
const OPAQUE = 128;

/** Palette manifestement fautive au-delà : ce n'est plus une palette, c'est une photo. */
const MAX_COLORS = 1024;

function fail(message) {
  throw new Error(`assets-src/palette.json : ${message}`);
}

/** `#rrggbb` (minuscule, six chiffres) à partir de trois composantes. */
export function toHex(r, g, b) {
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/**
 * Extrait les couleurs **opaques distinctes** d'une ou plusieurs images.
 *
 * @param {{data: Uint8ClampedArray|Uint8Array|Buffer}[]} images Pixels RGBA
 * @param {number} [alphaThreshold]
 * @returns {string[]} couleurs `#rrggbb`, triées
 */
export function extractPalette(images, alphaThreshold = OPAQUE) {
  const seen = new Set();
  for (const image of images) {
    const { data } = image;
    for (let offset = 0; offset < data.length; offset += 4) {
      if (data[offset + 3] < alphaThreshold) continue;
      seen.add((data[offset] << 16) | (data[offset + 1] << 8) | data[offset + 2]);
    }
  }
  // Tri numérique et non alphabétique : deux extractions des mêmes planches doivent rendre
  // exactement le même fichier, sinon le CI committe un diff à chaque passage.
  return [...seen].sort((a, b) => a - b).map((value) => toHex(value >> 16, (value >> 8) & 255, value & 255));
}

/**
 * Valide et normalise le fichier de palette.
 *
 * Les messages citent la clé fautive : comme le manifest, ce fichier peut être relu — et
 * cassé — depuis l'éditeur web de GitHub.
 *
 * @param {object} raw Contenu JSON
 * @returns {{colors: Array<[number, number, number]>, hex: string[], sources: string[], nativeSize: number|null}}
 */
export function parsePalette(raw) {
  if (typeof raw !== 'object' || raw === null) fail('le fichier doit contenir un objet JSON');

  const list = raw.colors;
  if (!Array.isArray(list) || list.length === 0) {
    fail('colors doit être une liste non vide de couleurs "#rrggbb" — relance `npm run palette`');
  }
  if (list.length > MAX_COLORS) {
    fail(
      `colors contient ${list.length} couleurs : ce n'est plus une palette. ` +
        `Vérifie que palette.sources ne cite que des planches de pack, pas une génération IA.`
    );
  }

  const colors = list.map((entry, index) => {
    if (typeof entry !== 'string' || !/^#[0-9a-f]{6}$/i.test(entry)) {
      fail(`colors[${index}] doit être une couleur "#rrggbb" (reçu ${JSON.stringify(entry)})`);
    }
    const value = Number.parseInt(entry.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  });

  const sources = Array.isArray(raw.sources) ? raw.sources.filter((s) => typeof s === 'string') : [];
  const nativeSize = Number.isInteger(raw.nativeSize) ? raw.nativeSize : null;

  return { colors, hex: list.map((entry) => entry.toLowerCase()), sources, nativeSize };
}

/**
 * Sérialise une palette dans le format committé.
 *
 * @param {object} options
 * @param {string[]} options.colors Couleurs `#rrggbb`
 * @param {string[]} options.sources Planches de référence, telles que nommées dans le manifest
 * @param {number} options.nativeSize Résolution native du projet, recopiée pour la relecture
 * @returns {string} JSON, terminé par un saut de ligne
 */
export function renderPalette({ colors, sources, nativeSize }) {
  const body = {
    _generated: 'npm run palette — ne pas éditer à la main',
    // Recopiée ici sans être lue par personne : c'est le fichier qu'on ouvre quand on se
    // demande « on est en combien, déjà ? », et il doit répondre tout seul.
    nativeSize,
    sources: [...sources].sort(),
    count: colors.length,
    colors,
  };
  return `${JSON.stringify(body, null, 2)}\n`;
}

export default parsePalette;
