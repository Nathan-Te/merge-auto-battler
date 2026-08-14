/**
 * Opérations d'image du pipeline — **fonctions pures sur des buffers RGBA**.
 *
 * Aucun accès disque, aucune dépendance à `sharp` : le découpage, le détourage et le
 * rognage sont de l'arithmétique sur `Uint8ClampedArray`, donc ils se testent dans vitest
 * avec une image de 4×4 pixels écrite à la main. `sharp` ne sert qu'à décoder, redimensionner
 * et encoder autour (cf. `run.js`) — c'est-à-dire à tout ce qu'on ne veut pas réécrire.
 */

/**
 * Rectangles de découpe d'une planche en grille.
 *
 * Les bords sont calculés en **flottant puis arrondis**, et non par une division entière :
 * une planche de 1000 px en 3 colonnes donne 333 / 334 / 333 et couvre toute la largeur,
 * là où un `Math.floor` uniforme laisserait une colonne d'un pixel à droite — c'est-à-dire
 * une bande du sprite voisin dans le dernier découpage.
 *
 * @param {object} options
 * @param {number} options.width Largeur de la planche
 * @param {number} options.height Hauteur de la planche
 * @param {number} options.cols
 * @param {number} options.rows
 * @param {number} [options.margin] Marge extérieure, en pixels
 * @param {number} [options.spacing] Gouttière entre deux cases, en pixels
 * @returns {{x: number, y: number, width: number, height: number, col: number, row: number}[]}
 */
export function sliceRects({ width, height, cols, rows, margin = 0, spacing = 0 }) {
  const innerWidth = width - margin * 2 - spacing * (cols - 1);
  const innerHeight = height - margin * 2 - spacing * (rows - 1);
  if (innerWidth <= 0 || innerHeight <= 0) {
    throw new Error(
      `découpe impossible : ${width}×${height} px avec margin ${margin} et spacing ${spacing} ` +
        `ne laisse pas de place pour ${cols}×${rows} cases`
    );
  }

  const cellWidth = innerWidth / cols;
  const cellHeight = innerHeight / rows;
  const rects = [];

  for (let row = 0; row < rows; row += 1) {
    const top = margin + row * (cellHeight + spacing);
    const y = Math.round(top);
    const bottom = Math.round(top + cellHeight);
    for (let col = 0; col < cols; col += 1) {
      const left = margin + col * (cellWidth + spacing);
      const x = Math.round(left);
      const right = Math.round(left + cellWidth);
      rects.push({ x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y), col, row });
    }
  }
  return rects;
}

/** Distance d'un pixel à la couleur de fond : le plus grand écart parmi les trois canaux. */
function channelDistance(data, offset, color) {
  const dr = Math.abs(data[offset] - color[0]);
  const dg = Math.abs(data[offset + 1] - color[1]);
  const db = Math.abs(data[offset + 2] - color[2]);
  return Math.max(dr, dg, db);
}

/**
 * Détourage : le fond devient transparent, **par propagation depuis les bords**.
 *
 * Un simple seuil (« tout ce qui est blanc devient transparent ») troue le sprite : une
 * armure éclairée, l'éclat d'une lame ou le blanc d'un œil sont blancs eux aussi, et
 * disparaîtraient. On part donc des **bords de la case** et on ne propage qu'entre voisins
 * de fond : ce qui est enfermé dans le dessin est conservé, quelle que soit sa couleur.
 *
 * Le bord est **adouci** plutôt que net : les pixels à mi-chemin entre le fond et le trait
 * reçoivent une opacité intermédiaire. Sans ça, un sprite redimensionné montre un liseré
 * blanc en escalier, très visible sur le fond sombre du jeu.
 *
 * @param {Uint8ClampedArray|Uint8Array} data Pixels RGBA, mutés en place
 * @param {{width: number, height: number}} size
 * @param {{color: number[], tolerance: number, softness: number}} keying
 * @returns {number} nombre de pixels rendus totalement transparents
 */
export function keyOutBackground(data, { width, height }, { color, tolerance, softness }) {
  const total = width * height;
  const outer = tolerance + softness;
  /** 0 = pas vu, 1 = en file, 2 = traité. */
  const state = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const consider = (index) => {
    if (state[index] !== 0) return;
    if (channelDistance(data, index * 4, color) > outer) return;
    state[index] = 1;
    queue[tail] = index;
    tail += 1;
  };

  for (let x = 0; x < width; x += 1) {
    consider(x);
    consider((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    consider(y * width);
    consider(y * width + width - 1);
  }

  let cleared = 0;
  while (head < tail) {
    const index = queue[head];
    head += 1;
    state[index] = 2;

    const offset = index * 4;
    const distance = channelDistance(data, offset, color);
    if (distance <= tolerance) {
      data[offset + 3] = 0;
      cleared += 1;
    } else {
      // Zone de transition : l'opacité monte linéairement du fond vers le trait.
      const ratio = softness > 0 ? (distance - tolerance) / softness : 1;
      data[offset + 3] = Math.round(data[offset + 3] * Math.min(1, Math.max(0, ratio)));
    }

    const x = index % width;
    const y = (index - x) / width;
    // Un pixel de transition ne propage pas : sinon le fond « traverse » le contour du
    // sprite par ses pixels les plus clairs et vide l'intérieur.
    if (distance > tolerance) continue;
    if (x > 0) consider(index - 1);
    if (x < width - 1) consider(index + 1);
    if (y > 0) consider(index - width);
    if (y < height - 1) consider(index + width);
  }

  return cleared;
}

/**
 * Boîte englobante des pixels visibles.
 *
 * Rend `null` si tout est transparent — une case vide de la planche, que l'appelant doit
 * signaler plutôt que d'exporter un sprite de 1×1 pixel.
 *
 * @param {Uint8ClampedArray|Uint8Array} data Pixels RGBA
 * @param {{width: number, height: number}} size
 * @param {number} [threshold] Opacité minimale pour compter comme visible
 * @returns {{x: number, y: number, width: number, height: number}|null}
 */
export function trimBounds(data, { width, height }, threshold = 8) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] < threshold) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Taille d'un sprite ramené à un côté cible, **sans jamais l'agrandir**.
 *
 * Le rapport d'aspect est conservé : c'est le plus grand côté qui vaut `size`. Agrandir une
 * planche fournie en basse définition ne gagnerait aucun détail et coûterait des pixels
 * d'atlas — donc du poids de téléchargement, qui est la contrainte du lot.
 */
export function fitSize({ width, height }, size) {
  const longest = Math.max(width, height);
  if (longest <= size) return { width, height };
  const scale = size / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
