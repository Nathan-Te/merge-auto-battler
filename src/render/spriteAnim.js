/**
 * **Lecture des frames d'animation livrées par les packs** — pur, sans Phaser, donc testable.
 *
 * Le pipeline découpe désormais les personnages en **groupes** : une ancre (le sprite à
 * l'arrêt) et les frames de ses animations, rognées sur un cadre commun et rangées dans le
 * même atlas (cf. `src/tools/assets/run.js`). Ce module est ce qui les regarde défiler.
 *
 * ## Pourquoi pas le gestionnaire d'animations de Phaser
 *
 * Il est global au jeu : chaque animation devrait être déclarée sous une clé unique, et
 * **survivrait à la partie**. Or tout le reste du projet est bâti sur l'inverse — une partie
 * possède ses objets et les emporte dans son `destroy()`, ce qui rend le bug classique du
 * « rejouer » impossible par construction. Un compteur de temps de quinze lignes, posé sur la
 * vue qui l'utilise, évite d'ouvrir cette exception ; il se teste en prime sans canvas.
 *
 * ## Ce que ce module ne fait pas
 *
 * Il ne touche à aucun objet d'affichage : il rend un **nom de frame**, ou `null` quand rien
 * n'a changé. C'est l'appelant qui pose l'image — et ce `null` est ce qui garde le coût nul
 * quand rien ne bouge : à 6 images par seconde sur un écran qui en affiche 60, neuf frames sur
 * dix ne demandent aucun travail.
 *
 * ## La cadence
 *
 * Elle est **volontairement basse** (4 à 8 images par seconde) : c'est le rythme du pixel art,
 * et l'accélérer ne rend pas la marche plus fluide, elle la rend nerveuse. Elle vit dans
 * `juice.json` (`sprite.fps.<animation>`) parce que c'est du feel, avec une dérogation par
 * planche dans le manifest pour un pack dont le rythme sort de l'ordinaire.
 */

/** Nom de l'animation jouée par défaut quand l'état demandé n'existe pas sur la planche. */
export const FALLBACK_ANIMATION = 'idle';

/**
 * Cadence retenue pour une animation : la planche l'emporte, sinon `juice.json`.
 *
 * @param {{fps: number|null}|null} animation Entrée de l'index d'assets
 * @param {string} name Nom de l'animation (`walk`, `idle`…)
 * @param {Record<string, number>} [fpsTable] Bloc `sprite.fps` de `juice.json`
 * @returns {number} images par seconde, 0 = figée
 */
export function resolveFps(animation, name, fpsTable) {
  if (typeof animation?.fps === 'number') return animation.fps;
  const declared = fpsTable?.[name];
  if (typeof declared === 'number') return declared;
  return typeof fpsTable?.default === 'number' ? fpsTable.default : 0;
}

/**
 * Compteur de frames d'une seule animation.
 *
 * Il accumule le temps réel et ne rend un nom que lorsque la frame **change** ; le retard
 * accumulé par un onglet masqué est absorbé par un modulo plutôt que rattrapé image par
 * image, exactement comme `BattleModel` jette les ticks en retard.
 */
export class FrameCycler {
  constructor() {
    this.key = null;
    this.frames = [];
    this.fps = 0;
    this.index = 0;
    this.elapsedMs = 0;
  }

  /**
   * Démarre une animation, ou ne fait rien si c'est déjà celle qui tourne.
   *
   * @param {string} key Identité de l'animation en cours (sprite + nom d'animation)
   * @param {{frames: string[], fps: number}} animation
   * @returns {string|null} frame à poser si l'animation a changé, `null` sinon
   */
  play(key, { frames, fps }) {
    if (key === this.key) return null;
    this.key = key;
    this.frames = Array.isArray(frames) ? frames : [];
    this.fps = fps > 0 ? fps : 0;
    this.index = 0;
    this.elapsedMs = 0;
    return this.current;
  }

  /** Frame courante, ou `null` si l'animation est vide. */
  get current() {
    return this.frames[this.index] ?? null;
  }

  /**
   * Avance l'horloge de l'animation.
   *
   * @param {number} dtMs
   * @returns {string|null} nouvelle frame, ou `null` si elle n'a pas changé
   */
  advance(dtMs) {
    if (this.fps <= 0 || this.frames.length < 2 || !(dtMs > 0)) return null;
    this.elapsedMs += dtMs;
    const stepMs = 1000 / this.fps;
    if (this.elapsedMs < stepMs) return null;

    const steps = Math.floor(this.elapsedMs / stepMs);
    this.elapsedMs -= steps * stepMs;
    const next = (this.index + steps) % this.frames.length;
    if (next === this.index) return null;
    this.index = next;
    return this.current;
  }
}

/**
 * Animateur d'un objet d'affichage : il sait quel sprite il habille et quel état il joue.
 *
 * Un sprite sans animation déclarée — un orbe de la grille, une planche non animée, un repli
 * greybox — rend toujours `null` : l'appelant n'a donc **aucun test de disponibilité** à
 * écrire, ce qui est la même promesse que `visuals.js` fait pour les sprites eux-mêmes.
 */
export class SpriteAnimator {
  /**
   * @param {import('./skin.js').Skin|null} skin
   * @param {Record<string, number>} [fpsTable] Bloc `sprite.fps` de `juice.json`
   */
  constructor(skin, fpsTable) {
    this.skin = skin ?? null;
    this.fpsTable = fpsTable ?? null;
    this.cycler = new FrameCycler();
  }

  /**
   * Joue l'état demandé et avance d'une frame de rendu.
   *
   * @param {string|null} base Nom du sprite d'ancre (`enemy.fast`, `unit.aoe.2`…)
   * @param {string} state Animation voulue (`walk`, `idle`…)
   * @param {number} dtMs
   * @returns {string|null} frame à poser, ou `null` s'il n'y a rien à faire
   */
  update(base, state, dtMs) {
    const table = base ? this.skin?.animationsFor(base) : null;
    if (!table) return null;

    // Un pack qui ne dessine pas l'état demandé retombe sur l'arrêt plutôt que de se figer
    // sur la dernière frame jouée : une marche interrompue en plein pas se voit.
    const name = table[state] ? state : FALLBACK_ANIMATION;
    const animation = table[name];
    if (!animation) return null;

    const started = this.cycler.play(`${base}/${name}`, {
      frames: animation.frames,
      fps: resolveFps(animation, name, this.fpsTable),
    });
    return started ?? this.cycler.advance(dtMs);
  }
}

export default SpriteAnimator;
