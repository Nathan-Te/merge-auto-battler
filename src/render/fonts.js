/**
 * Polices **auto-hébergées** — déclarées à l'exécution, depuis l'index du pipeline.
 *
 * ## Pourquoi pas Google Fonts
 *
 * Le seed doc et la checklist de release imposent **aucune requête externe** : tout est
 * servi depuis le domaine du jeu. Un `<link>` vers `fonts.googleapis.com` violerait ça,
 * ajouterait deux allers-retours DNS au chargement (compté dans les 3 s), et rendrait
 * l'affichage dépendant d'un tiers que Crazy Games ne contrôle pas. Les fichiers `.woff2`
 * passent donc par `assets-src/fonts/`, comme le reste — même porte d'entrée, même
 * comptabilité de poids.
 *
 * ## Deux polices, deux métiers — en pixel art depuis la bascule de direction artistique
 *
 * Une **display** pour les titres (le nom du jeu, les titres de panneau, le bandeau de
 * vague) et une **texte** pour tout ce qui se lit vraiment : descriptions de cartes, aide,
 * HUD. Les deux sont désormais des **polices bitmap** : une police vectorielle posée sur du
 * pixel art de 16 px jure autant qu'un cercle parfaitement lisse, et pour la même raison —
 * ses courbes sont anticrénelées, donc ses bords sont gris là où tout le reste de l'écran
 * n'a que des pixels pleins.
 *
 * La display peut se permettre d'être décorative ; la texte, non. Le playtest du Lot 3.5 a
 * montré que la description d'une carte de draft est **le** texte qu'il faut lire pour
 * décider, et une police pixel trop stylisée à 11 px sur un téléphone ne se lit pas.
 * Contrainte du choix : hauteur de capitale de 5 à 7 px, et des chiffres qui ne se
 * confondent pas.
 *
 * ## Taille entière, comme les sprites
 *
 * Une police bitmap n'a **qu'une** taille juste, celle à laquelle elle a été dessinée, et
 * ses multiples entiers. `pixelFontSize()` est la porte par laquelle toutes les scènes
 * passent : elle prend la taille souhaitée par le layout et rend la plus proche taille
 * valide. C'est la même règle que `spriteFit()` pour les sprites, appliquée au texte.
 *
 * ## Repli
 *
 * Tant qu'aucune police n'est livrée, `FONTS.display` et `FONTS.body` valent une pile
 * **monospace** : le jeu s'affiche comme aux lots précédents, en un peu plus sec. Le repli a
 * changé avec la direction artistique — `system-ui` est une police de système d'exploitation,
 * ce qui est le contraire de ce qu'on veut voir sur un écran de pixel art, et une monospace
 * est la moins déplacée des polices toujours disponibles. Une police livrée est prise en
 * compte au rechargement suivant, sans toucher au code.
 *
 * Les fichiers attendus sont documentés dans `docs/fonts.md`.
 */

/** Repli de toute police livrée. Voir l'en-tête : monospace plutôt que police système. */
const SYSTEM = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/**
 * Taille de base d'une police bitmap, en pixels.
 *
 * C'est la hauteur à laquelle les polices pixel usuelles sont dessinées (8 px de cadratin,
 * 5 à 6 px de capitale). Une police livrée à une autre taille l'annonce dans son **nom de
 * fichier** — `body-nom-10.woff2` — sur le même principe que le rôle : le pipeline recopie
 * les polices telles quelles, donc tout ce qu'on sait d'elles doit tenir dans leur nom.
 */
export const FONT_BASE_PX = 8;

/**
 * Métriques de la police de texte livrée, ou `null` tant qu'il n'y en a pas.
 *
 * C'est ce qui rend `pixelFontSize()` **inerte tant qu'aucune police pixel n'est déposée**,
 * et c'est délibéré. Le repli est une police vectorielle : l'arrondir à un multiple de 8 ne
 * gagnerait aucune netteté (elle n'a pas de taille native) et ferait sauter tous les textes
 * du jeu de trois tailles d'un coup, pour rien. Le jour où un `.woff2` pixel arrive, la même
 * ligne de code se met à contraindre les tailles, sans qu'aucune scène ne change.
 *
 * Même promesse que pour les sprites, appliquée au texte : un asset absent ne casse rien, un
 * asset livré est pris en compte au rechargement suivant.
 */
export const FONT_METRICS = { basePx: null };

/**
 * Familles utilisées par les scènes.
 *
 * Muté une fois par `installFonts()`, avant la création de la première scène. Les scènes
 * lisent `FONTS.display` / `FONTS.body` au moment de créer leurs textes.
 */
export const FONTS = {
  display: SYSTEM,
  body: SYSTEM,
  /** Chiffres alignés pour la ligne de diagnostic de `?debug=1`. */
  mono: SYSTEM,
};

/**
 * Ramène une taille de police au **multiple entier** de la taille de dessin de la police.
 *
 * Les scènes continuent de calculer leurs tailles comme avant — un pourcentage du plus petit
 * côté de l'écran, borné —, et c'est ici que ce nombre rencontre la grille. Une police bitmap
 * rendue à 13 px alors qu'elle est dessinée à 8 est interpolée : une ligne de pixels sur
 * trois est plus épaisse, ce qui est précisément l'irrégularité qu'on chasse partout ailleurs.
 *
 * **Sans police pixel livrée, la fonction ne fait qu'arrondir à l'entier** (cf.
 * `FONT_METRICS`). C'est ce qui permet de la brancher partout dès maintenant sans changer un
 * pixel de l'écran actuel.
 *
 * Rend au minimum une fois la taille de dessin : un texte trop petit reste préférable à un
 * texte absent, et le layout qui demande moins que ça a un problème à lui.
 *
 * @param {number} size Taille souhaitée, en unités de jeu
 * @param {number|null} [base] Taille de dessin ; `null` = pas de contrainte
 * @returns {number}
 */
export function pixelFontSize(size, base = FONT_METRICS.basePx) {
  const value = Number.isFinite(size) ? size : FONT_BASE_PX;
  if (!(base > 0)) return Math.max(1, Math.round(value));
  return Math.max(1, Math.round(value / base)) * base;
}

/** Le rôle d'une police se lit dans son nom de fichier : `display-*.woff2`, `body-*.woff2`. */
function roleOf(file) {
  const name = file.split('/').pop().toLowerCase();
  if (name.startsWith('display')) return 'display';
  if (name.startsWith('body')) return 'body';
  return null;
}

/**
 * Taille de dessin d'une police bitmap, lue dans son nom de fichier.
 *
 * `body-pixellari-8.woff2` → 8. Le nombre est cherché **juste avant l'extension** pour ne pas
 * confondre avec un chiffre du nom de la police elle-même (`display-m6x11.woff2` n'annonce
 * pas une base de 11). Absent, on retombe sur 8, la taille de dessin usuelle du genre.
 */
function baseSizeOf(file) {
  const match = /-(\d{1,2})\.[a-z0-9]+$/i.exec(file.split('/').pop());
  const value = match ? Number.parseInt(match[1], 10) : NaN;
  return Number.isFinite(value) && value >= 4 ? value : FONT_BASE_PX;
}

const FORMATS = { woff2: 'woff2', woff: 'woff', ttf: 'truetype', otf: 'opentype' };

/**
 * Déclare les polices livrées et met à jour `FONTS`.
 *
 * @param {object|null} index Contenu de `public/assets/index.json`
 * @param {string} [base] Préfixe d'URL des assets
 * @param {Document} [doc] Injectable pour les tests
 * @returns {{display: string, body: string, mono: string}} l'état de `FONTS` après coup
 */
export function installFonts(index, base = 'assets/', doc = globalThis.document) {
  const files = index?.fonts ?? [];
  if (files.length === 0 || !doc) return FONTS;

  const rules = [];
  for (const file of files) {
    const role = roleOf(file);
    if (!role) continue;
    const extension = file.split('.').pop().toLowerCase();
    const format = FORMATS[extension];
    if (!format) continue;

    const family = `mb-${role}`;
    rules.push(
      `@font-face{font-family:'${family}';` +
        `src:url('${base}fonts/${file}') format('${format}');` +
        // `swap` plutôt que le blocage par défaut : le texte s'affiche tout de suite dans la
        // police système et se remplace à l'arrivée. Un jeu qui démarre sans texte pendant
        // 400 ms paraît cassé, et le seed doc compte ces 400 ms.
        `font-display:swap;font-weight:normal;font-style:normal;}`
    );
    // Le repli reste derrière la police livrée : si le fichier échoue, le texte s'affiche
    // quand même.
    FONTS[role] = `'${family}', ${SYSTEM}`;
    // C'est la police de **texte** qui fixe la contrainte de taille, pas celle de titre :
    // elle est de loin la plus utilisée, et c'est elle qu'on lit à petite taille — donc
    // celle dont l'interpolation se voit. Une display à 24 px supporte un pixel de travers ;
    // une description de carte à 8 px, non.
    if (role === 'body') FONT_METRICS.basePx = baseSizeOf(file);
  }

  if (rules.length === 0) return FONTS;
  const style = doc.createElement('style');
  style.setAttribute('data-fonts', 'merge-battler');
  style.textContent = rules.join('\n');
  doc.head.appendChild(style);
  return FONTS;
}

export default FONTS;
