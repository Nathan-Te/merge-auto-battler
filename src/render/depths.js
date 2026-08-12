/** Ordre d'affichage, partagé par toutes les scènes. Aucune règle : de la profondeur. */
export const DEPTH = {
  background: -10,
  panel: 0,
  cell: 1,
  item: 5,
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

export default DEPTH;
