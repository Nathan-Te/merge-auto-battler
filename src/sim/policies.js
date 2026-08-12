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
 *   1. file de déploiement pleine → fusionner (c'est gratuit) ou ne rien faire ;
 *   2. un item de tier ≥ `sendTier` est présent → taper le plus haut ;
 *   3. une fusion est possible → fusionner la paire du **plus bas** tier ;
 *   4. grille pleine et rien à fusionner → taper le plus haut tier pour se débloquer ;
 *   5. sinon, attendre.
 *
 * `sendTier: 1` dégénère donc exactement en « spam » : la règle 2 se déclenche toujours et
 * la politique ne fusionne jamais. C'est l'anti-modèle contre lequel le design se mesure —
 * l'invariant « merge bat spam » (cf. `CLAUDE.md`) se vérifie en comparant ces deux-là.
 *
 * Les politiques sont **déterministes** : aucun tirage, et les égalités se tranchent par le
 * plus petit index. Deux exécutions de même graine donnent la même partie.
 */

/** Index des cases occupées, avec leur tier, dans l'ordre de la grille. */
function items(grid) {
  const list = [];
  grid.cells.forEach((item, index) => {
    if (item !== null) list.push({ index, tier: item.tier });
  });
  return list;
}

/**
 * Première paire fusionnable du **plus bas tier** présent en double.
 *
 * Fusionner par le bas plutôt que par le haut est le comportement d'un joueur qui
 * entretient sa grille : ça libère des cases et ça alimente les tiers supérieurs.
 *
 * @returns {{from: number, to: number, tier: number}|null}
 */
export function findMerge(grid, maxTier) {
  const byTier = new Map();
  for (const { index, tier } of items(grid)) {
    if (tier >= maxTier) continue; // tier plafond : plus rien à en tirer
    const list = byTier.get(tier);
    if (list) list.push(index);
    else byTier.set(tier, [index]);
  }

  let best = null;
  for (const [tier, indices] of byTier) {
    if (indices.length < 2) continue;
    if (best === null || tier < best.tier) best = { from: indices[0], to: indices[1], tier };
  }
  return best;
}

/** Case du tier le plus élevé (égalité : plus petit index), ou null si la grille est vide. */
export function findHighest(grid, minTier = 1) {
  let best = null;
  for (const entry of items(grid)) {
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
 * Construit une politique de la famille décrite en tête de fichier.
 *
 * @param {object} options
 * @param {string} options.id Identifiant en ligne de commande (`--policies=...`)
 * @param {string} options.label Libellé affiché dans le rapport
 * @param {number} options.sendTier Tier à partir duquel la politique envoie au combat
 * @param {string} options.summary Une ligne, reprise telle quelle dans le rapport
 * @returns {{id: string, label: string, summary: string, sendTier: number,
 *            act: (session: object) => (string|null)}}
 */
export function tierPolicy({ id, label, sendTier, summary }) {
  return {
    id,
    label,
    summary,
    sendTier,
    /**
     * Une action, au plus.
     *
     * @returns {string|null} Nom de l'action jouée (`'tap'`, `'merge'`) ou null
     */
    act(session) {
      const grid = session.grid;
      const maxTier = session.spawnerConfig.maxTier;
      const canSend = session.deployQueue.canAccept();

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

      const merge = findMerge(grid, maxTier);
      if (merge) {
        session.applyDrop(merge.from, merge.to);
        return 'merge';
      }

      // Grille pleine sans aucune fusion possible : rester immobile serait une mort par
      // asphyxie que jamais un joueur ne subirait. On envoie le meilleur item disponible.
      if (grid.isFull()) {
        const fallback = findHighest(grid);
        if (fallback) {
          session.applyTap(fallback.index);
          return 'tap';
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
 */
export const POLICIES = {
  spam: tierPolicy({
    id: 'spam',
    label: 'Spam tier 1',
    sendTier: 1,
    summary: 'envoie chaque item dès qu’il apparaît, ne fusionne jamais',
  }),
  mixed: tierPolicy({
    id: 'mixed',
    label: 'Mixte tier 3',
    sendTier: 3,
    summary: 'fusionne jusqu’au tier 3 puis envoie — le joueur médian',
  }),
  prepare: tierPolicy({
    id: 'prepare',
    label: 'Prépare tier 4',
    sendTier: 4,
    summary: 'ne lâche rien avant le tier 4',
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
