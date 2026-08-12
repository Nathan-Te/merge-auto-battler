/**
 * Harness de simulation headless — **le** outil d'équilibrage du Lot 3.
 *
 * Les modèles étant purs (aucune dépendance à Phaser), une partie complète se joue sans
 * canvas, sans horloge et sans joueur : `GameSession` avancée par pas fixes, pilotée par
 * une politique automatique (`./policies.js`). Un changement de `balance.json` se valide
 * ainsi **en secondes**, sur des dizaines de parties, au lieu d'un playtest par réglage.
 *
 * Deux garanties, sans lesquelles le harness ne servirait à rien :
 *
 *   - **déterminisme** : le tirage vient de `makeRng(seed)` et les politiques ne tirent
 *     rien. Même graine + même `balance.json` = même partie, à la milliseconde près.
 *   - **fidélité** : le harness ne réimplémente aucune règle. Il appelle `session.update()`,
 *     `applyTap()` et `applyDrop()` — exactement ce que fait la scène Phaser. L'apparition
 *     des items est celle de `GameSession` (cf. son horloge de spawn), pas une copie.
 *
 * Ce qu'il **ne** mesure pas : le feel, la lisibilité, la précision du doigt. Une politique
 * joue parfaitement dans les limites qu'on lui donne — les chiffres qui en sortent sont une
 * borne haute, à confronter au playtest (cf. `docs/balance-notes.md`).
 */

import { GameSession } from '../systems/GameSession.js';
import { makeRng } from '../systems/rng.js';

/** Réglages par défaut d'une partie simulée. */
export const SIM_DEFAULTS = {
  /** Pas de simulation. 50 ms = deux pas par tick logique, comme une frame de 20 fps. */
  stepMs: 50,
  /**
   * Cadence d'action de la politique : un joueur mobile enchaîne ~3 gestes par seconde en
   * pointe. Plus rapide mesurerait un robot, plus lent un joueur endormi.
   */
  actionIntervalMs: 300,
  /** Garde-fou : une partie qui dépasse ce temps est comptée comme « survie infinie ». */
  maxDurationMs: 20 * 60 * 1000,
};

/**
 * Joue une partie complète et rend son récap.
 *
 * @param {object} options
 * @param {object} options.balance Contenu de `balance.json`
 * @param {object} options.policy Politique (`./policies.js`)
 * @param {number} [options.seed] Graine du générateur
 * @param {number} [options.stepMs]
 * @param {number} [options.actionIntervalMs]
 * @param {number} [options.maxDurationMs]
 * @returns {{policy: string, seed: number, wave: number, wavesCleared: number,
 *            durationMs: number, timedOut: boolean, actions: {tap: number, merge: number},
 *            recap: object}}
 */
export function simulateGame({
  balance,
  policy,
  seed = 1,
  stepMs = SIM_DEFAULTS.stepMs,
  actionIntervalMs = SIM_DEFAULTS.actionIntervalMs,
  maxDurationMs = SIM_DEFAULTS.maxDurationMs,
} = {}) {
  const session = new GameSession({ balance, rng: makeRng(seed) }).start();

  const actions = { tap: 0, merge: 0 };
  let elapsedMs = 0;
  let actionAccMs = 0;

  while (!session.over && elapsedMs < maxDurationMs) {
    session.update(stepMs);
    elapsedMs += stepMs;

    actionAccMs += stepMs;
    while (actionAccMs >= actionIntervalMs) {
      actionAccMs -= actionIntervalMs;
      if (session.over) break;
      const played = policy.act(session);
      if (played) actions[played] += 1;
    }
  }

  const recap = session.recap();
  session.destroy();

  return {
    policy: policy.id,
    seed,
    wave: recap.wave,
    wavesCleared: recap.wavesCleared,
    // La durée du modèle (ticks × tickMs) plutôt que celle de la boucle : c'est le temps
    // que le joueur aurait passé devant l'écran.
    durationMs: recap.durationMs,
    timedOut: !session.over,
    actions,
    recap,
  };
}

// --------------------------------------------------------------------- agrégation

/** Moyenne d'une liste de nombres (0 sur liste vide). */
export function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Écart-type **de population** (on décrit l'échantillon joué, on n'infère rien). */
export function stdDev(values) {
  if (values.length === 0) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

/** Médiane d'une liste de nombres. */
export function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/**
 * Joue `games` parties d'une politique, avec des graines consécutives.
 *
 * Les graines sont `seed, seed + 1, …` : rejouer un rapport ne demande que sa graine de
 * départ et son nombre de parties.
 *
 * @returns {{policy: string, label: string, summary: string, games: number,
 *            waves: {mean: number, stdDev: number, min: number, max: number, median: number},
 *            durationMs: {mean: number, min: number, max: number},
 *            damageShare: Record<string, number>, sentByTier: Record<number, number>,
 *            blockedTaps: number, timedOut: number, results: object[]}}
 */
export function runPolicy({ balance, policy, games = 20, seed = 1, ...options } = {}) {
  const results = [];
  for (let i = 0; i < games; i += 1) {
    results.push(simulateGame({ balance, policy, seed: seed + i, ...options }));
  }

  const waves = results.map((result) => result.wavesCleared);
  const durations = results.map((result) => result.durationMs);

  // Les totaux de dégâts et d'envois sont cumulés sur toutes les parties : c'est la part
  // relative de chaque type / tier qui informe, pas la valeur absolue d'une partie.
  const damageTotals = {};
  const sentByTier = {};
  let blockedTaps = 0;
  const gridFullShare = mean(results.map((result) => result.recap.gridFullShare));
  const gridItemsAvg = mean(results.map((result) => result.recap.gridItemsAvg));
  for (const result of results) {
    for (const [type, value] of Object.entries(result.recap.damageByType)) {
      damageTotals[type] = (damageTotals[type] ?? 0) + value;
    }
    for (const [tier, count] of Object.entries(result.recap.sentByTier)) {
      sentByTier[tier] = (sentByTier[tier] ?? 0) + count;
    }
    blockedTaps += result.recap.blockedTaps;
  }

  const damageSum = Object.values(damageTotals).reduce((sum, value) => sum + value, 0);
  const damageShare = {};
  for (const [type, value] of Object.entries(damageTotals)) {
    damageShare[type] = damageSum > 0 ? value / damageSum : 0;
  }

  return {
    policy: policy.id,
    label: policy.label,
    summary: policy.summary,
    games,
    seed,
    waves: {
      mean: mean(waves),
      stdDev: stdDev(waves),
      median: median(waves),
      min: Math.min(...waves),
      max: Math.max(...waves),
    },
    durationMs: {
      mean: mean(durations),
      median: median(durations),
      min: Math.min(...durations),
      max: Math.max(...durations),
    },
    damageShare,
    sentByTier,
    blockedTaps,
    /** Occupation de la grille : accord entre cadence d'items et cooldown de sortie. */
    gridFullShare,
    gridItemsAvg,
    timedOut: results.filter((result) => result.timedOut).length,
    results,
  };
}

/**
 * Joue toutes les politiques demandées sur le **même jeu de graines** — c'est ce qui rend
 * la comparaison honnête : les deux politiques rencontrent les mêmes apparitions d'items.
 *
 * @returns {{games: number, seed: number, policies: object[]}}
 */
export function runPolicies({ balance, policies, games = 20, seed = 1, ...options } = {}) {
  return {
    games,
    seed,
    policies: policies.map((policy) => runPolicy({ balance, policy, games, seed, ...options })),
  };
}

export default simulateGame;
