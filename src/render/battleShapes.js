/**
 * Greybox de la bande de combat : une forme et une couleur par **type** d'unité et par
 * **type** d'ennemi. Le tier, lui, se lit au numéro et à la couleur du liseré (la même
 * roue de teintes que les items de la grille, pour que le pont grille → bande se voie).
 *
 * Aucune règle, aucun état — comme `tierShapes.js`. Les tailles à l'écran sont ici et
 * non dans `balance.json` : elles n'influencent aucun calcul de gameplay (le modèle
 * raisonne en unités de couloir), ce sont des choix de lisibilité.
 *
 * **Aucune unité n'est ronde** depuis le Lot 4. Le cercle est réservé aux items de pouvoir
 * (`powerShapes.js`), et la règle « rond = pouvoir » ne vaut que si elle n'a pas
 * d'exception : le panneau d'aide montre les types d'unités et les pouvoirs l'un sous
 * l'autre, et un mono-cible rond y contredirait la ligne qui le suit. Le `single` est donc
 * un **carré** — la forme la plus neutre pour le type le plus générique.
 */

import { tierColor } from './tierShapes.js';

/** Une teinte par type d'unité — franches et éloignées les unes des autres. */
export const UNIT_COLORS = {
  single: 0x4d96ff,
  aoe: 0xff7a45,
  slow: 0x4ecdc4,
  support: 0xc9a6ff,
};

/** Une teinte par type d'ennemi, dans une gamme distincte de celle des unités. */
export const ENEMY_COLORS = {
  basic: 0xe05a5a,
  fast: 0xf0c14b,
  tank: 0x9a6bd0,
};

/** Taille d'un ennemi, en fraction de la taille de référence de la bande. */
const ENEMY_SIZE_RATIO = { basic: 0.62, fast: 0.46, tank: 0.86 };

const FALLBACK_UNIT_COLOR = 0x8f97b0;
const FALLBACK_ENEMY_COLOR = 0xe05a5a;

/** Couleur d'un type d'unité (type inconnu : gris neutre). */
export function unitColor(type) {
  return UNIT_COLORS[type] ?? FALLBACK_UNIT_COLOR;
}

/** Couleur d'un type d'ennemi. */
export function enemyColor(type) {
  return ENEMY_COLORS[type] ?? FALLBACK_ENEMY_COLOR;
}

/**
 * Diamètre visuel d'un ennemi.
 *
 * @param {string} type
 * @param {number} reference Taille de référence de la bande (`zone.enemyReference`),
 *   déjà bornée par l'épaisseur du couloir et par la taille d'un slot.
 */
export function enemySize(type, reference) {
  return Math.max(6, reference * (ENEMY_SIZE_RATIO[type] ?? ENEMY_SIZE_RATIO.basic));
}

/**
 * Dessine une unité, centrée sur (0, 0).
 *
 * Forme = type, liseré = tier.
 *
 * @param {Phaser.GameObjects.Graphics} graphics
 * @param {string} type Type d'unité (`single`, `aoe`, `slow`, `support`)
 * @param {number} tier
 * @param {number} size Diamètre visuel visé
 */
export function drawUnitShape(graphics, type, tier, size) {
  const radius = size / 2;
  graphics.clear();
  graphics.fillStyle(unitColor(type), 1);
  // Liseré à la couleur du tier : deux unités de même type se distinguent d'un coup
  // d'œil sans lire leur numéro.
  graphics.lineStyle(Math.max(1.5, size * 0.1), tierColor(tier), 1);

  if (type === 'single') {
    strokeAndFill(graphics, squarePoints(radius));
  } else if (type === 'aoe') {
    strokeAndFill(graphics, diamondPoints(radius));
  } else if (type === 'slow') {
    strokeAndFill(graphics, regularPolygon(6, radius));
  } else if (type === 'support') {
    strokeAndFill(graphics, crossPoints(radius));
  } else {
    strokeAndFill(graphics, regularPolygon(4, radius));
  }
}

/**
 * Dessine un ennemi, centré sur (0, 0). La pointe des formes regarde vers la base
 * (`forward` : +1 vers la droite/le bas du couloir).
 */
export function drawEnemyShape(graphics, type, size, { horizontal = true } = {}) {
  const radius = size / 2;
  graphics.clear();
  graphics.fillStyle(enemyColor(type), 1);
  graphics.lineStyle(Math.max(1, size * 0.08), 0x14161f, 0.6);

  if (type === 'fast') {
    // Triangle pointé vers la base : la lecture de la menace la plus rapide est immédiate.
    const points = horizontal
      ? [
          { x: radius, y: 0 },
          { x: -radius * 0.8, y: -radius * 0.85 },
          { x: -radius * 0.8, y: radius * 0.85 },
        ]
      : [
          { x: 0, y: radius },
          { x: -radius * 0.85, y: -radius * 0.8 },
          { x: radius * 0.85, y: -radius * 0.8 },
        ];
    strokeAndFill(graphics, points);
    return;
  }

  if (type === 'tank') {
    strokeAndFill(graphics, regularPolygon(6, radius));
    return;
  }

  graphics.fillRect(-radius, -radius, size, size);
  graphics.strokeRect(-radius, -radius, size, size);
}

function strokeAndFill(graphics, points) {
  graphics.fillPoints(points, true, true);
  graphics.strokePoints(points, true, true);
}

function regularPolygon(sides, radius) {
  const points = [];
  for (let i = 0; i < sides; i += 1) {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
    points.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  }
  return points;
}

/** Carré à plat — le mono-cible. Un côté horizontal le distingue nettement du losange. */
function squarePoints(radius) {
  const side = radius * 0.86;
  return [
    { x: -side, y: -side },
    { x: side, y: -side },
    { x: side, y: side },
    { x: -side, y: side },
  ];
}

function diamondPoints(radius) {
  return [
    { x: 0, y: -radius },
    { x: radius, y: 0 },
    { x: 0, y: radius },
    { x: -radius, y: 0 },
  ];
}

function crossPoints(radius) {
  const thin = radius * 0.38;
  return [
    { x: -thin, y: -radius },
    { x: thin, y: -radius },
    { x: thin, y: -thin },
    { x: radius, y: -thin },
    { x: radius, y: thin },
    { x: thin, y: thin },
    { x: thin, y: radius },
    { x: -thin, y: radius },
    { x: -thin, y: thin },
    { x: -radius, y: thin },
    { x: -radius, y: -thin },
    { x: -thin, y: -thin },
  ];
}
