/**
 * Bancs d'essai « quel type d'unité contre quelle vague ». **Pur, sans Phaser.**
 *
 * Le rapport de politiques (`./simulate.js`) dit si le jeu tient dans ses objectifs ; il ne
 * dit pas si les quatre types d'unités servent à quelque chose. C'est ce que mesure ce
 * module : une escouade figée affronte une **texture de vague** donnée, base invulnérable,
 * et l'on relève les dégâts qu'elle laisse passer. Moins il en passe, meilleure est
 * l'escouade contre cette texture.
 *
 * Chaque escouade est le **même socle** (des mono-cibles) auquel on substitue un
 * spécialiste : on mesure donc la valeur *marginale* du spécialiste, pas sa valeur absolue.
 * C'est la seule mesure honnête pour le soutien, qui n'inflige aucun dégât, et pour le
 * ralentisseur, dont l'apport est un temps gagné et non des points de vie retirés.
 *
 * La base est rendue invulnérable pendant la mesure : sans cela, une vague qui tue la base
 * arrêterait la simulation et les escouades les plus mauvaises paraîtraient équivalentes.
 *
 * **Les renforts arrivent pendant le combat**, au rythme de `battle.deployCooldownMs`.
 * Ce détail n'en est pas un : sans renforts, le ralentisseur est structurellement
 * sous-évalué, puisque tout ce qu'il achète est du **temps**, et que le temps ne vaut
 * quelque chose que s'il fait arriver l'unité suivante. Une escouade figée mesurerait un
 * jeu où le joueur ne joue plus.
 */

import { BattleModel } from '../systems/BattleModel.js';
import { parseBattleConfig } from '../systems/battleConfig.js';
import { waveEnemyCount } from '../systems/waves.js';

/**
 * Escouades comparées. Toutes comptent 4 unités : à débit de sortie fixe, quatre créneaux
 * de déploiement sont ce que le joueur peut réellement poser avant un contact.
 */
export const SQUADS = [
  { id: 'single', label: '4× mono-cible', units: [{ type: 'single', count: 4 }] },
  {
    id: 'aoe',
    label: '2× mono + 2× zone',
    units: [
      { type: 'single', count: 2 },
      { type: 'aoe', count: 2 },
    ],
  },
  {
    id: 'slow',
    label: '2× mono + 2× ralentisseur',
    units: [
      { type: 'single', count: 2 },
      { type: 'slow', count: 2 },
    ],
  },
  {
    id: 'support',
    label: '3× mono + 1× soutien',
    units: [
      { type: 'single', count: 3 },
      { type: 'support', count: 1 },
    ],
  },
];

/**
 * Textures de vague testées. Les numéros pointent les vagues scriptées de `balance.json` —
 * si la liste `waves.scripted` change, ces libellés doivent suivre.
 */
export const SCENARIOS = [
  { wave: 5, label: 'mur de tanks' },
  { wave: 6, label: 'marée mixte' },
  { wave: 7, label: 'rush blindé' },
  { wave: 9, label: 'mur épais' },
  { wave: 10, label: 'tout à la fois' },
];

/**
 * Oppose une escouade à une vague et relève ce qui passe.
 *
 * @param {object} options
 * @param {object} options.balance Contenu de `balance.json`
 * @param {{units: {type: string, count: number}[]}} options.squad
 * @param {number} options.wave Numéro de vague (stats et composition de cette vague)
 * @param {number} [options.tier] Tier commun des unités de l'escouade
 * @param {number} [options.maxDurationMs] Garde-fou
 * @returns {{baseDamage: number, unitsLost: number, enemiesKilled: number,
 *            enemiesLeaked: number, durationMs: number, cleared: boolean}}
 */
export function runMatchup({
  balance,
  squad,
  wave,
  tier = 4,
  reinforcements = 8,
  maxDurationMs = 120_000,
} = {}) {
  const config = parseBattleConfig(balance);
  const model = new BattleModel({ config });
  // Mesurer ce qui passe, pas quand la base tombe : sinon toutes les mauvaises escouades
  // se ressemblent (elles meurent toutes).
  model.invincible = true;

  // Ordre de déploiement de l'escouade, répété pour les renforts.
  const roster = squad.units.flatMap((entry) => Array.from({ length: entry.count }, () => entry.type));
  for (const type of roster) model.spawnUnit(tier, type);
  model.startWave(wave);

  let leaked = 0;
  model.events.on('enemyLeak', ({ damage }) => {
    leaked += damage;
  });

  let elapsed = 0;
  let reinforceTimerMs = config.deployCooldownMs;
  let sent = 0;

  while (elapsed < maxDurationMs) {
    model.tick();
    elapsed += config.tickMs;

    if (sent < reinforcements) {
      reinforceTimerMs -= config.tickMs;
      if (reinforceTimerMs <= 0) {
        reinforceTimerMs += config.deployCooldownMs;
        model.spawnUnit(tier, roster[sent % roster.length]);
        sent += 1;
      }
    }

    if (model.spawnQueue.length === 0 && model.enemies.length === 0) break;
    // Plus une unité debout **et** plus un renfort à venir : la suite est écrite.
    if (model.units.length === 0 && model.enemies.length > 0 && sent >= reinforcements) {
      for (const enemy of model.enemies) leaked += enemy.damageToBase;
      break;
    }
  }

  const total = waveEnemyCount(config, wave);
  return {
    baseDamage: leaked,
    unitsLost: model.stats.unitsLost,
    enemiesKilled: model.stats.enemiesKilled,
    enemiesLeaked: total - model.stats.enemiesKilled,
    durationMs: elapsed,
    cleared: leaked === 0,
  };
}

/**
 * Matrice complète escouades × textures de vague.
 *
 * @returns {{tier: number, scenarios: object[], squads: object[],
 *            rows: {squad: string, label: string, cells: object[]}[]}}
 */
export function runMatchups({ balance, tier = 4, squads = SQUADS, scenarios = SCENARIOS } = {}) {
  return {
    tier,
    scenarios,
    squads,
    rows: squads.map((squad) => ({
      squad: squad.id,
      label: squad.label,
      cells: scenarios.map((scenario) => ({
        wave: scenario.wave,
        ...runMatchup({ balance, squad, wave: scenario.wave, tier }),
      })),
    })),
  };
}

export default runMatchups;
