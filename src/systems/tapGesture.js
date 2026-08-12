/**
 * Distinction **tap / glisser** — logique pure, sans Phaser, donc testable.
 *
 * C'est toute l'ergonomie du Lot 2.5 : le même doigt sur le même item fait deux choses
 * opposées (envoyer au combat / fusionner), et la seule différence est le geste. Deux
 * seuils, tous les deux dans `balance.json` (section `input`) pour être réglés au Lot 3
 * sans toucher au code :
 *
 *   - **distance** (`tapMaxDistancePx`) : au-delà, le doigt a traîné, c'est un drag. Le
 *     même seuil est donné à Phaser (`input.dragDistanceThreshold`), pour que le drag ne
 *     démarre **jamais** avant que le tap ne soit écarté — sans quoi les deux gestes se
 *     déclencheraient en même temps sur un petit mouvement.
 *   - **durée** (`tapMaxDurationMs`) : au-delà, le doigt est resté posé, ce n'est plus un
 *     tap. Un appui long ne déclenche donc rien plutôt que d'envoyer une unité par
 *     surprise pendant que le joueur réfléchit.
 *
 * Les seuils sont en **pixels CSS** : le canvas étant en `Scale.RESIZE` sans
 * suréchantillonnage (cf. README), un pixel de monde est un pixel CSS sur tous les écrans.
 */

/**
 * Valide et normalise la section `input` de `balance.json`.
 *
 * @param {object} balance Contenu de `balance.json`
 * @returns {{tapMaxDistancePx: number, tapMaxDurationMs: number}}
 */
export function parseInputConfig(balance) {
  const raw = balance?.input;
  if (!raw || typeof raw !== 'object') {
    throw new Error('balance.json : section `input` manquante');
  }

  const number = (key, { min, max }) => {
    const value = raw[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`balance.json : input.${key} manquant ou non numérique`);
    }
    if (value < min || value > max) {
      throw new Error(`balance.json : input.${key} hors bornes [${min}, ${max}]`);
    }
    return value;
  };

  return {
    tapMaxDistancePx: number('tapMaxDistancePx', { min: 1, max: 200 }),
    tapMaxDurationMs: number('tapMaxDurationMs', { min: 50, max: 5000 }),
  };
}

/**
 * Distance parcourue par le pointeur entre l'appui et le relâcher.
 *
 * Distance euclidienne : un geste est un glisser quelle que soit sa direction.
 */
export function gestureDistance({ startX, startY, endX, endY }) {
  return Math.hypot(endX - startX, endY - startY);
}

/**
 * Vrai si le geste est un **tap** : un doigt qui a bougé de peu, pendant peu de temps.
 *
 * @param {{startX: number, startY: number, endX: number, endY: number,
 *          startTime: number, endTime: number}} gesture Coordonnées en pixels, temps en ms
 * @param {{tapMaxDistancePx: number, tapMaxDurationMs: number}} config
 * @returns {boolean}
 */
export function isTap(gesture, config) {
  if (!gesture || !config) return false;
  const duration = gesture.endTime - gesture.startTime;
  if (!(duration >= 0) || duration > config.tapMaxDurationMs) return false;
  return gestureDistance(gesture) <= config.tapMaxDistancePx;
}

export default isTap;
