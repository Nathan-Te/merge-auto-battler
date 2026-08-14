/**
 * **Le seul endroit qui décide entre un sprite et une forme.**
 *
 * Chaque chose affichable du jeu — un item de la grille, une unité, un ennemi, une icône de
 * draft — se demande ici, sous forme de **description** (`{ kind: 'unit', type, tier }`), et
 * repart en objet d'affichage : une `Image` si le sprite existe, un `Graphics` greybox
 * sinon. Les scènes n'ont donc à connaître ni les noms de sprites, ni les paliers visuels,
 * ni l'état de livraison des planches.
 *
 * C'est ce qui rend le lot tenable : sans ce point de passage, chaque scène porterait son
 * propre `if (sprite existe)`, et les six écrans du jeu se désynchroniseraient à la première
 * planche livrée à moitié.
 *
 * **La forme d'un objet ne change jamais en cours de vie.** Une vue créée en greybox le
 * reste, une vue créée en sprite aussi : les atlas sont chargés une fois pour toutes au
 * démarrage, donc la disponibilité d'un sprite est fixe pour toute la partie. On peut
 * repeindre (changement de tier, de type), jamais transmuter — ce qui évite d'avoir à
 * remplacer un enfant au milieu d'un conteneur en cours de tween.
 *
 * Aucune règle de gameplay ici, et aucune taille : l'appelant donne la taille qu'il donnait
 * déjà au greybox, et les hitboxes ne bougent pas (règle du Lot 5).
 */

import { drawItemShape } from './tierShapes.js';
import { drawPowerShape } from './powerShapes.js';
import { drawUnitShape, drawEnemyShape, enemySize } from './battleShapes.js';
import { drawDraftIcon } from './draftIcons.js';
import { ITEM_FAMILY } from '../systems/GridModel.js';
import { enemySprite, orbSprite, powerItemSprite, unitSprite } from './skinNames.js';

/**
 * Nom du sprite correspondant à une description, ou `null` si cette famille d'objets n'en
 * a pas (les tracés de tir, par exemple, restent vectoriels).
 *
 * @param {object} spec
 * @param {import('./skin.js').Skin} skin
 * @returns {string|null}
 */
export function spriteNameFor(spec, skin) {
  switch (spec.kind) {
    case 'item':
      return spec.item?.family === ITEM_FAMILY.POWER
        ? powerItemSprite(spec.item.power, spec.item.tier, skin.bands.power)
        : orbSprite(spec.item.tier, skin.bands.orb);
    case 'power':
      return powerItemSprite(spec.type, spec.tier, skin.bands.power);
    case 'unit':
      return unitSprite(spec.type, spec.tier, skin.bands.unit);
    case 'enemy':
      return enemySprite(spec.type);
    case 'draftIcon':
      return `icon.draft.${spec.icon}`;
    default:
      return null;
  }
}

/** Dessine une description dans un `Graphics` — le chemin greybox, inchangé depuis le Lot 4. */
function drawGreybox(graphics, spec, size) {
  switch (spec.kind) {
    case 'item':
      drawItemShape(graphics, spec.item, size);
      return;
    case 'power':
      drawPowerShape(graphics, spec.type, spec.tier, size);
      return;
    case 'unit':
      drawUnitShape(graphics, spec.type, spec.tier, size);
      return;
    case 'enemy':
      drawEnemyShape(graphics, spec.type, size, { horizontal: spec.horizontal ?? true });
      return;
    case 'draftIcon':
      drawDraftIcon(graphics, spec.icon, size);
      return;
    default:
      graphics.clear();
  }
}

/**
 * Crée l'objet d'affichage d'une description, centré sur (0, 0).
 *
 * @param {Phaser.Scene} scene
 * @param {import('./skin.js').Skin|null} skin
 * @param {object} spec
 * @param {number} size Diamètre visuel visé
 * @returns {Phaser.GameObjects.Image|Phaser.GameObjects.Graphics}
 */
export function createVisual(scene, skin, spec, size) {
  const name = skin ? spriteNameFor(spec, skin) : null;
  if (name && skin.has(name)) {
    const image = skin.image(name, size);
    if (image) {
      applyFacing(image, spec);
      return image;
    }
  }
  const graphics = scene.add.graphics();
  drawGreybox(graphics, spec, size);
  return graphics;
}

/**
 * Repeint un objet existant pour une nouvelle description ou une nouvelle taille.
 *
 * @returns {boolean} false si l'objet ne peut pas rendre cette description (jamais en
 *   pratique, cf. l'invariant en tête) — l'appelant peut alors le recréer.
 */
export function repaintVisual(visual, skin, spec, size) {
  if (!visual) return false;

  // Un `Graphics` a une méthode `clear` ; une `Image` a une `setTexture`. C'est le test le
  // moins fragile, et il ne dépend pas d'un `instanceof` inutilisable en test sans Phaser.
  if (typeof visual.clear === 'function' && typeof visual.fillPoints === 'function') {
    drawGreybox(visual, spec, size);
    return true;
  }

  const name = skin ? spriteNameFor(spec, skin) : null;
  if (!name || !skin.setFrame(visual, name, size)) return false;
  applyFacing(visual, spec);
  return true;
}

/**
 * Oriente un sprite vers l'endroit où il marche — **par retournement, jamais par rotation**.
 *
 * Une rotation libre rééchantillonne le dessin et fabrique des pixels qui n'existent dans
 * aucune planche ; un `flipX` échange des colonnes entières et ne coûte pas un pixel
 * (cf. `CLAUDE.md`).
 *
 * Le sens de marche est une propriété du **camp**, pas de l'entité : dans ce jeu les ennemis
 * entrent à la progression 0 et montent vers la base, les unités sortent de la base et
 * descendent vers eux. Sur un couloir horizontal, la base est à droite : **les ennemis vont
 * vers la droite, les unités vers la gauche**. Les planches du pack étant dessinées tournées
 * vers la gauche, seuls les ennemis se retournent.
 *
 * En portrait le couloir est vertical et la question ne se pose pas : on garde alors
 * l'orientation naturelle de la planche, un sprite pivoté à 90° étant bien pire que pas de
 * pivot du tout.
 */
const FACING_FLIP = { unit: false, enemy: true };

function applyFacing(image, spec) {
  if (!image.setFlipX) return;
  const flip = FACING_FLIP[spec.kind];
  if (flip === undefined) return;
  image.setFlipX(flip && (spec.horizontal ?? true));
}

/** Taille d'un ennemi — inchangée, sprite ou pas : c'est un choix de lisibilité. */
export { enemySize };
