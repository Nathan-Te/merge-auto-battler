import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ALPHA_THRESHOLD,
  colorDistance,
  detectPixelScale,
  downscaleArea,
  fitNativeSize,
  offPaletteColors,
  pixelize,
  quantizeToPalette,
  resampleNearest,
  thresholdAlpha,
} from '../src/tools/assets/pixelOps.js';
import { extractPalette, parsePalette, renderPalette, toHex } from '../src/tools/assets/palette.js';
import { parseManifest } from '../src/tools/assets/manifest.js';
import {
  DEFAULT_NATIVE_SIZE,
  artPixelSize,
  integerScale,
  snapToArtGrid,
  snapToArtPixels,
  spriteFit,
} from '../src/systems/pixelScale.js';
import { pixelFontSize } from '../src/render/fonts.js';

/**
 * **La direction artistique pixel art, vérifiée là où elle se décide.**
 *
 * Elle tient sur deux règles d'or — une seule résolution native, une seule palette — et sur
 * une conséquence de rendu : la mise à l'échelle entière. Les trois sont de l'arithmétique
 * pure, donc les trois se testent ici, sans planche, sans `sharp` et sans canvas. C'est le
 * découpage habituel du projet : ce qui peut être décidé sans Phaser l'est dans un module
 * pur, et c'est ce module-là qu'on verrouille.
 */

/** Fabrique une image RGBA à partir d'une grille de couleurs `[r, g, b, a]`. */
function image(rows) {
  const height = rows.length;
  const width = rows[0].length;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data.set(rows[y][x], (y * width + x) * 4);
    }
  }
  return { data, width, height };
}

/** Agrandit une grille d'un facteur entier, comme un pack livré en ×N. */
function upscale({ data, width, height }, factor) {
  return { data: resampleNearest(data, { width, height }, {
    width: width * factor,
    height: height * factor,
  }), width: width * factor, height: height * factor };
}

const R = [255, 0, 0, 255];
const G = [0, 255, 0, 255];
const B = [0, 0, 255, 255];
const _ = [0, 0, 0, 0];

describe('detectPixelScale — retrouver la grille d’un pack', () => {
  it('mesure le facteur d’agrandissement d’une planche déjà pixelisée', () => {
    const source = image([
      [R, G],
      [B, R],
    ]);
    expect(detectPixelScale(upscale(source, 4).data, { width: 8, height: 8 })).toBe(4);
    expect(detectPixelScale(upscale(source, 3).data, { width: 6, height: 6 })).toBe(3);
  });

  /**
   * C'est **le** service rendu : les deux planches de référence du projet s'appellent
   * « Basic Holy 3x » et « Basic Undead 4x » et sont toutes les deux en ×4. Le nom du fichier
   * ment, les pixels non — donc on ne demande rien à personne, on mesure.
   */
  it('ne croit pas le nom du fichier, seulement les pixels', () => {
    const source = image([[R, G, B]]);
    const asFour = upscale(source, 4);
    expect(detectPixelScale(asFour.data, asFour)).toBe(4);
  });

  it('rend 1 sur une image lisse — une génération IA n’a pas de grille', () => {
    const gradient = image([
      [[10, 10, 10, 255], [11, 11, 11, 255], [12, 12, 12, 255], [13, 13, 13, 255]],
      [[14, 14, 14, 255], [15, 15, 15, 255], [16, 16, 16, 255], [17, 17, 17, 255]],
    ]);
    expect(detectPixelScale(gradient.data, gradient)).toBe(1);
  });

  it('ne rend qu’un facteur qui divise les deux dimensions', () => {
    // Une planche de pack rognée de deux pixels à droite reste en ×4 « moralement », mais on
    // ne peut pas la réduire d'un facteur qui ne tombe pas juste : ça décalerait la découpe.
    const source = upscale(image([[R, G]]), 4); // 8×4
    const cropped = { width: 6, height: 4, data: new Uint8ClampedArray(6 * 4 * 4) };
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 6; x += 1) {
        cropped.data.set(source.data.subarray((y * 8 + x) * 4, (y * 8 + x) * 4 + 4), (y * 6 + x) * 4);
      }
    }
    expect(6 % detectPixelScale(cropped.data, cropped)).toBe(0);
  });
});

describe('réduction', () => {
  it('est sans perte sur une source native agrandie d’un facteur entier', () => {
    // C'est ce qui donne son sens à « les packs passent sans transformation » : tous les
    // pixels d'un bloc sont identiques, donc moyenne et plus-proche-voisin disent la même
    // chose, et cette chose est le pixel d'origine.
    const source = image([
      [R, G],
      [B, _],
    ]);
    const big = upscale(source, 4);
    const target = { width: 2, height: 2 };
    expect([...resampleNearest(big.data, big, target)]).toEqual([...source.data]);
    expect([...downscaleArea(big.data, big, target)]).toEqual([...source.data]);
  });

  it('moyenne la surface plutôt que d’échantillonner un pixel au hasard', () => {
    // Quatre pixels, trois rouges et un vert : la moyenne rend un rouge tirant vers le vert.
    // Le plus-proche-voisin, lui, rend l'un des quatre — et lequel dépend du cadrage.
    const source = image([
      [R, R],
      [R, G],
    ]);
    const [r, g, b, a] = downscaleArea(source.data, source, { width: 1, height: 1 });
    expect(r).toBe(191);
    expect(g).toBe(64);
    expect(b).toBe(0);
    expect(a).toBe(255);
  });

  /**
   * Sans prémultiplication, un pixel transparent portant du blanc — ce que produisent la
   * plupart des exports PNG — tirerait la moyenne vers le blanc et poserait un liseré clair
   * tout autour du sprite. En prémultipliée un pixel transparent ne pèse rien, ce qui est sa
   * définition.
   */
  it('ne laisse pas un pixel transparent teindre ses voisins', () => {
    const source = image([
      [R, [255, 255, 255, 0]],
      [R, [255, 255, 255, 0]],
    ]);
    const [r, g, b, a] = downscaleArea(source.data, source, { width: 1, height: 1 });
    expect([r, g, b]).toEqual([255, 0, 0]);
    expect(a).toBe(128); // moitié de la surface couverte
  });
});

describe('seuillage alpha — opaque, ou pas là', () => {
  it('ne laisse aucune valeur intermédiaire', () => {
    const source = image([[[9, 9, 9, 40], [9, 9, 9, 127], [9, 9, 9, 128], [9, 9, 9, 200]]]);
    thresholdAlpha(source.data, DEFAULT_ALPHA_THRESHOLD);
    expect([...source.data.filter((_, i) => i % 4 === 3)]).toEqual([0, 0, 255, 255]);
  });

  it('remet à zéro la couleur d’un pixel effacé, pour que le vide soit uniforme', () => {
    // Elle ne s'affiche jamais, mais un atlas sans perte compresse d'autant mieux que ses
    // zones vides sont uniformes — et aucune teinte hors palette ne survit dans le fichier.
    const source = image([[[240, 30, 30, 40]]]);
    thresholdAlpha(source.data);
    expect([...source.data]).toEqual([0, 0, 0, 0]);
  });

  it('ne change rien à une planche déjà conforme — un pack traverse intact', () => {
    const source = image([[R, _, B]]);
    const before = [...source.data];
    thresholdAlpha(source.data);
    expect([...source.data]).toEqual(before);
  });
});

describe('quantification vers la palette partagée', () => {
  const palette = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
  ];

  it('rabat chaque couleur sur la plus proche de la palette', () => {
    const source = image([[[240, 20, 20, 255], [20, 240, 20, 255]]]);
    quantizeToPalette(source.data, palette);
    expect([...source.data]).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
  });

  it('laisse les pixels transparents tranquilles', () => {
    // Leur couleur ne s'affiche jamais, et la réécrire ne ferait que casser des plages
    // uniformes — donc grossir l'atlas pour rien.
    const source = image([[[7, 7, 7, 0]]]);
    expect(quantizeToPalette(source.data, palette)).toBe(0);
    expect([...source.data]).toEqual([7, 7, 7, 0]);
  });

  it('pondère les canaux comme l’œil, pas comme la géométrie', () => {
    // Un écart dans le vert compte plus qu'un écart équivalent dans le bleu.
    expect(colorDistance(0, 10, 0, 0, 0, 0)).toBeGreaterThan(colorDistance(0, 0, 10, 0, 0, 0));
  });

  it('signale les couleurs hors palette sans les corriger — un pack ne se retouche pas', () => {
    const source = image([[[1, 2, 3, 255], [255, 0, 0, 255]]]);
    expect(offPaletteColors(source.data, palette)).toEqual([0x010203]);
    expect([...source.data.slice(0, 3)]).toEqual([1, 2, 3]);
  });
});

describe('pixelize — la chaîne complète, dans l’ordre qui compte', () => {
  it('rend une image à la résolution native, en alpha binaire et dans la palette', () => {
    const palette = [
      [255, 0, 0],
      [0, 0, 255],
    ];
    // 4×4 lisse, à ramener en 2×2.
    const source = image([
      [[250, 10, 10, 255], [240, 20, 20, 255], [10, 10, 250, 255], [20, 20, 240, 255]],
      [[250, 10, 10, 255], [240, 20, 20, 255], [10, 10, 250, 255], [20, 20, 240, 255]],
      [[250, 10, 10, 90], [240, 20, 20, 90], [10, 10, 250, 255], [20, 20, 240, 255]],
      [[250, 10, 10, 90], [240, 20, 20, 90], [10, 10, 250, 255], [20, 20, 240, 255]],
    ]);

    const result = pixelize({
      data: source.data,
      size: { width: 4, height: 4 },
      target: { width: 2, height: 2 },
      palette,
    });

    expect(result.size).toEqual({ width: 2, height: 2 });
    expect([...result.data]).toEqual([
      255, 0, 0, 255, 0, 0, 255, 255,
      // Les deux pixels du bas à gauche étaient à 90 d'alpha : sous le seuil, ils sortent.
      0, 0, 0, 0, 0, 0, 255, 255,
    ]);
  });

  /**
   * L'ordre n'est pas cosmétique. Un pixel de bord à 40 % d'opacité porte une couleur à
   * moitié mélangée au fond : le quantifier **avant** de le seuiller ferait entrer dans la
   * palette une teinte qui n'est celle de personne, puis on l'effacerait.
   */
  it('seuille avant de quantifier, pas l’inverse', () => {
    const palette = [[255, 0, 0]];
    const source = image([[[128, 0, 0, 60]]]);
    const result = pixelize({
      data: source.data,
      size: { width: 1, height: 1 },
      target: { width: 1, height: 1 },
      palette,
    });
    // Le pixel a disparu au seuillage : il n'a donc jamais atteint la palette.
    expect(result.data[3]).toBe(0);
  });

  it('ne quantifie pas quand aucune palette n’est fournie', () => {
    const source = image([[[123, 45, 67, 255]]]);
    const result = pixelize({
      data: source.data,
      size: { width: 1, height: 1 },
      target: { width: 1, height: 1 },
      palette: null,
    });
    expect([...result.data]).toEqual([123, 45, 67, 255]);
  });
});

describe('fitNativeSize', () => {
  it('n’agrandit jamais un sprite plus petit que la cible', () => {
    expect(fitNativeSize({ width: 9, height: 6 }, 16)).toEqual({ width: 9, height: 6 });
  });

  it('ramène le plus grand côté à la cible, en gardant les proportions', () => {
    expect(fitNativeSize({ width: 200, height: 100 }, 16)).toEqual({ width: 16, height: 8 });
  });
});

describe('palette partagée', () => {
  it('extrait les couleurs opaques distinctes, triées', () => {
    const source = image([[B, R, _, R]]);
    expect(extractPalette([source])).toEqual(['#0000ff', '#ff0000']);
  });

  it('ignore ce qui est transparent : le fond n’est pas une couleur du jeu', () => {
    expect(extractPalette([image([[[1, 2, 3, 0]]])])).toEqual([]);
  });

  it('rend le même fichier pour les mêmes planches — sinon le CI committe en boucle', () => {
    const one = image([[R, B]]);
    const other = image([[B, R]]);
    const options = { sources: ['b.png', 'a.png'], nativeSize: 16 };
    expect(renderPalette({ colors: extractPalette([one]), ...options })).toBe(
      renderPalette({ colors: extractPalette([other]), ...options })
    );
  });

  it('relit ce qu’elle a écrit', () => {
    const json = JSON.parse(renderPalette({ colors: ['#ff0000', '#0000ff'], sources: [], nativeSize: 16 }));
    expect(parsePalette(json).colors).toEqual([
      [255, 0, 0],
      [0, 0, 255],
    ]);
  });

  it('refuse une palette vide ou mal écrite, en disant quoi faire', () => {
    expect(() => parsePalette({ colors: [] })).toThrow(/npm run palette/);
    expect(() => parsePalette({ colors: ['rouge'] })).toThrow(/#rrggbb/);
  });

  it('refuse une « palette » qui est en fait une photo', () => {
    const colors = Array.from({ length: 2000 }, (_, i) => toHex(i & 255, (i >> 8) & 255, 0));
    expect(() => parsePalette({ colors })).toThrow(/plus une palette/);
  });
});

describe('mise à l’échelle entière', () => {
  it('choisit le plus grand multiple entier qui tient', () => {
    expect(integerScale(64, 16)).toBe(4);
    expect(integerScale(60, 16)).toBe(3);
    expect(integerScale(16, 16)).toBe(1);
  });

  /**
   * Mieux vaut un sprite qui déborde — ça se voit, et ça se corrige dans le layout — qu'un
   * sprite réduit d'un facteur fractionnaire, qui serait illisible sans qu'on sache pourquoi.
   */
  it('ne descend jamais sous ×1, même dans une case trop petite', () => {
    expect(integerScale(10, 16)).toBe(1);
    expect(integerScale(0, 16)).toBe(1);
    expect(integerScale(NaN, 16)).toBe(1);
  });

  it('garde le rapport d’aspect d’un sprite non carré', () => {
    expect(spriteFit({ width: 16, height: 8 }, 64)).toEqual({ width: 64, height: 32, scale: 4 });
    expect(spriteFit({ width: 8, height: 16 }, 64)).toEqual({ width: 32, height: 64, scale: 4 });
  });

  it('déduit la trame de pixels d’art de la place disponible', () => {
    expect(artPixelSize(64)).toBe(64 / DEFAULT_NATIVE_SIZE);
    expect(artPixelSize(90, 16)).toBe(5);
  });

  it('arrondit les longueurs d’effet à un nombre entier de pixels d’art', () => {
    expect(snapToArtPixels(5.3, 3)).toBe(6);
    expect(snapToArtPixels(1.1, 3)).toBe(3); // jamais zéro : une particule invisible est un bug
    expect(snapToArtGrid(41.4, 3)).toBe(42);
  });
});

describe('taille de police', () => {
  it('n’arrondit qu’à l’entier tant qu’aucune police pixel n’est livrée', () => {
    // Le repli est vectoriel : le contraindre à des multiples de 8 ferait sauter tous les
    // textes du jeu de trois tailles d'un coup, sans gagner la moindre netteté.
    expect(pixelFontSize(13.4, null)).toBe(13);
    expect(pixelFontSize(9, null)).toBe(9);
  });

  it('contraint aux multiples de la taille de dessin dès qu’une police bitmap est là', () => {
    expect(pixelFontSize(13, 8)).toBe(16);
    expect(pixelFontSize(11, 8)).toBe(8);
    expect(pixelFontSize(3, 8)).toBe(8); // jamais en dessous d'une fois la taille de dessin
  });
});

describe('manifest — les constantes de direction artistique', () => {
  const base = { sheets: [] };

  it('porte la résolution native comme constante du projet', () => {
    expect(parseManifest(base).pixel.nativeSize).toBe(16);
    expect(parseManifest({ ...base, pixel: { nativeSize: 32 } }).pixel.nativeSize).toBe(32);
  });

  /**
   * Le piège d'un manifest écrit avant la bascule : `sizes` valait 192 à 640 en pixels
   * d'**écran**, il vaut maintenant 8 à 128 en pixels d'**art**. Laisser passer 192
   * produirait un sprite de 192 pixels de dessin — douze personnages bout à bout — et on ne
   * le découvrirait que dans la galerie.
   */
  it('refuse une taille en pixels d’écran, en expliquant l’unité', () => {
    expect(() => parseManifest({ ...base, sizes: { orbs: 192 } })).toThrow(/pixels d'art/);
  });

  it('exige une ligne de crédit sur toute planche de pack', () => {
    const sheet = { file: 'pack.png', category: 'units', cols: 1, rows: 1, names: ['unit.single.1'] };
    expect(() => parseManifest({ sheets: [{ ...sheet, native: true }] })).toThrow(/credit/);
    expect(() =>
      parseManifest({ sheets: [{ ...sheet, native: true, credit: { author: 'A' } }] })
    ).toThrow(/license/);

    const ok = parseManifest({
      sheets: [
        {
          ...sheet,
          native: true,
          credit: { author: 'A', pack: 'P', license: 'CC BY 4.0', url: 'https://x' },
        },
      ],
    });
    expect(ok.sheets[0].credit.license).toBe('CC BY 4.0');
    // Une planche native arrive déjà sur du transparent : le détourage du blanc ne s'y
    // applique pas, il ne ferait que risquer de manger ses zones claires.
    expect(ok.sheets[0].keyOut).toBe(false);
  });

  it('n’exige rien d’une planche générée — c’est le cas courant', () => {
    const parsed = parseManifest({
      sheets: [{ file: 'ia.png', category: 'orbs', cols: 1, rows: 1, names: ['orb.1'] }],
    });
    expect(parsed.sheets[0].native).toBe(false);
    expect(parsed.sheets[0].keyOut).toBe(true);
    expect(parsed.sheets[0].resample).toBe('area');
  });

  it('encode sans perte par défaut — sinon toute la pixelisation serait défaite', () => {
    expect(parseManifest(base).atlas.lossless).toBe(true);
  });
});
