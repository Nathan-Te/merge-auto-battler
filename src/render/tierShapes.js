/**
 * Greybox des items : une forme et une couleur par tier (1 -> 11).
 *
 * Rien ici n'influence les règles — c'est de la lisibilité pure, donc ça vit dans
 * le code et non dans `balance.json`. Les vrais sprites arrivent au Lot 5 ; d'ici
 * là, deux items de même tier doivent se reconnaître **d'un coup d'œil**, sans
 * lire le numéro : la forme change à chaque tier, la teinte tourne sur la roue.
 *
 * **Les items d'unité sont tous anguleux** depuis le Lot 4 : le cercle appartient désormais
 * aux items de **pouvoir** (`powerShapes.js`), et lui seul. C'est ce qui rend les deux
 * familles — donc les deux taps — impossibles à confondre au doigt. Le tier 1 est donc un
 * triangle et non plus un disque, et la règle « plus de côtés = plus haut tier » n'a fait
 * que se décaler d'un cran.
 */

import { drawPowerShape, powerColor } from './powerShapes.js';
import { ITEM_FAMILY } from '../systems/GridModel.js';

/** 11 teintes distinctes, toutes assez claires pour un numéro écrit en sombre. */
const TIER_COLORS = [
  0xff6b6b, // 1  rouge
  0xff9f43, // 2  orange
  0xffd93d, // 3  jaune
  0xb8e986, // 4  vert clair
  0x6bcb77, // 5  vert
  0x4ecdc4, // 6  turquoise
  0x63b3ff, // 7  bleu
  0x9aa8ff, // 8  indigo
  0xc9a6ff, // 9  violet
  0xff9ede, // 10 rose
  0xeef1f8, // 11 blanc
];

/** Forme associée à chaque tier : nombre de côtés croissant, puis étoiles. Aucun cercle. */
const TIER_SHAPES = [
  { kind: 'polygon', sides: 3 }, // 1
  { kind: 'polygon', sides: 4 }, // 2
  { kind: 'polygon', sides: 5 }, // 3
  { kind: 'polygon', sides: 6 }, // 4
  { kind: 'polygon', sides: 7 }, // 5
  { kind: 'polygon', sides: 8 }, // 6
  { kind: 'star', points: 4 }, // 7
  { kind: 'star', points: 5 }, // 8
  { kind: 'star', points: 6 }, // 9
  { kind: 'star', points: 7 }, // 10
  { kind: 'star', points: 8 }, // 11
];

/** Couleur d'un tier (les tiers hors plage retombent sur la dernière couleur). */
export function tierColor(tier) {
  return TIER_COLORS[Math.min(Math.max(tier, 1), TIER_COLORS.length) - 1];
}

/** Couleur du numéro écrit sur l'item : sombre, sur des formes volontairement claires. */
export const TIER_LABEL_COLOR = '#14161f';

/**
 * Dessine la forme d'un tier dans un `Graphics`, centrée sur (0, 0).
 *
 * @param {Phaser.GameObjects.Graphics} graphics
 * @param {number} tier
 * @param {number} size Diamètre visuel visé (la forme est inscrite dans ce carré)
 */
export function drawTierShape(graphics, tier, size) {
  const shape = TIER_SHAPES[Math.min(Math.max(tier, 1), TIER_SHAPES.length) - 1];
  const color = tierColor(tier);
  const radius = size / 2;

  graphics.clear();
  graphics.fillStyle(color, 1);
  // Un liseré sombre détache l'item du fond de case, quel que soit son tier.
  graphics.lineStyle(Math.max(1, size * 0.04), 0x14161f, 0.55);

  const points =
    shape.kind === 'star'
      ? starPoints(shape.points, radius, radius * 0.55)
      : polygonPoints(shape.sides, radius);

  graphics.fillPoints(points, true, true);
  graphics.strokePoints(points, true, true);
}

/**
 * Dessine **n'importe quel item de la grille**, quelle que soit sa famille.
 *
 * C'est le seul point d'entrée dont le rendu a besoin : il n'a pas à savoir qu'il existe
 * deux jeux de formes, il passe l'item et obtient la bonne silhouette.
 *
 * @param {Phaser.GameObjects.Graphics} graphics
 * @param {{tier: number, family?: string, power?: ?string}} item
 * @param {number} size Diamètre visuel visé
 */
export function drawItemShape(graphics, item, size) {
  if (item?.family === ITEM_FAMILY.POWER) {
    drawPowerShape(graphics, item.power, item.tier, size);
    return;
  }
  drawTierShape(graphics, item.tier, size);
}

/** Couleur d'un item, quelle que soit sa famille — teinte de tier, ou teinte de pouvoir. */
export function itemColor(item) {
  return item?.family === ITEM_FAMILY.POWER ? powerColor(item.power) : tierColor(item.tier);
}

/** Polygone régulier à `sides` côtés, pointe en haut. */
function polygonPoints(sides, radius) {
  const points = [];
  for (let i = 0; i < sides; i += 1) {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
    points.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  }
  return points;
}

/** Étoile à `count` branches, alternant rayon extérieur et rayon intérieur. */
function starPoints(count, outer, inner) {
  const points = [];
  for (let i = 0; i < count * 2; i += 1) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (i * Math.PI) / count;
    points.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  }
  return points;
}
