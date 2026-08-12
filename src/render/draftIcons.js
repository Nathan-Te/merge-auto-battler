/**
 * Greybox des cartes d'amélioration : une forme et une teinte par **famille** d'effet.
 *
 * Aucune règle, aucun état — comme `tierShapes.js` et `battleShapes.js`. Les clés d'icône
 * viennent de `balance.json` (`draft.upgrades[].icon`), mais ce qu'elles dessinent est
 * décidé ici : une icône n'influence rien, c'est de la lisibilité.
 *
 * La teinte porte plus d'information que la forme sur un écran de téléphone : deux cartes
 * de la même couleur touchent la même moitié du jeu (bleu = les unités, ambre = la grille
 * et la file, vert = la base). C'est ce qui permet de lire une offre de trois cartes d'un
 * coup d'œil avant même d'avoir lu les libellés.
 */

/** Teinte par famille — accordée aux couleurs déjà utilisées par le jeu. */
export const ICON_COLORS = {
  /** Ce qui rend les unités meilleures. */
  rate: 0x4d96ff,
  damage: 0xff7a45,
  range: 0x4ecdc4,
  shield: 0x8fa5ff,
  aura: 0xc9a6ff,
  /** Ce qui touche la grille, la file et le tempo. */
  clock: 0xffd93d,
  slot: 0xffb648,
  tier: 0xffe08a,
  grid: 0xf0c14b,
  skip: 0xffa8d2,
  /** Ce qui touche la base. */
  base: 0x6bcb77,
};

const FALLBACK_COLOR = 0x8f97b0;

/** Couleur d'une icône de carte (clé inconnue : gris neutre). */
export function iconColor(icon) {
  return ICON_COLORS[icon] ?? FALLBACK_COLOR;
}

/**
 * Dessine l'icône d'une carte, centrée sur (0, 0).
 *
 * @param {Phaser.GameObjects.Graphics} graphics
 * @param {string} icon Clé d'icône (`draft.upgrades[].icon`)
 * @param {number} size Diamètre visuel visé
 */
export function drawDraftIcon(graphics, icon, size) {
  const r = size / 2;
  const color = iconColor(icon);
  graphics.clear();
  graphics.fillStyle(color, 1);
  graphics.lineStyle(Math.max(1.5, size * 0.09), color, 1);

  switch (icon) {
    // Cadence : un chevron double, la lecture universelle de « plus vite ».
    case 'rate':
      chevron(graphics, -r * 0.55, r);
      chevron(graphics, r * 0.15, r);
      return;
    // Puissance : une pointe, dirigée vers la cible.
    case 'damage':
      fillPoints(graphics, [
        { x: r, y: 0 },
        { x: -r * 0.5, y: -r * 0.8 },
        { x: -r * 0.15, y: 0 },
        { x: -r * 0.5, y: r * 0.8 },
      ]);
      return;
    // Portée : deux arcs concentriques, comme une onde qui s'éloigne.
    case 'range':
      graphics.beginPath();
      graphics.arc(-r * 0.6, 0, r * 0.75, -0.9, 0.9);
      graphics.strokePath();
      graphics.beginPath();
      graphics.arc(-r * 0.6, 0, r * 1.25, -0.8, 0.8);
      graphics.strokePath();
      return;
    // Blindage : un écu.
    case 'shield':
      fillPoints(graphics, [
        { x: 0, y: -r },
        { x: r * 0.85, y: -r * 0.45 },
        { x: r * 0.6, y: r * 0.75 },
        { x: 0, y: r },
        { x: -r * 0.6, y: r * 0.75 },
        { x: -r * 0.85, y: -r * 0.45 },
      ]);
      return;
    // Aura : un noyau plein, un halo autour.
    case 'aura':
      graphics.fillCircle(0, 0, r * 0.42);
      graphics.strokeCircle(0, 0, r * 0.92);
      return;
    // Cooldown de sortie : un cadran avec son aiguille.
    case 'clock':
      graphics.strokeCircle(0, 0, r * 0.88);
      graphics.lineBetween(0, 0, 0, -r * 0.6);
      graphics.lineBetween(0, 0, r * 0.45, 0);
      return;
    // File élargie : trois cases, la dernière ouverte.
    case 'slot': {
      const box = r * 0.55;
      graphics.fillRect(-r, -box / 2, box, box);
      graphics.fillRect(-box / 2, -box / 2, box, box);
      graphics.strokeRect(r - box, -box / 2, box, box);
      return;
    }
    // Tier d'apparition : deux marches qui montent.
    case 'tier':
      graphics.fillRect(-r, r * 0.1, r * 0.7, r * 0.8);
      graphics.fillRect(-r * 0.2, -r * 0.4, r * 0.7, r * 1.3);
      graphics.fillRect(r * 0.55, -r * 0.9, r * 0.7, r * 1.8);
      return;
    // Cadence d'items : une grille.
    case 'grid': {
      const cell = r * 0.7;
      for (const cx of [-cell * 0.75, cell * 0.05]) {
        for (const cy of [-cell * 0.75, cell * 0.05]) {
          graphics.fillRect(cx, cy, cell * 0.6, cell * 0.6);
        }
      }
      return;
    }
    // Passer : une flèche qui saute par-dessus.
    case 'skip':
      fillPoints(graphics, [
        { x: -r, y: -r * 0.7 },
        { x: r * 0.1, y: 0 },
        { x: -r, y: r * 0.7 },
      ]);
      graphics.fillRect(r * 0.35, -r * 0.7, r * 0.4, r * 1.4);
      return;
    // Base : un bloc et son toit.
    case 'base':
      fillPoints(graphics, [
        { x: 0, y: -r },
        { x: r, y: -r * 0.2 },
        { x: r, y: r * 0.85 },
        { x: -r, y: r * 0.85 },
        { x: -r, y: -r * 0.2 },
      ]);
      return;
    default:
      graphics.fillCircle(0, 0, r * 0.8);
  }
}

function fillPoints(graphics, points) {
  graphics.fillPoints(points, true, true);
}

/** Un chevron « > », dessiné en trait, dont la pointe regarde à droite. */
function chevron(graphics, offsetX, r) {
  graphics.beginPath();
  graphics.moveTo(offsetX - r * 0.3, -r * 0.7);
  graphics.lineTo(offsetX + r * 0.4, 0);
  graphics.lineTo(offsetX - r * 0.3, r * 0.7);
  graphics.strokePath();
}

export default drawDraftIcon;
