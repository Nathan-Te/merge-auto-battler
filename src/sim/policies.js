/**
 * Politiques de jeu automatiques du harness d'équilibrage. **Pur, sans Phaser.**
 *
 * Une politique est un joueur factice : à intervalle régulier (`actionIntervalMs`), elle
 * observe la grille et effectue **au plus une action** — un tap ou une fusion. La cadence
 * limitée est volontaire : un joueur humain ne joue pas 60 coups par seconde, et une
 * politique qui viderait la grille instantanément mesurerait un jeu qui n'existe pas.
 *
 * Toutes les politiques de la famille `tierPolicy` obéissent à la même grammaire, et ne
 * diffèrent que par **le tier à partir duquel elles envoient** :
 *
 *   1. un pouvoir mûr est utile maintenant → l'utiliser (Lot 4, cf. plus bas) ;
 *   2. file de déploiement pleine → fusionner (c'est gratuit) ou ne rien faire ;
 *   3. un item d'unité de tier ≥ `sendTier` est présent → taper le plus haut ;
 *   4. une fusion est possible → fusionner la paire du **plus bas** tier ;
 *   5. grille pleine et rien à fusionner → se débloquer, item d'unité d'abord ;
 *   6. sinon, attendre.
 *
 * `sendTier: 1` dégénère donc exactement en « spam » : la règle 3 se déclenche toujours et
 * la politique ne fusionne jamais. C'est l'anti-modèle contre lequel le design se mesure —
 * l'invariant « merge bat spam » (cf. `CLAUDE.md`) se vérifie en comparant ces deux-là.
 *
 * ## Les pouvoirs (Lot 4)
 *
 * Deux réglages, et ils suffisent à décrire les joueurs qui nous intéressent :
 *
 *   - `powerTier` — le tier à partir duquel la politique consent à dépenser un pouvoir. À 1
 *     elle le brûle dès qu'il tombe, plus haut elle le fait mûrir comme un item d'unité.
 *   - `usePowers: false` — elle n'en utilise **jamais**. Elle les fusionne quand même (c'est
 *     gratuit et ça libère des cases), mais elle paie leur place sans rien en tirer. C'est
 *     la politique témoin : `mixed` doit la battre, sinon les pouvoirs ne servent à rien.
 *
 * Une politique n'utilise pas un pouvoir « parce qu'elle en a un » : elle attend que ça
 * vaille le coup — une ligne entamée pour le soin, un paquet d'ennemis pour la météorite.
 * Un joueur qui lâcherait sa météorite sur un traînard mesurerait un jeu que personne ne
 * joue.
 *
 * Les politiques sont **déterministes** : aucun tirage, et les égalités se tranchent par le
 * plus petit index. Deux exécutions de même graine donnent la même partie.
 */

import { ITEM_FAMILY } from '../systems/GridModel.js';

/**
 * Seuils de décision des pouvoirs. Ce sont des réglages **du joueur simulé**, pas du jeu :
 * ils décrivent quand un humain raisonnable dépenserait un pouvoir, et n'ont donc rien à
 * faire dans `balance.json`.
 */
export const POWER_TRIGGERS = {
  /** Part des PV en dessous de laquelle une unité « mérite » un soin. */
  healHpRatio: 0.6,
  /** Ennemis qu'il faut voir tomber dans la zone pour lâcher une météorite. */
  blastCluster: 3,
};

/** Sorte d'un item, sous forme de clé comparable : deux items ne fusionnent qu'à clé égale. */
function kindKey(item) {
  return item.family === ITEM_FAMILY.POWER ? `power:${item.power}` : ITEM_FAMILY.UNIT;
}

/** Index des cases occupées, avec leur tier et leur sorte, dans l'ordre de la grille. */
function items(grid) {
  const list = [];
  grid.cells.forEach((item, index) => {
    if (item === null) return;
    list.push({
      index,
      tier: item.tier,
      family: item.family ?? ITEM_FAMILY.UNIT,
      power: item.power ?? null,
      key: kindKey(item),
    });
  });
  return list;
}

/**
 * Première paire fusionnable du **plus bas tier** présent en double.
 *
 * Fusionner par le bas plutôt que par le haut est le comportement d'un joueur qui
 * entretient sa grille : ça libère des cases et ça alimente les tiers supérieurs. Depuis le
 * Lot 4 les paires se cherchent **par sorte** : deux items de même tier mais de familles
 * différentes ne fusionnent pas, et proposer ce lâcher ferait tourner la politique à vide.
 *
 * @param {object} grid
 * @param {number} maxTier Plafond des items d'unité ; les pouvoirs suivent le leur
 * @returns {{from: number, to: number, tier: number}|null}
 */
export function findMerge(grid, maxTier) {
  const groups = new Map();
  for (const entry of items(grid)) {
    const cap = entry.family === ITEM_FAMILY.POWER ? (grid.powerMaxTier ?? maxTier) : maxTier;
    if (entry.tier >= cap) continue; // tier plafond : plus rien à en tirer
    const key = `${entry.key}|${entry.tier}`;
    const list = groups.get(key);
    if (list) list.push(entry.index);
    else groups.set(key, [entry.index]);
  }

  let best = null;
  for (const [key, indices] of groups) {
    if (indices.length < 2) continue;
    const tier = Number(key.slice(key.indexOf('|') + 1));
    if (best === null || tier < best.tier) best = { from: indices[0], to: indices[1], tier };
  }
  return best;
}

/**
 * Case du tier le plus élevé (égalité : plus petit index), ou null.
 *
 * Ne regarde que les items d'**unité** par défaut : c'est cette fonction qui choisit ce que
 * la politique envoie au combat, et un pouvoir n'y va jamais.
 */
export function findHighest(grid, minTier = 1, { family = ITEM_FAMILY.UNIT, power = null } = {}) {
  let best = null;
  for (const entry of items(grid)) {
    if (entry.family !== family) continue;
    if (power !== null && entry.power !== power) continue;
    if (entry.tier < minTier) continue;
    if (best === null || entry.tier > best.tier) best = entry;
  }
  return best;
}

/** Case du tier le plus bas (égalité : plus petit index), ou null. */
export function findLowest(grid) {
  let best = null;
  for (const entry of items(grid)) {
    if (best === null || entry.tier < best.tier) best = entry;
  }
  return best;
}

/**
 * Le pouvoir le plus mûr qui **vaut la peine d'être lâché maintenant**, ou null.
 *
 * @param {object} session
 * @param {number} minTier Tier à partir duquel la politique consent à le dépenser
 * @returns {{index: number, tier: number, power: string}|null}
 */
export function findWorthwhilePower(session, minTier) {
  let best = null;
  for (const entry of items(session.grid)) {
    if (entry.family !== ITEM_FAMILY.POWER) continue;
    if (entry.tier < minTier) continue;
    if (!session.powers.canCast(entry.power)) continue;
    if (!isPowerWorthIt(session, entry)) continue;
    if (best === null || entry.tier > best.tier) best = entry;
  }
  return best;
}

/** Vrai si l'effet du pouvoir trouverait, à cet instant, de quoi se justifier. */
function isPowerWorthIt(session, entry) {
  const stats = session.powers.statsFor(entry.power, entry.tier);
  if (stats.kind === 'heal') {
    return session.battle.units.some(
      (unit) => unit.hp < unit.maxHp * POWER_TRIGGERS.healHpRatio
    );
  }

  // Zone : on compte ce que la météorite attraperait vraiment, en réutilisant le ciblage du
  // jeu — une politique qui estimerait la cible autrement mesurerait un autre jeu.
  const center = session.powers.targetCenter(stats.radius);
  if (center === null) return false;
  const caught = session.battle.enemies.filter(
    (enemy) => Math.abs(enemy.progress - center) <= stats.radius
  ).length;
  return caught >= POWER_TRIGGERS.blastCluster;
}

/**
 * Construit une politique de la famille décrite en tête de fichier.
 *
 * @param {object} options
 * @param {string} options.id Identifiant en ligne de commande (`--policies=...`)
 * @param {string} options.label Libellé affiché dans le rapport
 * @param {number} options.sendTier Tier à partir duquel la politique envoie au combat
 * @param {string} options.summary Une ligne, reprise telle quelle dans le rapport
 * @param {boolean} [options.usePowers] Faux : elle fusionne les pouvoirs mais n'en use jamais
 * @param {number} [options.powerTier] Tier à partir duquel elle consent à dépenser un pouvoir
 * @param {number} [options.actionIntervalMs] Cadence de jeu propre à cette politique ; sinon
 *   celle du harness. C'est la **vitesse de la main**, pas une stratégie
 * @returns {{id: string, label: string, summary: string, sendTier: number,
 *            usePowers: boolean, powerTier: number, actionIntervalMs: ?number,
 *            act: (session: object) => (string|null)}}
 */
export function tierPolicy({
  id,
  label,
  sendTier,
  summary,
  usePowers = true,
  powerTier = 1,
  actionIntervalMs = null,
}) {
  return {
    id,
    label,
    summary,
    sendTier,
    usePowers,
    powerTier,
    actionIntervalMs,
    /**
     * Une action, au plus.
     *
     * @returns {string|null} Nom de l'action jouée (`'tap'`, `'merge'`, `'power'`) ou null
     */
    act(session) {
      const grid = session.grid;
      const maxTier = session.spawnerConfig.maxTier;
      const canSend = session.deployQueue.canAccept();

      // Un pouvoir passe avant tout le reste : il ne coûte ni place de file ni cooldown, et
      // le bon moment pour l'utiliser ne dure pas.
      if (usePowers) {
        const power = findWorthwhilePower(session, powerTier);
        if (power) {
          session.applyTap(power.index);
          return 'power';
        }
      }

      if (!canSend) {
        // La file est pleine : envoyer est impossible, mais préparer reste gratuit — sauf
        // pour le spammeur, qui par définition ne prépare rien.
        if (sendTier <= 1) return null;
        const merge = findMerge(grid, maxTier);
        if (merge) {
          session.applyDrop(merge.from, merge.to);
          return 'merge';
        }
        return null;
      }

      const ready = findHighest(grid, sendTier);
      if (ready) {
        session.applyTap(ready.index);
        return 'tap';
      }

      // Le spammeur ne fusionne **jamais**, pas même deux pouvoirs quand il n'a plus un seul
      // item d'unité à envoyer : c'est sa définition, et l'anti-modèle ne vaut comme repère
      // que s'il est tenu jusqu'au bout.
      const merge = sendTier > 1 ? findMerge(grid, maxTier) : null;
      if (merge) {
        session.applyDrop(merge.from, merge.to);
        return 'merge';
      }

      // Grille pleine sans aucune fusion possible : rester immobile serait une mort par
      // asphyxie que jamais un joueur ne subirait. On envoie le meilleur item d'unité ; s'il
      // n'y en a plus un seul, on brûle le meilleur pouvoir utilisable pour rouvrir une case.
      if (grid.isFull()) {
        const fallback = findHighest(grid);
        if (fallback) {
          session.applyTap(fallback.index);
          return 'tap';
        }
        if (usePowers) {
          const power = findHighest(grid, 1, { family: ITEM_FAMILY.POWER });
          if (power && session.powers.canCast(power.power)) {
            session.applyTap(power.index);
            return 'power';
          }
        }
      }
      return null;
    },
  };
}

/**
 * Politiques disponibles pour `npm run sim`.
 *
 * `spam` et `prepare` sont les deux bornes du design : le premier envoie tout ce qui
 * apparaît, le second ne lâche rien avant le tier 4. `mixed` est le joueur médian, celui
 * dont la courbe doit ressembler à une vraie partie découverte.
 *
 * `noPowers` est le **témoin du Lot 4** : le même joueur que `mixed`, aux pouvoirs près. Le
 * comparer à `mixed` répond à la seule question qui compte pour cette mécanique — est-ce
 * qu'elle apporte quelque chose ? Deux politiques qui ne diffèrent que par un réglage sont
 * la façon la plus honnête de la poser.
 *
 * `slowHands` est le **témoin du Lot 4.5**, et il mesure autre chose qu'une stratégie : la
 * **vitesse de la main**. Toutes les autres politiques jouent trois gestes par seconde, ce
 * qu'aucun joueur ne tient — elles entretiennent donc une grille impeccable et ne voient
 * jamais la saturation dont se plaignent les playtests. Celle-ci joue le même jeu que
 * `mixed` à un geste toutes les 1,1 s : c'est la seule qui subisse vraiment la pression de
 * grille, donc la seule sur laquelle la régulation du Lot 4.5 se mesure.
 */
export const POLICIES = {
  spam: tierPolicy({
    id: 'spam',
    label: 'Spam tier 1',
    sendTier: 1,
    powerTier: 1,
    summary: 'envoie chaque item dès qu’il apparaît, ne fusionne jamais',
  }),
  mixed: tierPolicy({
    id: 'mixed',
    label: 'Mixte tier 3',
    sendTier: 3,
    powerTier: 3,
    summary: 'fusionne tout jusqu’au tier 3 — items d’unité comme pouvoirs — puis dépense : le joueur médian',
  }),
  prepare: tierPolicy({
    id: 'prepare',
    label: 'Prépare tier 4',
    sendTier: 4,
    powerTier: 3,
    summary: 'ne lâche rien avant le tier 4, ni un pouvoir avant le tier 3',
  }),
  noPowers: tierPolicy({
    id: 'noPowers',
    label: 'Mixte sans pouvoirs',
    sendTier: 3,
    usePowers: false,
    summary: 'le même joueur que « Mixte », mais qui n’utilise jamais un pouvoir',
  }),
  slowHands: tierPolicy({
    id: 'slowHands',
    label: 'Mixte, main lente',
    sendTier: 3,
    powerTier: 3,
    // Un geste toutes les 1,1 s au lieu de 0,3 : le pouce d'un joueur qui **regarde** la
    // bataille entre deux fusions, et non celui d'un robot.
    actionIntervalMs: 1100,
    summary: 'le même joueur que « Mixte », mais avec une main humaine — la mesure de la pression de grille',
  }),
};

/** Liste ordonnée des identifiants de politiques. */
export const POLICY_IDS = Object.keys(POLICIES);

/**
 * Résout une liste d'identifiants (`'spam,mixed'`) en politiques.
 *
 * @param {string[]} ids
 * @returns {object[]}
 */
export function resolvePolicies(ids) {
  return ids.map((id) => {
    const policy = POLICIES[id];
    if (!policy) {
      throw new Error(`politique inconnue « ${id} » (disponibles : ${POLICY_IDS.join(', ')})`);
    }
    return policy;
  });
}

export default POLICIES;
