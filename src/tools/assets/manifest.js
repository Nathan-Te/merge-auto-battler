/**
 * Lecture et validation du **manifest de découpe** (`assets-src/manifest.json`).
 *
 * Fonction pure, sans système de fichiers : elle prend l'objet JSON déjà lu et rend une
 * configuration normalisée, ou lève une erreur. C'est ce qui la rend testable sans planche
 * ni `sharp`, comme tout le reste de `src/systems/`.
 *
 * ## Le vrai destinataire de ce fichier
 *
 * Le manifest est **corrigé depuis l'éditeur web de GitHub, sur un téléphone**, par
 * quelqu'un qui ne relira pas le pipeline (cf. `assets-src/manifest.md`). Deux conséquences
 * qui gouvernent tout ce module :
 *
 *   - **les messages d'erreur citent le fichier, la clé et ce qu'il faut écrire à la place**
 *     — « planche 3 (`units.png`) : 12 cases découpées mais 10 noms donnés » se corrige
 *     sans quitter l'éditeur, « Invalid manifest » non ;
 *   - **tout ce qui peut avoir une valeur par défaut en a une.** Une planche minimale tient
 *     en quatre clés (`file`, `category`, `cols`, `rows`) ; le reste ne s'écrit que pour
 *     déroger.
 */

/** Catégories connues de la galerie et du rendu. Une planche doit se ranger dans l'une. */
export const CATEGORIES = [
  'orbs',
  'powers',
  'units',
  'enemies',
  'projectiles',
  'decor',
  'ui',
];

/** Valeurs par défaut, toutes surchargeables planche par planche. */
export const DEFAULTS = {
  /** Le fond des planches générées par IA est blanc : c'est lui qu'on retire. */
  keying: { color: [255, 255, 255], tolerance: 24, softness: 16 },
  /**
   * `lossless` est **la** conséquence technique de la bascule en pixel art, et elle n'est
   * pas négociable : un atlas WebP compressé avec perte réinvente des milliers de teintes
   * intermédiaires et adoucit chaque bord. On aurait quantifié vers cent couleurs et seuillé
   * l'alpha pour que l'encodeur défasse tout à la dernière étape. Le coût est nul ici — des
   * sprites de 16 px en aplats se compressent mieux sans perte qu'avec.
   */
  atlas: { maxSize: 2048, padding: 2, quality: 82, lossless: true },
  /**
   * **Constantes de la direction artistique pixel art.**
   *
   * `nativeSize` est la première règle d'or du projet : la taille de dessin d'un sprite de
   * personnage ou d'icône, en pixels d'art. Elle vaut 16 parce que c'est ce que mesure le
   * pack de référence (cellules de 16 px, marge 1 px, gouttière 2 px, planche livrée en ×4),
   * et **aucun asset d'une autre résolution native n'entre en jeu**. Ce n'est pas un réglage
   * qu'on ajuste au playtest : c'est ce qui fait que deux sprites voisins ont des pixels de
   * la même taille, et ça ne se rattrape pas après coup.
   */
  pixel: {
    nativeSize: 16,
    /** Seuillage : au-dessus le pixel est opaque, en dessous il n'existe pas. Jamais entre. */
    alphaThreshold: 128,
    /** Réduction par défaut d'une source non native. Voir `pixelOps.js`. */
    resample: 'area',
    /**
     * Garde-fou de relecture. Les tailles ci-dessous sont en **pixels d'art**, pas en pixels
     * d'écran : une valeur de 192 est le symptôme d'un manifest écrit avant la bascule en
     * pixel art, et produirait un sprite de 192 pixels de dessin — soit douze personnages
     * mis bout à bout. On refuse plutôt que de le découvrir dans la galerie.
     *
     * 128 = huit personnages de large, ce qui est déjà un décor plein cadre. Un asset qui a
     * une vraie raison d'aller au-delà relève le plafond ici, en connaissance de cause.
     */
    maxSpriteSize: 128,
  },
  /**
   * Côté visé d'un sprite, en **pixels d'art**, avant packing. Par catégorie.
   *
   * Ce sont des tailles de **dessin**, pas des tailles d'écran : c'est le rendu qui choisit
   * par quel entier les multiplier, écran par écran (`src/systems/pixelScale.js`). Avant la
   * bascule en pixel art, ces mêmes clés valaient 192 à 640 et étaient des pixels d'écran —
   * l'unité a changé en même temps que la direction artistique.
   */
  sizes: {
    orbs: 16,
    powers: 16,
    units: 16,
    enemies: 16,
    projectiles: 8,
    decor: 128,
    ui: 32,
  },
  /** Le pixel art pèse une fraction du dessin lisse : la cible descend avec lui. */
  budgetKb: { target: 5 * 1024, max: 20 * 1024 },
};

/** Modes de réduction d'une source non native. */
const RESAMPLE_MODES = ['area', 'nearest'];

/**
 * Séparateur des frames d'animation dans un nom de sprite.
 *
 * `~` est **impossible** dans un nom écrit à la main : `parseCellName` n'accepte que des
 * lettres, des chiffres et `. - _`. Une frame dérivée ne peut donc jamais entrer en collision
 * avec un sprite du manifest, et le rendu sait au caractère près ce qu'il regarde.
 */
export const ANIM_SEPARATOR = '~';

/** Nom de frame d'animation dérivé d'un nom d'ancre. */
export function animFrameName(base, animation, index) {
  return `${base}${ANIM_SEPARATOR}${animation}${index}`;
}

/** Vrai si ce nom est une frame d'animation produite par le pipeline, et non une ancre. */
export function isAnimFrameName(name) {
  return name.includes(ANIM_SEPARATOR);
}

/** Une cellule dont le nom vaut l'un de ces marqueurs est **ignorée** (case vide, ratée). */
const SKIP_MARKERS = new Set(['', '-', '_', 'skip', 'null']);

function fail(message) {
  throw new Error(`assets-src/manifest.json : ${message}`);
}

/** Entier strictement positif, avec un message qui dit quoi écrire. */
function positiveInt(value, path, { min = 1 } = {}) {
  if (!Number.isInteger(value) || value < min) {
    fail(`${path} doit être un entier ≥ ${min} (reçu ${JSON.stringify(value)})`);
  }
  return value;
}

function nonNegativeInt(value, path) {
  if (!Number.isInteger(value) || value < 0) {
    fail(`${path} doit être un entier ≥ 0 (reçu ${JSON.stringify(value)})`);
  }
  return value;
}

/** Normalise un bloc de détourage, en héritant du bloc parent. */
function parseKeying(raw, parent, path) {
  if (raw === undefined) return { ...parent };
  if (typeof raw !== 'object' || raw === null) fail(`${path} doit être un objet`);

  const color = raw.color ?? parent.color;
  if (!Array.isArray(color) || color.length !== 3 || color.some((c) => !Number.isInteger(c) || c < 0 || c > 255)) {
    fail(`${path}.color doit être trois entiers 0-255, par exemple [255, 255, 255]`);
  }
  const tolerance = raw.tolerance ?? parent.tolerance;
  const softness = raw.softness ?? parent.softness;
  if (typeof tolerance !== 'number' || tolerance < 0 || tolerance > 255) {
    fail(`${path}.tolerance doit être un nombre 0-255 (24 par défaut ; monter si le fond bave)`);
  }
  if (typeof softness !== 'number' || softness < 0 || softness > 255) {
    fail(`${path}.softness doit être un nombre 0-255 (16 par défaut ; monter si le bord est dur)`);
  }
  return { color: [...color], tolerance, softness };
}

/**
 * Normalise les plages de paliers visuels.
 *
 * Elles ne changent aucune valeur de jeu : elles disent seulement quel tier porte quel
 * sprite (cf. `src/render/skinNames.js`).
 */
function parseBands(raw, path) {
  if (!Array.isArray(raw) || raw.length === 0) {
    fail(`${path} doit être une liste de plages, par exemple [[1, 4], [5, 8], [9, 11]]`);
  }
  return raw.map((entry, index) => {
    if (!Array.isArray(entry) || entry.length !== 2) {
      fail(`${path}[${index}] doit être une paire [min, max]`);
    }
    const [min, max] = entry;
    positiveInt(min, `${path}[${index}][0]`);
    positiveInt(max, `${path}[${index}][1]`);
    if (max < min) fail(`${path}[${index}] : max (${max}) est plus petit que min (${min})`);
    return [min, max];
  });
}

/**
 * Nom d'une cellule, ou `null` si la cellule est à ignorer.
 *
 * Trois écritures acceptées, de la plus courte à la plus explicite — c'est volontaire : on
 * remplit un manifest au pouce, dans un éditeur sans autocomplétion.
 */
function parseCellName(raw, path) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') fail(`${path} doit être une chaîne (ou null pour ignorer la case)`);
  const name = raw.trim();
  if (SKIP_MARKERS.has(name.toLowerCase())) return null;
  if (!/^[a-z0-9][a-z0-9.\-_]*$/i.test(name)) {
    fail(`${path} : « ${name} » n'est pas un nom de sprite valide (lettres, chiffres, . - _)`);
  }
  return name;
}

/**
 * Animations d'une planche : **où sont les autres frames du même personnage**.
 *
 * Les packs de personnages sont tous bâtis pareil — un bloc de cellules par personnage, les
 * frames de marche côte à côte, les directions les unes sous les autres. Le manifest ne
 * nomme qu'**une** cellule par personnage (l'ancre, celle qu'on voit à l'arrêt) ; les frames
 * d'animation se décrivent alors comme des **décalages de cellule** par rapport à elle :
 *
 * ```json
 * "animations": {
 *   "walk": { "frames": [[-1, 0], [0, 0], [1, 0], [0, 0]] }
 * }
 * ```
 *
 * Un décalage vaut `[colonne, ligne]`, compté en cases de la grille de découpe. C'est la
 * seule écriture qui reste juste quand on ajoute un personnage : on déplace l'ancre dans
 * `names`, et toutes ses frames suivent — là où des indices absolus se réécriraient à la
 * main, case par case, depuis un téléphone.
 *
 * `[0, 0]` désigne l'ancre elle-même : le pipeline **réutilise** alors son sprite au lieu
 * d'en empiler une copie dans l'atlas.
 *
 * La **cadence** n'est pas ici : elle vit dans `juice.json` (`sprite.fps.<animation>`), avec
 * le reste de ce qui se règle à l'œil. Une planche dont le rythme sort de l'ordinaire peut
 * malgré tout poser un `"fps"` sur son animation, qui l'emporte alors sur la valeur globale.
 */
function parseAnimations(raw, label, { cols, rows }) {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    fail(
      `${label} : animations doit être un objet { "walk": { "frames": [[-1, 0], [0, 0], [1, 0]] } }`
    );
  }

  const animations = {};
  for (const [name, entry] of Object.entries(raw)) {
    const at = `${label} : animations.${name}`;
    if (!/^[a-z][a-z0-9]*$/.test(name)) {
      fail(`${at} : le nom d'une animation est en minuscules sans séparateur (walk, idle, hurt)`);
    }
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      fail(`${at} doit être un objet { "frames": [...] }`);
    }
    const frames = entry.frames;
    if (!Array.isArray(frames) || frames.length === 0) {
      fail(`${at}.frames doit être une liste non vide de décalages [colonne, ligne]`);
    }
    const offsets = frames.map((offset, index) => {
      if (!Array.isArray(offset) || offset.length !== 2 || offset.some((v) => !Number.isInteger(v))) {
        fail(`${at}.frames[${index}] doit être une paire d'entiers [colonne, ligne], par exemple [-1, 0]`);
      }
      const [dcol, drow] = offset;
      // Un décalage plus grand que la planche est forcément une faute de frappe : le dire
      // ici évite de découvrir un sprite vide trois écrans plus loin.
      if (Math.abs(dcol) >= cols || Math.abs(drow) >= rows) {
        fail(
          `${at}.frames[${index}] : le décalage [${dcol}, ${drow}] sort d'une planche de ` +
            `${cols}×${rows} cases`
        );
      }
      return [dcol, drow];
    });

    let fps = entry.fps ?? null;
    if (fps !== null && (typeof fps !== 'number' || !Number.isFinite(fps) || fps < 0)) {
      fail(`${at}.fps doit être un nombre ≥ 0 (ou absent, pour suivre juice.json)`);
    }

    animations[name] = { frames: offsets, fps };
  }
  return animations;
}

/**
 * Ligne de crédit d'une planche de **pack**.
 *
 * Obligatoire dès qu'une planche est déclarée native, et c'est délibérément raide : un
 * sprite de pack sans auteur ni licence est un problème juridique qu'on ne détecte plus une
 * fois qu'il est dans l'atlas, mélangé à cinquante autres. Le refuser à l'entrée est la
 * seule barrière qui tienne — et elle est facile à franchir quand on a l'information.
 */
function parseCredit(raw, path, { required }) {
  if (raw === undefined || raw === null) {
    if (!required) return null;
    fail(
      `${path} manquant. Une planche "native": true est un asset de pack : elle n'entre pas ` +
        `sans son auteur et sa licence. Écris par exemple :\n` +
        `  "credit": { "author": "…", "pack": "…", "license": "CC BY 4.0", "url": "https://…" }`
    );
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) fail(`${path} doit être un objet`);

  const author = raw.author;
  const license = raw.license;
  if (typeof author !== 'string' || author.trim().length === 0) {
    fail(`${path}.author manquant — le nom de l'auteur du pack, tel qu'il demande à être cité`);
  }
  if (typeof license !== 'string' || license.trim().length === 0) {
    fail(`${path}.license manquant — par exemple "CC BY 4.0", "CC0", "OGA-BY 3.0"`);
  }
  return {
    author: author.trim(),
    pack: typeof raw.pack === 'string' ? raw.pack.trim() : null,
    license: license.trim(),
    url: typeof raw.url === 'string' ? raw.url.trim() : null,
  };
}

/**
 * Normalise une planche.
 *
 * @param {object} raw Entrée brute de `sheets`
 * @param {number} index Rang dans la liste, cité dans les erreurs
 * @param {object} defaults Blocs par défaut déjà normalisés
 */
function parseSheet(raw, index, defaults) {
  const at = `sheets[${index}]`;
  if (typeof raw !== 'object' || raw === null) fail(`${at} doit être un objet`);

  const file = raw.file;
  if (typeof file !== 'string' || file.length === 0) {
    fail(`${at}.file manquant — le nom du fichier déposé dans assets-src/, par exemple "orbes.png"`);
  }
  const label = `planche ${index + 1} (« ${file} »)`;

  const category = raw.category;
  if (!CATEGORIES.includes(category)) {
    fail(`${label} : category « ${category} » inconnue — au choix : ${CATEGORIES.join(', ')}`);
  }

  const cols = positiveInt(raw.cols, `${label} : cols`);
  const rows = positiveInt(raw.rows, `${label} : rows`);
  const margin = nonNegativeInt(raw.margin ?? 0, `${label} : margin`);
  const spacing = nonNegativeInt(raw.spacing ?? 0, `${label} : spacing`);

  /**
   * **Native** = déjà du pixel art, à la résolution du projet (une planche de pack).
   * Elle passe sans pixelisation : on la ramène seulement à ×1 si elle est livrée agrandie.
   * Par défaut une planche est **non native** — c'est le cas courant, une génération IA.
   */
  const native = raw.native ?? false;
  if (typeof native !== 'boolean') {
    fail(`${label} : native doit être true ou false (true = planche de pack, déjà pixelisée)`);
  }

  const resample = raw.resample ?? defaults.pixel.resample;
  if (!RESAMPLE_MODES.includes(resample)) {
    fail(
      `${label} : resample « ${resample} » inconnu — "area" (défaut, moyenne de surface) ` +
        `ou "nearest" (plus-proche-voisin, pour une source déjà pixelisée mal agrandie)`
    );
  }

  const size = raw.size ?? defaults.sizes[category];
  positiveInt(size, `${label} : size`);
  if (size > defaults.pixel.maxSpriteSize) {
    fail(
      `${label} : size vaut ${size}, mais les tailles sont en **pixels d'art** depuis la ` +
        `bascule en pixel art, pas en pixels d'écran. Un personnage fait ` +
        `${defaults.pixel.nativeSize}, un décor plein cadre quelques dizaines. ` +
        `Le rendu multiplie ensuite par un entier, écran par écran.`
    );
  }

  const names = raw.names;
  if (!Array.isArray(names)) {
    fail(
      `${label} : names manquant — une liste de ${cols * rows} noms, ligne par ligne, ` +
        `de gauche à droite (mettre null pour sauter une case)`
    );
  }
  if (names.length !== cols * rows) {
    fail(
      `${label} : ${cols}×${rows} = ${cols * rows} cases découpées mais ${names.length} ` +
        `noms donnés — ajuste cols/rows, ou complète names avec des null`
    );
  }

  const cells = names.map((name, cell) => ({
    name: parseCellName(name, `${label} : names[${cell}]`),
    col: cell % cols,
    row: Math.floor(cell / cols),
  }));

  const animations = parseAnimations(raw.animations, label, { cols, rows });

  // Une frame d'animation qui tombe hors de la planche donnerait un sprite vide sans rien
  // dire. On vérifie **chaque ancre contre chaque animation**, une seule fois, ici.
  for (const cell of cells) {
    if (!cell.name) continue;
    for (const [animation, { frames }] of Object.entries(animations)) {
      for (const [dcol, drow] of frames) {
        const col = cell.col + dcol;
        const row = cell.row + drow;
        if (col < 0 || col >= cols || row < 0 || row >= rows) {
          fail(
            `${label} : la frame [${dcol}, ${drow}] de l'animation « ${animation} » sort de la ` +
              `planche pour « ${cell.name} » (case colonne ${cell.col + 1}, ligne ${cell.row + 1}). ` +
              `Déplace l'ancre dans names, ou corrige le décalage.`
          );
        }
      }
    }
  }

  return {
    animations,
    file,
    category,
    cols,
    rows,
    margin,
    spacing,
    size,
    native,
    resample,
    /**
     * Facteur d'agrandissement de la source, si on veut le forcer. Par défaut il est
     * **mesuré** sur les pixels (`detectPixelScale`), ce qui vaut mieux que de le lire dans
     * le nom du fichier : les deux planches de référence du projet s'appellent « 3x » et
     * « 4x » et sont toutes les deux en ×4.
     */
    scale: raw.scale === undefined ? null : positiveInt(raw.scale, `${label} : scale`),
    /** Rogner les bords transparents après détourage. Coupé pour un décor plein cadre. */
    trim: raw.trim ?? true,
    /**
     * Détourer le fond. Une planche de pack arrive déjà sur du transparent : lui appliquer
     * le détourage du blanc ne ferait que risquer de manger ses zones claires.
     */
    keyOut: raw.keyOut ?? !native,
    keying: parseKeying(raw.keying, defaults.keying, `${label} : keying`),
    credit: parseCredit(raw.credit, `${label} : credit`, { required: native }),
    cells,
  };
}

/**
 * Valide et normalise le manifest complet.
 *
 * @param {object} raw Contenu JSON du manifest
 * @returns {{atlas: object, budgetKb: object, keying: object, sizes: object,
 *            tierBands: object, sheets: object[], audio: object, fonts: object}}
 */
export function parseManifest(raw) {
  if (typeof raw !== 'object' || raw === null) fail('le fichier doit contenir un objet JSON');

  const keying = parseKeying(raw.keying, DEFAULTS.keying, 'keying');

  // --- constantes de direction artistique. Elles ne se règlent pas au playtest.
  const pixel = { ...DEFAULTS.pixel, ...(raw.pixel ?? {}) };
  positiveInt(pixel.nativeSize, 'pixel.nativeSize', { min: 4 });
  positiveInt(pixel.maxSpriteSize, 'pixel.maxSpriteSize', { min: pixel.nativeSize });
  if (!Number.isInteger(pixel.alphaThreshold) || pixel.alphaThreshold < 1 || pixel.alphaThreshold > 255) {
    fail(
      'pixel.alphaThreshold doit être un entier 1-255 (128 par défaut). ' +
        'Monter si les bords des sprites pixelisés bavent, descendre s’ils sont rongés.'
    );
  }
  if (!RESAMPLE_MODES.includes(pixel.resample)) {
    fail(`pixel.resample doit valoir "area" ou "nearest" (reçu ${JSON.stringify(pixel.resample)})`);
  }

  const paletteRaw = raw.palette ?? {};
  if (typeof paletteRaw !== 'object' || Array.isArray(paletteRaw)) fail('palette doit être un objet');
  const paletteSources = paletteRaw.sources ?? [];
  if (!Array.isArray(paletteSources) || paletteSources.some((entry) => typeof entry !== 'string')) {
    fail('palette.sources doit être une liste de noms de planches, par exemple ["mon-pack.png"]');
  }
  const palette = {
    /** Fichier committé, produit par `npm run palette`. */
    file: typeof paletteRaw.file === 'string' ? paletteRaw.file : 'palette.json',
    /** Planches de **pack** dont on extrait la palette. Jamais une génération IA. */
    sources: [...paletteSources],
    /**
     * Quantifier ou non. Toujours vrai en pratique : c'est la seconde règle d'or. La clé
     * existe pour pouvoir regarder une planche non quantifiée dans la galerie, le temps de
     * juger si la palette est trop pauvre — pas pour publier sans elle.
     */
    quantize: paletteRaw.quantize ?? true,
  };

  const sizes = { ...DEFAULTS.sizes };
  if (raw.sizes !== undefined) {
    if (typeof raw.sizes !== 'object' || raw.sizes === null) fail('sizes doit être un objet');
    for (const [category, value] of Object.entries(raw.sizes)) {
      if (!CATEGORIES.includes(category)) {
        fail(`sizes.${category} : catégorie inconnue — au choix : ${CATEGORIES.join(', ')}`);
      }
      sizes[category] = positiveInt(value, `sizes.${category}`);
      if (sizes[category] > pixel.maxSpriteSize) {
        fail(
          `sizes.${category} vaut ${value}, mais les tailles sont en **pixels d'art** depuis ` +
            `la bascule en pixel art, pas en pixels d'écran. Un personnage fait ` +
            `${pixel.nativeSize} ; c'est le rendu qui multiplie par un entier.`
        );
      }
    }
  }

  const atlas = { ...DEFAULTS.atlas, ...(raw.atlas ?? {}) };
  positiveInt(atlas.maxSize, 'atlas.maxSize', { min: 64 });
  nonNegativeInt(atlas.padding, 'atlas.padding');
  if (typeof atlas.quality !== 'number' || atlas.quality < 1 || atlas.quality > 100) {
    fail('atlas.quality doit être un nombre 1-100 (82 par défaut ; baisser pour alléger)');
  }
  if (typeof atlas.lossless !== 'boolean') {
    fail(
      'atlas.lossless doit être true ou false (true par défaut, et c’est ce que le pixel art ' +
        'exige : une compression avec perte réinvente des couleurs hors palette et adoucit ' +
        'les bords). Ne le passer à false que pour comparer un poids dans la galerie.'
    );
  }

  const budgetKb = { ...DEFAULTS.budgetKb, ...(raw.budgetKb ?? {}) };
  positiveInt(budgetKb.target, 'budgetKb.target');
  positiveInt(budgetKb.max, 'budgetKb.max');
  if (budgetKb.max < budgetKb.target) {
    fail(`budgetKb.max (${budgetKb.max}) doit être ≥ budgetKb.target (${budgetKb.target})`);
  }

  // Trois tables distinctes : les orbes de la grille, les unités du champ et les pouvoirs
  // n'ont pas le même coût de dessin, donc pas forcément le même nombre de paliers. `orb`
  // hérite de `unit` quand il n'est pas donné, pour qu'un manifest écrit avant la séparation
  // se comporte exactement comme avant.
  const unitBands = parseBands(raw.tierBands?.unit ?? [[1, 4], [5, 8], [9, 11]], 'tierBands.unit');
  const tierBands = {
    orb: raw.tierBands?.orb ? parseBands(raw.tierBands.orb, 'tierBands.orb') : unitBands,
    unit: unitBands,
    power: parseBands(raw.tierBands?.power ?? [[1, 2], [3, 4], [5, 6]], 'tierBands.power'),
  };

  const sheetsRaw = raw.sheets ?? [];
  if (!Array.isArray(sheetsRaw)) fail('sheets doit être une liste');
  const defaults = { keying, sizes, pixel };
  const sheets = sheetsRaw.map((entry, index) => parseSheet(entry, index, defaults));

  // Un nom en double produirait deux frames de même clé dans l'atlas, et la seconde
  // écraserait la première **en silence**. C'est exactement le genre de panne qu'on ne
  // diagnostique jamais depuis un téléphone : on la refuse ici.
  const seen = new Map();
  for (const sheet of sheets) {
    for (const cell of sheet.cells) {
      if (!cell.name) continue;
      const previous = seen.get(cell.name);
      if (previous) {
        fail(
          `le nom « ${cell.name} » est utilisé deux fois (« ${previous} » et « ${sheet.file} ») — ` +
            `chaque sprite doit avoir un nom unique`
        );
      }
      seen.set(cell.name, sheet.file);
    }
  }

  return {
    keying,
    pixel,
    palette,
    atlas,
    budgetKb,
    sizes,
    tierBands,
    sheets,
    /** Dossiers recopiés tels quels, avec comptabilité de poids. */
    audio: { dir: raw.audio?.dir ?? 'audio' },
    fonts: { dir: raw.fonts?.dir ?? 'fonts' },
  };
}

export default parseManifest;
