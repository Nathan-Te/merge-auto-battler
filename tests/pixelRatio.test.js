import { describe, it, expect } from 'vitest';
import juice from '../src/config/juice.json';
import { parseJuiceConfig } from '../src/systems/juice.js';
import {
  effectivePixelRatio,
  bufferSize,
  textResolution,
  DEFAULT_MAX_PIXEL_RATIO,
} from '../src/systems/pixelRatio.js';
import { pixelRatioOverride } from '../src/systems/debug.js';

/**
 * Résolution de rendu. La partie qui touche Phaser (`src/render/hiDpi.js`) se vérifie au
 * navigateur ; ce qui est calculable se vérifie ici — c'est le découpage habituel du
 * projet, et c'est ce qui permet de raisonner sur le plafond sans lancer un téléphone.
 */

const CAP = juice.render.maxPixelRatio;

describe('effectivePixelRatio', () => {
  it('rend le ratio de l’écran quand il tient sous le plafond', () => {
    expect(effectivePixelRatio(1, 2)).toBe(1);
    expect(effectivePixelRatio(1.5, 2)).toBe(1.5);
    expect(effectivePixelRatio(2, 2)).toBe(2);
  });

  it('plafonne les écrans très denses — le coût de rendu est quadratique', () => {
    // Un téléphone en 3× demanderait 9 fois plus de pixels qu'en 1× : le gain visuel
    // au-delà de 2 ne vaut pas ce prix (cf. README).
    expect(effectivePixelRatio(3, 2)).toBe(2);
    expect(effectivePixelRatio(4, 2)).toBe(2);
  });

  it('ne descend jamais sous 1, même sur un écran qui annonce n’importe quoi', () => {
    expect(effectivePixelRatio(0.5, 2)).toBe(1);
    expect(effectivePixelRatio(0, 2)).toBe(1);
    expect(effectivePixelRatio(-3, 2)).toBe(1);
    expect(effectivePixelRatio(undefined, 2)).toBe(1);
    expect(effectivePixelRatio(NaN, 2)).toBe(1);
  });

  it('traite un plafond absurde comme « pas de suréchantillonnage »', () => {
    // Mieux vaut un jeu net-mais-pas-plus qu'un jeu qui ne démarre pas.
    expect(effectivePixelRatio(3, 0)).toBe(1);
    expect(effectivePixelRatio(3, NaN)).toBe(1);
    expect(effectivePixelRatio(3, undefined)).toBe(DEFAULT_MAX_PIXEL_RATIO);
  });

  it('n’arrondit pas à l’entier : les écrans en 1,5 gardent leur gain', () => {
    expect(effectivePixelRatio(1.5, 3)).toBe(1.5);
    expect(effectivePixelRatio(2.625, 3)).toBe(2.625);
  });
});

describe('bufferSize', () => {
  it('multiplie la taille logique par le ratio', () => {
    expect(bufferSize(390, 780, 2)).toEqual({ width: 780, height: 1560 });
    expect(bufferSize(390, 780, 1)).toEqual({ width: 390, height: 780 });
  });

  it('rend des entiers : un canvas ne fait pas 585,5 pixels de large', () => {
    const size = bufferSize(390, 781, 1.5);
    expect(Number.isInteger(size.width)).toBe(true);
    expect(Number.isInteger(size.height)).toBe(true);
    expect(size).toEqual({ width: 585, height: 1172 });
  });

  it('ne rend jamais une dimension nulle', () => {
    expect(bufferSize(0, 0, 2)).toEqual({ width: 1, height: 1 });
  });
});

describe('textResolution', () => {
  it('suit le ratio effectif — c’est ce qui rend le texte net', () => {
    expect(textResolution(2)).toBe(2);
    expect(textResolution(1.5)).toBe(1.5);
  });

  it('ne descend pas sous 1', () => {
    expect(textResolution(0.5)).toBe(1);
  });
});

describe('render.maxPixelRatio', () => {
  it('est déclaré dans juice.json et vaut 2 par défaut', () => {
    expect(CAP).toBe(2);
  });

  it('est obligatoire : une valeur oubliée doit crier au chargement', () => {
    const without = { ...juice, render: {} };
    expect(() => parseJuiceConfig(without)).toThrow(/maxPixelRatio/);
  });
});

describe('?dpr=N — surcharge de mesure', () => {
  it('lit un plafond forcé dans l’URL', () => {
    expect(pixelRatioOverride('?dpr=1')).toBe(1);
    expect(pixelRatioOverride('?dpr=3')).toBe(3);
    expect(pixelRatioOverride('?debug=1&dpr=1.5')).toBe(1.5);
  });

  it('rend null quand il n’y en a pas — c’est `juice.json` qui décide alors', () => {
    expect(pixelRatioOverride('')).toBeNull();
    expect(pixelRatioOverride('?debug=1')).toBeNull();
  });

  it('ignore une valeur qui n’a pas de sens plutôt que de casser le rendu', () => {
    expect(pixelRatioOverride('?dpr=0')).toBeNull();
    expect(pixelRatioOverride('?dpr=abc')).toBeNull();
    expect(pixelRatioOverride('?dpr=-2')).toBeNull();
  });
});
