import { describe, expect, it } from 'vitest';

import { parseManifest, animFrameName, isAnimFrameName } from '../src/tools/assets/manifest.js';
import { FrameCycler, SpriteAnimator, resolveFps } from '../src/render/spriteAnim.js';
import { Skin, atlasKey } from '../src/render/skin.js';

/**
 * **Les animations de frames livrées par les packs**, des deux côtés de la chaîne : ce que le
 * manifest accepte de décrire, et ce que le rendu en fait. Comme le reste du Lot 5, tout se
 * teste sans Phaser — la lecture de frames est un compteur, pas un moteur.
 */

const sheet = (overrides = {}) => ({
  file: 'monstres.png',
  category: 'enemies',
  cols: 3,
  rows: 4,
  names: [null, null, null, null, 'enemy.basic', null, null, null, null, null, null, null],
  ...overrides,
});

describe('manifest — animations', () => {
  it('laisse une planche sans animations exactement comme avant', () => {
    const [parsed] = parseManifest({ sheets: [sheet()] }).sheets;
    expect(parsed.animations).toEqual({});
  });

  it('normalise les décalages de cellule et laisse la cadence à juice.json', () => {
    const [parsed] = parseManifest({
      sheets: [
        sheet({
          animations: { walk: { frames: [[-1, 0], [0, 0], [1, 0], [0, 0]] } },
        }),
      ],
    }).sheets;
    expect(parsed.animations.walk.frames).toEqual([
      [-1, 0],
      [0, 0],
      [1, 0],
      [0, 0],
    ]);
    // `null` = « suis juice.json ». C'est le partage voulu : le pipeline dit quelles images
    // existent, jamais à quelle vitesse on les regarde.
    expect(parsed.animations.walk.fps).toBeNull();
  });

  it('accepte une dérogation de cadence par planche', () => {
    const [parsed] = parseManifest({
      sheets: [sheet({ animations: { walk: { frames: [[0, 0]], fps: 12 } } })],
    }).sheets;
    expect(parsed.animations.walk.fps).toBe(12);
  });

  it('refuse une frame qui sort de la planche, en nommant l’ancre fautive', () => {
    expect(() =>
      parseManifest({
        // L'ancre est en colonne 1 : un décalage de −2 tombe hors de la planche.
        sheets: [sheet({ animations: { walk: { frames: [[-2, 0]] } } })],
      })
    ).toThrow(/enemy\.basic/);
  });

  it('refuse un décalage qui n’est pas une paire d’entiers', () => {
    expect(() =>
      parseManifest({ sheets: [sheet({ animations: { walk: { frames: [[0.5, 0]] } } })] })
    ).toThrow(/\[colonne, ligne\]/);
  });

  it('refuse une animation sans frames', () => {
    expect(() =>
      parseManifest({ sheets: [sheet({ animations: { walk: {} } })] })
    ).toThrow(/frames/);
  });
});

describe('noms de frames dérivées', () => {
  /**
   * Le séparateur est ce qui garantit qu'une frame dérivée n'écrase jamais un sprite du
   * manifest : `parseCellName` n'accepte pas `~`, donc la collision est impossible **par
   * construction** et non par convention.
   */
  it('utilise un séparateur que le manifest ne peut pas écrire', () => {
    const name = animFrameName('enemy.basic', 'walk', 2);
    expect(isAnimFrameName(name)).toBe(true);
    expect(isAnimFrameName('enemy.basic')).toBe(false);
    expect(() =>
      parseManifest({ sheets: [sheet({ names: [name, ...Array(11).fill(null)] })] })
    ).toThrow(/n'est pas un nom de sprite valide/);
  });
});

describe('resolveFps', () => {
  const table = { default: 6, walk: 8, idle: 4 };

  it('donne la priorité à la planche', () => {
    expect(resolveFps({ fps: 12 }, 'walk', table)).toBe(12);
  });

  it('retombe sur juice.json par nom d’animation', () => {
    expect(resolveFps({ fps: null }, 'idle', table)).toBe(4);
  });

  it('retombe sur la valeur par défaut pour une animation que le jeu ne connaît pas', () => {
    expect(resolveFps({ fps: null }, 'hurt', table)).toBe(6);
  });

  it('rend 0 — donc figé — quand rien n’est configuré', () => {
    expect(resolveFps(null, 'walk', null)).toBe(0);
  });
});

describe('FrameCycler', () => {
  const walk = { frames: ['a', 'b', 'c'], fps: 10 };

  it('pose la première frame en démarrant, et rien de plus', () => {
    const cycler = new FrameCycler();
    expect(cycler.play('x/walk', walk)).toBe('a');
    expect(cycler.play('x/walk', walk)).toBeNull();
  });

  it('ne rend une frame que lorsqu’elle change', () => {
    const cycler = new FrameCycler();
    cycler.play('x/walk', walk);
    // 10 fps = un pas toutes les 100 ms : à 60 images par seconde, cinq frames de rendu sur
    // six ne demandent aucun travail. C'est ce `null` qui rend l'animation gratuite.
    expect(cycler.advance(60)).toBeNull();
    expect(cycler.advance(60)).toBe('b');
    expect(cycler.advance(79)).toBeNull();
    expect(cycler.advance(2)).toBe('c');
    expect(cycler.advance(100)).toBe('a');
  });

  it('absorbe un gros retard au lieu de le rattraper image par image', () => {
    const cycler = new FrameCycler();
    cycler.play('x/walk', walk);
    // Onglet masqué pendant deux secondes : on repart à la bonne frame, sans rejouer vingt
    // pas de marche — même geste que `BattleModel` avec ses ticks en retard.
    expect(cycler.advance(2000)).toBe('c');
  });

  it('ne bouge pas pour une animation figée ou à une seule frame', () => {
    const cycler = new FrameCycler();
    cycler.play('x/idle', { frames: ['a'], fps: 8 });
    expect(cycler.advance(5000)).toBeNull();
    cycler.play('x/walk', { frames: ['a', 'b'], fps: 0 });
    expect(cycler.advance(5000)).toBeNull();
  });
});

/** Scène minimale : un gestionnaire de textures qui sait seulement ce qui existe. */
function fakeScene(available = {}) {
  const textures = new Map(
    Object.entries(available).map(([key, names]) => [key, new Set(names)])
  );
  return {
    textures: {
      exists: (key) => textures.has(key),
      get: (key) => ({ has: (name) => textures.get(key)?.has(name) ?? false }),
    },
  };
}

const INDEX = {
  atlases: [{ key: 'enemies', image: 'atlas-enemies.webp', json: 'atlas-enemies.json' }],
  frames: {
    'enemy.basic': 'enemies',
    'enemy.basic~walk0': 'enemies',
    'enemy.basic~walk2': 'enemies',
    'enemy.fast': 'enemies',
  },
  animations: {
    'enemy.basic': {
      idle: { fps: null, frames: ['enemy.basic'] },
      walk: {
        fps: null,
        frames: ['enemy.basic~walk0', 'enemy.basic', 'enemy.basic~walk2', 'enemy.basic'],
      },
    },
  },
};

const loaded = fakeScene({
  [atlasKey('enemies')]: Object.keys(INDEX.frames),
});

describe('Skin — animations', () => {
  it('rend les animations d’un sprite livré', () => {
    const skin = new Skin(loaded, INDEX);
    expect(Object.keys(skin.animationsFor('enemy.basic'))).toEqual(['idle', 'walk']);
  });

  it('rend null pour un sprite sans animation, et pour un sprite inconnu', () => {
    const skin = new Skin(loaded, INDEX);
    expect(skin.animationsFor('enemy.fast')).toBeNull();
    expect(skin.animationsFor('enemy.boss')).toBeNull();
  });

  it('rend null quand l’atlas n’a pas pu être chargé', () => {
    // Même précaution que `has` : annoncer une marche dont l'atlas manque ferait poser des
    // frames inexistantes sur un repli greybox.
    const skin = new Skin(fakeScene({}), INDEX);
    expect(skin.animationsFor('enemy.basic')).toBeNull();
  });

  it('n’échange une frame que si elle existe, et jamais sur un greybox', () => {
    const skin = new Skin(loaded, INDEX);
    const image = { frame: 'enemy.basic', setFrame(name) { this.frame = name; return this; } };
    expect(skin.setFrameName(image, 'enemy.basic~walk0')).toBe(true);
    expect(image.frame).toBe('enemy.basic~walk0');
    expect(skin.setFrameName(image, 'enemy.basic~walk9')).toBe(false);
    // Un `Graphics` n'a pas de `setFrame` : le repli greybox traverse sans rien casser.
    expect(skin.setFrameName({}, 'enemy.basic~walk0')).toBe(false);
  });
});

describe('SpriteAnimator', () => {
  const fps = { default: 6, walk: 10, idle: 4 };

  it('démarre l’animation demandée et la fait tourner', () => {
    const animator = new SpriteAnimator(new Skin(loaded, INDEX), fps);
    expect(animator.update('enemy.basic', 'walk', 0)).toBe('enemy.basic~walk0');
    expect(animator.update('enemy.basic', 'walk', 100)).toBe('enemy.basic');
    expect(animator.update('enemy.basic', 'walk', 100)).toBe('enemy.basic~walk2');
  });

  it('repart au premier pas en changeant d’état, sans se figer en plein pas', () => {
    const animator = new SpriteAnimator(new Skin(loaded, INDEX), fps);
    animator.update('enemy.basic', 'walk', 0);
    animator.update('enemy.basic', 'walk', 100);
    expect(animator.update('enemy.basic', 'idle', 0)).toBe('enemy.basic');
  });

  it('retombe sur l’arrêt quand la planche ne dessine pas l’état demandé', () => {
    const animator = new SpriteAnimator(new Skin(loaded, INDEX), fps);
    expect(animator.update('enemy.basic', 'hurt', 0)).toBe('enemy.basic');
  });

  it('ne demande rien quand il n’y a rien à jouer', () => {
    const animator = new SpriteAnimator(new Skin(loaded, INDEX), fps);
    expect(animator.update('enemy.fast', 'walk', 100)).toBeNull();
    expect(animator.update(null, 'walk', 100)).toBeNull();
    expect(new SpriteAnimator(null, fps).update('enemy.basic', 'walk', 100)).toBeNull();
  });
});
