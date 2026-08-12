/**
 * `Skin` — la couche qui pose un **sprite quand il existe**, et retombe sur le greybox
 * vectoriel quand il n'existe pas.
 *
 * C'est le pont entre le pipeline (`npm run assets`) et le rendu. Il tient une promesse
 * précise, qui est tout l'intérêt du Lot 5 : **une planche déposée dans `assets-src/` se
 * retrouve en jeu en une commande**, sans toucher à une scène. À l'inverse, un sprite pas
 * encore livré ne casse rien — le jeu reste jouable et lisible en formes colorées, exactement
 * comme aux Lots 1 à 4.
 *
 * ## Pourquoi le repli n'est pas une précaution mais une fonctionnalité
 *
 * Les assets arrivent **par vagues** (grille, puis champ, puis interface). Sans repli, la
 * première vague rendrait le jeu injouable jusqu'à la dernière, et on ne pourrait rien
 * relire entre les deux. Avec, chaque planche livrée améliore l'écran sans jamais le casser,
 * et la galerie dit ce qui manque encore. C'est ce qui rend la boucle « upload → CI →
 * galerie » utilisable une planche à la fois.
 *
 * ## Ce que ce module ne fait pas
 *
 * Il ne décide **rien** : ni taille, ni position, ni règle. Il répond à « as-tu un sprite
 * pour ça ? » et pose l'image demandée à la taille demandée. Les tailles à l'écran restent
 * là où elles étaient (`layout.js`, `battleShapes.js`), et aucune valeur de gameplay n'entre
 * ici — un habillage ne change pas les hitboxes, c'est la règle du lot.
 */

import { DEFAULT_TIER_BANDS, bandOf } from './skinNames.js';

/** Clé de la texture Phaser d'un atlas de catégorie. */
export function atlasKey(category) {
  return `atlas-${category}`;
}

export class Skin {
  /**
   * @param {Phaser.Scene} scene Scène qui possède le gestionnaire de textures
   * @param {object|null} index Contenu de `public/assets/index.json`, ou null si absent
   */
  constructor(scene, index) {
    this.scene = scene;
    this.index = index ?? null;
    /** Nom de sprite → clé d'atlas, tel que le pipeline l'a écrit. */
    this.frames = new Map(Object.entries(index?.frames ?? {}));
    /**
     * Plages de paliers visuels : elles viennent du **manifest**, pas du code, pour qu'un
     * playtest qui trouve la marche mal placée se corrige depuis l'éditeur web de GitHub.
     */
    this.bands = {
      unit: index?.tierBands?.unit ?? DEFAULT_TIER_BANDS.unit,
      power: index?.tierBands?.power ?? DEFAULT_TIER_BANDS.power,
    };
  }

  /**
   * Vrai si le sprite existe **et** si sa texture est réellement chargée.
   *
   * Les deux conditions comptent : l'index peut annoncer un sprite dont l'atlas n'a pas pu
   * être chargé (fichier corrompu, réseau coupé au premier lancement). Dans ce cas on veut
   * le greybox, pas un rectangle vert de texture manquante.
   */
  has(name) {
    const category = this.frames.get(name);
    if (!category) return false;
    const key = atlasKey(category);
    return this.scene.textures.exists(key) && this.scene.textures.get(key).has(name);
  }

  /** Palier visuel d'un tier, dans la famille donnée (`unit` ou `power`). */
  band(family, tier) {
    return bandOf(tier, this.bands[family] ?? DEFAULT_TIER_BANDS.unit);
  }

  /**
   * Crée l'image d'un sprite, ou `null` s'il n'est pas disponible.
   *
   * L'image est **dimensionnée sur son plus grand côté**, comme le pipeline l'a normalisée :
   * un sprite plus haut que large garde ses proportions au lieu d'être écrasé dans un carré.
   *
   * @param {string} name
   * @param {number} size Diamètre visuel visé, la même valeur que pour le greybox
   * @returns {Phaser.GameObjects.Image|null}
   */
  image(name, size) {
    if (!this.has(name)) return null;
    const image = this.scene.add.image(0, 0, atlasKey(this.frames.get(name)), name);
    this.resize(image, size);
    return image;
  }

  /** Redimensionne une image déjà posée, en conservant son rapport d'aspect. */
  resize(image, size) {
    if (!image) return image;
    const source = image.frame;
    const longest = Math.max(source.width, source.height) || 1;
    const scale = size / longest;
    image.setDisplaySize(source.width * scale, source.height * scale);
    return image;
  }

  /**
   * Remplace la frame d'une image existante, si le nouveau sprite existe.
   *
   * Sert au changement de palier visuel : un item qui passe du tier 4 au tier 5 change
   * d'orbe sans qu'on détruise et recrée son conteneur.
   *
   * @returns {boolean} true si la frame a changé
   */
  setFrame(image, name, size) {
    if (!image || !this.has(name)) return false;
    image.setTexture(atlasKey(this.frames.get(name)), name);
    this.resize(image, size);
    return true;
  }

  /** Nombre de sprites réellement disponibles — lu par la ligne de diagnostic de debug. */
  get count() {
    let total = 0;
    for (const name of this.frames.keys()) if (this.has(name)) total += 1;
    return total;
  }
}

/**
 * Déclare le chargement des atlas décrits par l'index.
 *
 * À appeler depuis le `preload()` d'une scène. Un atlas qui échoue au chargement est
 * **ignoré** plutôt que fatal : le jeu doit démarrer même si un fichier manque, et `Skin.has`
 * s'en rendra compte tout seul (cf. `has`).
 *
 * @param {Phaser.Scene} scene
 * @param {object|null} index Contenu de `public/assets/index.json`
 * @param {string} [base] Préfixe d'URL des assets
 */
export function loadAtlases(scene, index, base = 'assets/') {
  for (const atlas of index?.atlases ?? []) {
    scene.load.atlas(atlasKey(atlas.key), `${base}${atlas.image}`, `${base}${atlas.json}`);
  }
}

export default Skin;
