/**
 * File d'attente des **types** d'unités envoyées au combat.
 *
 * Le seed doc ne type pas les items de la grille : c'est cette file qui décide quel type
 * d'unité naît du prochain tap. Elle est **déterministe** (un motif parcouru en boucle,
 * défini dans `balance.json`) et **visible** dans le HUD, pour que le joueur puisse
 * planifier ses envois — un tirage aléatoire rendrait la planification impossible et le
 * pont grille → bande illisible.
 *
 * ## « Passer » (Lot 3.5)
 *
 * Voir la file ne suffisait pas : l'information était affichée mais ne nourrissait aucun
 * choix. Le bouton **passer** défausse le type de tête et fait avancer la file d'un cran,
 * contre un cooldown (`battle.skipCooldownMs`). C'est ce qui transforme la file en levier :
 * l'annonce de vague dit ce qui arrive, la file dit ce qu'on peut envoyer, et « passer »
 * est le coup qui réconcilie les deux — au prix d'une attente.
 *
 * Le cooldown est **remis à zéro par un skip uniquement** : laisser la file tranquille
 * garde le bouton prêt, on ne punit pas le joueur qui n'en a pas eu besoin.
 *
 * Pur, sans Phaser.
 */
export class UnitQueue {
  /**
   * @param {string[]} pattern Motif de types, parcouru en boucle (`battle.unitTypePattern`)
   * @param {object} [options]
   * @param {number} [options.skipCooldownMs] Cooldown du bouton « passer » (0 = toujours prêt)
   * @param {() => object} [options.getModifiers] Modificateurs de draft (« Réflexe »)
   */
  constructor(pattern, { skipCooldownMs = 0, getModifiers = null } = {}) {
    if (!Array.isArray(pattern) || pattern.length === 0) {
      throw new Error('UnitQueue attend un motif non vide');
    }
    this.pattern = [...pattern];
    this.cursor = 0;
    this.baseSkipCooldownMs = Math.max(0, skipCooldownMs);
    this.getModifiers = getModifiers;
    /** Temps restant avant que « passer » redevienne disponible ; 0 = prêt. */
    this.skipCooldownMs = 0;
    /** Défausses effectuées — lu par le récap de fin de partie. */
    this.skipCount = 0;
  }

  /** Type de la prochaine unité produite, sans avancer. */
  peek() {
    return this.pattern[this.cursor % this.pattern.length];
  }

  /**
   * Types des `count` prochaines unités, sans avancer — le HUD en affiche trois.
   *
   * @param {number} count
   * @returns {string[]}
   */
  preview(count) {
    const types = [];
    for (let i = 0; i < Math.max(0, count); i += 1) {
      types.push(this.pattern[(this.cursor + i) % this.pattern.length]);
    }
    return types;
  }

  /** Consomme le type courant et avance d'un cran. */
  take() {
    const type = this.peek();
    this.cursor = (this.cursor + 1) % this.pattern.length;
    return type;
  }

  // ------------------------------------------------------------------ passer

  /** Durée du cooldown de « passer », améliorations comprises. */
  skipCooldownDurationMs() {
    return this.baseSkipCooldownMs * (this.getModifiers?.()?.skipCooldown ?? 1);
  }

  /** Vrai si le bouton « passer » est disponible. */
  canSkip() {
    return this.skipCooldownMs <= 0;
  }

  /**
   * Avancement du cooldown de « passer », de 0 (vient d'être utilisé) à 1 (prêt).
   * C'est ce que le bouton affiche.
   */
  skipRatio() {
    const total = this.skipCooldownDurationMs();
    if (total <= 0) return 1;
    return Math.min(1, Math.max(0, 1 - this.skipCooldownMs / total));
  }

  /** Fait tourner le cooldown de « passer ». */
  update(dtMs) {
    if (!Number.isFinite(dtMs) || dtMs <= 0) return;
    if (this.skipCooldownMs > 0) this.skipCooldownMs = Math.max(0, this.skipCooldownMs - dtMs);
  }

  /**
   * Défausse le type de tête : la file avance sans qu'aucune unité ne parte au combat.
   *
   * @returns {string|null} Le type défaussé, ou null si le cooldown n'est pas écoulé
   */
  skip() {
    if (!this.canSkip()) return null;
    const discarded = this.take();
    this.skipCooldownMs = this.skipCooldownDurationMs();
    this.skipCount += 1;
    return discarded;
  }

  /** Remet la file à son point de départ (nouvelle partie). */
  reset() {
    this.cursor = 0;
    this.skipCooldownMs = 0;
    this.skipCount = 0;
  }
}

export default UnitQueue;
