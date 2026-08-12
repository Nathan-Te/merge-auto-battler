import { describe, it, expect } from 'vitest';
import juice from '../src/config/juice.json';
import { parseJuiceConfig, SFX_NAMES, SFX_WAVES } from '../src/systems/juice.js';
import { renderSound, Sfx } from '../src/systems/sfx.js';
import { readSoundEnabled, writeSoundEnabled, SOUND_KEY } from '../src/systems/settings.js';

/**
 * `juice.json` obéit à la même règle que `balance.json` : une valeur absente est une
 * erreur, pas un défaut implicite. Ces tests verrouillent le contrat — sans eux, un
 * réglage supprimé par mégarde produirait un tween de `undefined` ms au lieu d'un
 * message clair au chargement.
 */

/** Stockage en mémoire, pour tester la persistance sans navigateur. */
function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
  };
}

describe('parseJuiceConfig', () => {
  it('accepte le fichier livré', () => {
    expect(() => parseJuiceConfig(juice)).not.toThrow();
    expect(parseJuiceConfig(juice)).toBe(juice);
  });

  it('refuse une valeur manquante, en nommant le chemin fautif', () => {
    const broken = structuredClone(juice);
    delete broken.grid.mergeSquash.scaleX;
    expect(() => parseJuiceConfig(broken)).toThrow(/grid\.mergeSquash\.scaleX/);
  });

  it('refuse une durée négative', () => {
    const broken = structuredClone(juice);
    broken.combat.hitFlashMs = -1;
    expect(() => parseJuiceConfig(broken)).toThrow(/positif/);
  });

  it('exige tous les sons du jeu', () => {
    for (const name of SFX_NAMES) {
      const broken = structuredClone(juice);
      delete broken.sfx[name];
      expect(() => parseJuiceConfig(broken)).toThrow(new RegExp(`sfx\\.${name}`));
    }
  });

  it('refuse une forme d’onde inconnue', () => {
    const broken = structuredClone(juice);
    broken.sfx.merge.wave = 'didgeridoo';
    expect(() => parseJuiceConfig(broken)).toThrow(/wave inconnu/);
    expect(SFX_WAVES).toContain(juice.sfx.merge.wave);
  });

  it('refuse un contenu qui n’est pas un objet', () => {
    expect(() => parseJuiceConfig(null)).toThrow(/contenu invalide/);
  });
});

// --------------------------------------------------------------------- sons

/** Contexte audio minimal : de quoi rendre et jouer, sans navigateur. */
class FakeAudioContext {
  constructor() {
    this.sampleRate = 22050;
    this.destination = { connect() {} };
    this.started = [];
    this.state = 'running';
  }

  createBuffer(channels, length) {
    const data = new Float32Array(length);
    return { length, getChannelData: () => data };
  }

  createGain() {
    return { gain: { value: 1 }, connect() {} };
  }

  createBufferSource() {
    const context = this;
    return {
      buffer: null,
      connect() {},
      start() {
        context.started.push(this.buffer);
      },
    };
  }

  close() {
    this.state = 'closed';
  }
}

describe('renderSound', () => {
  it('rend un buffer de la durée demandée', () => {
    const context = new FakeAudioContext();
    const buffer = renderSound(context, juice.sfx.merge);
    expect(buffer.length).toBe(Math.floor((juice.sfx.merge.durationMs / 1000) * 22050));
  });

  it('produit un signal borné, qui commence et finit au silence', () => {
    const context = new FakeAudioContext();
    const data = renderSound(context, juice.sfx.baseHit).getChannelData();
    const peak = Math.max(...Array.from(data, Math.abs));
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(1);
    expect(Math.abs(data[0])).toBeLessThan(0.05);
    expect(Math.abs(data[data.length - 1])).toBeLessThan(0.05);
  });

  it('est déterministe, bruit compris', () => {
    const first = Array.from(renderSound(new FakeAudioContext(), juice.sfx.death).getChannelData());
    const second = Array.from(renderSound(new FakeAudioContext(), juice.sfx.death).getChannelData());
    expect(first).toEqual(second);
  });
});

describe('Sfx', () => {
  const build = (options = {}) => {
    let clock = 0;
    const sfx = new Sfx(juice, {
      AudioContextClass: FakeAudioContext,
      now: () => clock,
      ...options,
    });
    return { sfx, advance: (ms) => (clock += ms) };
  };

  it('ne joue rien tant que l’audio n’est pas déverrouillé', () => {
    const { sfx } = build();
    expect(sfx.play('merge')).toBe(false);
  });

  it('rend tous les sons au déverrouillage, et les joue ensuite', () => {
    const { sfx } = build();
    expect(sfx.unlock()).toBe(true);
    expect(sfx.buffers.size).toBe(SFX_NAMES.length);
    expect(sfx.play('merge')).toBe(true);
  });

  it('déverrouiller deux fois ne recrée pas le contexte', () => {
    const { sfx } = build();
    sfx.unlock();
    const context = sfx.context;
    sfx.unlock();
    expect(sfx.context).toBe(context);
  });

  it('étrangle les sons répétés plutôt que d’empiler une bouillie', () => {
    const { sfx, advance } = build();
    sfx.unlock();
    expect(sfx.play('shot')).toBe(true);
    expect(sfx.play('shot')).toBe(false);
    advance(juice.sfx.shot.minIntervalMs);
    expect(sfx.play('shot')).toBe(true);
  });

  it('coupé, il ne joue plus rien', () => {
    const { sfx } = build();
    sfx.unlock();
    sfx.setEnabled(false);
    expect(sfx.play('merge')).toBe(false);
    expect(sfx.toggle()).toBe(true);
    expect(sfx.play('merge')).toBe(true);
  });

  it('ignore un son inconnu au lieu de lever', () => {
    const { sfx } = build();
    sfx.unlock();
    expect(sfx.play('inexistant')).toBe(false);
  });

  it('survit à un navigateur sans audio', () => {
    const sfx = new Sfx(juice, { AudioContextClass: null, now: () => 0 });
    expect(sfx.unlock()).toBe(false);
    expect(sfx.play('merge')).toBe(false);
    expect(() => sfx.destroy()).not.toThrow();
  });
});

describe('préférence de son', () => {
  it('retombe sur la valeur de juice.json quand rien n’a été choisi', () => {
    expect(readSoundEnabled(true, memoryStorage())).toBe(true);
    expect(readSoundEnabled(false, memoryStorage())).toBe(false);
  });

  it('mémorise le choix du joueur', () => {
    const storage = memoryStorage();
    writeSoundEnabled(false, storage);
    expect(storage.getItem(SOUND_KEY)).toBe('0');
    expect(readSoundEnabled(true, storage)).toBe(false);

    writeSoundEnabled(true, storage);
    expect(readSoundEnabled(false, storage)).toBe(true);
  });

  it('ne casse jamais une partie si le stockage est indisponible', () => {
    const hostile = {
      getItem() {
        throw new Error('mode privé');
      },
      setItem() {
        throw new Error('quota');
      },
    };
    expect(readSoundEnabled(true, hostile)).toBe(true);
    expect(() => writeSoundEnabled(false, hostile)).not.toThrow();
    expect(readSoundEnabled(true, null)).toBe(true);
  });
});
