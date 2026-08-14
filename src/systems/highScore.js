/**
 * Record local — `localStorage`, aucune donnée personnelle (cf. `docs/seed.md`).
 *
 * Le stockage est injectable pour que ce module se teste sans navigateur, et toutes les
 * lectures/écritures sont protégées : Safari en navigation privée, un quota plein ou un
 * stockage désactivé lèvent une exception qui ne doit **jamais** casser une partie.
 */

const STORAGE_KEY = 'mergeBattler.bestWaves';

/** Récupère `localStorage` s'il est réellement utilisable, sinon null. */
export function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Record enregistré, ou 0 si aucun (ou stockage indisponible / corrompu). */
export function readBest(storage = defaultStorage()) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  } catch {
    return 0;
  }
}

/**
 * Enregistre un score s'il bat le record.
 *
 * @param {number} score Vagues survécues
 * @returns {{best: number, isRecord: boolean}}
 */
export function submitScore(score, storage = defaultStorage()) {
  const value = Number.isFinite(score) && score > 0 ? Math.floor(score) : 0;
  const previous = readBest(storage);
  if (value <= previous) return { best: previous, isRecord: false };

  try {
    storage?.setItem(STORAGE_KEY, String(value));
  } catch {
    // Stockage indisponible : le record vaut pour la session en cours, sans persister.
  }
  return { best: value, isRecord: true };
}

export { STORAGE_KEY };
