/**
 * Calcul de layout — pur, sans Phaser, donc testable.
 *
 * Le canvas est en `Scale.RESIZE` (cf. README) : à chaque `resize`, la scène
 * redemande un layout complet plutôt que de corriger des positions au coup par coup.
 *
 * Deux zones, décidées ici une fois pour toutes :
 *   - la **grille de merge**, toujours carrée ;
 *   - la **bande de combat**, réservée dès le Lot 1 et découpée depuis le Lot 2 en
 *     HUD / couloir / base / slots de déploiement (`computeBattleZone`).
 *
 * Ce ne sont pas des stats de gameplay (aucun impact sur les règles), donc ces
 * proportions vivent dans le code et non dans `balance.json`. Le modèle de combat
 * raisonne en **unités de couloir** ; c'est `lanePoint()` qui les convertit en pixels.
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

/** Proportions internes de la bande de combat. Purement visuel, comme ci-dessus. */
const BATTLE = {
  gapRatio: 0.035,
  minGap: 4,
  maxGap: 12,
  // Deux lignes de HUD (PV / vague, puis file / prochaine unité) : la hauteur réservée
  // doit les contenir toutes les deux, même sur le plus petit écran visé.
  hudRatio: 0.19,
  minHud: 26,
  maxHud: 46,
  /** Écart entre deux slots de déploiement, en multiples de la taille d'un slot. */
  slotPitchRatio: 1.14,
  /** Épaisseur du bloc « base » au bout du couloir. */
  baseRatio: 0.11,
  minBase: 20,
  maxBase: 56,
  maxSlot: 96,
  minSlot: 10,
  /** Part de la place restante que peuvent prendre les slots (le reste va au couloir). */
  slotShare: 0.46,
  unitRatio: 0.86,
  /**
   * Épaisseur maximale du couloir, en multiples d'un slot. Sans ce plafond, un grand
   * écran étire le couloir en un pavé vide au lieu d'un corridor lisible.
   */
  laneThicknessPerSlot: 2.6,
  /** Part minimale de l'épaisseur disponible laissée au couloir. */
  laneMinShare: 0.62,
  /** Retrait de l'entrée des ennemis, pour qu'ils apparaissent **dans** le couloir. */
  laneEntryPerSlot: 0.5,
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * Épaisseur du couloir : quelques slots de large, mais jamais au prix d'une bande à
 * moitié vide — sur un écran étroit, mieux vaut un couloir large qu'une marge inutile.
 *
 * @param {number} available Épaisseur disponible une fois les slots placés
 * @param {number} slotSize
 */
function laneThickness(available, slotSize) {
  const wanted = Math.max(slotSize * BATTLE.laneThicknessPerSlot, available * BATTLE.laneMinShare);
  return Math.max(8, Math.min(available, wanted));
}

/**
 * Calcule les rectangles de l'écran pour une taille de canvas donnée.
 *
 * @param {number} width Largeur du canvas
 * @param {number} height Hauteur du canvas
 * @param {object} [options]
 * @param {number} [options.cols]
 * @param {number} [options.rows]
 * @param {number} [options.slotCount] Slots de déploiement (`battle.slotCount`)
 * @param {number} [options.debugRowPx] Hauteur réservée sous l'en-tête au panneau de debug
 *   (0 en jeu normal). Le contenu descend d'autant : les boutons de réglage ne doivent
 *   **jamais** recouvrir une case de la grille, même en mode debug.
 * @returns {{
 *   width: number, height: number, landscape: boolean, pad: number,
 *   header: {x: number, y: number, width: number, height: number},
 *   debugRow: {x: number, y: number, width: number, height: number},
 *   grid: {x: number, y: number, size: number, cell: number, cols: number, rows: number},
 *   battle: {x: number, y: number, width: number, height: number},
 *   battleZone: object,
 *   itemSize: number
 * }}
 */
export function computeLayout(
  width,
  height,
  { cols = GRID_COLS, rows = GRID_ROWS, slotCount = 5, debugRowPx = 0 } = {}
) {
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

  const debugRowHeight = Math.max(0, debugRowPx);
  const debugRowTop = pad + headerHeight + Math.round(gap / 2);
  const contentTop = debugRowTop + debugRowHeight;
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
    debugRow: { x: pad, y: debugRowTop, width: availableWidth, height: debugRowHeight },
    grid: { ...grid, cell, cols, rows },
    battle,
    battleZone: computeBattleZone(battle, { slotCount }),
    itemSize: cell * LAYOUT.itemRatio,
  };
}

/**
 * Découpe la bande de combat en sous-zones.
 *
 * Le couloir suit le **grand côté** de la bande : horizontal quand elle est plus large
 * que haute (cas le plus courant, portrait comme paysage), vertical sinon. Les ennemis
 * entrent au début du couloir, la base ferme l'autre bout.
 *
 * Depuis le Lot 2.5, les slots **ne sont plus un banc de tir** aligné sur le couloir mais
 * la **file de déploiement** : une rangée compacte collée au bout « base » du couloir,
 * le slot 0 (la tête, celle qui part) au plus près de la sortie. La file se lit donc dans
 * le sens de la marche, et l'endroit d'où sortent les unités est exactement l'endroit où
 * elles entrent dans le couloir.
 *
 * @param {{x: number, y: number, width: number, height: number}} battle
 * @param {object} [options]
 * @param {number} [options.slotCount]
 * @returns {{
 *   horizontal: boolean, gap: number, slotSize: number, slotPitch: number, unitSize: number,
 *   fieldUnitSize: number, laneThickness: number, laneLengthPx: number,
 *   hud: object, lane: object, base: object, travel: object,
 *   slots: {x: number, y: number, size: number}[]
 * }}
 */
export function computeBattleZone(battle, { slotCount = 5 } = {}) {
  const { x, y, width: w, height: h } = battle;
  const horizontal = w >= h;
  const gap = clamp(Math.round(Math.min(w, h) * BATTLE.gapRatio), BATTLE.minGap, BATTLE.maxGap);
  const hudHeight = clamp(Math.round(h * BATTLE.hudRatio), BATTLE.minHud, BATTLE.maxHud);

  const hud = { x, y, width: w, height: Math.min(hudHeight, h) };
  const contentTop = hud.y + hud.height + gap;
  const contentHeight = Math.max(1, h - hud.height - gap * 2);

  let lane;
  let base;
  let travel;
  let slotSize;

  if (horizontal) {
    const baseWidth = clamp(Math.round(w * BATTLE.baseRatio), BATTLE.minBase, BATTLE.maxBase);
    const laneWidth = Math.max(1, w - baseWidth);
    slotSize = clamp(
      Math.min((laneWidth / slotCount) * 0.92, contentHeight * BATTLE.slotShare),
      BATTLE.minSlot,
      BATTLE.maxSlot
    );
    const laneHeight = laneThickness(contentHeight - slotSize - gap, slotSize);
    // Couloir + rangée de slots forment un bloc, centré dans la place disponible : sur
    // un grand écran, le couloir ne s'étire pas en pavé vide.
    const groupTop = contentTop + Math.max(0, (contentHeight - laneHeight - gap - slotSize) / 2);

    lane = { x, y: groupTop, width: laneWidth, height: laneHeight };
    base = { x: x + laneWidth, y: groupTop, width: baseWidth, height: laneHeight };

    const entry = Math.min(slotSize * BATTLE.laneEntryPerSlot, laneWidth * 0.06);
    const midY = lane.y + lane.height / 2;
    travel = {
      from: { x: lane.x + entry, y: midY },
      to: { x: lane.x + lane.width, y: midY },
      slotY: lane.y + lane.height + gap + slotSize / 2,
    };
  } else {
    const baseHeight = clamp(Math.round(h * BATTLE.baseRatio), BATTLE.minBase, BATTLE.maxBase);
    const laneHeight = Math.max(1, contentHeight - baseHeight);
    slotSize = clamp(
      Math.min((laneHeight / slotCount) * 0.92, w * 0.3),
      BATTLE.minSlot,
      BATTLE.maxSlot
    );
    const laneWidth = laneThickness(w - slotSize - gap, slotSize);
    const groupLeft = x + Math.max(0, (w - laneWidth - gap - slotSize) / 2);

    lane = { x: groupLeft, y: contentTop, width: laneWidth, height: laneHeight };
    base = { x: groupLeft, y: contentTop + laneHeight, width: laneWidth, height: baseHeight };

    const entry = Math.min(slotSize * BATTLE.laneEntryPerSlot, laneHeight * 0.06);
    const midX = lane.x + lane.width / 2;
    travel = {
      from: { x: midX, y: lane.y + entry },
      to: { x: midX, y: lane.y + lane.height },
      slotX: lane.x + lane.width + gap + slotSize / 2,
    };
  }

  const laneLengthPx = Math.hypot(travel.to.x - travel.from.x, travel.to.y - travel.from.y);
  const fighterReference = Math.min(lane.height, lane.width, laneLengthPx / 8);

  // File de déploiement : une rangée compacte qui remonte depuis le bout « base » du
  // couloir. Le slot 0 est le plus proche de la sortie — la file se lit dans le sens
  // où elle se vide.
  const slotPitch = Math.max(
    slotSize,
    Math.min(slotSize * BATTLE.slotPitchRatio, laneLengthPx / slotCount)
  );
  const slots = Array.from({ length: slotCount }, (_, i) => ({
    x: horizontal ? travel.to.x - (i + 0.5) * slotPitch : travel.slotX,
    y: horizontal ? travel.slotY : travel.to.y - (i + 0.5) * slotPitch,
    size: slotSize,
  }));

  return {
    horizontal,
    gap,
    slotSize,
    /** Écart entre deux centres de slots de déploiement. */
    slotPitch,
    unitSize: slotSize * BATTLE.unitRatio,
    laneThickness: horizontal ? lane.height : lane.width,
    laneLengthPx,
    /**
     * Taille de référence des combattants : bornée par l'épaisseur du couloir **et** par
     * une fraction de sa longueur. La seconde borne est ce qui garde le couloir lisible —
     * sans elle, un couloir épais mais court produit des combattants qui l'occupent
     * entièrement, et on ne voit plus qui avance.
     */
    enemyReference: fighterReference,
    /** Diamètre d'une unité **sur le champ de bataille** (celles des slots font `unitSize`). */
    fieldUnitSize: fighterReference * 0.78,
    hud,
    lane,
    base,
    /**
     * Segment parcouru par les combattants. `from` = entrée des ennemis (progression 0),
     * `to` = face de la base (progression `laneLength`), d'où **sortent les unités**.
     */
    travel,
    slots,
  };
}

/**
 * Point du couloir correspondant à une progression normalisée.
 *
 * @param {object} zone Résultat de `computeBattleZone`
 * @param {number} t Progression dans [0, 1] : 0 = entrée des ennemis, 1 = face de la base
 * @returns {{x: number, y: number}}
 */
export function lanePoint(zone, t) {
  const clamped = clamp(t, 0, 1);
  const { from, to } = zone.travel;
  return {
    x: from.x + (to.x - from.x) * clamped,
    y: from.y + (to.y - from.y) * clamped,
  };
}

/** Centre du slot de déploiement `index`, ou null hors file. */
export function slotCenter(zone, index) {
  const slot = zone.slots[index];
  return slot ? { x: slot.x, y: slot.y } : null;
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
