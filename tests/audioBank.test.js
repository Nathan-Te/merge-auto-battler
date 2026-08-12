import { beforeEach, describe, expect, it, vi } from 'vitest';

import juiceConfig from '../src/config/juice.json';
import { parseJuiceConfig } from '../src/systems/juice.js';
import { AudioBank, DEFEAT_KEY, MUSIC_KEY } from '../src/systems/audio.js';

/**
 * La promesse du Lot 5 côté son : **un échantillon livré remplace sa synthèse, et rien
 * d'autre ne change**. Les sons arrivent un par un, donc le repli n'est pas une précaution
 * mais le mode de fonctionnement normal pendant toute la production.
 */

const juice = parseJuiceConfig(juiceConfig);

/** Synthétiseur factice : on n'observe que ce qui lui est demandé. */
function fakeSfx({ unlocked = true } = {}) {
  const played = [];
  const started = [];
  const context = {
    decodeAudioData: vi.fn(() => Promise.resolve({ duration: 1 })),
    createBufferSource: () => {
      const source = { buffer: null, loop: false, connect() {}, start() {}, stop() {} };
      started.push(source);
      return source;
    },
    createGain: () => ({ gain: { value: 1 }, connect() {} }),
  };

  return {
    played,
    started,
    enabled: true,
    context: unlocked ? context : null,
    master: {},
    lastPlayedAt: new Map(),
    now: () => 0,
    unlock: vi.fn(function unlock() {
      this.context = context;
      return unlocked;
    }),
    play: vi.fn((name) => {
      played.push(name);
      return true;
    }),
    toggle: vi.fn(function toggle() {
      this.enabled = !this.enabled;
      return this.enabled;
    }),
    setEnabled: vi.fn(function setEnabled(value) {
      this.enabled = Boolean(value);
    }),
    destroy: vi.fn(),
  };
}

/** Un tampon crédible : `decodeAudioData` le détache, donc il doit pouvoir l'être. */
const sample = () => new ArrayBuffer(64);

describe('AudioBank — repli sur la synthèse', () => {
  let sfx;

  beforeEach(() => {
    sfx = fakeSfx();
  });

  it('joue le son synthétisé tant qu’aucun fichier n’est livré', () => {
    const bank = new AudioBank(juice, { sfx });
    expect(bank.play('merge')).toBe(true);
    expect(sfx.played).toEqual(['merge']);
  });

  it('joue le son synthétisé pour un son livré mais pas encore décodé', () => {
    const bank = new AudioBank(juice, { sfx, samples: new Map([['merge', sample()]]) });
    // Rien n'est décodé avant `unlock()` : le décodage demande un contexte, donc un geste.
    bank.play('merge');
    expect(sfx.played).toEqual(['merge']);
  });

  it('bascule sur l’échantillon dès qu’il est décodé, sans toucher aux autres sons', async () => {
    const bank = new AudioBank(juice, { sfx, samples: new Map([['merge', sample()]]) });
    bank.unlock();
    await vi.waitFor(() => expect(bank.decoded.has('merge')).toBe(true));

    expect(bank.play('merge')).toBe(true);
    // Le son de fusion ne passe plus par la synthèse…
    expect(sfx.played).toEqual([]);
    // …mais celui de tap, non livré, si.
    bank.play('tap');
    expect(sfx.played).toEqual(['tap']);
  });

  it('copie le tampon avant de le décoder — `decodeAudioData` le détache', () => {
    const raw = sample();
    const bank = new AudioBank(juice, { sfx, samples: new Map([['merge', raw]]) });
    bank.unlock();
    // Le tampon passé au décodeur n'est pas celui du cache de Phaser : sans copie, un
    // second `unlock()` (onglet revenu au premier plan) décoderait un tampon vidé.
    expect(sfx.context.decodeAudioData).toHaveBeenCalledTimes(1);
    expect(sfx.context.decodeAudioData.mock.calls[0][0]).not.toBe(raw);
  });

  it('ne décode pas deux fois le même échantillon', async () => {
    const bank = new AudioBank(juice, { sfx, samples: new Map([['merge', sample()]]) });
    bank.unlock();
    await vi.waitFor(() => expect(bank.decoded.has('merge')).toBe(true));
    bank.unlock();
    expect(sfx.context.decodeAudioData).toHaveBeenCalledTimes(1);
  });

  it('survit à un fichier illisible en gardant sa synthèse', async () => {
    sfx.context.decodeAudioData = vi.fn(() => Promise.reject(new Error('corrompu')));
    const bank = new AudioBank(juice, { sfx, samples: new Map([['merge', sample()]]) });
    bank.unlock();
    await Promise.resolve();
    expect(bank.play('merge')).toBe(true);
    expect(sfx.played).toEqual(['merge']);
  });
});

describe('AudioBank — étranglement', () => {
  it('applique le même `minIntervalMs` aux échantillons qu’à la synthèse', async () => {
    const sfx = fakeSfx();
    let clock = 0;
    sfx.now = () => clock;

    const bank = new AudioBank(juice, { sfx, samples: new Map([['shot', sample()]]) });
    bank.unlock();
    await vi.waitFor(() => expect(bank.decoded.has('shot')).toBe(true));

    expect(bank.play('shot')).toBe(true);
    // Vingt unités qui tirent, c'est trente sons par seconde et une bouillie — que le son
    // vienne d'un fichier ou d'un oscillateur.
    expect(bank.play('shot')).toBe(false);

    clock = juice.sfx.shot.minIntervalMs + 1;
    expect(bank.play('shot')).toBe(true);
  });

  it('ne joue rien quand le son est coupé', async () => {
    const sfx = fakeSfx();
    const bank = new AudioBank(juice, { sfx, samples: new Map([['merge', sample()]]) });
    bank.unlock();
    await vi.waitFor(() => expect(bank.decoded.has('merge')).toBe(true));

    sfx.enabled = false;
    expect(bank.play('merge')).toBe(false);
  });
});

describe('AudioBank — musique', () => {
  it('ne démarre que sur demande — `unlock()` ouvre le contexte, il ne joue pas', async () => {
    const sfx = fakeSfx();
    const bank = new AudioBank(juice, { sfx, samples: new Map([[MUSIC_KEY, sample()]]) });
    bank.unlock();
    await vi.waitFor(() => expect(bank.decoded.has(MUSIC_KEY)).toBe(true));
    expect(bank.musicSource).toBeNull();
  });

  it('ne démarre pas avant le geste de déverrouillage, et se rattrape ensuite', async () => {
    const sfx = fakeSfx();
    const bank = new AudioBank(juice, { sfx, samples: new Map([[MUSIC_KEY, sample()]]) });
    // Aucun navigateur ne laisse démarrer un son avant un geste : la demande est notée.
    sfx.context = null;
    expect(bank.startMusic()).toBe(false);
    expect(bank.pendingMusic).toBe(true);

    bank.unlock();
    await vi.waitFor(() => expect(bank.musicSource).not.toBeNull());
  });

  it('est un non-événement tant qu’aucune musique n’est livrée', () => {
    const bank = new AudioBank(juice, { sfx: fakeSfx() });
    expect(bank.startMusic()).toBe(false);
    expect(bank.musicSource).toBeNull();
  });

  it('boucle, et ne se relance pas si elle tourne déjà', async () => {
    const sfx = fakeSfx();
    const bank = new AudioBank(juice, { sfx, samples: new Map([[MUSIC_KEY, sample()]]) });
    bank.unlock();
    // La musique ne part que si on la demande : `unlock()` ouvre le contexte, il ne décide
    // pas de jouer. C'est `GameScene` qui la lance, au premier appui du joueur.
    bank.startMusic();
    await vi.waitFor(() => expect(bank.musicSource).not.toBeNull());

    const source = bank.musicSource;
    expect(source.loop).toBe(true);
    bank.startMusic();
    expect(bank.musicSource).toBe(source);
  });

  it('se coupe avec le son, et repart quand on le rallume', async () => {
    const sfx = fakeSfx();
    const bank = new AudioBank(juice, { sfx, samples: new Map([[MUSIC_KEY, sample()]]) });
    bank.unlock();
    bank.startMusic();
    await vi.waitFor(() => expect(bank.musicSource).not.toBeNull());

    bank.toggle();
    expect(bank.musicSource).toBeNull();
    bank.toggle();
    expect(bank.musicSource).not.toBeNull();
  });

  it('coupe la musique **avant** le sting de défaite', async () => {
    const sfx = fakeSfx();
    const bank = new AudioBank(juice, {
      sfx,
      samples: new Map([
        [MUSIC_KEY, sample()],
        [DEFEAT_KEY, sample()],
      ]),
    });
    bank.unlock();
    bank.startMusic();
    await vi.waitFor(() => expect(bank.decoded.has(DEFEAT_KEY)).toBe(true));
    expect(bank.musicSource).not.toBeNull();

    bank.playDefeat();
    // Par-dessus la boucle, le sting ne s'entendrait pas — et c'est le seul son que le
    // joueur écoute vraiment.
    expect(bank.musicSource).toBeNull();
  });

  it('retombe sur le son de game over quand aucun sting n’est livré', () => {
    const sfx = fakeSfx();
    const bank = new AudioBank(juice, { sfx });
    bank.playDefeat();
    expect(sfx.played).toEqual(['gameOver']);
  });
});

describe('AudioBank — volumes par catégorie', () => {
  it('lit les deux catégories de `juice.json`', () => {
    const bank = new AudioBank(juice, { sfx: fakeSfx() });
    expect(bank.volumeOf('sfx')).toBe(juice.sound.categories.sfx);
    expect(bank.volumeOf('music')).toBe(juice.sound.categories.music);
  });

  it('rend 1 pour une catégorie inconnue plutôt que de rendre le jeu muet', () => {
    const bank = new AudioBank(juice, { sfx: fakeSfx() });
    expect(bank.volumeOf('nawak')).toBe(1);
  });
});
