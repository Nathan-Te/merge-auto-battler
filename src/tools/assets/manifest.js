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
  atlas: { maxSize: 2048, padding: 2, quality: 82 },
  /** Côté visé d'un sprite, en pixels, avant packing. Par catégorie. */
  sizes: {
    orbs: 192,
    powers: 192,
    units: 224,
    enemies: 224,
    projectiles: 96,
    decor: 640,
    ui: 256,
  },
  budgetKb: { target: 10 * 1024, max: 20 * 1024 },
};

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

  const size = raw.size ?? defaults.sizes[category];
  positiveInt(size, `${label} : size`);

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

  return {
    file,
    category,
    cols,
    rows,
    margin,
    spacing,
    size,
    /** Rogner les bords transparents après détourage. Coupé pour un décor plein cadre. */
    trim: raw.trim ?? true,
    keying: parseKeying(raw.keying, defaults.keying, `${label} : keying`),
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

  const sizes = { ...DEFAULTS.sizes };
  if (raw.sizes !== undefined) {
    if (typeof raw.sizes !== 'object' || raw.sizes === null) fail('sizes doit être un objet');
    for (const [category, value] of Object.entries(raw.sizes)) {
      if (!CATEGORIES.includes(category)) {
        fail(`sizes.${category} : catégorie inconnue — au choix : ${CATEGORIES.join(', ')}`);
      }
      sizes[category] = positiveInt(value, `sizes.${category}`);
    }
  }

  const atlas = { ...DEFAULTS.atlas, ...(raw.atlas ?? {}) };
  positiveInt(atlas.maxSize, 'atlas.maxSize', { min: 64 });
  nonNegativeInt(atlas.padding, 'atlas.padding');
  if (typeof atlas.quality !== 'number' || atlas.quality < 1 || atlas.quality > 100) {
    fail('atlas.quality doit être un nombre 1-100 (82 par défaut ; baisser pour alléger)');
  }

  const budgetKb = { ...DEFAULTS.budgetKb, ...(raw.budgetKb ?? {}) };
  positiveInt(budgetKb.target, 'budgetKb.target');
  positiveInt(budgetKb.max, 'budgetKb.max');
  if (budgetKb.max < budgetKb.target) {
    fail(`budgetKb.max (${budgetKb.max}) doit être ≥ budgetKb.target (${budgetKb.target})`);
  }

  const tierBands = {
    unit: parseBands(raw.tierBands?.unit ?? [[1, 4], [5, 8], [9, 11]], 'tierBands.unit'),
    power: parseBands(raw.tierBands?.power ?? [[1, 2], [3, 4], [5, 6]], 'tierBands.power'),
  };

  const sheetsRaw = raw.sheets ?? [];
  if (!Array.isArray(sheetsRaw)) fail('sheets doit être une liste');
  const defaults = { keying, sizes };
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
