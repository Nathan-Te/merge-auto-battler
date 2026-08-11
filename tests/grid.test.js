import { describe, it, expect } from 'vitest';
import { gridIndex, gridCoords, areAdjacent, GRID_COLS } from '../src/systems/grid.js';

describe('gridIndex', () => {
  it('mappe le coin haut-gauche sur 0', () => {
    expect(gridIndex(0, 0)).toBe(0);
  });

  it('parcourt la grille en row-major', () => {
    expect(gridIndex(1, 0)).toBe(1);
    expect(gridIndex(0, 1)).toBe(GRID_COLS);
    expect(gridIndex(4, 4)).toBe(24);
  });

  it('respecte une largeur de grille personnalisée', () => {
    expect(gridIndex(2, 3, 4)).toBe(14);
  });

  it('renvoie -1 hors grille ou sur des coordonnées non entières', () => {
    expect(gridIndex(-1, 0)).toBe(-1);
    expect(gridIndex(0, -1)).toBe(-1);
    expect(gridIndex(GRID_COLS, 0)).toBe(-1);
    expect(gridIndex(1.5, 0)).toBe(-1);
  });
});

describe('gridCoords', () => {
  it('est l’inverse de gridIndex sur toute la grille', () => {
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < GRID_COLS; x += 1) {
        expect(gridCoords(gridIndex(x, y))).toEqual({ x, y });
      }
    }
  });

  it('renvoie null sur un index invalide', () => {
    expect(gridCoords(-1)).toBeNull();
    expect(gridCoords(2.5)).toBeNull();
  });
});

describe('areAdjacent', () => {
  it('reconnaît les voisins orthogonaux', () => {
    expect(areAdjacent(2, 2, 2, 3)).toBe(true);
    expect(areAdjacent(2, 2, 1, 2)).toBe(true);
  });

  it('exclut la diagonale et la case elle-même', () => {
    expect(areAdjacent(2, 2, 3, 3)).toBe(false);
    expect(areAdjacent(2, 2, 2, 2)).toBe(false);
  });
});
