/**
 * **Le vocabulaire de sprites du jeu** — la liste des noms que le rendu sait afficher.
 *
 * Ce module est le seul endroit où se décide comment s'appelle un sprite, et il est lu par
 * les **deux** bouts de la chaîne :
 *
 *   - le **pipeline** (`npm run assets`) s'en sert pour dire, dans la galerie, ce qui manque
 *     encore et ce qui a été découpé sous un nom que personne n'attend — les deux erreurs
 *     qu'on fait en remplissant un manifest depuis un téléphone ;
 *   - le **rendu** (`src/render/skin.js`) s'en sert pour demander une texture, et retomber
 *     sur le greybox vectoriel quand elle n'existe pas.
 *
 * Les noms sont **dérivés de `balance.json`** plutôt qu'écrits à la main : ajouter un type
 * d'unité ou un pouvoir fait apparaître les sprites attendus dans la galerie sans que
 * personne n'ait à tenir une seconde liste à jour. Une liste tenue à la main mentirait dès
 * la première retouche, exactement comme le ferait `docs/reference.md`.
 *
 * `balance.json` est **passé en paramètre** plutôt qu'importé : le module est lu à la fois
 * par le rendu (où Vite résout les imports JSON) et par le pipeline en ligne de commande
 * (où Node exigerait un attribut d'import). Même raison que `src/tools/generateReference.js`,
 * qui lit le fichier au disque.
 *
 * ## Paliers visuels
 *
 * Les items d'unité ont 11 tiers et les pouvoirs 6, mais les planches n'en dessinent que
 * **trois** par famille : au-delà, on peint onze fois le même orbe. Les tiers sont donc
 * rangés en **plages** (`bands`), configurables dans le manifest de découpe
 * (`assets-src/manifest.json`, clé `tierBands`) : c'est de la présentation, aucune valeur de
 * jeu n'en dépend, et un playtest qui trouve la marche trop haute se corrige depuis
 * l'éditeur web de GitHub.
 */

/**
 * Plages par défaut : trois paliers visuels, du plus modeste au plus imposant.
 *
 * **Trois familles, trois tables, et c'est délibéré.** Les orbes de la grille et les unités
 * du champ de bataille ont le même nombre de tiers, mais pas le même coût de dessin : un
 * orbe est une icône qu'on peut décliner onze fois sans y passer la semaine, une unité est
 * un personnage. Les avoir fait partager une table obligeait à choisir entre « onze orbes,
 * donc onze personnages par type » et « trois personnages, donc trois orbes » — un faux
 * choix, qui a coûté un aller-retour au premier lot d'assets livré.
 */
export const DEFAULT_TIER_BANDS = {
  /** 11 tiers d'items de la grille → 3 paliers par défaut, jusqu'à 11 si les orbes existent. */
  orb: [
    [1, 4],
    [5, 8],
    [9, 11],
  ],
  /** 11 tiers d'unités au combat → 3 paliers : ce sont des personnages, pas des icônes. */
  unit: [
    [1, 4],
    [5, 8],
    [9, 11],
  ],
  /** 6 tiers de pouvoir → 3 paliers. */
  power: [
    [1, 2],
    [3, 4],
    [5, 6],
  ],
};

/**
 * Palier visuel (1-indexé) d'un tier, d'après une table de plages.
 *
 * Hors plage — un tier au-delà de la dernière borne — retombe sur le dernier palier plutôt
 * que sur rien : mieux vaut un orbe trop imposant qu'un item invisible.
 *
 * @param {number} tier
 * @param {[number, number][]} bands
 * @returns {number} palier, de 1 à `bands.length`
 */
export function bandOf(tier, bands) {
  const value = Math.max(1, Math.floor(tier));
  for (let i = 0; i < bands.length; i += 1) {
    const [min, max] = bands[i];
    if (value >= min && value <= max) return i + 1;
  }
  return value < bands[0]?.[0] ? 1 : bands.length;
}

/**
 * Nom du sprite d'un item de la grille (l'orbe d'invocation) pour un tier donné.
 *
 * Ses plages sont **celles des orbes** (`tierBands.orb`), pas celles des unités : un orbe
 * par tier est un choix courant et peu coûteux, onze personnages par type ne l'est pas.
 */
export function orbSprite(tier, bands = DEFAULT_TIER_BANDS.orb) {
  return `orb.${bandOf(tier, bands)}`;
}

/** Nom du sprite d'un item de pouvoir (fiole, orbe de météore) pour un type et un tier. */
export function powerItemSprite(type, tier, bands = DEFAULT_TIER_BANDS.power) {
  return `power.${type}.${bandOf(tier, bands)}`;
}

/** Nom du sprite d'une unité au combat — type et palier visuel. */
export function unitSprite(type, tier, bands = DEFAULT_TIER_BANDS.unit) {
  return `unit.${type}.${bandOf(tier, bands)}`;
}

/** Nom du sprite d'un ennemi. Les ennemis n'ont pas de tier : un seul sprite par type. */
export function enemySprite(type) {
  return `enemy.${type}`;
}

/**
 * Projectile associé à un rôle d'unité.
 *
 * Le modèle ne connaît que des rôles (`damage`, `aoe`, `slow`, `support`) : la flèche, la
 * boule de feu et l'éclat de givre sont une décision de rendu, pas de gameplay.
 */
export const PROJECTILE_BY_ROLE = {
  damage: 'projectile.arrow',
  aoe: 'projectile.fireball',
  slow: 'projectile.frost',
  support: 'projectile.arrow',
};

/** Sprites de décor : le champ, le château, le portail d'invocation, la table de guerre. */
export const DECOR_SPRITES = [
  'decor.field',
  'decor.castle',
  'decor.portal',
  'decor.table',
  'decor.sky',
];

/** Sprites d'interface : panneaux 9-slice, carte de parchemin, bouton. */
export const UI_SPRITES = ['ui.panel.wood', 'ui.panel.parchment', 'ui.card', 'ui.button'];

/** Icônes d'interface hors draft (bouton son, aide, crédits). */
export const ICON_SPRITES = ['icon.sound.on', 'icon.sound.off', 'icon.help'];

/**
 * Tous les noms de sprites que le jeu sait afficher, dans l'ordre de la galerie.
 *
 * @param {object} options
 * @param {object} options.balance Contenu de `balance.json`
 * @param {{orb: [number,number][], unit: [number,number][], power: [number,number][]}} [options.bands]
 * @returns {{name: string, category: string}[]}
 */
export function expectedSprites({ balance, bands = DEFAULT_TIER_BANDS }) {
  const sprites = [];
  const push = (category, name) => sprites.push({ name, category });

  const orbBands = bands.orb ?? bands.unit;
  for (let band = 1; band <= orbBands.length; band += 1) push('orbs', `orb.${band}`);

  for (const type of Object.keys(balance.powers.types)) {
    for (let band = 1; band <= bands.power.length; band += 1) {
      push('powers', `power.${type}.${band}`);
    }
  }

  for (const type of Object.keys(balance.units)) {
    for (let band = 1; band <= bands.unit.length; band += 1) {
      push('units', `unit.${type}.${band}`);
    }
  }

  for (const type of Object.keys(balance.enemies)) push('enemies', `enemy.${type}`);

  for (const name of new Set(Object.values(PROJECTILE_BY_ROLE))) push('projectiles', name);
  for (const name of DECOR_SPRITES) push('decor', name);
  for (const name of UI_SPRITES) push('ui', name);
  for (const name of ICON_SPRITES) push('ui', name);
  // Les icônes de draft sont nommées dans `balance.json` : une carte ajoutée fait
  // apparaître son icône dans la galerie, sans toucher à ce fichier.
  for (const icon of new Set(balance.draft.upgrades.map((entry) => entry.icon))) {
    push('ui', `icon.draft.${icon}`);
  }

  return sprites;
}

/** L'ensemble des noms attendus, pour un test d'appartenance rapide. */
export function expectedSpriteNames(options) {
  return new Set(expectedSprites(options).map((entry) => entry.name));
}

export default expectedSprites;
