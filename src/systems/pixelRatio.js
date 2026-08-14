/**
 * Résolution de rendu — **pur, sans Phaser ni DOM**, donc testable.
 *
 * ## Le problème
 *
 * Le canvas est en `Scale.RESIZE` : Phaser lui donne la taille CSS du viewport, et sa
 * mémoire de rendu fait **exactement** ce nombre de pixels. Sur un téléphone à
 * `devicePixelRatio` 2 ou 3, le navigateur étire ensuite cette image sur 2 ou 3 fois plus de
 * pixels physiques : tout est flou, et le texte le premier (playtest du Lot 3.5).
 *
 * ## Le correctif
 *
 * Rendre dans une mémoire de **taille physique** (CSS × ratio) tout en gardant la taille
 * CSS à l'affichage. Les coordonnées de jeu, elles, ne bougent pas : c'est le zoom des
 * caméras qui absorbe le facteur (cf. `src/render/hiDpi.js`). Aucune scène n'a à savoir que
 * le ratio existe.
 *
 * ## Pourquoi un plafond
 *
 * Le coût de rendu est **quadratique** : à ratio 2 il y a 4 fois plus de pixels à remplir,
 * à ratio 3 il y en a 9. Au-delà de 2, le gain visuel est marginal (l'œil ne distingue plus
 * les marches d'escalier) alors que le budget de fill-rate d'un téléphone d'entrée de gamme,
 * lui, est bien réel. Le plafond vit dans `juice.json` (`render.maxPixelRatio`) parce que
 * c'est un réglage de **rendu**, qui se juge à l'œil sur un téléphone et ne doit **jamais**
 * influencer une règle du jeu.
 *
 * **Toute correction de netteté ou de performance passe par ce plafond**, jamais par des
 * tailles en dur dans les scènes (cf. `CLAUDE.md`).
 *
 * ## Pourquoi le ratio est devenu entier au passage en pixel art
 *
 * Le zoom des caméras **est** ce ratio. Tant que le jeu était vectoriel, un zoom de 2,625
 * était un cadeau : chaque courbe gagnait en finesse et rien ne s'y opposait. En pixel art
 * il devient le maillon qui casse la chaîne — un sprite affiché à un multiple entier
 * impeccable de sa taille native, multiplié ensuite par 2,625, retombe entre deux pixels
 * d'écran, et une colonne de pixels d'art sur trois s'étale sur une largeur différente de ses
 * voisines. Le sprite n'est pas flou, il est **irrégulier**, ce qui est pire et se voit sur
 * un visage de 16 px.
 *
 * On tronque donc à l'entier. Le prix est réel et il est payé les yeux ouverts : sur un écran
 * en 1,5 le texte perd sa demi-résolution, sur un écran en 2,625 il rend à 2 et le navigateur
 * étire l'image du reste. Mais cet étirement-là est **uniforme** — une homothétie propre sur
 * toute la surface, que l'œil lit comme un léger adoucissement — là où un zoom fractionnaire
 * appliqué avant le filtrage au plus proche voisin déforme la grille elle-même. La netteté du
 * pixel art prime, c'est la décision de direction artistique.
 */

/** Plafond de repli si `juice.json` est illisible. Même valeur que le fichier. */
export const DEFAULT_MAX_PIXEL_RATIO = 2;

/**
 * Ratio de rendu effectif : le ratio de l'écran, borné par le plafond, **tronqué à l'entier**,
 * jamais sous 1.
 *
 * L'entier est la contrainte du pixel art (cf. l'en-tête du module). Il est obtenu par
 * troncature et non par arrondi : un écran en 1,9 rend à 1 et non à 2, parce que rendre dans
 * une mémoire **plus grande** que l'écran physique ferait réduire l'image par le navigateur —
 * c'est-à-dire jeter un pixel d'art sur deux, exactement ce qu'on cherche à éviter.
 *
 * @param {number} deviceRatio `window.devicePixelRatio`
 * @param {number} [maxRatio] Plafond (`render.maxPixelRatio`)
 * @returns {number} Ratio effectif entier, dans [1, maxRatio]
 */
export function effectivePixelRatio(deviceRatio, maxRatio = DEFAULT_MAX_PIXEL_RATIO) {
  const cap = Number.isFinite(maxRatio) && maxRatio >= 1 ? maxRatio : 1;
  const raw = Number.isFinite(deviceRatio) && deviceRatio > 0 ? deviceRatio : 1;
  return Math.max(1, Math.floor(Math.min(raw, cap)));
}

/**
 * Taille de la mémoire de rendu pour une taille logique donnée.
 *
 * Arrondie à l'entier : un canvas ne peut pas faire 780,5 pixels de large, et laisser le
 * navigateur arrondir donnerait un décalage d'un demi-pixel sur tout l'écran.
 *
 * @param {number} width Largeur logique (CSS)
 * @param {number} height Hauteur logique (CSS)
 * @param {number} ratio Ratio effectif
 * @returns {{width: number, height: number}}
 */
export function bufferSize(width, height, ratio) {
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

/**
 * Résolution à donner aux objets `Text` de Phaser.
 *
 * Un `Text` est rasterisé dans une texture puis affiché à sa taille logique, elle-même
 * multipliée par le zoom des caméras : sa texture doit donc être générée au **ratio
 * effectif**, exactement. En dessous, le texte reste flou malgré tout le reste ; au-dessus,
 * on paie de la mémoire de texture pour rien.
 *
 * @param {number} ratio Ratio effectif
 * @returns {number}
 */
export function textResolution(ratio) {
  return Math.max(1, ratio);
}

export default effectivePixelRatio;
