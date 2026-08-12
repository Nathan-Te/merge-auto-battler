/**
 * `OverlayGuard` — protection d'inputs des écrans qui s'ouvrent **par-dessus le jeu**.
 * Pur, sans Phaser, sans horloge (le temps est passé en argument).
 *
 * ## Le problème, remonté au playtest du Lot 3.5
 *
 * Le draft s'ouvre à la fin d'une vague, c'est-à-dire pile au moment où le joueur est en
 * train de fusionner. Le doigt est déjà posé sur l'écran, il se relève une fraction de
 * seconde plus tard — sur une carte. L'amélioration est prise **sans avoir été lue**, et
 * elle vaut pour toute la partie : c'est le pire clic accidentel possible.
 *
 * ## Les deux verrous
 *
 *   1. **Un appui postérieur à l'ouverture est exigé.** Un doigt déjà enfoncé quand l'écran
 *      s'ouvre n'a jamais émis d'appui *sur* la carte : `release()` ne trouve rien et rend
 *      `false`. C'est le verrou principal, et il est absolu — aucun réglage ne peut le
 *      contourner.
 *   2. **Un délai de grâce** (`graceMs`) pendant lequel les appuis ne sont pas enregistrés
 *      du tout. Il couvre le cas que le premier verrou laisse passer : un joueur qui tape
 *      la grille en rafale peut poser **un nouveau** doigt 30 ms après l'ouverture, ce qui
 *      est un appui postérieur parfaitement valide et pourtant pas une décision.
 *
 * Les deux sont nécessaires : le premier attrape le doigt déjà posé, le second le doigt qui
 * arrive trop vite. Ce couple est le patron à réutiliser pour tout futur overlay
 * (cf. `CLAUDE.md`).
 */
export class OverlayGuard {
  /**
   * @param {object} [options]
   * @param {number} [options.graceMs] Délai après l'ouverture pendant lequel aucun appui
   *   n'est enregistré. 0 désactive ce second verrou — jamais le premier.
   */
  constructor({ graceMs = 0 } = {}) {
    this.graceMs = Math.max(0, graceMs);
    this.openedAtMs = null;
    /** @type {Map<number, any>} Cible de l'appui en cours, par identifiant de pointeur. */
    this.presses = new Map();
  }

  /**
   * Ouvre l'écran. Les appuis déjà en cours ne sont **pas** repris : c'est tout l'intérêt.
   *
   * @param {number} nowMs Horloge de la scène
   */
  open(nowMs) {
    this.openedAtMs = nowMs;
    this.presses.clear();
  }

  /** Vrai si le délai de grâce est écoulé et que les appuis comptent. */
  isArmed(nowMs) {
    if (this.openedAtMs === null) return false;
    return nowMs - this.openedAtMs >= this.graceMs;
  }

  /**
   * Avancement du délai de grâce, de 0 (vient d'ouvrir) à 1 (armé). C'est ce que l'écran
   * affiche pour que l'attente se voie au lieu de paraître un bug.
   */
  armRatio(nowMs) {
    if (this.openedAtMs === null) return 0;
    if (this.graceMs <= 0) return 1;
    return Math.min(1, Math.max(0, (nowMs - this.openedAtMs) / this.graceMs));
  }

  /**
   * Enregistre un appui sur une cible.
   *
   * @param {number} pointerId
   * @param {any} target Cible opaque (une carte, un bouton…)
   * @param {number} nowMs
   * @returns {boolean} false si l'appui est ignoré (écran fermé ou grâce en cours)
   */
  press(pointerId, target, nowMs) {
    if (!this.isArmed(nowMs)) return false;
    this.presses.set(pointerId, target);
    return true;
  }

  /**
   * Relâche un pointeur.
   *
   * @param {number} pointerId
   * @param {any} target Cible sur laquelle le doigt se relève
   * @returns {boolean} true seulement si **ce** pointeur avait appuyé sur **cette** cible
   *   après l'ouverture — un doigt qui glisse d'une carte à l'autre n'active donc rien non
   *   plus, ce qui est la même exigence de geste délibéré.
   */
  release(pointerId, target) {
    const pressed = this.presses.get(pointerId);
    this.presses.delete(pointerId);
    return pressed !== undefined && pressed === target;
  }

  /** Oublie un appui (pointeur sorti de l'écran, geste annulé). */
  cancel(pointerId) {
    this.presses.delete(pointerId);
  }

  /** Referme l'écran : plus rien n'est armé, plus aucun appui n'est en attente. */
  close() {
    this.openedAtMs = null;
    this.presses.clear();
  }
}

export default OverlayGuard;
