/** Ordre d'affichage, partagé par toutes les scènes. Aucune règle : de la profondeur. */
export const DEPTH = {
  background: -10,
  panel: 0,
  cell: 1,
  item: 5,
  /**
   * **Bande des combattants du champ, unités et ennemis mélangés.**
   *
   * Depuis la répartition verticale, les deux camps ne peuvent plus être séparés par la
   * profondeur : deux entités qui se chevauchent doivent se trier sur leur **ordonnée**, quel
   * que soit leur camp, sinon un ennemi placé plus haut passe devant l'unité qui le mord.
   * `fighterDepth()` répartit tout le monde dans `[fighter, fighter + fighterSpan]`.
   *
   * Elle occupe la même valeur que `item` sans risque : les items vivent sur la grille et les
   * combattants dans la bande de combat, deux rectangles disjoints de l'écran.
   */
  fighter: 5,
  fighterSpan: 0.9,
  enemy: 6,
  tracer: 7,
  /** Particules : au-dessus des combattants, sous les objets qui volent. */
  particles: 8,
  flight: 18,
  drag: 20,
  hud: 30,
  banner: 40,
  /** Vignette de dégâts : par-dessus le jeu, sous l'écran de game over. */
  vignette: 45,
};

/**
 * Profondeur d'un combattant d'après sa position dans la bande de combat (**y-sort**).
 *
 * La valeur est **quantifiée** : la profondeur d'un objet Phaser ne sert qu'à trier, donc une
 * précision au millième ne change rien à l'écran mais salit la liste d'affichage à chaque
 * frame. Un cran par 1/128e de bande suffit largement à départager deux sprites de 16 px, et
 * l'appelant peut comparer la valeur rendue à la précédente pour ne rien réécrire quand elle
 * n'a pas bougé.
 *
 * @param {number} ratio Position verticale dans la bande, 0 en haut, 1 en bas
 * @returns {number}
 */
export function fighterDepth(ratio) {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0));
  return DEPTH.fighter + (Math.round(clamped * 128) / 128) * DEPTH.fighterSpan;
}

export default DEPTH;
