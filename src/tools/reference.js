/**
 * Génération de `docs/reference.md` **depuis `balance.json`**. Pur, sans Phaser ni système
 * de fichiers : le CLI (`./generateReference.js`) écrit ce que ce module rend.
 *
 * ## Pourquoi générer plutôt qu'écrire
 *
 * Une référence tenue à la main ment. Elle ment lentement — une valeur retouchée au harness,
 * un tier ajouté, une carte de draft dosée autrement — et elle ment sans prévenir, parce que
 * rien ne la relie au fichier qu'elle décrit. Celle-ci est **calculée** : elle ne peut pas
 * diverger de `balance.json`, et si elle est périmée, `npm run docs` la remet d'aplomb en
 * une seconde.
 *
 * Corollaire, inscrit dans `CLAUDE.md` : **toute livraison qui touche `balance.json`
 * régénère ce fichier**. Ne jamais l'éditer à la main — le prochain `npm run docs` écraserait
 * la correction.
 *
 * Les stats par tier viennent des **mêmes formules que le jeu** (`unitStats`, `enemyStats`) :
 * la référence ne réimplémente rien, exactement comme le harness de simulation.
 */

import { parseBattleConfig, unitStats, supportBonus, enemyStats } from '../systems/battleConfig.js';
import { parseSpawnerConfig } from '../systems/itemSpawner.js';
import { parseInputConfig } from '../systems/tapGesture.js';
import { parseDraftConfig } from '../systems/DraftSystem.js';
import { waveComposition, waveSpawnGapMs, waveLabel } from '../systems/waves.js';
import { MULTIPLIER_KEYS, ADDITIVE_KEYS } from '../systems/modifiers.js';

/** Tiers détaillés dans les tableaux d'unités. Au-delà, la courbe se déduit du facteur. */
const SHOWN_TIERS = [1, 2, 3, 4, 5, 6, 8, 11];
/** Vagues générées détaillées après les vagues scriptées. */
const SHOWN_GENERATED = 4;

/** Arrondi lisible : deux décimales au plus, sans zéros inutiles. */
function round(value, digits = 1) {
  const factor = 10 ** digits;
  return String(Math.round(value * factor) / factor);
}

const row = (cells) => `| ${cells.join(' | ')} |`;
const separator = (count) => `|${' --- |'.repeat(count)}`;

function table(header, rows) {
  return [row(header), separator(header.length), ...rows.map(row)].join('\n');
}

/** Description lisible d'un effet de draft, clé par clé. */
export function describeEffect(effect) {
  const parts = [];
  for (const key of MULTIPLIER_KEYS) {
    if (effect[key] === undefined) continue;
    const percent = Math.round((effect[key] - 1) * 1000) / 10;
    // Signe moins typographique, comme dans les libellés de cartes : le tiret du clavier
    // ressemble à un trait d'union et se lit mal dans un tableau.
    const signed = percent > 0 ? `+${percent}` : `−${Math.abs(percent)}`;
    parts.push(`\`${key}\` ×${effect[key]} (${signed} %)`);
  }
  for (const key of ADDITIVE_KEYS) {
    if (effect[key] === undefined) continue;
    parts.push(`\`${key}\` ${effect[key] > 0 ? '+' : ''}${effect[key]}`);
  }
  for (const [type, entry] of Object.entries(effect.byType ?? {})) {
    const inner = Object.entries(entry)
      .map(([key, value]) => `${key} ×${value}`)
      .join(', ');
    parts.push(`\`${type}\` : ${inner}`);
  }
  return parts.join(' · ');
}

function unitsSection(config) {
  const lines = ['## Unités', ''];
  lines.push(
    'Quatre types au périmètre V1. Les stats listées sont **calculées par les formules du',
    'jeu** (`unitStats`) : `stat(tier) = stat(1) × facteur^(tier-1)`.',
    ''
  );

  for (const [id, def] of Object.entries(config.units)) {
    lines.push(`### ${def.label} — \`${id}\``, '');
    // Le même texte que le panneau d'aide in-game : une seule source, donc pas de dérive
    // entre ce que le jeu dit au joueur et ce que la référence dit au développeur.
    lines.push(def.blurb, '');
    lines.push(
      `Rôle \`${def.role}\` · vitesse de marche ${def.speed} unités de couloir/s ` +
        '(elle ne dépend pas du tier).',
      ''
    );

    const header = ['tier', 'PV', 'dégâts', 'cadence (ms)', 'portée'];
    const extra =
      def.role === 'aoe'
        ? ['rayon de zone']
        : def.role === 'slow'
          ? ['rayon de ralenti', 'durée (ms)']
          : def.role === 'support'
            ? ['rayon d’aura', 'bonus dégâts', 'bonus cadence']
            : [];

    const rows = SHOWN_TIERS.map((tier) => {
      const stats = unitStats(config, id, tier);
      const cells = [
        String(tier),
        round(stats.hp),
        round(stats.damage),
        stats.fireRateMs > 0 ? round(stats.fireRateMs, 0) : '—',
        round(stats.range, 0),
      ];
      if (def.role === 'aoe') cells.push(round(stats.splashRadius, 0));
      if (def.role === 'slow') {
        cells.push(round(stats.slowRadius, 0), round(stats.slowDurationMs, 0));
      }
      if (def.role === 'support') {
        const bonus = supportBonus(config, id, tier);
        cells.push(
          round(stats.auraRadius, 0),
          `+${Math.round(bonus.damage * 100)} %`,
          `−${Math.round(bonus.fireRate * 100)} %`
        );
      }
      return cells;
    });

    lines.push(table([...header, ...extra], rows), '');

    if (def.role === 'slow') {
      lines.push(
        `Le facteur de ralentissement vaut **${def.slowFactor}** à tous les tiers : c'est la ` +
          'durée et le rayon qui montent, sinon un ralentisseur de haut tier immobiliserait la vague.',
        ''
      );
    }
    if (def.role === 'support') {
      lines.push(
        `Le cumul des bonus de cadence de plusieurs soutiens est plafonné à ` +
          `**${Math.round(config.maxSupportFireRateBonus * 100)} %**.`,
        ''
      );
    }
  }

  lines.push('### File des types', '');
  lines.push(
    'Le type de la prochaine unité suit un motif déterministe, parcouru en boucle, et se fige',
    '**au tap**. Le bouton « passer » en défausse un contre un cooldown de',
    `**${round(config.skipCooldownMs / 1000)} s**.`,
    '',
    '```',
    config.unitTypePattern.join(' → ') + ' → …',
    '```',
    ''
  );
  return lines.join('\n');
}

function enemiesSection(config) {
  const lines = ['## Ennemis', ''];
  lines.push(
    'Trois types. Les stats listées sont celles de la **vague 1** ; le scaling par vague',
    'est appliqué par-dessus (voir plus bas).',
    ''
  );

  lines.push(
    table(
      ['type', 'PV', 'vitesse', 'dégâts base', 'dégâts unités', 'cadence (ms)', 'portée'],
      Object.entries(config.enemies).map(([id, def]) => [
        `**${def.label}** (\`${id}\`)`,
        String(def.hp),
        String(def.speed),
        String(def.damageToBase),
        String(def.damage),
        String(def.attackRateMs),
        String(def.attackRange),
      ])
    ),
    ''
  );

  const { scaling } = config.waves;
  lines.push('### Montée en puissance par vague', '');
  lines.push(
    `PV ×**${scaling.hpPerWave}**, vitesse ×**${scaling.speedPerWave}**, dégâts aux unités`,
    `×**${scaling.damagePerWave}**, le tout à la puissance (vague − 1). Les dégâts à la base,`,
    'eux, **ne montent pas** : la pression vient des PV, de la vitesse et du nombre.',
    ''
  );

  lines.push(
    table(
      ['vague', ...Object.values(config.enemies).map((def) => `PV ${def.label.toLowerCase()}`)],
      [1, 3, 5, 8, 10, 12, 15].map((wave) => [
        String(wave),
        ...Object.keys(config.enemies).map((id) => String(enemyStats(config, id, wave).hp)),
      ])
    ),
    ''
  );
  return lines.join('\n');
}

function wavesSection(config) {
  const scripted = config.waves.scripted.length;
  const lines = ['## Vagues', ''];
  lines.push(
    `Les **${scripted} premières vagues** sont scriptées ; au-delà, la composition est générée`,
    'sans limite. La cadence propre à chaque vague est ce qui lui donne sa texture : à nombre',
    "d'ennemis égal, un rush et un mur ne sont pas la même vague.",
    ''
  );

  const rows = [];
  for (let wave = 1; wave <= scripted + SHOWN_GENERATED; wave += 1) {
    rows.push([
      String(wave) + (wave > scripted ? ' *(générée)*' : ''),
      waveLabel(config, wave) || '—',
      `${round(waveSpawnGapMs(config, wave), 0)} ms`,
      waveComposition(config, wave)
        .map((entry) => `${entry.count}× ${config.enemies[entry.type].label}`)
        .join(', '),
    ]);
  }
  lines.push(table(['vague', 'texture', 'cadence', 'composition'], rows), '');

  lines.push(
    `Préparation avant la vague 1 : **${round(config.waves.firstWaveDelayMs / 1000)} s**.`,
    `Pause entre deux vagues : **${round(config.waves.interWavePauseMs / 1000)} s** — c'est le`,
    'temps de merge légitime, pas du temps mort.',
    ''
  );
  return lines.join('\n');
}

function draftSection(draft) {
  const lines = ['## Améliorations (draft)', ''];
  lines.push(
    `Toutes les **${draft.everyWaves} vagues**, la partie se met en pause et propose`,
    `**${draft.cardsPerOffer} améliorations** distinctes parmi ${draft.upgrades.length}. Une carte`,
    'prise vaut pour le reste de la partie et **ne modifie jamais `balance.json`** : elle',
    'accumule un modificateur appliqué au moment de lire une stat.',
    ''
  );

  lines.push(
    table(
      ['carte', 'niveaux', 'effet par niveau', 'description'],
      draft.upgrades.map((entry) => [
        `**${entry.label}** (\`${entry.id}\`)`,
        String(entry.maxLevel),
        describeEffect(entry.effect),
        entry.description,
      ])
    ),
    ''
  );

  lines.push(
    'Les facteurs se composent **par produit** à chaque niveau (deux fois « +18 % » vaut ×1,39,',
    'pas ×1,36) ; les quantités entières (places, PV, tiers) s’additionnent.',
    ''
  );
  return lines.join('\n');
}

function economySection({ spawner, battle, input }) {
  const lines = ['## Économie de la grille', ''];
  lines.push(
    table(
      ['réglage', 'valeur', 'ce que ça décide'],
      [
        ['tiers maximum', String(spawner.maxTier), 'plafond de fusion'],
        ['items au départ', String(spawner.startingItems), 'de quoi fusionner avant la vague 1'],
        [
          'intervalle initial',
          `${spawner.intervalMs} ms`,
          'le rythme des premières vagues — la grille doit respirer',
        ],
        [
          'plancher',
          `${spawner.minIntervalMs} ms`,
          'le rythme de fin de partie, quand la pression doit monter',
        ],
        [
          'décroissance',
          String(spawner.intervalDecay),
          'la vitesse à laquelle on passe de l’un à l’autre',
        ],
        [
          'tiers à l’apparition',
          spawner.tierWeights.map((entry) => `${entry.tier} (×${entry.weight})`).join(', '),
          'les tiers supérieurs ne s’obtiennent que par fusion',
        ],
        [
          'cooldown de sortie',
          `${battle.deployCooldownMs} ms`,
          '**le métronome** : le débit d’unités, quoi que fasse le joueur',
        ],
        ['places dans la file', String(battle.slotCount), 'combien d’unités peuvent attendre'],
        ['PV de la base', String(battle.baseHp), 'la marge d’erreur totale'],
      ]
    ),
    ''
  );

  const perSend = 4;
  const equilibrium = (battle.deployCooldownMs / perSend).toFixed(0);
  lines.push(
    `**Le repère qui cadre tout** : un envoi de tier 3 coûte ${perSend} items et un envoi part`,
    `toutes les ${battle.deployCooldownMs} ms, donc suivre le rythme demande un item toutes les`,
    `**${equilibrium} ms**. Le plancher est réglé autour de cette valeur pour que le goulot`,
    'reste le cooldown de sortie et non la grille.',
    '',
    `Gestes : un tap de moins de ${input.tapMaxDistancePx} px et ${input.tapMaxDurationMs} ms`,
    'envoie l’item au combat, tout le reste est un glisser (fusion ou déplacement). Un écran',
    `qui s’ouvre par-dessus le jeu ignore les appuis pendant ${input.overlayGraceMs} ms.`,
    ''
  );
  return lines.join('\n');
}

/**
 * Rend le contenu complet de `docs/reference.md`.
 *
 * @param {object} balance Contenu de `balance.json`
 * @returns {string} Markdown
 */
export function generateReference(balance) {
  const config = parseBattleConfig(balance);
  const spawner = parseSpawnerConfig(balance);
  const input = parseInputConfig(balance);
  const draft = parseDraftConfig(balance);

  return [
    '# Référence — Merge Battler',
    '',
    '> **Fichier généré. Ne pas l’éditer à la main.**',
    '> Il est produit par `npm run docs` à partir de `src/config/balance.json`, en passant par',
    '> les **formules du jeu** (`unitStats`, `enemyStats`, `waveComposition`) — il ne',
    '> réimplémente rien et ne peut donc pas diverger de ce que le jeu fait vraiment.',
    '>',
    '> Toute livraison qui touche `balance.json` le régénère (cf. `CLAUDE.md`).',
    '',
    `Version de \`balance.json\` : **${balance.version ?? '—'}**.`,
    '',
    '## En deux gestes',
    '',
    '- **Taper** un item le consomme et met une unité de son tier en file de déploiement. Le',
    '  type vient de la file des types, et il est fixé **au moment du tap**.',
    '- **Glisser** un item sur un autre du même tier les fusionne en un tier supérieur ; sur une',
    '  case vide, il se déplace. Un merge ne déclenche **rien** côté combat.',
    '',
    'La file se vide toute seule au rythme du cooldown de sortie : c’est le métronome du jeu, et',
    'c’est ce qui rend le spam de petites unités perdant.',
    '',
    unitsSection(config),
    enemiesSection(config),
    wavesSection(config),
    draftSection(draft),
    economySection({ spawner, battle: config, input }),
  ].join('\n');
}

export default generateReference;
