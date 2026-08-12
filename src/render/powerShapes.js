/**
 * Greybox des **items de pouvoir** : un disque cerclé, une teinte par type de pouvoir.
 *
 * Aucune règle, aucun état — comme `tierShapes.js` et `battleShapes.js`. Les identifiants de
 * pouvoir viennent de `balance.json`, mais ce qu'ils dessinent se décide ici : une couleur
 * n'influence rien, c'est de la lisibilité.
 *
 * **La silhouette porte la famille, la teinte porte le type.** Les items d'unité sont
 * anguleux (polygones puis étoiles, cf. `tierShapes.js`), les pouvoirs sont **ronds** — et
 * ils sont les seuls. C'est ce qui rend les deux taps impossibles à confondre au doigt : on
 * n'a pas à lire un numéro ni à reconnaître une couleur pour savoir qu'on s'apprête à
 * dépenser un pouvoir plutôt qu'à envoyer une unité. Le double cerclage renforce le
 * « bouton », et le tier reste écrit au centre comme partout ailleurs.
 */

/** Teinte par type de pouvoir. Volontairement à l'écart de la roue des tiers d'items. */
export const POWER_COLORS = {
  /** Soin : le vert d'une fiole, distinct du vert de tier 5 par sa saturation. */
  heal: 0x3ddc97,
  /** Météorite : le vermillon d'une braise. */
  meteor: 0xff5c39,
};

const FALLBACK_COLOR = 0xd7dbe8;

/** Couleur d'un type de pouvoir (type inconnu : gris clair neutre). */
export function powerColor(type) {
  return POWER_COLORS[type] ?? FALLBACK_COLOR;
}

/**
 * Dessine un item de pouvoir, centré sur (0, 0).
 *
 * Le **nombre d'anneaux** suit le tier de un à trois : à distance, un pouvoir mûr se
 * reconnaît sans lire son numéro, exactement comme un item d'unité se reconnaît à son
 * nombre de côtés.
 *
 * @param {Phaser.GameObjects.Graphics} graphics
 * @param {string} type Identifiant du pouvoir (`balance.json`)
 * @param {number} tier
 * @param {number} size Diamètre visuel visé
 */
export function drawPowerShape(graphics, type, tier, size) {
  const color = powerColor(type);
  const radius = size / 2;
  const line = Math.max(1, size * 0.05);

  graphics.clear();
  graphics.fillStyle(color, 1);
  graphics.fillCircle(0, 0, radius * 0.78);

  // Un liseré sombre détache l'item du fond de case, comme pour les items d'unité.
  graphics.lineStyle(line, 0x14161f, 0.55);
  graphics.strokeCircle(0, 0, radius * 0.78);

  graphics.lineStyle(line * 1.2, color, 0.95);
  const rings = Math.min(3, Math.max(1, Math.ceil(tier / 2)));
  for (let i = 0; i < rings; i += 1) {
    graphics.strokeCircle(0, 0, radius * (0.9 + i * 0.06));
  }
}

export default drawPowerShape;
