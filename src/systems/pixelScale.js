/**
 * **Mise à l'échelle entière** — pur, sans Phaser ni DOM, donc testable.
 *
 * ## La règle, et pourquoi elle ne souffre pas d'exception
 *
 * Un sprite de pixel art s'affiche à un **multiple entier** de sa taille native, ou il ne
 * s'affiche pas correctement. Un facteur de 3,4 répartit les pixels d'art sur 3 ou 4 pixels
 * d'écran selon leur position : sur un personnage de 16 px, une colonne sur trois est plus
 * large que ses voisines. Le résultat n'est pas « un peu flou », il est **irrégulier** — un
 * œil se retrouve décentré d'un pixel, un trait d'épaule fait un ressaut. C'est le défaut qui
 * distingue immédiatement un jeu pixel art d'une image de pixel art redimensionnée, et aucun
 * réglage de filtrage ne le rattrape.
 *
 * D'où la chaîne, entièrement entière de bout en bout :
 *
 * ```
 * pixel d'art  ×  échelle du sprite  ×  zoom de la caméra  =  pixel d'écran
 *                 (entier, ici)          (entier, cf. pixelRatio.js)
 * ```
 *
 * ## Ce que ça change par rapport aux lots précédents
 *
 * Avant, `Skin.resize()` mettait un sprite à **exactement** la taille demandée par le
 * layout : un orbe faisait la taille de sa case, au pixel près. Maintenant il fait le plus
 * grand multiple entier de 16 qui tient dans sa case — donc parfois un peu moins. C'est un
 * échange assumé : on perd quelques pixels de remplissage, on gagne une grille de pixels
 * intacte sur tous les écrans. Le layout, lui, n'a pas changé d'un iota : il continue de
 * calculer des rectangles, et c'est le sprite qui se range dedans.
 *
 * ## Pourquoi ici et pas dans `render/`
 *
 * Parce que c'est de l'arithmétique, que ça se teste sans canvas, et que trois consommateurs
 * en ont besoin sans se connaître : la couche de skin (`src/render/skin.js`), les particules
 * (`src/render/particles.js`) et les vues qui posent un décor. Une fonction recopiée trois
 * fois dériverait à la première correction.
 */

/**
 * Résolution native du projet, en pixels d'art — **la première règle d'or**.
 *
 * Valeur de repli quand `public/assets/index.json` n'existe pas encore (aucune planche
 * livrée). En temps normal elle vient du manifest, via l'index du pipeline : les deux ne
 * peuvent pas diverger, puisqu'il n'y a qu'un producteur.
 */
export const DEFAULT_NATIVE_SIZE = 16;

/**
 * Plafond de sécurité. Un facteur au-delà voudrait dire qu'un sprite de 16 px occupe plus
 * de 1000 px : c'est un layout cassé, pas une intention.
 */
const MAX_SCALE = 64;

/**
 * Plus grand entier `k` tel que `native × k` tienne dans `available`.
 *
 * Rend **1** quand même la taille native ne tient pas. C'est délibéré : mieux vaut un sprite
 * qui déborde légèrement de son rectangle qu'un sprite réduit d'un facteur fractionnaire,
 * qui serait illisible là où le débordement, lui, se voit et se corrige dans le layout.
 *
 * @param {number} available Place disponible, en unités de jeu
 * @param {number} native Taille native, en pixels d'art
 * @param {number} [min] Facteur minimal
 * @returns {number} facteur entier ≥ min
 */
export function integerScale(available, native, min = 1) {
  const floor = Math.max(1, Math.floor(min));
  if (!Number.isFinite(available) || !Number.isFinite(native) || native <= 0) return floor;
  const raw = Math.floor(available / native);
  return Math.min(MAX_SCALE, Math.max(floor, raw));
}

/**
 * Taille d'affichage d'un sprite, ramenée au multiple entier qui tient dans `target`.
 *
 * `target` est un **diamètre visuel visé**, la même valeur que celle passée au greybox : les
 * deux familles de rendu se demandent la même place, et c'est ce qui permet à un sprite
 * absent de retomber sur une forme sans que rien ne bouge à l'écran.
 *
 * Le facteur est choisi sur le **plus grand côté** : un sprite plus haut que large garde ses
 * proportions au lieu d'être écrasé dans un carré, exactement comme avant la bascule.
 *
 * @param {{width: number, height: number}} frame Taille du sprite, en pixels d'art
 * @param {number} target Diamètre visuel visé, en unités de jeu
 * @returns {{width: number, height: number, scale: number}}
 */
export function spriteFit({ width, height }, target) {
  const longest = Math.max(width, height) || 1;
  const scale = integerScale(target, longest);
  return { width: width * scale, height: height * scale, scale };
}

/**
 * Taille d'un pixel d'art à l'écran, pour une place et une taille native données.
 *
 * C'est l'unité dans laquelle raisonnent les effets : une particule, un liseré ou un décalage
 * de recul se comptent en **pixels d'art**, jamais en pixels d'écran, sinon ils changent de
 * grosseur relative d'un téléphone à l'autre et cessent d'appartenir au même dessin.
 *
 * @param {number} available Place disponible, en unités de jeu
 * @param {number} [native] Taille native, en pixels d'art
 * @returns {number} côté d'un pixel d'art, en unités de jeu
 */
export function artPixelSize(available, native = DEFAULT_NATIVE_SIZE) {
  return integerScale(available, native);
}

/**
 * Arrondit une longueur à un multiple entier du pixel d'art.
 *
 * Sert aux effets qui dessinent des rectangles : une particule de 5,3 px sur une grille de
 * 3 px n'appartient à aucun dessin. `min` garantit qu'un effet ne disparaît pas en
 * s'arrondissant à zéro — une particule invisible est un bug, pas une subtilité.
 *
 * @param {number} length Longueur voulue, en unités de jeu
 * @param {number} pixelSize Côté d'un pixel d'art, en unités de jeu
 * @param {number} [minPixels] Nombre minimal de pixels d'art
 * @returns {number}
 */
export function snapToArtPixels(length, pixelSize, minPixels = 1) {
  const unit = pixelSize > 0 ? pixelSize : 1;
  const steps = Math.max(minPixels, Math.round(length / unit));
  return steps * unit;
}

/**
 * Aligne une coordonnée sur la grille de pixels d'art.
 *
 * `roundPixels` de Phaser aligne sur le pixel **de jeu**, ce qui suffit à un rendu net mais
 * pas à une grille cohérente : à l'échelle ×3, un carré posé en 41 et un autre en 42 ne sont
 * pas sur la même trame, et l'œil le voit sur une gerbe de particules. Ici on aligne sur la
 * trame du dessin.
 *
 * @param {number} value
 * @param {number} pixelSize Côté d'un pixel d'art, en unités de jeu
 * @returns {number}
 */
export function snapToArtGrid(value, pixelSize) {
  const unit = pixelSize > 0 ? pixelSize : 1;
  return Math.round(value / unit) * unit;
}

export default spriteFit;
