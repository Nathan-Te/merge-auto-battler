/**
 * Calcul de layout — pur, sans Phaser, donc testable.
 *
 * Le canvas est en `Scale.RESIZE` (cf. README) : à chaque `resize`, la scène
 * redemande un layout complet plutôt que de corriger des positions au coup par coup.
 *
 * Deux zones, décidées ici une fois pour toutes :
 *   - la **grille de merge**, toujours carrée ;
 *   - la **bande de combat**, réservée dès le Lot 1 (placeholder vide) pour que le
 *     Lot 2 n'ait pas à rebouger l'écran : à droite en paysage, en bas en portrait.
 *
 * Ce ne sont pas des stats de gameplay (aucun impact sur les règles), donc ces
 * proportions vivent dans le code et non dans `balance.json`.
 */

import { GRID_COLS, GRID_ROWS } from './grid.js';

/** Proportions d'écran. Purement visuel — voir l'en-tête du fichier. */
const LAYOUT = {
  /** Marge extérieure, en fraction du plus petit côté. */
  padRatio: 0.035,
  minPad: 8,
  maxPad: 26,
  /** Bandeau de debug en haut (titre + compteur de merges). */
  headerRatio: 0.075,
  minHeader: 26,
  maxHeader: 52,
  /** Part maximale de la largeur prise par la grille en paysage. */
  gridWidthShareLandscape: 0.56,
  /** Part maximale de la hauteur prise par la grille en portrait. */
  gridHeightSharePortrait: 0.62,
  /** Taille de l'item par rapport à sa case. */
  itemRatio: 0.82,
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * Calcule les rectangles de l'écran pour une taille de canvas donnée.
 *
 * @param {number} width Largeur du canvas
 * @param {number} height Hauteur du canvas
 * @param {object} [options]
 * @param {number} [options.cols]
 * @param {number} [options.rows]
 * @returns {{
 *   width: number, height: number, landscape: boolean, pad: number,
 *   header: {x: number, y: number, width: number, height: number},
 *   grid: {x: number, y: number, size: number, cell: number, cols: number, rows: number},
 *   battle: {x: number, y: number, width: number, height: number},
 *   itemSize: number
 * }}
 */
export function computeLayout(width, height, { cols = GRID_COLS, rows = GRID_ROWS } = {}) {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const landscape = w >= h;

  const pad = clamp(Math.round(Math.min(w, h) * LAYOUT.padRatio), LAYOUT.minPad, LAYOUT.maxPad);
  const headerHeight = clamp(
    Math.round(Math.min(w, h) * LAYOUT.headerRatio),
    LAYOUT.minHeader,
    LAYOUT.maxHeader
  );
  const gap = pad;

  const contentTop = pad + headerHeight + Math.round(gap / 2);
  const availableWidth = Math.max(1, w - pad * 2);
  const availableHeight = Math.max(1, h - contentTop - pad);

  let grid;
  let battle;

  if (landscape) {
    // La grille se cale à gauche, la bande prend toute la colonne de droite.
    const size = Math.max(
      1,
      Math.min(availableHeight, (availableWidth - gap) * LAYOUT.gridWidthShareLandscape)
    );
    grid = { x: pad, y: contentTop + (availableHeight - size) / 2, size };
    battle = {
      x: pad + size + gap,
      y: contentTop,
      width: Math.max(1, availableWidth - size - gap),
      height: availableHeight,
    };
  } else {
    // La grille se cale en haut, la bande occupe le bas de l'écran.
    const size = Math.max(
      1,
      Math.min(availableWidth, (availableHeight - gap) * LAYOUT.gridHeightSharePortrait)
    );
    grid = { x: (w - size) / 2, y: contentTop, size };
    battle = {
      x: pad,
      y: contentTop + size + gap,
      width: availableWidth,
      height: Math.max(1, availableHeight - size - gap),
    };
  }

  const cell = grid.size / Math.max(cols, rows);

  return {
    width: w,
    height: h,
    landscape,
    pad,
    header: { x: pad, y: pad, width: availableWidth, height: headerHeight },
    grid: { ...grid, cell, cols, rows },
    battle,
    itemSize: cell * LAYOUT.itemRatio,
  };
}

/**
 * Centre en pixels d'une case.
 *
 * @param {object} layout Résultat de `computeLayout`
 * @param {number} x Colonne
 * @param {number} y Ligne
 * @returns {{x: number, y: number}}
 */
export function cellCenter(layout, x, y) {
  const { grid } = layout;
  return {
    x: grid.x + (x + 0.5) * grid.cell,
    y: grid.y + (y + 0.5) * grid.cell,
  };
}

/** Centre en pixels d'une case désignée par son index à plat. */
export function cellCenterAt(layout, index) {
  const { cols } = layout.grid;
  return cellCenter(layout, index % cols, Math.floor(index / cols));
}

/**
 * Case la plus proche d'un point — c'est la tolérance de drop « pensée pour le doigt » :
 * on ne teste pas le pixel exact sous l'item, on cherche le centre de case le plus proche
 * de son centre, et on l'accepte s'il n'est pas trop loin.
 *
 * @param {object} layout Résultat de `computeLayout`
 * @param {number} px
 * @param {number} py
 * @param {object} [options]
 * @param {number} [options.tolerance] Distance max au centre de case, en fraction de case
 * @returns {number} Index à plat de la case, ou -1 si le point est hors tolérance
 */
export function nearestCellIndex(layout, px, py, { tolerance = 0.9 } = {}) {
  const { grid } = layout;
  if (!(grid.cell > 0)) return -1;

  const col = clamp(Math.floor((px - grid.x) / grid.cell), 0, grid.cols - 1);
  const row = clamp(Math.floor((py - grid.y) / grid.cell), 0, grid.rows - 1);
  const center = cellCenter(layout, col, row);

  // Distance de Tchebychev plutôt qu'euclidienne : la zone d'acceptation est un
  // carré autour de la case, ce qui évite les coins morts entre quatre cases.
  const distance = Math.max(Math.abs(px - center.x), Math.abs(py - center.y));
  if (distance > grid.cell * tolerance) return -1;

  return row * grid.cols + col;
}
