/**
 * Sons placeholder **synthétisés à l'exécution**, façon jsfxr. Pas de fichier audio.
 *
 * Pourquoi synthétiser plutôt que livrer des `.wav` : le seed doc impose un téléchargement
 * initial léger, et le Lot 4 remplacera de toute façon ces sons par les vrais. Un
 * générateur de 150 lignes pèse **zéro octet** de plus dans `dist/`, se règle dans
 * `juice.json` comme le reste du feel, et permet de juger le feel en son dès aujourd'hui —
 * un jeu muet ne se juge pas.
 *
 * Chaque son est rendu **une fois** dans un `AudioBuffer` au premier déverrouillage, puis
 * rejoué par un `AudioBufferSourceNode` : le coût par tir est celui d'un nœud jetable, pas
 * d'une synthèse.
 *
 * ## Politique des navigateurs
 *
 * Un `AudioContext` ne démarre qu'après un geste utilisateur. `unlock()` est donc appelé au
 * premier `pointerdown` de la scène ; avant ça, `play()` ne fait rien plutôt que de lever
 * une exception au milieu d'une frame.
 *
 * ## Étranglement
 *
 * Vingt unités qui tirent, c'est trente sons par seconde et une bouillie. Chaque son porte
 * son `minIntervalMs` (dans `juice.json`) : au-delà de la cadence, le son est **ignoré**,
 * jamais mis en file. Le premier coup d'une salve s'entend, les suivants se devinent.
 */

import { readSoundEnabled, writeSoundEnabled } from './settings.js';

const SAMPLE_RATE = 22050;

/** Génère un échantillon de forme d'onde à la phase donnée (0 → 1). */
function waveSample(shape, phase, noise) {
  switch (shape) {
    case 'square':
      return phase % 1 < 0.5 ? 1 : -1;
    case 'saw':
      return 2 * (phase % 1) - 1;
    case 'triangle':
      return 4 * Math.abs((phase % 1) - 0.5) - 1;
    case 'sine':
      return Math.sin(phase * Math.PI * 2);
    case 'noise':
    default:
      return noise;
  }
}

/**
 * Rend un son dans un `AudioBuffer`.
 *
 * Enveloppe : attaque linéaire sur `attackMs`, puis décroissance exponentielle jusqu'au
 * silence à `durationMs`. La fréquence glisse de `freqStart` à `freqEnd` de façon
 * géométrique — c'est ce glissando qui donne son caractère « jeu » à un carré de 80 ms.
 *
 * @param {BaseAudioContext} context
 * @param {object} spec Entrée `sfx.<nom>` de `juice.json`
 * @returns {AudioBuffer}
 */
export function renderSound(context, spec) {
  const length = Math.max(1, Math.floor((spec.durationMs / 1000) * context.sampleRate));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);

  const attackSamples = Math.max(1, Math.floor((spec.attackMs / 1000) * context.sampleRate));
  // Le bruit est tiré d'une suite déterministe : deux parties identiques sonnent pareil,
  // et le rendu ne dépend pas de `Math.random`.
  let noiseState = 1;
  let phase = 0;

  for (let i = 0; i < length; i += 1) {
    const t = i / length;
    const freq = spec.freqStart * (spec.freqEnd / Math.max(1, spec.freqStart)) ** t;
    phase += freq / context.sampleRate;

    noiseState = (noiseState * 16807) % 2147483647;
    const noise = (noiseState / 2147483647) * 2 - 1;

    const attack = i < attackSamples ? i / attackSamples : 1;
    const decay = Math.exp(-4.2 * t);
    data[i] = waveSample(spec.wave, phase, noise) * attack * decay * spec.volume;
  }

  return buffer;
}

/**
 * Banque de sons du jeu. Une instance par partie n'est pas nécessaire : la banque est
 * sans état de jeu, seul le compteur d'étranglement bouge.
 */
export class Sfx {
  /**
   * @param {object} juice Config validée (`parseJuiceConfig`)
   * @param {object} [options]
   * @param {typeof AudioContext} [options.AudioContextClass] Injectable pour les tests
   * @param {() => number} [options.now] Horloge en ms, injectable
   */
  constructor(juice, { AudioContextClass, now = () => performance.now() } = {}) {
    this.juice = juice;
    this.now = now;
    this.AudioContextClass =
      AudioContextClass ?? globalThis.AudioContext ?? globalThis.webkitAudioContext ?? null;

    this.context = null;
    this.master = null;
    /** @type {Map<string, AudioBuffer>} */
    this.buffers = new Map();
    /** @type {Map<string, number>} Dernier instant de lecture, par son. */
    this.lastPlayedAt = new Map();
    // La préférence survit à la partie et au rechargement : un joueur qui coupe le son ne
    // doit pas le retrouver au « rejouer ».
    this.enabled = readSoundEnabled(juice.sound.enabled);
  }

  /**
   * Crée le contexte audio et rend les sons. À appeler **depuis un geste utilisateur**.
   * Idempotent, et silencieux si le navigateur refuse l'audio.
   *
   * @returns {boolean} true si l'audio est prêt
   */
  unlock() {
    if (this.context) {
      // Un contexte suspendu (onglet revenu au premier plan) se relance ici.
      if (this.context.state === 'suspended') this.context.resume?.();
      return true;
    }
    if (!this.AudioContextClass) return false;

    try {
      this.context = new this.AudioContextClass({ sampleRate: SAMPLE_RATE });
    } catch {
      // Certains navigateurs refusent un `sampleRate` imposé : on retente au défaut.
      try {
        this.context = new this.AudioContextClass();
      } catch {
        this.AudioContextClass = null;
        return false;
      }
    }

    this.master = this.context.createGain();
    this.master.gain.value = this.enabled ? this.juice.sound.masterVolume : 0;
    this.master.connect(this.context.destination);

    for (const [name, spec] of Object.entries(this.juice.sfx)) {
      this.buffers.set(name, renderSound(this.context, spec));
    }
    return true;
  }

  /** Coupe ou rallume le son, et mémorise le choix. @returns {boolean} nouvel état */
  toggle() {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    writeSoundEnabled(this.enabled);
    if (this.master) this.master.gain.value = this.enabled ? this.juice.sound.masterVolume : 0;
  }

  /**
   * Joue un son, s'il est prêt, autorisé et hors de sa fenêtre d'étranglement.
   *
   * @param {string} name Clé de `juice.sfx`
   * @returns {boolean} true si le son a réellement été joué
   */
  play(name) {
    if (!this.enabled || !this.context) return false;
    const buffer = this.buffers.get(name);
    if (!buffer) return false;

    const spec = this.juice.sfx[name];
    const time = this.now();
    const last = this.lastPlayedAt.get(name);
    // Ignoré, pas mis en file : un son en retard sur son événement ment sur ce qui se passe.
    if (last !== undefined && time - last < spec.minIntervalMs) return false;
    this.lastPlayedAt.set(name, time);

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.master);
    source.start();
    return true;
  }

  /** Ferme le contexte audio (fin de scène). */
  destroy() {
    this.buffers.clear();
    this.lastPlayedAt.clear();
    try {
      this.context?.close?.();
    } catch {
      // Un contexte déjà fermé n'est pas un problème.
    }
    this.context = null;
    this.master = null;
  }
}

export default Sfx;
