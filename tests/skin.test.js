import { describe, expect, it } from 'vitest';

import balance from '../src/config/balance.json';
import { Skin, atlasKey } from '../src/render/skin.js';
import {
  DEFAULT_TIER_BANDS,
  bandOf,
  enemySprite,
  expectedSprites,
  orbSprite,
  powerItemSprite,
  unitSprite,
} from '../src/render/skinNames.js';
import { FONTS, installFonts } from '../src/render/fonts.js';

/**
 * La promesse du Lot 5 côté image : **une planche déposée arrive en jeu en une commande**,
 * et un sprite absent ne casse rien. Les deux moitiés se testent sans Phaser — `Skin` ne
 * demande à la scène qu'un gestionnaire de textures, qu'on peut falsifier en dix lignes.
 */

/** Gestionnaire de textures minimal : il sait seulement ce qui existe. */
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
      // 16×8 pixels d'art : la résolution native du projet, sur un sprite plus large que
      // haut pour vérifier que le rapport d'aspect survit à la mise à l'échelle entière.
      image: (x, y, key, frame) => ({
        key,
        frame: { name: frame, width: 16, height: 8 },
        scaleX: 1,
        scaleY: 1,
        get displayWidth() {
          return this.frame.width * this.scaleX;
        },
        get displayHeight() {
          return this.frame.height * this.scaleY;
        },
        setScale(scale) {
          this.scaleX = scale;
          this.scaleY = scale;
          return this;
        },
        setTexture(nextKey, nextFrame) {
          this.key = nextKey;
          this.frame = { name: nextFrame, width: 16, height: 8 };
          return this;
        },
        setFlipX() {
          return this;
        },
      }),
    },
  };
}

const INDEX = {
  atlases: [{ key: 'orbs', image: 'atlas-orbs.webp', json: 'atlas-orbs.json' }],
  frames: { 'orb.1': 'orbs', 'orb.2': 'orbs' },
  tierBands: DEFAULT_TIER_BANDS,
};

describe('paliers visuels', () => {
  it('range les 11 tiers d’items dans 3 paliers', () => {
    expect(bandOf(1, DEFAULT_TIER_BANDS.unit)).toBe(1);
    expect(bandOf(4, DEFAULT_TIER_BANDS.unit)).toBe(1);
    expect(bandOf(5, DEFAULT_TIER_BANDS.unit)).toBe(2);
    expect(bandOf(8, DEFAULT_TIER_BANDS.unit)).toBe(2);
    expect(bandOf(11, DEFAULT_TIER_BANDS.unit)).toBe(3);
  });

  it('rabat un tier hors plage sur le dernier palier plutôt que sur rien', () => {
    // Mieux vaut un orbe trop imposant qu'un item invisible : un tier au-delà du plafond
    // ne doit jamais faire disparaître ce qu'on manipule au doigt.
    expect(bandOf(99, DEFAULT_TIER_BANDS.unit)).toBe(3);
    expect(bandOf(0, DEFAULT_TIER_BANDS.unit)).toBe(1);
  });

  it('nomme les sprites à partir du palier, pas du tier', () => {
    expect(orbSprite(2)).toBe('orb.1');
    expect(orbSprite(6)).toBe('orb.2');
    expect(unitSprite('single', 9)).toBe('unit.single.3');
    expect(powerItemSprite('heal', 3)).toBe('power.heal.2');
    expect(enemySprite('tank')).toBe('enemy.tank');
  });

  it('suit les plages du manifest, pas celles du code', () => {
    // C'est ce qui permet de corriger une marche mal placée depuis l'éditeur web de GitHub,
    // sans toucher au jeu.
    const bands = [[1, 1], [2, 11]];
    expect(orbSprite(1, bands)).toBe('orb.1');
    expect(orbSprite(2, bands)).toBe('orb.2');
  });

  /**
   * Les orbes et les unités ont le même nombre de tiers mais **pas le même coût de dessin** :
   * onze orbes se déclinent, onze personnages par type ne se dessinent pas. Leurs tables sont
   * donc séparées — les avoir fait partager une seule table imposait un faux choix, et a coûté
   * un aller-retour au premier lot d'assets livré.
   */
  it('sépare la table des orbes de celle des unités', () => {
    const bands = {
      orb: Array.from({ length: 11 }, (_, i) => [i + 1, i + 1]),
      unit: DEFAULT_TIER_BANDS.unit,
    };
    expect(orbSprite(7, bands.orb)).toBe('orb.7');
    // La même valeur de tier ne donne pas le même palier des deux côtés, et c'est le but.
    expect(unitSprite('single', 7, bands.unit)).toBe('unit.single.2');
  });
});

describe('expectedSprites', () => {
  const sprites = expectedSprites({ balance });
  const names = sprites.map((entry) => entry.name);

  it('demande autant d’orbes que la table des orbes en déclare', () => {
    const eleven = Array.from({ length: 11 }, (_, i) => [i + 1, i + 1]);
    const withEleven = expectedSprites({
      balance,
      bands: { ...DEFAULT_TIER_BANDS, orb: eleven },
    }).map((entry) => entry.name);

    expect(withEleven.filter((name) => name.startsWith('orb.'))).toHaveLength(11);
    // …sans que les unités suivent : elles gardent leurs trois paliers.
    expect(withEleven.filter((name) => name.startsWith('unit.single.'))).toHaveLength(3);
  });

  it('fait hériter les orbes de la table des unités quand elle n’est pas donnée', () => {
    // Compatibilité : un manifest écrit avant la séparation se comporte à l'identique.
    const inherited = expectedSprites({
      balance,
      bands: { unit: [[1, 11]], power: DEFAULT_TIER_BANDS.power },
    }).map((entry) => entry.name);
    expect(inherited.filter((name) => name.startsWith('orb.'))).toEqual(['orb.1']);
  });

  it('dérive la liste de balance.json plutôt que de la tenir à la main', () => {
    // Une liste écrite à la main mentirait dès le premier type ajouté, exactement comme une
    // référence non générée.
    for (const type of Object.keys(balance.units)) expect(names).toContain(`unit.${type}.1`);
    for (const type of Object.keys(balance.enemies)) expect(names).toContain(`enemy.${type}`);
    for (const type of Object.keys(balance.powers.types)) expect(names).toContain(`power.${type}.1`);
    for (const upgrade of balance.draft.upgrades) {
      expect(names).toContain(`icon.draft.${upgrade.icon}`);
    }
  });

  it('ne nomme jamais deux fois le même sprite', () => {
    expect(new Set(names).size).toBe(names.length);
  });

  it('range chaque sprite dans une catégorie de la galerie', () => {
    for (const entry of sprites) expect(entry.category).toBeTruthy();
  });
});

describe('Skin', () => {
  it('trouve un sprite annoncé par l’index **et** réellement chargé', () => {
    const skin = new Skin(fakeScene({ [atlasKey('orbs')]: ['orb.1'] }), INDEX);
    expect(skin.has('orb.1')).toBe(true);
  });

  it('refuse un sprite annoncé mais dont l’atlas n’a pas pu être chargé', () => {
    // Le cas d'un fichier corrompu ou d'un réseau coupé au premier lancement : on veut le
    // greybox, pas un rectangle de texture manquante.
    const skin = new Skin(fakeScene({}), INDEX);
    expect(skin.has('orb.1')).toBe(false);
  });

  it('refuse un sprite absent de l’index', () => {
    const skin = new Skin(fakeScene({ [atlasKey('orbs')]: ['orb.1'] }), INDEX);
    expect(skin.has('unit.single.1')).toBe(false);
  });

  it('fonctionne sans index du tout — c’est l’état de départ du lot', () => {
    const skin = new Skin(fakeScene({}), null);
    expect(skin.has('orb.1')).toBe(false);
    expect(skin.image('orb.1', 64)).toBeNull();
    // Les plages retombent sur celles du code : le jeu reste cohérent sans aucun asset.
    expect(skin.bands.unit).toEqual(DEFAULT_TIER_BANDS.unit);
    expect(skin.bands.orb).toEqual(DEFAULT_TIER_BANDS.orb);
  });

  it('fait hériter `orb` de `unit` quand l’index ne le donne pas', () => {
    const skin = new Skin(fakeScene({}), { tierBands: { unit: [[1, 11]] } });
    expect(skin.bands.orb).toEqual([[1, 11]]);
  });

  it('dimensionne sur le plus grand côté, sans écraser le sprite', () => {
    const skin = new Skin(fakeScene({ [atlasKey('orbs')]: ['orb.1'] }), INDEX);
    const image = skin.image('orb.1', 64);
    // Source 16×8 portée à 64 de large : la hauteur suit, elle n'est pas forcée à 64.
    expect(image.displayWidth).toBe(64);
    expect(image.displayHeight).toBe(32);
  });

  it('n’affiche qu’à un multiple **entier** de la taille native', () => {
    // La règle de la direction artistique pixel art : un sprite de 16 px dans une case de
    // 60 s'affiche à 48, pas à 60. On perd douze pixels de remplissage, on garde une grille
    // de pixels régulière — et c'est l'irrégularité, pas le flou, qui trahit le faux
    // pixel art (cf. `src/systems/pixelScale.js`).
    const skin = new Skin(fakeScene({ [atlasKey('orbs')]: ['orb.1'] }), INDEX);
    expect(skin.image('orb.1', 60).displayWidth).toBe(48);
    expect(skin.image('orb.1', 47).displayWidth).toBe(32);
    expect(skin.image('orb.1', 32).displayWidth).toBe(32);
  });

  it('ne descend jamais sous ×1, même dans une case plus petite que le sprite', () => {
    // Mieux vaut un sprite qui déborde un peu — ça se voit et ça se corrige dans le layout —
    // qu'un sprite réduit d'un facteur fractionnaire, qui serait illisible.
    const skin = new Skin(fakeScene({ [atlasKey('orbs')]: ['orb.1'] }), INDEX);
    expect(skin.image('orb.1', 10).displayWidth).toBe(16);
  });

  it('repeint une image existante quand le palier change', () => {
    const skin = new Skin(fakeScene({ [atlasKey('orbs')]: ['orb.1', 'orb.2'] }), INDEX);
    const image = skin.image('orb.1', 64);
    expect(skin.setFrame(image, 'orb.2', 32)).toBe(true);
    expect(image.frame.name).toBe('orb.2');
    expect(image.displayWidth).toBe(32);
  });

  it('refuse de repeindre vers un sprite absent, laissant l’image intacte', () => {
    const skin = new Skin(fakeScene({ [atlasKey('orbs')]: ['orb.1'] }), INDEX);
    const image = skin.image('orb.1', 64);
    expect(skin.setFrame(image, 'orb.9', 64)).toBe(false);
    expect(image.frame.name).toBe('orb.1');
  });

  it('compte les sprites réellement disponibles', () => {
    const skin = new Skin(fakeScene({ [atlasKey('orbs')]: ['orb.1'] }), INDEX);
    // `orb.2` est annoncé par l'index mais absent de l'atlas chargé.
    expect(skin.count).toBe(1);
  });
});

describe('polices auto-hébergées', () => {
  /** Document minimal : on n'observe que la règle CSS produite. */
  function fakeDocument() {
    const head = { children: [] };
    return {
      head: { appendChild: (node) => head.children.push(node) },
      createElement: () => ({ setAttribute() {}, textContent: '' }),
      _head: head,
    };
  }

  it('ne déclare rien tant qu’aucune police n’est livrée', () => {
    const doc = fakeDocument();
    installFonts({ fonts: [] }, 'assets/', doc);
    expect(doc._head.children).toHaveLength(0);
    // Le repli est monospace depuis la bascule en pixel art : une police de système
    // d'exploitation est ce qu'on veut le moins voir sur un écran de pixel art.
    expect(FONTS.body).toContain('monospace');
  });

  it('déclare une @font-face locale et garde le repli système derrière', () => {
    const doc = fakeDocument();
    const fonts = installFonts({ fonts: ['body-inter.woff2'] }, 'assets/', doc);

    const css = doc._head.children[0].textContent;
    expect(css).toContain('@font-face');
    // Auto-hébergée : la checklist de release interdit toute requête externe.
    expect(css).toContain("url('assets/fonts/body-inter.woff2')");
    expect(css).toContain('format(\'woff2\')');
    // `swap` : le texte s'affiche tout de suite en police système et se remplace à l'arrivée.
    expect(css).toContain('font-display:swap');
    expect(fonts.body).toContain('monospace');
  });

  it('déduit le rôle du nom de fichier, et ignore un fichier hors convention', () => {
    const doc = fakeDocument();
    installFonts({ fonts: ['display-cinzel.woff2', 'nawak.woff2'] }, 'assets/', doc);
    expect(FONTS.display).toContain('mb-display');
    expect(doc._head.children[0].textContent).not.toContain('nawak');
  });
});
