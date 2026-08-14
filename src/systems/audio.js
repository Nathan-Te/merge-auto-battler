/**
 * `AudioBank` — la banque de sons définitive : **échantillons livrés, synthèse en repli**.
 *
 * Le Lot 3 synthétisait tous les sons à l'exécution (`sfx.js`), parce qu'aucun asset
 * n'existait. Le Lot 5 les remplace par de vrais fichiers — mais **un par un**, au rythme où
 * ils arrivent. D'où la règle de ce module : chaque son cherche d'abord son échantillon, et
 * retombe sur sa version synthétisée s'il n'a pas encore été livré. Le jeu n'est donc jamais
 * muet, et on peut juger un son livré en contexte sans attendre les dix-sept autres.
 *
 * ## Un seul contexte audio, comme un seul pool de particules
 *
 * `CLAUDE.md` impose un seul exemplaire par partie des ressources coûteuses. On aurait pu
 * confier les échantillons au gestionnaire de sons de Phaser et garder `Sfx` pour la
 * synthèse — mais ça ferait **deux `AudioContext`**, deux chaînes de gain, et deux volumes à
 * tenir d'accord. Les fichiers sont donc chargés en binaire (`BootScene`) et décodés dans le
 * contexte que `Sfx` possède déjà. Un contexte, un gain maître, un étranglement.
 *
 * ## Volumes par catégorie
 *
 * Un effet et une boucle musicale ne se règlent pas ensemble : la musique doit rester sous
 * les effets sans les écraser, et c'est le rapport entre les deux qu'on ajuste au casque.
 * Les deux volumes vivent dans `juice.json` (`sound.categories`), comme tout le feel.
 *
 * ## Musique et politique d'autoplay
 *
 * Aucun navigateur ne laisse démarrer un son avant un geste. La musique ne part donc
 * **jamais** au chargement : elle attend le premier `pointerdown`, comme le reste de
 * l'audio. Ce n'est pas une limitation contournable, c'est le contrat du navigateur — et
 * c'est aussi la politesse minimale envers quelqu'un qui ouvre un onglet.
 */

import { Sfx } from './sfx.js';

/** Nom de la boucle musicale et du sting de défaite, tels qu'ils sont livrés. */
export const MUSIC_KEY = 'music';
export const DEFEAT_KEY = 'defeat';

export class AudioBank {
  /**
   * @param {object} juice Config validée (`parseJuiceConfig`)
   * @param {object} [options]
   * @param {Map<string, ArrayBuffer>} [options.samples] Fichiers chargés, par nom
   * @param {object} [options.sfx] Synthétiseur injectable (tests)
   */
  constructor(juice, { samples = new Map(), sfx = null } = {}) {
    this.juice = juice;
    /** Le synthétiseur reste la source de vérité du son : volumes, étranglement, toggle. */
    this.sfx = sfx ?? new Sfx(juice);
    this.rawSamples = samples;
    /** @type {Map<string, AudioBuffer>} échantillons décodés, par nom */
    this.decoded = new Map();
    this.musicSource = null;
    this.musicGain = null;
    this.pendingMusic = false;
  }

  get enabled() {
    return this.sfx.enabled;
  }

  /** Volume d'une catégorie, relatif au volume maître. */
  volumeOf(category) {
    return this.juice.sound.categories?.[category] ?? 1;
  }

  /**
   * Ouvre le contexte audio et décode les échantillons. À appeler **depuis un geste**.
   *
   * Le décodage est asynchrone et **non attendu** : rien ne doit bloquer la frame du premier
   * appui. Tant qu'un échantillon n'est pas prêt, son son synthétisé le remplace — c'est
   * exactement le même repli que pour un fichier absent, donc aucun code en plus.
   */
  unlock() {
    const ready = this.sfx.unlock();
    if (!ready) return false;

    for (const [name, raw] of this.rawSamples) {
      if (this.decoded.has(name) || !raw) continue;
      // `slice()` : `decodeAudioData` **détache** le tampon qu'on lui donne, et le cache de
      // Phaser garde une référence dessus. Sans copie, un second `unlock()` (onglet revenu
      // au premier plan) travaillerait sur un tampon vidé.
      this.decode(name, raw.slice(0));
    }

    if (this.pendingMusic) this.startMusic();
    return true;
  }

  decode(name, raw) {
    try {
      const promise = this.sfx.context.decodeAudioData(raw);
      if (promise?.then) {
        promise.then(
          (buffer) => {
            this.decoded.set(name, buffer);
            // La musique peut avoir été demandée avant la fin de son décodage.
            if (name === MUSIC_KEY && this.pendingMusic) this.startMusic();
          },
          () => {
            // Fichier illisible : le son synthétisé reste en place, et personne ne le sait.
          }
        );
      }
    } catch {
      // Idem — un décodage refusé ne doit pas remonter au milieu d'une frame de jeu.
    }
  }

  /**
   * Joue un son : l'échantillon s'il est prêt, la synthèse sinon.
   *
   * L'étranglement (`sfx.<nom>.minIntervalMs`) s'applique **dans les deux cas** : vingt
   * unités qui tirent, c'est trente sons par seconde et une bouillie, que le son vienne d'un
   * fichier ou d'un oscillateur.
   *
   * @param {string} name Clé de `juice.sfx`
   * @returns {boolean} true si un son a réellement été joué
   */
  play(name) {
    const buffer = this.decoded.get(name);
    if (!buffer) return this.sfx.play(name);

    if (!this.sfx.enabled || !this.sfx.context) return false;
    const spec = this.juice.sfx[name];
    const time = this.sfx.now();
    const last = this.sfx.lastPlayedAt.get(name);
    if (spec && last !== undefined && time - last < spec.minIntervalMs) return false;
    this.sfx.lastPlayedAt.set(name, time);

    const source = this.sfx.context.createBufferSource();
    source.buffer = buffer;
    // Le volume propre au son (réglé dans `juice.json`) est déjà dans la synthèse ; pour un
    // échantillon, il s'applique ici, multiplié par le volume de sa catégorie.
    const gain = this.sfx.context.createGain();
    gain.gain.value = (spec?.volume ?? 1) * this.volumeOf('sfx');
    source.connect(gain);
    gain.connect(this.sfx.master);
    source.start();
    return true;
  }

  /**
   * Lance la boucle musicale, si elle a été livrée.
   *
   * Sans fichier de musique, l'appel est un **non-événement** : pas de silence artificiel à
   * gérer, pas de branche en plus chez l'appelant.
   */
  startMusic() {
    if (this.musicSource) return true;
    const buffer = this.decoded.get(MUSIC_KEY);
    if (!buffer || !this.sfx.context) {
      // Demandée trop tôt (avant le geste de déverrouillage, ou avant la fin du décodage) :
      // on la note, et `unlock()` la reprendra.
      this.pendingMusic = true;
      return false;
    }

    this.pendingMusic = false;
    this.musicGain = this.sfx.context.createGain();
    this.musicGain.gain.value = this.volumeOf('music');
    this.musicGain.connect(this.sfx.master);

    const source = this.sfx.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(this.musicGain);
    source.start();
    this.musicSource = source;
    return true;
  }

  /** Coupe la musique (fin de partie, son désactivé). */
  stopMusic() {
    this.pendingMusic = false;
    try {
      this.musicSource?.stop();
    } catch {
      // Une source déjà arrêtée n'est pas un problème.
    }
    this.musicSource = null;
    this.musicGain = null;
  }

  /**
   * Le sting de défaite : la musique s'arrête, le sting tombe dans le silence qu'elle laisse.
   *
   * L'ordre compte — jouer le sting par-dessus la boucle donne une bouillie au moment le
   * plus chargé de la partie, et c'est le seul son que le joueur écoute vraiment.
   */
  playDefeat() {
    this.stopMusic();
    if (this.decoded.has(DEFEAT_KEY)) return this.play(DEFEAT_KEY);
    return this.play('gameOver');
  }

  /** Coupe ou rallume tout le son, et mémorise le choix. @returns {boolean} nouvel état */
  toggle() {
    const enabled = this.sfx.toggle();
    if (!enabled) this.stopMusic();
    else this.startMusic();
    return enabled;
  }

  setEnabled(enabled) {
    this.sfx.setEnabled(enabled);
    if (!this.sfx.enabled) this.stopMusic();
  }

  destroy() {
    this.stopMusic();
    this.decoded.clear();
    this.rawSamples = new Map();
    this.sfx.destroy();
  }
}

/**
 * Rassemble les échantillons chargés par `BootScene` depuis le cache binaire de Phaser.
 *
 * @param {Phaser.Scene} scene
 * @param {object|null} index Contenu de `public/assets/index.json`
 * @returns {Map<string, ArrayBuffer>}
 */
export function collectSamples(scene, index) {
  const samples = new Map();
  for (const file of index?.audio ?? []) {
    const key = file.replace(/\.[^.]+$/, '');
    const raw = scene.cache.binary.get(key);
    if (raw) samples.set(key, raw);
  }
  return samples;
}

export default AudioBank;
