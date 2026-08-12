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
 */

/** Plafond de repli si `juice.json` est illisible. Même valeur que le fichier. */
export const DEFAULT_MAX_PIXEL_RATIO = 2;

/**
 * Ratio de rendu effectif : le ratio de l'écran, borné par le plafond, jamais sous 1.
 *
 * Le ratio n'est **pas** arrondi à l'entier. Sur les écrans à 1,5 ou 2,625 (très courants
 * sur Android), arrondir vers le bas jetterait la moitié du gain de netteté pour la seule
 * satisfaction d'avoir un facteur entier.
 *
 * @param {number} deviceRatio `window.devicePixelRatio`
 * @param {number} [maxRatio] Plafond (`render.maxPixelRatio`)
 * @returns {number} Ratio effectif, dans [1, maxRatio]
 */
export function effectivePixelRatio(deviceRatio, maxRatio = DEFAULT_MAX_PIXEL_RATIO) {
  const cap = Number.isFinite(maxRatio) && maxRatio >= 1 ? maxRatio : 1;
  const raw = Number.isFinite(deviceRatio) && deviceRatio > 0 ? deviceRatio : 1;
  return Math.min(Math.max(1, raw), cap);
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
