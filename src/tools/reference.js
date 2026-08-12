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
import { parsePowersConfig, powerStats } from '../systems/PowerSystem.js';
// `format.js` et non `index.js` : ce dernier importe les dictionnaires JSON, ce que Node
// refuse sans attribut d'import — et ce module tourne en ligne de commande.
import { compositionText, waveLabelText } from '../i18n/format.js';
import { waveComposition, waveSpawnGapMs, waveLabel } from '../systems/waves.js';
import { MULTIPLIER_KEYS, ADDITIVE_KEYS } from '../systems/modifiers.js';

/** Tiers détaillés dans les tableaux d'unités. Au-delà, la courbe se déduit du facteur. */
const SHOWN_TIERS = [1, 2, 3, 4, 5, 6, 8, 11];
/** Tiers détaillés pour les pouvoirs — ils plafonnent plus bas, la table est plus courte. */
const SHOWN_POWER_TIERS = [1, 2, 3, 4, 5, 6];
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

function unitsSection(config, t) {
  const lines = ['## Unités', ''];
  lines.push(
    'Quatre types au périmètre V1. Les stats listées sont **calculées par les formules du',
    'jeu** (`unitStats`) : `stat(tier) = stat(1) × facteur^(tier-1)`.',
    ''
  );

  for (const [id, def] of Object.entries(config.units)) {
    lines.push(`### ${t(`units.${id}.label`)} — \`${id}\``, '');
    // Le même texte que le panneau d'aide in-game, tiré du **même dictionnaire** : une seule
    // source, donc pas de dérive entre ce que le jeu dit au joueur et ce que la référence dit
    // au développeur.
    lines.push(t(`units.${id}.blurb`), '');
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

function powersSection(powers, t) {
  const lines = ['## Pouvoirs actifs', ''];
  lines.push(
    'La grille produit **deux familles d’items**. Un item d’unité part en file de déploiement',
    'quand on le tape ; un item de **pouvoir** est consommé sur-le-champ, sans file ni',
    'cooldown. Les deux se fusionnent de la même façon, mais **jamais entre eux** : deux items',
    'ne fusionnent que s’ils ont le même tier **et** la même sorte (même famille, et même type',
    'de pouvoir).',
    '',
    `Un item qui apparaît est un pouvoir avec une probabilité de **${Math.round(powers.spawnChance * 100)} %**,`,
    `réparti selon les poids ci-dessous. Les pouvoirs plafonnent au **tier ${powers.maxTier}**, plus bas que`,
    'les items d’unité : au-delà, le dernier tier serait hors d’atteinte et deux pouvoirs',
    'plafonnés resteraient collés sur la grille sans pouvoir fusionner.',
    ''
  );

  for (const [id, def] of Object.entries(powers.types)) {
    const total = Object.values(powers.types).reduce((sum, entry) => sum + entry.weight, 0);
    lines.push(`### ${t(`powers.${id}.label`)} — \`${id}\``, '');
    lines.push(t(`powers.${id}.blurb`), '');
    lines.push(
      `Effet \`${def.kind}\` · poids d’apparition ${def.weight} sur ${total} · ` +
        (def.telegraphMs > 0
          ? `télégraphie **${round(def.telegraphMs / 1000, 2)} s** avant l’impact`
          : 'effet **immédiat**'),
      ''
    );

    const blast = def.kind === 'blast';
    const header = ['tier', blast ? 'dégâts' : 'PV rendus par unité'];
    if (blast) header.push('rayon');

    const rows = SHOWN_POWER_TIERS.filter((tier) => tier <= powers.maxTier).map((tier) => {
      const stats = powerStats(powers, id, tier);
      const cells = [String(tier), round(stats.amount, 0)];
      if (blast) cells.push(round(stats.radius, 0));
      return cells;
    });
    lines.push(table(header, rows), '');
  }

  lines.push(
    'Le **ciblage est automatique** — pas de visée manuelle en V1, le glisser reste réservé à',
    'la fusion. La zone se pose sur le groupe qui compte le plus d’ennemis dans le rayon du',
    'pouvoir, et à nombre égal sur le plus avancé, donc le plus près de la base.',
    '',
    'Un pouvoir sans la moindre cible (une météorite sans un ennemi sur le couloir, un soin',
    'sans une unité sur le champ) est **refusé** : l’item reste sur la grille. Soigner une',
    'armée intacte, en revanche, reste permis — c’est un jugement du joueur.',
    ''
  );
  return lines.join('\n');
}

function enemiesSection(config, t) {
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
        `**${t(`enemies.${id}.label`)}** (\`${id}\`)`,
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
      [
        'vague',
        ...Object.keys(config.enemies).map((id) => `PV ${t(`enemies.${id}.label`).toLowerCase()}`),
      ],
      [1, 3, 5, 8, 10, 12, 15].map((wave) => [
        String(wave),
        ...Object.keys(config.enemies).map((id) => String(enemyStats(config, id, wave).hp)),
      ])
    ),
    ''
  );
  return lines.join('\n');
}

function wavesSection(config, t) {
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
      waveLabelText(waveLabel(config, wave), t) || '—',
      `${round(waveSpawnGapMs(config, wave), 0)} ms`,
      compositionText(waveComposition(config, wave), t),
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

function draftSection(draft, t) {
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
        `**${t(`draft.upgrades.${entry.id}.label`)}** (\`${entry.id}\`)`,
        String(entry.maxLevel),
        describeEffect(entry.effect),
        t(`draft.upgrades.${entry.id}.description`),
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
          'régulation de remplissage',
          `${Math.round(spawner.fillPressure.startFill * 100)} % → ` +
            `${Math.round(spawner.fillPressure.stopFill * 100)} %, ` +
            `jusqu’à ×${spawner.fillPressure.maxFactor}`,
          '**le curseur de la pression de grille** : la cadence s’étire quand la grille se remplit',
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
 * Rend le contenu complet de la référence, **dans la langue demandée**.
 *
 * Les libellés ne sont plus dans `balance.json` depuis le Lot 5 : ils viennent du même
 * dictionnaire que le jeu (`src/i18n/`). C'est ce qui garantit qu'une carte de draft
 * s'appelle pareil dans la référence et sur la carte que voit le joueur — une référence qui
 * dérive de l'interface ne vaut pas mieux qu'une référence tenue à la main.
 *
 * @param {object} balance Contenu de `balance.json`
 * @param {object} options
 * @param {(key: string, params?: object) => string} options.t Traducteur, construit par
 *   l'appelant (`src/tools/generateReference.js` le fabrique depuis les dictionnaires lus
 *   au disque, les tests depuis `createTranslator`)
 * @returns {string} Markdown
 */
export function generateReference(balance, { t }) {
  const config = parseBattleConfig(balance);
  const spawner = parseSpawnerConfig(balance);
  const input = parseInputConfig(balance);
  const draft = parseDraftConfig(balance);
  const powers = parsePowersConfig(balance);

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
    '- **Taper** un item d’unité (silhouette anguleuse) le consomme et met une unité de son tier',
    '  en file de déploiement. Le type vient de la file des types, fixé **au moment du tap**.',
    '- **Taper** un item de pouvoir (silhouette **ronde**) le dépense tout de suite : ni file, ni',
    '  cooldown.',
    '- **Glisser** un item sur un autre de la même sorte et du même tier les fusionne en un tier',
    '  supérieur ; sur une case vide, il se déplace ; sur n’importe quel autre item, les deux',
    '  **échangent leur place**. Un merge ne déclenche **rien** côté combat.',
    '',
    'La file se vide toute seule au rythme du cooldown de sortie : c’est le métronome du jeu, et',
    'c’est ce qui rend le spam de petites unités perdant.',
    '',
    unitsSection(config, t),
    powersSection(powers, t),
    enemiesSection(config, t),
    wavesSection(config, t),
    draftSection(draft, t),
    economySection({ spawner, battle: config, input }),
  ].join('\n');
}

export default generateReference;
