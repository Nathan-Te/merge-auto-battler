/**
 * File d'attente des **types** d'unités produits par les fusions de la grille.
 *
 * Le seed doc ne type pas les items de la grille : c'est cette file qui décide quel type
 * d'unité naît de la prochaine fusion. Elle est **déterministe** (un motif parcouru en
 * boucle, défini dans `balance.json`) et **visible** dans le HUD, pour que le joueur
 * puisse planifier ses fusions — un tirage aléatoire rendrait la planification impossible
 * et le pont grille → bande illisible.
 *
 * Pur, sans Phaser.
 */
export class UnitQueue {
  /**
   * @param {string[]} pattern Motif de types, parcouru en boucle (`battle.unitTypePattern`)
   */
  constructor(pattern) {
    if (!Array.isArray(pattern) || pattern.length === 0) {
      throw new Error('UnitQueue attend un motif non vide');
    }
    this.pattern = [...pattern];
    this.cursor = 0;
  }

  /** Type de la prochaine unité produite, sans avancer. */
  peek() {
    return this.pattern[this.cursor % this.pattern.length];
  }

  /**
   * Types des `count` prochaines unités, sans avancer — le HUD en affiche les deux
   * premières.
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

  /** Remet la file à son point de départ (nouvelle partie). */
  reset() {
    this.cursor = 0;
  }
}

export default UnitQueue;
