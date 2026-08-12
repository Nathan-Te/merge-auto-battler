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
 * ## Deux polices, deux métiers
 *
 * Une **display** médiévale pour les titres (le nom du jeu, les titres de panneau, le
 * bandeau de vague) et une **texte** neutre pour tout ce qui se lit vraiment : descriptions
 * de cartes, aide, HUD. Écrire une description de draft en gothique la rend illisible sur un
 * téléphone, et c'est exactement le texte qu'il faut lire pour décider.
 *
 * ## Repli
 *
 * Tant qu'aucune police n'est livrée, `FONTS.display` et `FONTS.body` valent la pile
 * système : le jeu s'affiche comme aux lots précédents. Une police livrée est prise en
 * compte au rechargement suivant, sans toucher au code.
 */

/** Pile système, et repli de toute police livrée. */
const SYSTEM = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

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
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

/** Le rôle d'une police se lit dans son nom de fichier : `display-*.woff2`, `body-*.woff2`. */
function roleOf(file) {
  const name = file.split('/').pop().toLowerCase();
  if (name.startsWith('display')) return 'display';
  if (name.startsWith('body')) return 'body';
  return null;
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
  }

  if (rules.length === 0) return FONTS;
  const style = doc.createElement('style');
  style.setAttribute('data-fonts', 'merge-battler');
  style.textContent = rules.join('\n');
  doc.head.appendChild(style);
  return FONTS;
}

export default FONTS;
