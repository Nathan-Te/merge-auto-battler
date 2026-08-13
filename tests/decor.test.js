import { describe, expect, it } from 'vitest';

import { DecorPiece, createDecor } from '../src/render/decor.js';
import { DECOR_MODE, DECOR_SPRITES, expectedSpriteNames } from '../src/render/skinNames.js';
import { Skin, atlasKey } from '../src/render/skin.js';
import { parseManifest } from '../src/tools/assets/manifest.js';
import balance from '../src/config/balance.json';

/**
 * **Le décor**, des deux côtés : ce que le manifest accepte de décrire, et ce que le rendu en
 * fait. Deux règles y sont vérifiées plus que les autres, parce que ce sont les deux qui ne se
 * rattrapent pas à l'œil : un fond se **répète** à un facteur entier au lieu d'être étiré, et
 * un objet ne **déborde jamais** de la boîte qu'on lui offre.
 */

/** Objets d'affichage minimaux : ils enregistrent ce qu'on leur demande, rien de plus. */
function fakeTileSprite() {
  return {
    active: true,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    tileScaleX: 1,
    depth: 0,
    setOrigin() {
      return this;
    },
    setDepth(depth) {
      this.depth = depth;
      return this;
    },
    setPosition(x, y) {
      this.x = x;
      this.y = y;
      return this;
    },
    setSize(width, height) {
      this.width = width;
      this.height = height;
      return this;
    },
    setTileScale(scale) {
      this.tileScaleX = scale;
      return this;
    },
    destroy() {
      this.active = false;
    },
  };
}

function fakeImage(frame = { width: 32, height: 32 }) {
  return {
    active: true,
    x: 0,
    y: 0,
    frame,
    scaleX: 1,
    depth: 0,
    setOrigin() {
      return this;
    },
    setDepth(depth) {
      this.depth = depth;
      return this;
    },
    setScale(scale) {
      this.scaleX = scale;
      this.scaleY = scale;
      return this;
    },
    setPosition(x, y) {
      this.x = x;
      this.y = y;
      return this;
    },
    destroy() {
      this.active = false;
    },
  };
}

const INDEX = {
  frames: { 'decor.field': 'decor', 'decor.castle': 'decor' },
  pixel: { nativeSize: 16 },
};

function fakeScene(available = {}) {
  const textures = new Map(
    Object.entries(available).map(([key, names]) => [key, new Set(names)])
  );
  return {
    textures: {
      exists: (key) => textures.has(key),
      get: (key) => ({ has: (name) => textures.get(key)?.has(name) ?? false }),
    },
    add: {
      tileSprite: () => fakeTileSprite(),
      image: () => fakeImage(),
    },
  };
}

const scene = fakeScene({ [atlasKey('decor')]: ['decor.field', 'decor.castle'] });
const skin = new Skin(scene, INDEX);

describe('emplacements de décor', () => {
  it('sont tous attendus par la galerie, et connaissent tous leur mode', () => {
    const expected = expectedSpriteNames({ balance });
    for (const name of DECOR_SPRITES) {
      expect(expected.has(name)).toBe(true);
      expect(['tile', 'fit']).toContain(DECOR_MODE[name]);
    }
  });

  it('tuile les matières et pose les objets', () => {
    // Ce n'est pas un réglage : un ciel, un plateau et un sol couvrent une surface dont
    // personne ne connaît la taille ; un château et un portail sont des objets.
    expect(DECOR_MODE['decor.sky']).toBe('tile');
    expect(DECOR_MODE['decor.table']).toBe('tile');
    expect(DECOR_MODE['decor.field']).toBe('tile');
    expect(DECOR_MODE['decor.castle']).toBe('fit');
    expect(DECOR_MODE['decor.portal']).toBe('fit');
  });
});

describe('createDecor', () => {
  it('rend null tant que la planche n’est pas livrée — le rectangle de repli suffit', () => {
    expect(createDecor(scene, skin, 'decor.sky', 1)).toBeNull();
    expect(createDecor(scene, null, 'decor.field', 1)).toBeNull();
  });

  it('pose la pièce à la profondeur demandée', () => {
    const piece = createDecor(scene, skin, 'decor.field', 1.1);
    expect(piece).toBeInstanceOf(DecorPiece);
    expect(piece.object.depth).toBe(1.1);
  });
});

describe('DecorPiece — mode tile', () => {
  it('couvre exactement son rectangle, sans jamais étirer le dessin', () => {
    // C'est tout l'intérêt du mode : la **répétition** absorbe une taille quelconque, donc
    // le facteur d'échelle reste entier — ce qu'un étirement ne peut pas offrir.
    const piece = createDecor(scene, skin, 'decor.field', 1);
    piece.resize({ x: 12, y: 34, width: 517, height: 293 }, 3);
    expect(piece.object.x).toBe(12);
    expect(piece.object.y).toBe(34);
    expect(piece.object.width).toBe(517);
    expect(piece.object.height).toBe(293);
    expect(piece.scale).toBe(3);
  });

  it('garde un facteur entier ≥ 1, même sur une trame dégénérée', () => {
    const piece = createDecor(scene, skin, 'decor.field', 1);
    piece.resize({ x: 0, y: 0, width: 100, height: 100 }, 0);
    expect(piece.scale).toBe(1);
    piece.resize({ x: 0, y: 0, width: 100, height: 100 }, 2.6);
    expect(Number.isInteger(piece.scale)).toBe(true);
  });
});

describe('DecorPiece — mode fit', () => {
  it('se centre dans sa boîte et n’en déborde jamais', () => {
    // Le défaut qu'on corrige : un château centré sur l'extrémité du couloir débordait de
    // moitié, sur la jauge de PV d'un côté et hors du panneau de l'autre.
    const piece = createDecor(scene, skin, 'decor.castle', 1);
    const box = { x: 100, y: 200, width: 80, height: 80 };
    piece.resize(box, 3);
    expect(piece.object.x).toBe(140);
    expect(piece.object.y).toBe(240);
    expect(piece.scale * 32).toBeLessThanOrEqual(80);
  });

  it('se cale sur le petit côté de la boîte, quelle que soit sa forme', () => {
    const piece = createDecor(scene, skin, 'decor.castle', 1);
    piece.resize({ x: 0, y: 0, width: 400, height: 70 }, 3);
    // 32 px d'art dans 70 → ×2 (×3 déborderait de la hauteur).
    expect(piece.scale).toBe(2);
  });

  it('reste à un multiple entier de sa taille native', () => {
    const piece = createDecor(scene, skin, 'decor.castle', 1);
    for (const side of [33, 64, 95, 128, 200]) {
      piece.resize({ x: 0, y: 0, width: side, height: side }, 3);
      expect(Number.isInteger(piece.scale)).toBe(true);
      expect(piece.scale * 32).toBeLessThanOrEqual(Math.max(32, side));
    }
  });

  it('ne touche à rien une fois détruite', () => {
    const piece = createDecor(scene, skin, 'decor.castle', 1);
    piece.destroy();
    expect(() => piece.resize({ x: 0, y: 0, width: 10, height: 10 }, 1)).not.toThrow();
  });
});

describe('manifest — « un fichier = un sprite »', () => {
  const decorSheet = (overrides = {}) => ({
    file: 'sol.png',
    category: 'decor',
    ...overrides,
  });

  it('remplace cols, rows et names d’un coup', () => {
    const [parsed] = parseManifest({
      sheets: [decorSheet({ sprite: 'decor.field' })],
    }).sheets;
    expect(parsed.cols).toBe(1);
    expect(parsed.rows).toBe(1);
    expect(parsed.cells).toEqual([{ name: 'decor.field', col: 0, row: 0 }]);
  });

  it('refuse le mélange avec une grille, en disant laquelle des deux écritures garder', () => {
    for (const key of ['cols', 'rows', 'names']) {
      expect(() =>
        parseManifest({ sheets: [decorSheet({ sprite: 'decor.field', [key]: 2 })] })
      ).toThrow(new RegExp(`sprite et ${key}`));
    }
  });

  it('refuse un nom vide ou marqué comme case à ignorer', () => {
    expect(() => parseManifest({ sheets: [decorSheet({ sprite: '-' })] })).toThrow(/sprite/);
    expect(() => parseManifest({ sheets: [decorSheet({ sprite: 42 })] })).toThrow(/sprite/);
  });

  it('ne rogne pas un décor par défaut — un rognage casse une taille en puissance de deux', () => {
    const [decor] = parseManifest({ sheets: [decorSheet({ sprite: 'decor.field' })] }).sheets;
    expect(decor.trim).toBe(false);
    // Le défaut ne change que pour le décor : tout le reste continue de se rogner.
    const [orbs] = parseManifest({
      sheets: [{ file: 'o.png', category: 'orbs', sprite: 'orb.1' }],
    }).sheets;
    expect(orbs.trim).toBe(true);
    // Et il reste surchargeable, pour une planche qui aurait besoin du contraire.
    const [forced] = parseManifest({
      sheets: [decorSheet({ sprite: 'decor.field', trim: true })],
    }).sheets;
    expect(forced.trim).toBe(true);
  });
});
