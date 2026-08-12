import { describe, it, expect } from 'vitest';
import { computeLayout, cellCenter, cellCenterAt, nearestCellIndex } from '../src/systems/layout.js';

/** Écrans représentatifs du parc visé (téléphone en priorité). */
const SCREENS = [
  { name: 'téléphone portrait', width: 390, height: 844 },
  { name: 'téléphone paysage', width: 844, height: 390 },
  { name: 'téléphone étroit', width: 320, height: 568 },
  { name: 'tablette portrait', width: 820, height: 1180 },
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'carré', width: 600, height: 600 },
];

describe('computeLayout', () => {
  for (const screen of SCREENS) {
    describe(screen.name, () => {
      const layout = computeLayout(screen.width, screen.height);

      it('garde la grille carrée et dans l’écran', () => {
        expect(layout.grid.size).toBeGreaterThan(0);
        expect(layout.grid.cell).toBeCloseTo(layout.grid.size / 5);
        expect(layout.grid.x).toBeGreaterThanOrEqual(0);
        expect(layout.grid.y).toBeGreaterThanOrEqual(0);
        expect(layout.grid.x + layout.grid.size).toBeLessThanOrEqual(screen.width + 0.001);
        expect(layout.grid.y + layout.grid.size).toBeLessThanOrEqual(screen.height + 0.001);
      });

      it('réserve une bande de combat non vide, dans l’écran', () => {
        expect(layout.battle.width).toBeGreaterThan(20);
        expect(layout.battle.height).toBeGreaterThan(20);
        expect(layout.battle.x + layout.battle.width).toBeLessThanOrEqual(screen.width + 0.001);
        expect(layout.battle.y + layout.battle.height).toBeLessThanOrEqual(screen.height + 0.001);
      });

      it('ne fait jamais chevaucher la grille et la bande', () => {
        const grid = { x: layout.grid.x, y: layout.grid.y, w: layout.grid.size, h: layout.grid.size };
        const separated =
          grid.x + grid.w <= layout.battle.x + 0.001 ||
          layout.battle.x + layout.battle.width <= grid.x + 0.001 ||
          grid.y + grid.h <= layout.battle.y + 0.001 ||
          layout.battle.y + layout.battle.height <= grid.y + 0.001;
        expect(separated).toBe(true);
      });

      it('laisse le bandeau de debug au-dessus des deux zones', () => {
        const headerBottom = layout.header.y + layout.header.height;
        expect(layout.grid.y).toBeGreaterThanOrEqual(headerBottom);
        expect(layout.battle.y).toBeGreaterThanOrEqual(headerBottom);
      });
    });
  }

  it('met la bande à droite en paysage, en bas en portrait', () => {
    const landscape = computeLayout(844, 390);
    expect(landscape.landscape).toBe(true);
    expect(landscape.battle.x).toBeGreaterThan(landscape.grid.x + landscape.grid.size - 0.001);

    const portrait = computeLayout(390, 844);
    expect(portrait.landscape).toBe(false);
    expect(portrait.battle.y).toBeGreaterThan(portrait.grid.y + portrait.grid.size - 0.001);
  });

  it('survit à une taille dégénérée (canvas pas encore dimensionné)', () => {
    const layout = computeLayout(0, 0);
    expect(layout.grid.size).toBeGreaterThan(0);
    expect(layout.grid.cell).toBeGreaterThan(0);
    expect(Number.isFinite(layout.battle.width)).toBe(true);
  });
});

describe('cellCenter', () => {
  const layout = computeLayout(390, 844);

  it('place les centres de case dans la grille, en row-major', () => {
    const first = cellCenter(layout, 0, 0);
    const last = cellCenter(layout, 4, 4);
    expect(first.x).toBeCloseTo(layout.grid.x + layout.grid.cell / 2);
    expect(last.y).toBeCloseTo(layout.grid.y + layout.grid.size - layout.grid.cell / 2);
    expect(cellCenterAt(layout, 6)).toEqual(cellCenter(layout, 1, 1));
  });
});

describe('nearestCellIndex — tolérance de drop pensée pour le doigt', () => {
  const layout = computeLayout(390, 844);

  it('retrouve la case sous le centre exact', () => {
    for (const index of [0, 7, 12, 24]) {
      const center = cellCenterAt(layout, index);
      expect(nearestCellIndex(layout, center.x, center.y)).toBe(index);
    }
  });

  it('accepte un lâcher approximatif : la case la plus proche gagne', () => {
    const center = cellCenterAt(layout, 12);
    const offset = layout.grid.cell * 0.45;
    expect(nearestCellIndex(layout, center.x + offset, center.y - offset)).toBe(12);
  });

  it('bascule sur la case voisine au-delà de la moitié de case', () => {
    const center = cellCenterAt(layout, 12);
    expect(nearestCellIndex(layout, center.x + layout.grid.cell * 0.6, center.y)).toBe(13);
    expect(nearestCellIndex(layout, center.x, center.y + layout.grid.cell * 0.6)).toBe(17);
  });

  it('pardonne un lâcher juste à côté de la grille', () => {
    const corner = cellCenterAt(layout, 0);
    const nudge = layout.grid.cell * 0.7;
    expect(nearestCellIndex(layout, corner.x - nudge, corner.y - nudge)).toBe(0);
  });

  it('rejette un lâcher franchement hors grille (bande de combat, en-tête)', () => {
    expect(nearestCellIndex(layout, layout.battle.x + 10, layout.battle.y + 40)).toBe(-1);
    expect(nearestCellIndex(layout, layout.header.x, layout.header.y)).toBe(-1);
  });
});

describe('computeLayout — bande de debug', () => {
  it('ne réserve rien en jeu normal', () => {
    const normal = computeLayout(390, 844);
    expect(normal.debugRow.height).toBe(0);
  });

  it('descend le contenu d’autant : les boutons ne recouvrent jamais la grille', () => {
    const normal = computeLayout(390, 844);
    const withDebug = computeLayout(390, 844, { debugRowPx: 30 });

    expect(withDebug.debugRow.height).toBe(30);
    expect(withDebug.grid.y).toBeGreaterThanOrEqual(
      withDebug.debugRow.y + withDebug.debugRow.height
    );
    expect(withDebug.grid.y).toBeGreaterThan(normal.grid.y);
    // L'en-tête, lui, ne bouge pas : le titre reste où le joueur l'a vu.
    expect(withDebug.header).toEqual(normal.header);
  });

  it('la bande se glisse entre l’en-tête et le contenu', () => {
    const layout = computeLayout(844, 390, { debugRowPx: 24 });
    expect(layout.debugRow.y).toBeGreaterThanOrEqual(layout.header.y + layout.header.height);
    expect(layout.debugRow.width).toBe(layout.header.width);
  });
});
