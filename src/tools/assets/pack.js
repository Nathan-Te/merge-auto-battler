/**
 * Packing d'atlas — **rangement en étagères**, pur et déterministe.
 *
 * Pourquoi des étagères et non un algorithme plus fin : les sprites d'un même atlas sortent
 * tous normalisés à la **même taille cible** par catégorie (cf. `manifest.js`), donc ils ont
 * des hauteurs très proches. Sur ce profil, l'étagère laisse quelques pour cent de vide
 * là où un `MaxRects` coûterait dix fois le code pour rien.
 *
 * **Déterminisme obligatoire.** Le CI recommit les sorties du pipeline : si le même
 * `assets-src/` produisait deux atlas différents, chaque exécution créerait un commit et la
 * boucle ne s'arrêterait jamais. Le tri est donc total — hauteur, puis largeur, puis nom —
 * et ne dépend ni de l'ordre du manifest ni de celui du système de fichiers.
 */

/** Puissance de deux immédiatement supérieure ou égale — les GPU aiment, WebGL aussi. */
export function nextPowerOfTwo(value) {
  let size = 1;
  while (size < value) size *= 2;
  return size;
}

/**
 * Range des sprites dans un atlas.
 *
 * @param {{name: string, width: number, height: number}[]} items
 * @param {object} options
 * @param {number} options.maxSize Côté maximum de l'atlas
 * @param {number} [options.padding] Gouttière entre deux sprites
 * @returns {{width: number, height: number,
 *            frames: {name: string, x: number, y: number, width: number, height: number}[]}}
 * @throws {Error} si un sprite ne peut pas entrer, avec le nom du fautif
 */
export function packFrames(items, { maxSize, padding = 2 }) {
  if (items.length === 0) return { width: 1, height: 1, frames: [] };

  const sorted = [...items].sort(
    (a, b) => b.height - a.height || b.width - a.width || a.name.localeCompare(b.name)
  );

  for (const item of sorted) {
    if (item.width + padding * 2 > maxSize || item.height + padding * 2 > maxSize) {
      throw new Error(
        `« ${item.name} » fait ${item.width}×${item.height} px et n'entre pas dans un atlas ` +
          `de ${maxSize} px — baisse sa taille cible (sizes.<catégorie>) ou monte atlas.maxSize`
      );
    }
  }

  // On essaie **toutes** les largeurs en puissance de deux et on garde celle qui minimise
  // la surface encodée — pas la première qui tient. La différence n'est pas cosmétique :
  // huit sprites de 124 px rangés sur une colonne donnent un atlas 128×1024, contre
  // 512×256 en quatre colonnes, soit **quatre fois moins de pixels** à encoder et à
  // téléverser sur le GPU. Le poids de téléchargement est la contrainte du lot.
  const widest = Math.max(...sorted.map((item) => item.width)) + padding * 2;
  let best = null;

  for (let width = nextPowerOfTwo(Math.max(widest, 64)); width <= maxSize; width *= 2) {
    const layout = shelvePack(sorted, width, padding);
    const height = nextPowerOfTwo(layout.height);
    if (height > maxSize) continue;
    const area = width * height;
    // À surface égale, la plus petite largeur gagne : le départage doit être total, sinon
    // deux exécutions pourraient rendre des atlas différents (cf. déterminisme, en tête).
    if (!best || area < best.area) best = { width, height, area, frames: layout.frames };
  }

  if (!best) {
    throw new Error(
      `les sprites ne tiennent pas dans un atlas de ${maxSize}² px — baisse les tailles ` +
        `cibles (sizes.<catégorie>) ou monte atlas.maxSize dans le manifest`
    );
  }
  return { width: best.width, height: best.height, frames: best.frames };
}

/** Une passe d'étagères à largeur fixe. Rend la hauteur utilisée et les positions. */
function shelvePack(items, width, padding) {
  const frames = [];
  let shelfY = padding;
  let shelfHeight = 0;
  let cursorX = padding;

  for (const item of items) {
    if (cursorX + item.width + padding > width) {
      shelfY += shelfHeight + padding;
      shelfHeight = 0;
      cursorX = padding;
    }
    frames.push({ name: item.name, x: cursorX, y: shelfY, width: item.width, height: item.height });
    cursorX += item.width + padding;
    shelfHeight = Math.max(shelfHeight, item.height);
  }

  return { frames, height: shelfY + shelfHeight + padding };
}

/**
 * Atlas au format JSON Hash (TexturePacker), celui que `this.load.atlas` de Phaser lit
 * sans conversion.
 *
 * Les sprites étant **rognés** avant packing (cf. `imageOps.trimBounds`), on écrit
 * `trimmed: false` et une `sourceSize` égale à la taille de la frame : du point de vue du
 * jeu, le sprite *est* son contenu visible. C'est ce qui permet de centrer une unité sur sa
 * silhouette plutôt que sur le vide de sa case d'origine — un orbe dessiné en haut à gauche
 * de sa cellule tomberait sinon en haut à gauche de la case de la grille.
 */
export function toAtlasJson({ image, width, height, frames }) {
  const hash = {};
  for (const frame of [...frames].sort((a, b) => a.name.localeCompare(b.name))) {
    hash[frame.name] = {
      frame: { x: frame.x, y: frame.y, w: frame.width, h: frame.height },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: frame.width, h: frame.height },
      sourceSize: { w: frame.width, h: frame.height },
    };
  }

  return {
    frames: hash,
    meta: {
      app: 'npm run assets',
      // Le rappel vit dans le fichier lui-même : c'est la première chose qu'on lit en
      // l'ouvrant par erreur pour « corriger une position à la main ».
      note: 'Fichier généré — ne pas éditer. Source : assets-src/ + manifest.json',
      image,
      format: 'RGBA8888',
      size: { w: width, h: height },
      scale: '1',
    },
  };
}
