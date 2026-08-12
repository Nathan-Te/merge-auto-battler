import { describe, expect, it } from 'vitest';

import { fitSize, keyOutBackground, sliceRects, trimBounds } from '../src/tools/assets/imageOps.js';
import { nextPowerOfTwo, packFrames, toAtlasJson } from '../src/tools/assets/pack.js';
import { formatBytes, renderGallery } from '../src/tools/assets/gallery.js';

/** Petite image RGBA remplie d'une couleur unie, pour écrire des cas à la main. */
function image(width, height, [r, g, b, a] = [255, 255, 255, 255]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return data;
}

function setPixel(data, width, x, y, [r, g, b, a = 255]) {
  const offset = (y * width + x) * 4;
  data[offset] = r;
  data[offset + 1] = g;
  data[offset + 2] = b;
  data[offset + 3] = a;
}

const alphaAt = (data, width, x, y) => data[(y * width + x) * 4 + 3];

const WHITE_KEY = { color: [255, 255, 255], tolerance: 24, softness: 16 };

describe('sliceRects', () => {
  it('couvre toute la planche quand la division tombe juste', () => {
    const rects = sliceRects({ width: 400, height: 200, cols: 4, rows: 2 });
    expect(rects).toHaveLength(8);
    expect(rects[0]).toMatchObject({ x: 0, y: 0, width: 100, height: 100 });
    expect(rects[7]).toMatchObject({ x: 300, y: 100, width: 100, height: 100 });
  });

  it('couvre toute la largeur même quand elle ne se divise pas — pas de bande orpheline', () => {
    // 1000 / 3 : une division entière laisserait une colonne d'un pixel à droite, donc une
    // tranche du sprite voisin dans le dernier découpage.
    const rects = sliceRects({ width: 1000, height: 100, cols: 3, rows: 1 });
    const last = rects[2];
    expect(last.x + last.width).toBe(1000);
    expect(rects[0].x).toBe(0);
    // Deux cases voisines se touchent sans se recouvrir.
    expect(rects[1].x).toBe(rects[0].x + rects[0].width);
  });

  it('tient compte de la marge et de la gouttière', () => {
    // 220 px − 2×10 de marge − 20 de gouttière = 180 utiles, soit deux cases de 90.
    const rects = sliceRects({ width: 220, height: 110, cols: 2, rows: 1, margin: 10, spacing: 20 });
    expect(rects[0]).toMatchObject({ x: 10, width: 90 });
    expect(rects[1]).toMatchObject({ x: 120, width: 90 });
    // La dernière case s'arrête pile sur la marge de droite.
    expect(rects[1].x + rects[1].width).toBe(220 - 10);
  });

  it('refuse une découpe qui ne laisse pas de place', () => {
    expect(() => sliceRects({ width: 10, height: 10, cols: 4, rows: 1, margin: 6 })).toThrow(
      /découpe impossible/
    );
  });
});

describe('keyOutBackground', () => {
  it('rend le fond transparent et laisse le sujet intact', () => {
    const data = image(5, 5);
    setPixel(data, 5, 2, 2, [200, 30, 30]);

    keyOutBackground(data, { width: 5, height: 5 }, WHITE_KEY);

    expect(alphaAt(data, 5, 0, 0)).toBe(0);
    expect(alphaAt(data, 5, 2, 2)).toBe(255);
  });

  it('**préserve un blanc enfermé dans le dessin** — un seuil global le troue', () => {
    // Anneau rouge de 5×5 avec un pixel blanc au centre : l'éclat d'une armure, le blanc
    // d'un œil. C'est le cas qui condamne un simple seuil sur la couleur.
    const data = image(5, 5);
    for (let y = 1; y <= 3; y += 1) {
      for (let x = 1; x <= 3; x += 1) {
        if (x === 2 && y === 2) continue;
        setPixel(data, 5, x, y, [180, 40, 40]);
      }
    }

    keyOutBackground(data, { width: 5, height: 5 }, WHITE_KEY);

    expect(alphaAt(data, 5, 2, 2)).toBe(255);
    expect(alphaAt(data, 5, 0, 0)).toBe(0);
  });

  it('adoucit le bord : un pixel à mi-chemin reçoit une opacité intermédiaire', () => {
    const data = image(5, 1);
    // Gris clair : au-delà de la tolérance, mais dans la zone d'adoucissement.
    setPixel(data, 5, 2, 0, [255 - 32, 255 - 32, 255 - 32]);

    keyOutBackground(data, { width: 5, height: 1 }, WHITE_KEY);

    const alpha = alphaAt(data, 5, 2, 0);
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(255);
  });

  it('compte les pixels effacés', () => {
    const data = image(4, 4);
    setPixel(data, 4, 1, 1, [10, 10, 10]);
    const cleared = keyOutBackground(data, { width: 4, height: 4 }, WHITE_KEY);
    expect(cleared).toBe(15);
  });
});

describe('trimBounds', () => {
  it('rend la boîte des pixels visibles', () => {
    const data = image(6, 6, [0, 0, 0, 0]);
    setPixel(data, 6, 2, 3, [255, 0, 0, 255]);
    setPixel(data, 6, 4, 4, [255, 0, 0, 255]);
    expect(trimBounds(data, { width: 6, height: 6 })).toEqual({ x: 2, y: 3, width: 3, height: 2 });
  });

  it('rend null quand tout est transparent — la case était vide', () => {
    expect(trimBounds(image(4, 4, [0, 0, 0, 0]), { width: 4, height: 4 })).toBeNull();
  });
});

describe('fitSize', () => {
  it('ramène le plus grand côté à la cible en gardant le rapport', () => {
    expect(fitSize({ width: 400, height: 200 }, 100)).toEqual({ width: 100, height: 50 });
  });

  it("n'agrandit jamais : une planche basse définition ne gagne rien à être étirée", () => {
    expect(fitSize({ width: 40, height: 20 }, 100)).toEqual({ width: 40, height: 20 });
  });
});

describe('packFrames', () => {
  const items = (count, size = 60) =>
    Array.from({ length: count }, (_, index) => ({
      name: `s${String(index).padStart(2, '0')}`,
      width: size,
      height: size,
    }));

  it('range tous les sprites sans en perdre', () => {
    const packed = packFrames(items(9), { maxSize: 1024 });
    expect(packed.frames).toHaveLength(9);
    expect(new Set(packed.frames.map((frame) => frame.name)).size).toBe(9);
  });

  it('ne fait jamais se chevaucher deux sprites', () => {
    const packed = packFrames(items(17, 50), { maxSize: 1024, padding: 2 });
    for (let i = 0; i < packed.frames.length; i += 1) {
      for (let j = i + 1; j < packed.frames.length; j += 1) {
        const a = packed.frames[i];
        const b = packed.frames[j];
        const disjoint =
          a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
        expect(disjoint).toBe(true);
      }
    }
  });

  it('garde tout le monde dans les bornes de l’atlas', () => {
    const packed = packFrames(items(20, 70), { maxSize: 1024, padding: 2 });
    for (const frame of packed.frames) {
      expect(frame.x + frame.width).toBeLessThanOrEqual(packed.width);
      expect(frame.y + frame.height).toBeLessThanOrEqual(packed.height);
    }
  });

  it('choisit la disposition la moins large en pixels, pas la première qui tient', () => {
    // Huit carrés de 124 px : une colonne donnerait 128×1024, quatre colonnes 512×256 —
    // quatre fois moins de pixels à encoder, donc à télécharger.
    const packed = packFrames(items(8, 124), { maxSize: 2048, padding: 2 });
    expect(packed.width * packed.height).toBeLessThanOrEqual(256 * 512);
  });

  it('est déterministe : même entrée, même sortie, quel que soit l’ordre reçu', () => {
    const list = items(12, 40);
    const a = packFrames(list, { maxSize: 512 });
    const b = packFrames([...list].reverse(), { maxSize: 512 });
    expect(b.frames).toEqual(a.frames);
    expect(b.width).toBe(a.width);
  });

  it('nomme le sprite fautif quand il ne peut pas entrer', () => {
    expect(() => packFrames([{ name: 'decor.field', width: 900, height: 40 }], { maxSize: 512 })).toThrow(
      /« decor\.field » fait 900×40/
    );
  });

  it('accepte une liste vide', () => {
    expect(packFrames([], { maxSize: 512 }).frames).toEqual([]);
  });
});

describe('nextPowerOfTwo', () => {
  it('arrondit vers le haut, et laisse les puissances de deux en place', () => {
    expect(nextPowerOfTwo(1)).toBe(1);
    expect(nextPowerOfTwo(129)).toBe(256);
    expect(nextPowerOfTwo(256)).toBe(256);
  });
});

describe('toAtlasJson', () => {
  it('produit le format que Phaser lit sans conversion', () => {
    const json = toAtlasJson({
      image: 'atlas-orbs.webp',
      width: 256,
      height: 128,
      frames: [{ name: 'orb.1', x: 2, y: 4, width: 60, height: 60 }],
    });

    expect(json.meta.image).toBe('atlas-orbs.webp');
    expect(json.meta.size).toEqual({ w: 256, h: 128 });
    expect(json.frames['orb.1'].frame).toEqual({ x: 2, y: 4, w: 60, h: 60 });
    // Les sprites sont rognés avant packing : du point de vue du jeu, le sprite *est* son
    // contenu visible, donc il n'y a rien à recentrer.
    expect(json.frames['orb.1'].trimmed).toBe(false);
    expect(json.frames['orb.1'].sourceSize).toEqual({ w: 60, h: 60 });
  });

  it('rappelle dans le fichier lui-même qu’il est généré', () => {
    const json = toAtlasJson({ image: 'a.webp', width: 8, height: 8, frames: [] });
    expect(json.meta.note).toMatch(/généré/i);
  });
});

describe('galerie', () => {
  const model = {
    generatedAt: '2026-08-12',
    atlases: [{ name: 'orbs', bytes: 4400, width: 256, height: 256 }],
    groups: [
      {
        category: 'orbs',
        sprites: [
          { name: 'orb.1', atlas: '../assets/atlas-orbs.webp', x: 2, y: 2, width: 60, height: 60, bytes: 500 },
        ],
      },
    ],
    extras: [],
    totalBytes: 4400,
    budgetKb: { target: 10240, max: 20480 },
    missing: [],
    orphans: [],
  };

  it('affiche le budget et son verdict en tête de page', () => {
    const html = renderGallery(model);
    expect(html).toContain('sous la cible');
    expect(html).toContain('pill ok');
  });

  it('alerte quand le poids dépasse la limite dure', () => {
    const html = renderGallery({ ...model, totalBytes: 30 * 1024 * 1024 });
    expect(html).toContain('pill bad');
    expect(html).toContain('au-dessus de la limite dure');
  });

  it('découpe la vignette dans l’atlas plutôt que de réexporter le sprite', () => {
    const html = renderGallery(model);
    expect(html).toContain('background-position:-2px -2px');
    expect(html).toContain('url(../assets/atlas-orbs.webp)');
  });

  it('annonce les sprites manquants et les orphelins', () => {
    const html = renderGallery({ ...model, missing: ['unit.aoe.1'], orphans: ['typo.oops'] });
    expect(html).toContain('unit.aoe.1');
    expect(html).toContain('typo.oops');
  });

  it('dit quoi faire quand aucune planche n’a encore été déposée', () => {
    const html = renderGallery({ ...model, groups: [{ category: 'orbs', sprites: [] }] });
    expect(html).toContain('assets-src/');
  });

  it('échappe ce qui vient du manifest — un nom de sprite n’est jamais sûr', () => {
    const html = renderGallery({
      ...model,
      orphans: ['<script>alert(1)</script>'],
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('formatBytes', () => {
  it('choisit une unité lisible', () => {
    expect(formatBytes(512)).toBe('512 o');
    expect(formatBytes(2048)).toBe('2.0 Ko');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.00 Mo');
  });
});
