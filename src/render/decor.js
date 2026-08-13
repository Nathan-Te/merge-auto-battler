/**
 * **Le décor** — les cinq images de fond du jeu, posées quand elles existent.
 *
 * Même promesse que `visuals.js`, appliquée aux surfaces plutôt qu'aux objets : une scène
 * demande un emplacement de décor, et reçoit soit un objet d'affichage, soit `null`. Elle
 * garde de toute façon son rectangle de couleur derrière — c'est **lui** le repli, il ne
 * disparaît jamais, et le décor se pose simplement par-dessus. Aucune scène n'a donc de
 * `if (le sprite existe)` à écrire, et livrer `decor.field` seul n'a aucun effet sur les
 * quatre autres.
 *
 * ## Les deux modes, et pourquoi ils ne se choisissent pas
 *
 * `DECOR_SLOTS` (`skinNames.js`) dit pour chaque emplacement s'il se **tuile** ou s'il se
 * **pose**. Ce n'est pas un réglage : c'est ce que la chose est. Un ciel, un plateau et un
 * sol sont des matières qui couvrent un rectangle dont personne ne connaît la taille à
 * l'avance — sur un écran de 320 px comme sur un 27 pouces. Un château et un portail sont des
 * objets, avec un haut, un bas et des proportions.
 *
 * ## Pourquoi on ne peut pas étirer un fond
 *
 * Parce que c'est du pixel art : étirer une image d'un facteur 3,4 répartit ses pixels sur 3
 * ou 4 pixels d'écran selon leur position (cf. `src/systems/pixelScale.js`). Un fond tuilé à
 * un facteur **entier** couvre exactement son rectangle sans qu'aucun pixel ne change de
 * taille — c'est la seule façon d'avoir les deux à la fois.
 *
 * ## Le piège du `TileSprite`
 *
 * Phaser redessine toute frame **non puissance de deux** étirée vers la taille supérieure,
 * en interpolant, avant d'en faire une texture répétable. Un sol de 24 px arriverait donc à
 * l'écran resampé en 32 : flou, et hors trame. Le pipeline signale le cas planche par
 * planche ; ici on n'a rien à faire de particulier, sinon le savoir.
 */

import { DECOR_MODE } from './skinNames.js';
import { atlasKey } from './skin.js';
import { DEFAULT_NATIVE_SIZE, integerScale, spriteFit } from '../systems/pixelScale.js';

/**
 * Une pièce de décor posée à l'écran.
 *
 * Créée par `createDecor`, qui rend `null` quand le sprite n'est pas livré : l'appelant n'a
 * donc jamais à tester la disponibilité, seulement à passer par `?.`.
 */
export class DecorPiece {
  /**
   * @param {Phaser.GameObjects.GameObject} object `TileSprite` ou `Image`
   * @param {'tile'|'fit'} mode
   * @param {number} nativeSize Résolution native du projet, en pixels d'art
   */
  constructor(object, mode, nativeSize) {
    this.object = object;
    this.mode = mode;
    this.nativeSize = nativeSize;
  }

  /**
   * Replace la pièce dans une **boîte**, à la trame de pixels donnée.
   *
   * La boîte est toujours donnée en coin haut-gauche + taille, dans les deux modes : un fond
   * la remplit, un objet s'y centre. Une pièce ne déborde donc jamais de ce qu'on lui a
   * offert, ce qui est la seule façon de garantir qu'un château ne viendra pas se poser sur
   * la jauge de PV le jour où quelqu'un livre une planche deux fois plus grande que prévu.
   *
   * @param {{x: number, y: number, width: number, height: number}} box
   * @param {number} artPixel Côté d'un pixel d'art à l'écran, en unités de jeu — **la même
   *   valeur que pour tout le reste de l'écran** (`GameScene.artPixel`), sinon deux surfaces
   *   voisines n'ont pas des pixels de la même grosseur et l'illusion tombe.
   */
  resize(box, artPixel) {
    const object = this.object;
    if (!object?.active) return this;

    if (this.mode === 'tile') {
      // Le `TileSprite` couvre **exactement** la boîte, et c'est la répétition — pas
      // l'étirement — qui absorbe la taille : `tileScale` reste entier.
      object.setPosition(box.x, box.y).setSize(box.width, box.height);
      object.setTileScale(Math.max(1, Math.round(artPixel)));
      return this;
    }

    // `fit` : un objet centré dans la boîte, au plus grand multiple entier qui y tient —
    // exactement la règle de `Skin.resize`. Le côté retenu est le **plus petit** des deux :
    // c'est ce qui garantit que rien ne dépasse, quelle que soit la forme de la planche.
    const { scale } = spriteFit(object.frame, Math.min(box.width, box.height));
    object.setScale(scale).setPosition(box.x + box.width / 2, box.y + box.height / 2);
    return this;
  }

  /** Facteur entier auquel la pièce s'affiche — lu par les tests et le debug. */
  get scale() {
    return this.mode === 'tile' ? this.object?.tileScaleX ?? 1 : this.object?.scaleX ?? 1;
  }

  setVisible(visible) {
    this.object?.setVisible(visible);
    return this;
  }

  destroy() {
    this.object?.destroy();
    this.object = null;
  }
}

/**
 * Crée la pièce de décor d'un emplacement, ou `null` si sa planche n'est pas livrée.
 *
 * @param {Phaser.Scene} scene
 * @param {import('./skin.js').Skin|null} skin
 * @param {string} name Nom d'emplacement (`decor.field`, `decor.sky`…)
 * @param {number} depth Profondeur d'affichage — **au-dessus du rectangle de repli**, qui
 *   reste posé dessous et continue de porter la couleur de la zone
 * @returns {DecorPiece|null}
 */
export function createDecor(scene, skin, name, depth) {
  if (!skin?.has(name)) return null;
  const mode = DECOR_MODE[name] ?? 'fit';
  const key = atlasKey(skin.frames.get(name));
  const nativeSize = skin.nativeSize ?? DEFAULT_NATIVE_SIZE;

  const object =
    mode === 'tile'
      ? scene.add.tileSprite(0, 0, 16, 16, key, name).setOrigin(0, 0)
      : scene.add.image(0, 0, key, name).setOrigin(0.5, 0.5);

  object.setDepth(depth);
  return new DecorPiece(object, mode, nativeSize);
}

/**
 * Trame de pixels d'un décor, quand l'appelant n'a pas déjà la valeur de l'écran sous la main.
 *
 * Exposé pour que les tests et les vues qui n'ont pas accès à `GameScene.artPixel` calculent
 * la même chose plutôt qu'une variante.
 */
export function decorPixelSize(reference, nativeSize = DEFAULT_NATIVE_SIZE) {
  return integerScale(reference, nativeSize);
}

export default createDecor;
