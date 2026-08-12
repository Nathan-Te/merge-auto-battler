import Phaser from 'phaser';

import { bufferSize, effectivePixelRatio, textResolution } from '../systems/pixelRatio.js';

/**
 * Rendu à la **résolution physique** de l'écran, sans qu'aucune scène ne le sache.
 *
 * Phaser en `Scale.RESIZE` dimensionne la mémoire de rendu du canvas à la taille **CSS** du
 * viewport : sur un téléphone à `devicePixelRatio` 3, le navigateur étire ensuite l'image
 * sur trois fois plus de pixels, et tout est flou. Ce module remet les choses en place :
 *
 * ```
 *   mémoire de rendu   = taille CSS × ratio        (on dessine à la résolution de l'écran)
 *   style CSS du canvas= taille CSS                (il occupe la même place à l'écran)
 *   taille de jeu      = taille CSS                (les scènes ne voient aucun changement)
 *   zoom des caméras   = ratio                     (le facteur est absorbé ici, et là seulement)
 * ```
 *
 * ## Ce que fait Phaser, et ce qu'on lui ajoute
 *
 * `ScaleManager` distingue déjà deux tailles : `gameSize` — « la taille de jeu telle que
 * demandée », que voient les scènes — et `baseSize` — celle de la mémoire de rendu, que
 * suivent le renderer, les caméras et la mise à l'échelle des pointeurs. En mode `RESIZE`
 * il les garde égales ; on rouvre cet écart, et tout le reste de Phaser suit tout seul :
 *
 *   - le renderer redimensionne sa mémoire et sa matrice de projection sur `baseSize` ;
 *   - les caméras se dimensionnent sur `baseSize` (leur `scissor` est en pixels de mémoire) ;
 *   - `displayScale` (DOM → jeu) devient `baseSize / taille CSS`, donc les coordonnées de
 *     pointeur arrivent en pixels de mémoire… et `camera.getWorldPoint()` les redivise par
 *     le zoom. Les gestes retombent donc **exactement** sur les coordonnées logiques, sans
 *     qu'un seul seuil de `balance.json` ait à changer.
 *
 * La caméra est ancrée en **(0, 0) d'origine** : sa matrice se réduit alors à une homothétie
 * pure de facteur `ratio` (`Camera.preRender` compose `translate(origine) · zoom ·
 * translate(-origine)`), donc le monde 0..largeur couvre pile la mémoire 0..largeur×ratio.
 * Avec l'origine par défaut de 0,5, le contenu partirait de travers d'un demi-écran.
 *
 * ## Pourquoi une synchronisation par frame
 *
 * Un `ScaleManager` en `RESIZE` réécrit `baseSize` et la taille du canvas à chaque
 * redimensionnement **et** à chaque changement d'orientation ; et une scène lancée en cours
 * de partie (draft, aide, game over) crée sa caméra à la taille de jeu, pas à celle de la
 * mémoire. Plutôt que de s'accrocher à trois événements différents et d'en oublier un
 * quatrième, on vérifie l'état à chaque frame : deux comparaisons d'entiers quand tout est
 * déjà en place, et une remise en ordre sinon. C'est ce qui rend la rotation d'écran et
 * l'ouverture d'un overlay correctes **par construction**.
 *
 * Ratio effectif de 1 (desktop ordinaire) : le module se débranche complètement, et le jeu
 * tourne exactement comme avant.
 */
export class HiDpi {
  /**
   * @param {Phaser.Game} game
   * @param {object} [options]
   * @param {number} [options.maxRatio] Plafond (`juice.render.maxPixelRatio`)
   * @param {number} [options.deviceRatio] Ratio de l'écran ; injectable pour les tests
   */
  constructor(game, { maxRatio, deviceRatio = window.devicePixelRatio } = {}) {
    this.game = game;
    this.ratio = effectivePixelRatio(deviceRatio, maxRatio);
    this.attached = false;
  }

  /** Résolution à donner aux objets `Text`. */
  get textResolution() {
    return textResolution(this.ratio);
  }

  /** Branche la synchronisation. Sans effet si le ratio effectif vaut 1. */
  attach() {
    if (this.attached || this.ratio === 1) return this;
    this.attached = true;
    this.game.events.on(Phaser.Core.Events.PRE_STEP, this.sync, this);
    this.sync();
    return this;
  }

  detach() {
    if (!this.attached) return;
    this.attached = false;
    this.game.events.off(Phaser.Core.Events.PRE_STEP, this.sync, this);
  }

  /** Remet mémoire de rendu et caméras d'aplomb si quelque chose a bougé. */
  sync() {
    const scale = this.game.scale;
    const buffer = bufferSize(scale.gameSize.width, scale.gameSize.height, this.ratio);

    if (this.game.canvas.width !== buffer.width || this.game.canvas.height !== buffer.height) {
      this.resizeBuffer(buffer, scale);
    }
    this.syncCameras(buffer);
  }

  /**
   * Porte la mémoire de rendu à la taille physique et le style CSS à la taille logique.
   */
  resizeBuffer(buffer, scale) {
    const canvas = this.game.canvas;
    const { width, height } = scale.gameSize;

    canvas.width = buffer.width;
    canvas.height = buffer.height;
    // Sans style explicite, le canvas s'affiche à la taille de sa mémoire de rendu — donc
    // deux à trois fois trop grand. C'est ce style qui le ramène à sa place.
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    scale.baseSize.setSize(buffer.width, buffer.height);
    this.game.renderer.resize(buffer.width, buffer.height);

    // `autoCenter` centre le canvas avec des marges calculées sur sa taille **affichée**.
    // Phaser les a posées avant qu'on ne change ce style : à la rotation, il mesurait encore
    // l'ancienne taille et décalait le canvas d'un demi-écran (constaté au navigateur —
    // marges de 195 px et −195 px après un passage en paysage). On les recalcule sur la
    // taille réelle.
    scale.updateBounds();
    scale.updateCenter();

    // `displayScale` convertit les coordonnées du DOM en coordonnées de jeu. Il se recalcule
    // depuis les bornes réelles du canvas plutôt que depuis le ratio : si un jour une marge
    // ou une transformation CSS s'ajoute, la conversion reste juste.
    scale.updateBounds();
    const bounds = scale.canvasBounds;
    if (bounds.width > 0 && bounds.height > 0) {
      scale.displayScale.set(buffer.width / bounds.width, buffer.height / bounds.height);
    }
  }

  /**
   * Aligne les caméras de **toutes** les scènes actives sur la mémoire de rendu.
   *
   * Une caméra couvre la mémoire entière (son `scissor` est en pixels de mémoire) et porte
   * le zoom ; l'origine à (0, 0) fait de sa matrice une homothétie pure, ce qui laisse les
   * coordonnées de jeu intactes.
   */
  syncCameras(buffer) {
    // **Toutes** les scènes, pas seulement les actives : une scène en pause continue de se
    // dessiner (c'est tout l'intérêt — le champ de bataille reste visible derrière le
    // draft). Ne synchroniser que les actives laisserait `GameScene` avec une caméra
    // périmée si l'écran tournait pendant qu'un overlay est ouvert. Les scènes pas encore
    // démarrées n'ont pas de caméra et sont ignorées d'elles-mêmes.
    for (const scene of this.game.scene.scenes) {
      for (const camera of scene.cameras?.cameras ?? []) {
        if (
          camera.zoomX === this.ratio &&
          camera.width === buffer.width &&
          camera.height === buffer.height
        ) {
          continue;
        }
        camera.setPosition(0, 0);
        camera.setSize(buffer.width, buffer.height);
        camera.setOrigin(0, 0);
        camera.setZoom(this.ratio);
      }
    }
  }
}

/**
 * Résolution de texture à donner aux `Text`.
 *
 * Un seul point de vérité : plus personne ne lit `window.devicePixelRatio` dans son coin
 * (chaque scène le plafonnait à 2 en dur, ce qui ignorait le réglage de `juice.json`).
 *
 * Accepte aussi bien une `Scene` qu'un objet de rendu qui en possède une (`BattleView`,
 * `IntelBar`, `DebugPanel`) : sur une `Scene`, `scene.scene` est le *plugin* de scène et non
 * la scène elle-même, une confusion facile à faire et silencieuse. Rendre 1 quand le module
 * n'est pas branché laisse le jeu fonctionner au lieu d'exploser sur un `undefined`.
 *
 * @param {Phaser.Scene|{scene: Phaser.Scene}} target
 * @returns {number}
 */
export function sceneTextResolution(target) {
  const game = target?.game ?? target?.scene?.game ?? target?.systems?.game;
  return game?.hiDpi?.textResolution ?? 1;
}

export default HiDpi;
