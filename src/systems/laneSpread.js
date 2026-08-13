/**
 * **Répartition verticale des combattants sur le couloir** — pur, sans Phaser, donc testable.
 *
 * Le champ de bataille du modèle est une **droite** : une seule coordonnée, `progress`, et
 * toutes les portées, tous les ciblages, tous les contacts s'y calculent. C'est ce qui rend la
 * simulation rejouable à l'identique dans vitest et mesurable au harness, et **rien de ce
 * fichier n'y touche**. Ce qu'il calcule est un décalage **purement cosmétique**, sur l'axe
 * perpendiculaire à la marche, pour qu'une vague de six squelettes ne ressemble plus à un
 * squelette.
 *
 * ## Pourquoi il vit ici et pas dans le modèle
 *
 * Parce qu'un tirage aléatoire dans `BattleModel` consommerait le générateur seedé de la
 * partie, et déplacerait **tout ce qui vient après** : la composition des vagues, le tirage du
 * draft, les items de la grille. Le harness rendrait d'autres chiffres, les tests
 * d'équilibrage tomberaient, et la cause serait un décor. Le décalage est donc dérivé de
 * l'**identifiant** de l'entité, qui existe déjà et que personne n'a besoin de tirer.
 *
 * ## Pourquoi une permutation et pas un hachage
 *
 * Un hachage répartit *en moyenne*, ce qui autorise deux voisins à tomber exactement au même
 * endroit — précisément le défaut qu'on vient corriger, et il se voit dès la première vague.
 * Les identifiants d'une vague sont **consécutifs** : en multipliant par un pas premier avec
 * le nombre de rangs, on obtient une bijection, donc `steps` entités successives occupent
 * `steps` rangs **différents**, et jamais deux fois le même. Le pas est choisi loin de 1 pour
 * que deux voisins de file ne soient pas non plus des voisins d'écran — sans quoi la vague
 * descend en escalier bien rangé, ce qui se remarque autant qu'un empilement.
 */

/** PGCD, pour choisir un pas premier avec le nombre de rangs. */
function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x;
}

/**
 * Pas de la permutation : le plus grand entier premier avec `steps` sous le nombre d'or.
 *
 * Le nombre d'or est le point de départ classique d'une suite qui ne fait ni paquet ni
 * escalier ; la coprimalité est ce qui garantit qu'aucun rang ne se répète avant que tous
 * soient sortis.
 *
 * @param {number} steps Nombre de rangs
 * @returns {number} pas ≥ 1
 */
export function coprimeStride(steps) {
  const count = Math.max(1, Math.floor(steps));
  if (count <= 2) return 1;
  for (let stride = Math.max(2, Math.round(count * 0.618)); stride > 1; stride -= 1) {
    if (gcd(stride, count) === 1) return stride;
  }
  return 1;
}

/**
 * Rang d'une entité dans la bande, de 0 (en haut) à `steps - 1` (en bas).
 *
 * @param {number} id Identifiant de l'entité, tel que `BattleModel` le lui a donné
 * @param {number} steps Nombre de rangs
 * @param {number} [salt] Décalage par camp : unités et ennemis ont des compteurs
 *   d'identifiants séparés, et sans lui ils partiraient tous les deux du même rang
 * @returns {number}
 */
export function laneRank(id, steps, salt = 0) {
  const count = Math.max(1, Math.floor(steps));
  if (count === 1) return 0;
  const index = Math.floor(id) + Math.floor(salt);
  const rank = (index * coprimeStride(count)) % count;
  return rank < 0 ? rank + count : rank;
}

/**
 * Décalage normalisé d'une entité : −1 tout en haut de la bande, +1 tout en bas.
 *
 * @param {number} id
 * @param {{steps: number, salt?: number}} options
 * @returns {number} valeur dans [-1, 1]
 */
export function laneOffsetRatio(id, { steps, salt = 0 } = {}) {
  const count = Math.max(1, Math.floor(steps));
  if (count === 1) return 0;
  return (laneRank(id, count, salt) / (count - 1)) * 2 - 1;
}

/**
 * Convertit un décalage normalisé en unités de jeu, dans l'épaisseur du couloir.
 *
 * Les deux marges sont des **fractions de l'épaisseur** et non des pixels : le couloir n'a pas
 * la même épaisseur sur un téléphone en portrait et sur un écran large, et une marge en dur y
 * mangerait tantôt rien, tantôt toute la bande. Elles n'ont aucune raison d'être égales — on
 * laisse volontiers plus de place en bas, où les barres de vie des uns passent devant la tête
 * des autres.
 *
 * @param {number} ratio Décalage normalisé, dans [-1, 1]
 * @param {number} thickness Épaisseur du couloir, en unités de jeu
 * @param {{marginStart: number, marginEnd: number}} margins Fractions laissées libres
 * @returns {number} décalage en unités de jeu, compté depuis l'axe du couloir
 */
export function laneOffsetLength(ratio, thickness, { marginStart = 0, marginEnd = 0 } = {}) {
  const span = Math.max(0, thickness);
  // Deux marges qui se recouvrent ne laisseraient plus de bande : on retombe alors sur l'axe
  // plutôt que sur une bande négative, qui inverserait le haut et le bas sans prévenir.
  const usable = span * Math.max(0, 1 - marginStart - marginEnd);
  const center = (span * (marginStart - marginEnd)) / 2;
  return center + (ratio * usable) / 2;
}

export default laneOffsetRatio;
