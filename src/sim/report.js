/**
 * Mise en forme du rapport du harness. **Pure** (des chaînes, rien d'autre) : c'est le CLI
 * qui écrit sur la sortie standard, et les tests peuvent vérifier le texte sans capturer
 * de flux.
 */

/** `123456` → `2:03` — une durée de partie se lit en minutes, pas en millisecondes. */
export function formatDuration(ms) {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

const pad = (value, width) => String(value).padStart(width);
const padEnd = (value, width) => String(value).padEnd(width);
const round = (value, digits = 1) => value.toFixed(digits);

/**
 * Rapport texte complet.
 *
 * @param {object} run Résultat de `runPolicies`
 * @param {object} [options]
 * @param {{minWave: number, maxWave: number, minDurationMs: number, maxDurationMs: number}}
 *   [options.targets] Objectifs chiffrés du lot, annotés dans le tableau
 * @returns {string}
 */
export function formatReport(run, { targets } = {}) {
  const lines = [];
  lines.push(`Harness d'équilibrage — ${run.games} parties par politique, graines ${run.seed}..${run.seed + run.games - 1}`);
  lines.push('');
  lines.push(
    `${padEnd('politique', 22)}${pad('vague moy.', 11)}${pad('σ', 7)}${pad('méd.', 6)}${pad('min', 5)}${pad('max', 5)}${pad('durée moy.', 12)}${pad('refus', 7)}`
  );
  lines.push('-'.repeat(75));

  for (const entry of run.policies) {
    lines.push(
      padEnd(entry.label, 22) +
        pad(round(entry.waves.mean, 2), 11) +
        pad(round(entry.waves.stdDev, 2), 7) +
        pad(round(entry.waves.median, 1), 6) +
        pad(entry.waves.min, 5) +
        pad(entry.waves.max, 5) +
        pad(formatDuration(entry.durationMs.mean), 12) +
        pad(entry.blockedTaps, 7)
    );
  }

  lines.push('');
  for (const entry of run.policies) {
    const damage = Object.entries(entry.damageShare)
      .sort((a, b) => b[1] - a[1])
      .map(([type, share]) => `${type} ${Math.round(share * 100)}%`)
      .join(', ');
    const tiers = Object.entries(entry.sentByTier)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([tier, count]) => `T${tier}×${count}`)
      .join(' ');
    lines.push(`${entry.label} — ${entry.summary}`);
    lines.push(`  dégâts : ${damage || '—'}`);
    lines.push(`  envois : ${tiers || '—'}`);
    lines.push(
      `  grille : ${round(entry.gridItemsAvg, 1)} items en moyenne, ` +
        `pleine ${Math.round(entry.gridFullShare * 100)}% du temps`
    );
    const powers = Object.entries(entry.powersByType ?? {})
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => `${type}×${count}`)
      .join(' ');
    lines.push(
      `  pouvoirs : ${round(entry.powersPerGame ?? 0, 1)} par partie — ${powers || '—'} · ` +
        `${Math.round((entry.powerDamageShare ?? 0) * 100)}% des dégâts, ` +
        `${Math.round(entry.powerHealingPerGame ?? 0)} PV rendus par partie`
    );
    const drafts = Object.entries(entry.draftCounts ?? {})
      .sort((a, b) => b[1] - a[1])
      .map(([id, count]) => `${id}×${count}`)
      .join(' ');
    lines.push(`  draft : ${round(entry.draftsPerGame ?? 0, 1)} par partie — ${drafts || '—'}`);
    if (entry.timedOut > 0) {
      lines.push(`  ⚠ ${entry.timedOut} partie(s) arrêtée(s) sur la limite de temps (survie infinie)`);
    }
  }

  const checks = evaluateTargets(run, targets);
  if (checks.length > 0) {
    lines.push('');
    lines.push('Objectifs chiffrés');
    for (const check of checks) lines.push(`  ${check.ok ? '✔' : '✘'} ${check.label}`);
  }

  return lines.join('\n');
}

/**
 * Confronte un rapport aux objectifs chiffrés du lot.
 *
 * La politique de référence pour la durée et la fenêtre de défaite est `mixed` — le joueur
 * médian. `spam` est une borne basse (mauvais jeu) et `prepare` une borne haute (jeu
 * optimisé) : ni l'un ni l'autre ne représente la partie d'un joueur qui découvre.
 *
 * @returns {{label: string, ok: boolean}[]}
 */
export function evaluateTargets(run, targets) {
  if (!targets) return [];
  const byId = new Map(run.policies.map((entry) => [entry.policy, entry]));
  const checks = [];

  const reference = byId.get(targets.referencePolicy ?? 'mixed');
  if (reference) {
    const waves = reference.waves.mean;
    checks.push({
      label: `première défaite vagues ${targets.minWave}-${targets.maxWave} (${reference.label} : ${round(waves, 2)})`,
      ok: waves >= targets.minWave && waves <= targets.maxWave,
    });
    const duration = reference.durationMs.mean;
    checks.push({
      label: `durée de partie ${formatDuration(targets.minDurationMs)}-${formatDuration(
        targets.maxDurationMs
      )} (${reference.label} : ${formatDuration(duration)})`,
      ok: duration >= targets.minDurationMs && duration <= targets.maxDurationMs,
    });
  }

  const spam = byId.get('spam');
  const prepare = byId.get('prepare');
  if (spam && prepare) {
    const ratio = spam.waves.mean > 0 ? prepare.waves.mean / spam.waves.mean : Infinity;
    checks.push({
      label: `« merge bat spam » — ${prepare.label} ${round(prepare.waves.mean, 2)} vs ${
        spam.label
      } ${round(spam.waves.mean, 2)} (×${round(ratio, 2)}, seuil ×${targets.mergeBeatsSpamRatio})`,
      ok: prepare.waves.mean >= spam.waves.mean * targets.mergeBeatsSpamRatio,
    });
  }

  const withPowers = byId.get(targets.powersPolicy ?? 'mixed');
  const without = byId.get(targets.noPowersPolicy ?? 'noPowers');
  if (withPowers && without) {
    const gap = withPowers.waves.mean - without.waves.mean;
    checks.push({
      label:
        `« les pouvoirs se voient » — ${withPowers.label} ${round(withPowers.waves.mean, 2)} vs ` +
        `${without.label} ${round(without.waves.mean, 2)} (+${round(gap, 2)} vague(s), ` +
        `seuil +${targets.powersBeatNoPowersWaves})`,
      ok: gap >= targets.powersBeatNoPowersWaves,
    });
  }

  return checks;
}

/**
 * Rapport de la matrice escouades × textures de vague (`runMatchups`).
 *
 * Chaque case donne les **PV de base laissés passer** : plus c'est bas, mieux l'escouade
 * tient cette texture. Le meilleur de chaque colonne est marqué d'une étoile — c'est ce
 * marquage qui répond à « chaque type a-t-il une situation où il est le bon choix ? ».
 */
export function formatMatchups(matrix) {
  const lines = [];
  lines.push(`Bancs d'essai — escouades de 4 unités de tier ${matrix.tier}, base invulnérable`);
  lines.push('PV de base laissés passer (plus bas = mieux, ★ = meilleur de la colonne)');
  lines.push('');

  const header = padEnd('escouade', 26) + matrix.scenarios.map((s) => pad(s.label, 18)).join('');
  lines.push(header);
  lines.push('-'.repeat(header.length));

  const bestPerColumn = matrix.scenarios.map((_, column) =>
    Math.min(...matrix.rows.map((row) => row.cells[column].baseDamage))
  );

  for (const row of matrix.rows) {
    const cells = row.cells.map((cell, column) => {
      const mark = cell.baseDamage === bestPerColumn[column] ? ' ★' : '  ';
      return pad(`${Math.round(cell.baseDamage)}${mark}`, 18);
    });
    lines.push(padEnd(row.label, 26) + cells.join(''));
  }

  return lines.join('\n');
}

export default formatReport;
