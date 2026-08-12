/**
 * Préférences locales du joueur — `localStorage`, aucune donnée personnelle (seed doc).
 *
 * Même prudence que `highScore.js` : Safari en navigation privée, un quota plein ou un
 * stockage désactivé lèvent une exception qui ne doit **jamais** casser une partie. Le
 * stockage est injectable pour que le module se teste sans navigateur.
 */

const SOUND_KEY = 'mergeBattler.sound';

/** Récupère `localStorage` s'il est réellement utilisable, sinon null. */
function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * État du son mémorisé, ou `fallback` si rien n'a jamais été choisi.
 *
 * @param {boolean} fallback Valeur par défaut (`juice.json`, `sound.enabled`)
 * @param {Storage|null} [storage]
 * @returns {boolean}
 */
export function readSoundEnabled(fallback = true, storage = defaultStorage()) {
  try {
    const raw = storage?.getItem(SOUND_KEY);
    if (raw === null || raw === undefined) return Boolean(fallback);
    return raw === '1';
  } catch {
    return Boolean(fallback);
  }
}

/** Mémorise le choix du joueur. Sans effet si le stockage est indisponible. */
export function writeSoundEnabled(enabled, storage = defaultStorage()) {
  try {
    storage?.setItem(SOUND_KEY, enabled ? '1' : '0');
  } catch {
    // Le choix vaut pour la session en cours, sans persister.
  }
}

export { SOUND_KEY };
