/**
 * Utilitaires de grille partagés (la grille de merge du Lot 1 s'appuiera dessus).
 *
 * Convention : la grille est stockée à plat, en row-major.
 * L'index 0 est la case (0, 0) = coin haut-gauche ; x = colonne, y = ligne.
 */

/** Taille de la grille de merge (5x5, cf. docs/seed.md). */
export const GRID_COLS = 5;
export const GRID_ROWS = 5;

/**
 * Convertit des coordonnées de case en index à plat.
 *
 * @param {number} x Colonne (0 -> cols-1)
 * @param {number} y Ligne (0 -> rows-1)
 * @param {number} [cols=GRID_COLS] Nombre de colonnes
 * @returns {number} Index dans le tableau à plat, ou -1 si hors grille
 */
export function gridIndex(x, y, cols = GRID_COLS) {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return -1;
  if (x < 0 || y < 0 || x >= cols) return -1;
  return y * cols + x;
}

/**
 * Opération inverse de gridIndex.
 *
 * @param {number} index Index dans le tableau à plat
 * @param {number} [cols=GRID_COLS] Nombre de colonnes
 * @returns {{x: number, y: number}|null} Coordonnées de case, ou null si index invalide
 */
export function gridCoords(index, cols = GRID_COLS) {
  if (!Number.isInteger(index) || index < 0) return null;
  return { x: index % cols, y: Math.floor(index / cols) };
}

/**
 * Vrai si deux cases sont adjacentes orthogonalement (pas en diagonale).
 *
 * Le merge de la grille n'impose **pas** l'adjacence (on traîne un item sur
 * n'importe quel autre item identique) ; ce prédicat sert au voisinage — la fusion
 * de deux unités adjacentes sur la bande de combat au Lot 2.
 *
 * @returns {boolean}
 */
export function areAdjacent(ax, ay, bx, by) {
  return Math.abs(ax - bx) + Math.abs(ay - by) === 1;
}
