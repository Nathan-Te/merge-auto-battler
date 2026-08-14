import { describe, expect, it } from 'vitest';

import { CATEGORIES, DEFAULTS, parseManifest } from '../src/tools/assets/manifest.js';

/**
 * Le manifest est corrigé **depuis un téléphone, dans l'éditeur web de GitHub**, par
 * quelqu'un qui ne lira pas le pipeline. Ces tests portent donc autant sur la qualité des
 * messages d'erreur que sur la validation elle-même : une erreur qui ne dit pas quoi écrire
 * à la place fait perdre un aller-retour de CI.
 */

const sheet = (overrides = {}) => ({
  file: 'orbes.png',
  category: 'orbs',
  cols: 2,
  rows: 1,
  names: ['orb.1', 'orb.2'],
  ...overrides,
});

describe('parseManifest', () => {
  it('accepte un manifest vide et rend des valeurs par défaut complètes', () => {
    const config = parseManifest({});
    expect(config.sheets).toEqual([]);
    expect(config.atlas).toEqual(DEFAULTS.atlas);
    expect(config.keying).toEqual(DEFAULTS.keying);
    expect(config.tierBands.unit).toEqual([
      [1, 4],
      [5, 8],
      [9, 11],
    ]);
  });

  it('complète une planche minimale : quatre clés suffisent', () => {
    const [parsed] = parseManifest({ sheets: [sheet()] }).sheets;
    expect(parsed.margin).toBe(0);
    expect(parsed.spacing).toBe(0);
    expect(parsed.trim).toBe(true);
    expect(parsed.size).toBe(DEFAULTS.sizes.orbs);
    expect(parsed.keying).toEqual(DEFAULTS.keying);
    expect(parsed.crop).toBeNull();
  });

  it('lit un recadrage de source en pixels du fichier déposé', () => {
    const [parsed] = parseManifest({
      sheets: [sheet({ crop: { x: 245, y: 8, width: 64, height: 64 } })],
    }).sheets;
    expect(parsed.crop).toEqual({ x: 245, y: 8, width: 64, height: 64 });
  });

  it('accepte un recadrage sans origine — le coin haut-gauche est le défaut', () => {
    const [parsed] = parseManifest({ sheets: [sheet({ crop: { width: 32, height: 32 } })] }).sheets;
    expect(parsed.crop).toEqual({ x: 0, y: 0, width: 32, height: 32 });
  });

  it('refuse un recadrage sans dimensions, en disant quoi écrire', () => {
    expect(() => parseManifest({ sheets: [sheet({ crop: { x: 4, y: 4 } })] })).toThrow(
      /crop\.width doit être un entier/
    );
    expect(() => parseManifest({ sheets: [sheet({ crop: [0, 0, 16, 16] })] })).toThrow(
      /"x".*"y".*"width".*"height"/s
    );
  });

  it('range chaque case en ligne puis colonne, dans l’ordre de lecture', () => {
    const [parsed] = parseManifest({
      sheets: [sheet({ cols: 2, rows: 2, names: ['a', 'b', 'c', 'd'] })],
    }).sheets;
    expect(parsed.cells).toEqual([
      { name: 'a', col: 0, row: 0 },
      { name: 'b', col: 1, row: 0 },
      { name: 'c', col: 0, row: 1 },
      { name: 'd', col: 1, row: 1 },
    ]);
  });

  it('ignore une case marquée null, "-" ou vide sans la compter comme un sprite', () => {
    const [parsed] = parseManifest({
      sheets: [sheet({ cols: 4, rows: 1, names: ['orb.1', null, '-', '  '] })],
    }).sheets;
    expect(parsed.cells.map((cell) => cell.name)).toEqual(['orb.1', null, null, null]);
  });

  it('hérite du détourage global et le laisse déroger planche par planche', () => {
    const config = parseManifest({
      keying: { tolerance: 40 },
      sheets: [sheet(), sheet({ file: 'b.png', names: ['orb.3', null], keying: { softness: 2 } })],
    });
    expect(config.sheets[0].keying).toEqual({ ...DEFAULTS.keying, tolerance: 40 });
    // La planche hérite du global (tolerance 40) et n'écrase que ce qu'elle nomme.
    expect(config.sheets[1].keying).toEqual({ ...DEFAULTS.keying, tolerance: 40, softness: 2 });
  });

  describe('refus, avec un message qui dit quoi corriger', () => {
    it('compte les cases quand names ne correspond pas à cols × rows', () => {
      expect(() =>
        parseManifest({ sheets: [sheet({ cols: 4, rows: 3, names: ['a', 'b'] })] })
      ).toThrow(/4×3 = 12 cases découpées mais 2 noms donnés/);
    });

    it('nomme les deux planches quand un nom de sprite est en double', () => {
      expect(() =>
        parseManifest({
          sheets: [sheet(), sheet({ file: 'autre.png', names: ['orb.1', null] })],
        })
      ).toThrow(/« orb.1 » est utilisé deux fois.*orbes\.png.*autre\.png/s);
    });

    it('liste les catégories possibles quand celle donnée est inconnue', () => {
      expect(() => parseManifest({ sheets: [sheet({ category: 'orb' })] })).toThrow(
        new RegExp(CATEGORIES.join(', '))
      );
    });

    it('cite la planche par son nom de fichier, pas par son rang seul', () => {
      expect(() => parseManifest({ sheets: [sheet({ cols: 0 })] })).toThrow(/« orbes\.png »/);
    });

    it('refuse un budget dont la limite dure est sous la cible', () => {
      expect(() => parseManifest({ budgetKb: { target: 20480, max: 10240 } })).toThrow(
        /budgetKb\.max .* doit être ≥ budgetKb\.target/
      );
    });

    it('refuse une plage de tiers inversée', () => {
      expect(() => parseManifest({ tierBands: { unit: [[8, 3]] } })).toThrow(
        /max \(3\) est plus petit que min \(8\)/
      );
    });

    it('refuse une planche décrite sans fichier', () => {
      expect(() => parseManifest({ sheets: [{ category: 'orbs', cols: 1, rows: 1 }] })).toThrow(
        /file manquant/
      );
    });
  });
});
