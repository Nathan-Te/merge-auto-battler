/**
 * **Pixelisation** — les opérations qui ramènent n'importe quelle image sur la grille de
 * pixels du jeu. Fonctions pures sur des buffers RGBA, comme `imageOps.js` : aucun accès
 * disque, aucune dépendance à `sharp`, donc tout se teste dans vitest sur une image de
 * 4×4 pixels écrite à la main.
 *
 * ## Pourquoi ce module existe
 *
 * La direction artistique est le **pixel art**, et elle tient sur deux règles d'or qui ne se
 * négocient pas (cf. `CLAUDE.md`) :
 *
 *   1. **une seule résolution native** pour tous les sprites — celle du pack de référence ;
 *   2. **une seule palette partagée**, extraite de ce même pack.
 *
 * Le pack les respecte par construction : c'est lui qui les définit. Tout le reste — les
 * générations IA, qui sont des images lisses en dizaines de milliers de couleurs — doit y
 * être ramené, et c'est le métier de ce fichier. Sans lui, on mélangerait deux résolutions
 * et deux palettes dans le même écran, ce qui se voit immédiatement et ne se rattrape pas
 * au réglage.
 *
 * ## L'ordre des opérations, et pourquoi il est celui-là
 *
 * ```
 * réduction  →  seuillage alpha  →  quantification
 * (surface)     (opaque ou rien)    (palette partagée)
 * ```
 *
 * - **La réduction d'abord**, parce que c'est elle qui fabrique la grille ; tout ce qui suit
 *   travaille sur des pixels d'art définitifs.
 * - **Le seuillage ensuite**, avant la quantification : un pixel de bord à 40 % d'opacité
 *   porte une couleur à moitié mélangée au fond. Le quantifier d'abord ferait entrer dans la
 *   palette une teinte qui n'est celle de personne, puis on l'effacerait — du travail pour
 *   rien, et une couleur fausse si le seuil l'avait gardé.
 * - **La quantification en dernier**, sur des pixels pleinement opaques dont la couleur est
 *   réelle.
 *
 * ## Réduction : surface par défaut, plus-proche-voisin sur demande
 *
 * Une génération IA fait 1376×768 et un sprite en fait 16 : chaque pixel d'art recouvre un
 * bloc d'environ 20×20 pixels de source. Le plus-proche-voisin **en tire un seul au hasard
 * du cadrage** et jette les 399 autres — sur un dessin fin (un œil, un liseré), le résultat
 * change complètement selon qu'on rogne un pixel plus à gauche, et le bruit de l'image de
 * départ passe tel quel. La moyenne de surface lit le bloc entier, donc elle est stable et
 * fidèle ; et comme le seuillage puis la quantification passent **après**, elle ne laisse
 * derrière elle ni demi-transparence ni couleur hors palette. Le résultat est aussi net,
 * simplement mieux choisi.
 *
 * Le plus-proche-voisin reste disponible par planche (`"resample": "nearest"`) : sur une
 * source déjà pixelisée mais agrandie d'un facteur non entier, c'est lui qui a raison. Et
 * pour une source **native** agrandie d'un facteur entier — le cas d'un pack livré en ×4 —
 * les deux donnent exactement le même résultat, puisque tous les pixels d'un bloc sont
 * identiques : la réduction est alors sans perte, et c'est le sens de « les packs passent
 * sans transformation ».
 */

/** Alpha en dessous duquel un pixel est considéré comme absent (bord, fond). */
export const DEFAULT_ALPHA_THRESHOLD = 128;

/** Plus grand facteur d'agrandissement qu'on cherche à détecter sur une planche native. */
const MAX_DETECTED_SCALE = 16;

function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y > 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

/** Les quatre canaux d'un pixel sont-ils identiques ? */
function samePixel(data, a, b) {
  return (
    data[a] === data[b] &&
    data[a + 1] === data[b + 1] &&
    data[a + 2] === data[b + 2] &&
    data[a + 3] === data[b + 3]
  );
}

/**
 * Facteur d'agrandissement d'une image **déjà pixelisée**.
 *
 * Un pack livré en ×4 est une image dont chaque pixel d'art occupe un carré de 4×4 pixels
 * identiques. On retrouve le facteur en prenant le **PGCD des longueurs de plages** de
 * pixels identiques, horizontalement et verticalement : sur une telle image il vaut 4, sur
 * une photo ou une génération IA il vaut 1.
 *
 * C'est ce qui permet de ne **rien demander à personne** : le nom du fichier ment (les deux
 * planches de référence s'appellent « 3x » et « 4x » et sont toutes les deux en ×4), mais
 * les pixels, eux, ne mentent pas.
 *
 * Le facteur rendu divise toujours les deux dimensions : une planche rognée de deux pixels
 * à droite ne doit pas faire croire à un ×4 qu'on ne pourrait pas appliquer.
 *
 * @param {Uint8ClampedArray|Uint8Array|Buffer} data Pixels RGBA
 * @param {{width: number, height: number}} size
 * @returns {number} facteur ≥ 1
 */
export function detectPixelScale(data, { width, height }) {
  let factor = 0;

  for (let y = 0; y < height; y += 1) {
    let run = 1;
    for (let x = 1; x < width; x += 1) {
      const here = (y * width + x) * 4;
      if (samePixel(data, here, here - 4)) {
        run += 1;
      } else {
        factor = gcd(factor, run);
        run = 1;
      }
      if (factor === 1) return 1;
    }
    factor = gcd(factor, run);
  }

  for (let x = 0; x < width; x += 1) {
    let run = 1;
    for (let y = 1; y < height; y += 1) {
      const here = (y * width + x) * 4;
      if (samePixel(data, here, here - width * 4)) {
        run += 1;
      } else {
        factor = gcd(factor, run);
        run = 1;
      }
      if (factor === 1) return 1;
    }
    factor = gcd(factor, run);
  }

  if (factor < 1) return 1;
  const capped = Math.min(factor, MAX_DETECTED_SCALE);
  // Un facteur qui ne divise pas les deux côtés ne peut pas être appliqué : une planche
  // rognée à 88 px de large est bien en ×4, mais on ne peut la réduire proprement qu'en
  // repassant au plus grand diviseur commun avec ses dimensions.
  for (let scale = capped; scale > 1; scale -= 1) {
    if (capped % scale === 0 && width % scale === 0 && height % scale === 0) return scale;
  }
  return 1;
}

/**
 * Réduction par **moyenne de surface**, en alpha prémultipliée.
 *
 * La prémultiplication n'est pas un détail : sans elle, un pixel transparent portant du
 * blanc (ce que produisent la plupart des exports PNG) tire la moyenne vers le blanc et
 * pose un liseré clair tout autour du sprite — précisément le halo que la galerie sert à
 * repérer. En prémultipliée, un pixel transparent ne pèse **rien**, ce qui est sa
 * définition.
 *
 * @param {Uint8ClampedArray|Uint8Array|Buffer} data Pixels RGBA source
 * @param {{width: number, height: number}} from
 * @param {{width: number, height: number}} to
 * @returns {Uint8ClampedArray} pixels RGBA réduits
 */
export function downscaleArea(data, from, to) {
  const out = new Uint8ClampedArray(to.width * to.height * 4);
  const scaleX = from.width / to.width;
  const scaleY = from.height / to.height;

  for (let y = 0; y < to.height; y += 1) {
    // Bornes en flottant puis arrondies : un bloc de 20,3 pixels ne doit pas perdre sa
    // colonne de droite tous les trois blocs.
    const y0 = Math.min(from.height - 1, Math.floor(y * scaleY));
    const y1 = Math.max(y0 + 1, Math.min(from.height, Math.round((y + 1) * scaleY)));
    for (let x = 0; x < to.width; x += 1) {
      const x0 = Math.min(from.width - 1, Math.floor(x * scaleX));
      const x1 = Math.max(x0 + 1, Math.min(from.width, Math.round((x + 1) * scaleX)));

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const offset = (sy * from.width + sx) * 4;
          const alpha = data[offset + 3];
          r += data[offset] * alpha;
          g += data[offset + 1] * alpha;
          b += data[offset + 2] * alpha;
          a += alpha;
          count += 1;
        }
      }

      const target = (y * to.width + x) * 4;
      if (a === 0 || count === 0) {
        out[target] = 0;
        out[target + 1] = 0;
        out[target + 2] = 0;
        out[target + 3] = 0;
        continue;
      }
      // Dé-prémultiplication : la couleur rendue est celle du dessin, pas celle du dessin
      // fondu dans le vide.
      out[target] = Math.round(r / a);
      out[target + 1] = Math.round(g / a);
      out[target + 2] = Math.round(b / a);
      out[target + 3] = Math.round(a / count);
    }
  }
  return out;
}

/**
 * Réduction (ou agrandissement) au **plus-proche-voisin**.
 *
 * Aucune moyenne, aucune couleur inventée. C'est la bonne réponse sur une source déjà
 * pixelisée — et la seule qui existe pour agrandir, ce que le jeu fait à l'affichage.
 *
 * @param {Uint8ClampedArray|Uint8Array|Buffer} data Pixels RGBA source
 * @param {{width: number, height: number}} from
 * @param {{width: number, height: number}} to
 * @returns {Uint8ClampedArray}
 */
export function resampleNearest(data, from, to) {
  const out = new Uint8ClampedArray(to.width * to.height * 4);
  for (let y = 0; y < to.height; y += 1) {
    // Le centre du pixel de destination, et non son coin : sur un facteur entier, c'est ce
    // qui retombe pile au milieu du bloc source au lieu de mordre sur le bloc précédent.
    const sy = Math.min(from.height - 1, Math.floor(((y + 0.5) * from.height) / to.height));
    for (let x = 0; x < to.width; x += 1) {
      const sx = Math.min(from.width - 1, Math.floor(((x + 0.5) * from.width) / to.width));
      const source = (sy * from.width + sx) * 4;
      const target = (y * to.width + x) * 4;
      out[target] = data[source];
      out[target + 1] = data[source + 1];
      out[target + 2] = data[source + 2];
      out[target + 3] = data[source + 3];
    }
  }
  return out;
}

/**
 * **Seuillage alpha** : un pixel est opaque, ou il n'est pas là.
 *
 * Le pixel art n'a pas de demi-transparence. Un bord adouci sur un sprite affiché à un
 * multiple entier de sa taille ne produit pas un dégradé mais un **gros carré translucide**,
 * quatre à six fois plus visible que le pixel qu'il devait adoucir. C'est le défaut n° 1
 * d'une génération IA pixelisée, et il se voit au zoom ×4 de la galerie.
 *
 * @param {Uint8ClampedArray|Uint8Array|Buffer} data Pixels RGBA, mutés en place
 * @param {number} [threshold] Alpha minimal pour rester
 * @returns {number} nombre de pixels effacés
 */
export function thresholdAlpha(data, threshold = DEFAULT_ALPHA_THRESHOLD) {
  let cleared = 0;
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] >= threshold) {
      data[offset + 3] = 255;
      continue;
    }
    if (data[offset + 3] !== 0) cleared += 1;
    // La couleur d'un pixel effacé est remise à zéro avec son alpha. Elle ne s'affiche
    // jamais, mais elle occupe de la place : un atlas sans perte compresse d'autant mieux
    // que ses zones vides sont **uniformes**, et un fond parsemé de rouges invisibles n'en
    // est pas une. C'est aussi ce qui garantit qu'aucune teinte ne survit hors palette dans
    // un fichier qu'on relira au débogage.
    data[offset] = 0;
    data[offset + 1] = 0;
    data[offset + 2] = 0;
    data[offset + 3] = 0;
  }
  return cleared;
}

/**
 * Distance perceptuelle approchée entre deux couleurs (« redmean »).
 *
 * La distance euclidienne brute dans RGB traite les trois canaux à égalité, ce que l'œil ne
 * fait pas : elle envoie régulièrement un brun chaud sur un gris. Cette approximation
 * classique pondère les canaux selon le rouge moyen des deux couleurs, coûte trois
 * multiplications de plus, et suffit largement pour une palette de cent teintes.
 */
export function colorDistance(r1, g1, b1, r2, g2, b2) {
  const rmean = (r1 + r2) / 2;
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return (((512 + rmean) * dr * dr) >> 8) + 4 * dg * dg + (((767 - rmean) * db * db) >> 8);
}

/**
 * Couleur de la palette la plus proche d'une couleur donnée.
 *
 * @param {Array<[number, number, number]>} palette
 * @returns {[number, number, number]}
 */
export function nearestPaletteColor(palette, r, g, b) {
  let best = palette[0];
  let bestDistance = Infinity;
  for (const color of palette) {
    const distance = colorDistance(r, g, b, color[0], color[1], color[2]);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = color;
    }
  }
  return best;
}

/**
 * **Quantification vers la palette partagée**, en place.
 *
 * Les pixels totalement transparents sont laissés tels quels : leur couleur ne s'affiche
 * jamais, et la remplacer ne ferait que grossir l'atlas en cassant des plages uniformes.
 *
 * Un cache mémorise les couleurs déjà vues. Une image de 1376×768 en contient 140 000
 * distinctes avant réduction, mais un sprite de 16×16 en contient au plus 256 : le cache
 * transforme une recherche par pixel en une recherche par couleur.
 *
 * @param {Uint8ClampedArray|Uint8Array|Buffer} data Pixels RGBA, mutés en place
 * @param {Array<[number, number, number]>} palette
 * @returns {number} nombre de pixels dont la couleur a changé
 */
export function quantizeToPalette(data, palette) {
  if (!palette || palette.length === 0) return 0;
  const cache = new Map();
  let changed = 0;

  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] === 0) continue;
    const key = (data[offset] << 16) | (data[offset + 1] << 8) | data[offset + 2];
    let color = cache.get(key);
    if (color === undefined) {
      color = nearestPaletteColor(palette, data[offset], data[offset + 1], data[offset + 2]);
      cache.set(key, color);
    }
    if (data[offset] !== color[0] || data[offset + 1] !== color[1] || data[offset + 2] !== color[2]) {
      changed += 1;
    }
    data[offset] = color[0];
    data[offset + 1] = color[1];
    data[offset + 2] = color[2];
  }
  return changed;
}

/**
 * Couleurs opaques d'une image **absentes** de la palette.
 *
 * Sert au diagnostic des sources natives, qu'on ne quantifie pas : un pack passe sans
 * transformation (c'est la règle), donc la seule chose à faire s'il sort de la palette
 * partagée est de **le dire** dans la galerie. Un second pack aux teintes voisines mais
 * jamais identiques est exactement ce qu'on ne veut pas laisser entrer sans le voir.
 *
 * @returns {number[]} couleurs hors palette, en 0xRRGGBB, triées
 */
export function offPaletteColors(data, palette) {
  const known = new Set(palette.map(([r, g, b]) => (r << 16) | (g << 8) | b));
  const found = new Set();
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] === 0) continue;
    const key = (data[offset] << 16) | (data[offset + 1] << 8) | data[offset + 2];
    if (!known.has(key)) found.add(key);
  }
  return [...found].sort((a, b) => a - b);
}

/**
 * Taille cible d'un sprite, en **pixels d'art**, sans jamais l'agrandir.
 *
 * Même contrat que `fitSize()` de `imageOps.js`, à une différence près qui change tout :
 * l'unité. `fitSize` raisonnait en pixels d'écran (« un orbe fait 192 px de large ») ;
 * ici on raisonne en pixels **de dessin** (« un orbe fait 16 pixels d'art de large »), et
 * c'est le rendu qui choisit ensuite par combien les multiplier. C'est la seule façon de
 * tenir la règle de la résolution native unique : la taille à l'écran dépend du téléphone,
 * la taille du dessin non.
 *
 * @param {{width: number, height: number}} bounds
 * @param {number} size Plus grand côté visé, en pixels d'art
 * @returns {{width: number, height: number}}
 */
export function fitNativeSize({ width, height }, size) {
  const longest = Math.max(width, height);
  if (longest <= size) return { width, height };
  const scale = size / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Chaîne complète de pixelisation d'une case découpée.
 *
 * Rassemblée ici plutôt qu'éparpillée dans `run.js` pour une raison simple : c'est **l'ordre**
 * des trois étapes qui fait la qualité du résultat (cf. l'en-tête du module), et un ordre ne
 * se teste que s'il est écrit à un seul endroit.
 *
 * @param {object} options
 * @param {Uint8ClampedArray|Uint8Array|Buffer} options.data Pixels RGBA de la case
 * @param {{width: number, height: number}} options.size Dimensions de la case
 * @param {{width: number, height: number}} options.target Dimensions visées, en pixels d'art
 * @param {'area'|'nearest'} [options.resample]
 * @param {Array<[number, number, number]>} [options.palette] Palette partagée ; absente, on ne quantifie pas
 * @param {number} [options.alphaThreshold]
 * @returns {{data: Uint8ClampedArray, size: {width: number, height: number}}}
 */
export function pixelize({
  data,
  size,
  target,
  resample = 'area',
  palette = null,
  alphaThreshold = DEFAULT_ALPHA_THRESHOLD,
}) {
  let pixels =
    size.width === target.width && size.height === target.height
      ? Uint8ClampedArray.from(data)
      : resample === 'nearest'
        ? resampleNearest(data, size, target)
        : downscaleArea(data, size, target);

  thresholdAlpha(pixels, alphaThreshold);
  if (palette) quantizeToPalette(pixels, palette);

  return { data: pixels, size: { ...target } };
}

export default pixelize;
