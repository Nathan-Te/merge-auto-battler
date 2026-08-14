/**
 * `JuiceKit` — la boîte à outils de feedback partagée par la scène et la vue de combat.
 *
 * Particules, secousses, vignette de dégâts, sons et musique vivent ici, en **un seul
 * exemplaire** par partie : `GameScene` la possède et la prête à `BattleView`. Sans ça, chaque vue
 * gérerait son propre pool de particules et son propre contexte audio, et le budget de
 * performance du Lot 3 (60 fps mobile en charge) partirait en doublons.
 *
 * Aucune règle de gameplay, aucune valeur en dur : tout vient de `juice.json`.
 */

import { ParticleField } from './particles.js';
import { AudioBank, collectSamples } from '../systems/audio.js';
import { DEPTH } from './depths.js';

const VIGNETTE_KEY = 'juice-vignette';
const VIGNETTE_SIZE = 256;

/**
 * Fabrique (une fois par jeu) la texture de vignette : un dégradé radial transparent au
 * centre, rouge sur les bords. Une texture de 256², générée au démarrage — zéro octet
 * téléchargé, et un seul quad à l'écran plutôt qu'un empilement de rectangles.
 */
function ensureVignetteTexture(scene) {
  if (scene.textures.exists(VIGNETTE_KEY)) return true;

  const texture = scene.textures.createCanvas(VIGNETTE_KEY, VIGNETTE_SIZE, VIGNETTE_SIZE);
  if (!texture) return false;

  const ctx = texture.getContext();
  const half = VIGNETTE_SIZE / 2;
  const gradient = ctx.createRadialGradient(half, half, half * 0.55, half, half, half);
  gradient.addColorStop(0, 'rgba(255, 70, 70, 0)');
  gradient.addColorStop(0.65, 'rgba(255, 55, 55, 0.35)');
  gradient.addColorStop(1, 'rgba(255, 40, 40, 1)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, VIGNETTE_SIZE, VIGNETTE_SIZE);
  texture.refresh();
  return true;
}

export class JuiceKit {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} juice Config validée (`parseJuiceConfig`)
   */
  constructor(scene, juice) {
    this.scene = scene;
    this.config = juice;

    this.particles = new ParticleField(scene, {
      poolSize: juice.particles.poolSize,
      gravityPx: juice.particles.gravityPx,
      dragPerSecond: juice.particles.dragPerSecond,
      depth: DEPTH.particles,
    });

    // `sfx` reste le nom historique : tout le jeu appelle `juice.sfx.unlock()` /
    // `.toggle()`, et `AudioBank` expose la même surface. Ce qui change est dessous —
    // un échantillon livré remplace sa version synthétisée, son par son.
    this.sfx = new AudioBank(juice, {
      samples: collectSamples(scene, scene.registry.get('assetIndex')),
    });

    this.vignette = ensureVignetteTexture(scene)
      ? scene.add.image(0, 0, VIGNETTE_KEY).setOrigin(0, 0).setAlpha(0).setDepth(DEPTH.vignette)
      : null;

    /** Dernière secousse : sert à tenir la promesse de parcimonie (cf. `shake`). */
    this.lastShakeAt = -Infinity;
  }

  /**
   * Redimensionne ce qui couvre l'écran. Appelé à chaque `resize`.
   *
   * `pixelSize` est la **trame de dessin** : le côté d'un pixel d'art en unités de jeu, tel
   * que le layout courant le donne (cf. `src/systems/pixelScale.js`). Il transite par ici
   * plutôt que d'être recalculé dans le champ de particules, parce que c'est la scène qui
   * connaît la place accordée à la grille — et qu'il n'y a qu'un endroit où le dire.
   *
   * @param {number} width
   * @param {number} height
   * @param {{pixelSize?: number}} [options]
   */
  layout(width, height, { pixelSize } = {}) {
    this.vignette?.setDisplaySize(width, height);
    if (pixelSize) this.particles.setPixelSize(pixelSize);
  }

  /**
   * Secousse de caméra, **étranglée**.
   *
   * Le seed doc demande un screenshake « léger et parcimonieux » : le garde-fou n'est donc
   * pas dans l'appelant (qui oublierait) mais ici. Deux événements majeurs rapprochés
   * secouent une fois, pas deux — sauf le game over, qui a le droit de couper la file.
   *
   * @param {'baseDamage'|'tankDeath'|'gameOver'} kind Entrée de `juice.shake`
   */
  shake(kind) {
    const spec = this.config.shake[kind];
    if (!spec) return false;

    const now = this.scene.time.now;
    const forced = kind === 'gameOver';
    if (!forced && now - this.lastShakeAt < this.config.shake.minIntervalMs) return false;
    this.lastShakeAt = now;

    this.scene.cameras.main.shake(spec.durationMs, spec.intensity);
    return true;
  }

  /** Voile rouge sur les bords de l'écran, qui s'efface. La base vient d'encaisser. */
  flashVignette() {
    const vignette = this.vignette;
    if (!vignette) return;
    this.scene.tweens.killTweensOf(vignette);
    vignette.setAlpha(this.config.base.vignetteAlpha);
    this.scene.tweens.add({
      targets: vignette,
      alpha: 0,
      duration: this.config.base.vignetteFadeMs,
      ease: 'Quad.easeOut',
    });
  }

  /** Éteint la vignette immédiatement (avant une mise en pause, qui gèlerait le fondu). */
  clearVignette() {
    if (!this.vignette) return;
    this.scene.tweens.killTweensOf(this.vignette);
    this.vignette.setAlpha(0);
  }

  /** Raccourci : une gerbe de particules à une couleur donnée. */
  burst(x, y, spec, color) {
    this.particles.burst(x, y, { ...spec, color });
  }

  /** Un son, s'il est déverrouillé et hors étranglement. */
  play(name) {
    return this.sfx.play(name);
  }

  /** La boucle musicale — sans effet tant qu'aucune musique n'a été livrée. */
  startMusic() {
    return this.sfx.startMusic();
  }

  /** Le sting de défaite, dans le silence laissé par la musique coupée. */
  playDefeat() {
    return this.sfx.playDefeat();
  }

  update(deltaMs) {
    this.particles.update(deltaMs);
  }

  destroy() {
    this.particles.destroy();
    this.sfx.destroy();
    this.vignette?.destroy();
    this.vignette = null;
  }
}

export default JuiceKit;
