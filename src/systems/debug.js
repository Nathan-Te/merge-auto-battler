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

export default isDebugEnabled;
