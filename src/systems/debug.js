/**
 * Mode debug — activé par `?debug=1` dans l'URL.
 *
 * Tout affichage de diagnostic (compteur de merges, FPS, ticks, état de la bande) passe
 * par ce drapeau : l'écran de jeu par défaut reste celui que verra un joueur de Crazy
 * Games, et le test au doigt d'une valeur d'équilibrage ne demande qu'un `?debug=1`.
 *
 * La chaîne est injectable pour rester testable hors navigateur.
 */
export function isDebugEnabled(search = globalThis.location?.search ?? '') {
  if (typeof search !== 'string' || search.length === 0) return false;
  const value = new URLSearchParams(search).get('debug');
  return value !== null && value !== '0' && value !== 'false';
}

/**
 * Plafond de résolution forcé par l'URL (`?dpr=1`, `?dpr=3`), ou `null`.
 *
 * Outil de mesure, pas de réglage : il sert à comparer netteté et coût de rendu sur un vrai
 * téléphone sans reconstruire le jeu. La valeur qui fait foi reste `render.maxPixelRatio`
 * dans `juice.json` (cf. `src/systems/pixelRatio.js`).
 *
 * @param {string} [search]
 * @returns {number|null}
 */
export function pixelRatioOverride(search = globalThis.location?.search ?? '') {
  if (typeof search !== 'string' || search.length === 0) return null;
  const raw = new URLSearchParams(search).get('dpr');
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 1 ? value : null;
}

/**
 * Vitesses de jeu proposées par le panneau de debug.
 *
 * Multiplier le temps plutôt que de toucher aux valeurs : la simulation reste identique
 * (tick fixe), on la regarde juste défiler plus vite. C'est ce qui permet de vérifier une
 * vague 12 en trente secondes au lieu de quatre minutes.
 */
export const DEBUG_SPEEDS = [1, 2, 4];

/** Vitesse suivante dans le cycle (revient à ×1 après la dernière). */
export function nextDebugSpeed(current) {
  const index = DEBUG_SPEEDS.indexOf(current);
  return DEBUG_SPEEDS[(index + 1) % DEBUG_SPEEDS.length];
}

export default isDebugEnabled;
