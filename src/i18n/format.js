/**
 * Mécanique de traduction — **sans aucun dictionnaire**.
 *
 * Ce module ne contient que des fonctions : résolution d'une clé, gabarits, pluriel, mise en
 * mots des descripteurs de vagues. Il est séparé de `index.js` pour une raison très
 * concrète : `index.js` **importe les dictionnaires JSON**, ce que Vite résout mais que Node
 * refuse sans attribut d'import. Or `npm run docs` génère la référence en ligne de commande,
 * dans Node, et a besoin de la même mécanique que le jeu — sinon la référence traduirait
 * autrement que l'interface, ce qui est exactement ce qu'on cherche à empêcher.
 *
 * Découpage, donc : la mécanique ici, les dictionnaires et l'état global dans `index.js`,
 * et le CLI lit les JSON au disque comme le reste de `src/tools/`.
 */

/** Descend une clé pointée (`units.single.label`) dans un dictionnaire. */
function lookup(dictionary, key) {
  let node = dictionary;
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = node[part];
  }
  return node;
}

/**
 * Remplace les gabarits `{nom}` par les valeurs données.
 *
 * Un paramètre absent laisse le gabarit visible : c'est un défaut de traduction, et le voir
 * dans la phrase est le seul moyen qu'il soit corrigé.
 */
export function interpolate(template, params) {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    Object.hasOwn(params, name) ? String(params[name]) : match
  );
}

/**
 * Résout une clé dans un dictionnaire, avec pluriel.
 *
 * Le pluriel est **volontairement minimal** : une entrée peut être une chaîne, ou un objet
 * `{ one, other }` choisi par le paramètre `count`. Anglais et français partagent la même
 * règle (singulier à 1, pluriel ailleurs) et le jeu n'affiche que des compteurs simples —
 * une bibliothèque de pluralisation complète serait des kilo-octets téléchargés pour deux
 * phrases.
 */
export function resolve(dictionary, key, params) {
  const entry = lookup(dictionary, key);
  if (entry === undefined || entry === null) return undefined;

  if (typeof entry === 'object') {
    if (params?.count === undefined) return undefined;
    const form = Math.abs(Number(params.count)) === 1 ? entry.one : entry.other;
    return typeof form === 'string' ? interpolate(form, params) : undefined;
  }
  return typeof entry === 'string' ? interpolate(entry, params) : undefined;
}

/**
 * Fabrique un traducteur sur un dictionnaire, avec repli.
 *
 * Une clé absente ne doit **jamais** afficher un blanc au milieu d'un panneau : on retombe
 * sur le dictionnaire de repli (l'anglais), puis sur la clé elle-même. Un « gameOver.title »
 * affiché tel quel est laid mais se répare ; un panneau vide, personne ne le signale.
 *
 * @param {object} dictionary
 * @param {object} [fallback]
 * @returns {(key: string, params?: object) => string}
 */
export function makeTranslator(dictionary, fallback = null) {
  return function translate(key, params) {
    return (
      resolve(dictionary, key, params) ??
      (fallback ? resolve(fallback, key, params) : undefined) ??
      key
    );
  };
}

/**
 * Libellé d'une texture de vague, à partir du descripteur rendu par `waveLabel()`.
 *
 * La logique de vagues est **pure et sans langue** : elle rend « une marée de gobelins »
 * sous forme de données (`{ kind: 'tide', enemy: 'basic' }`), et c'est ici que ça devient
 * une phrase. Sans cette séparation, `waves.js` — qui décide de ce qui apparaît — porterait
 * du français, et traduire le jeu obligerait à toucher une règle de gameplay.
 *
 * @param {{kind: string, id?: string, enemy?: string}|null} descriptor
 * @param {(key: string, params?: object) => string} translate
 * @returns {string} chaîne vide si la vague n'a pas de texture nommée
 */
export function waveLabelText(descriptor, translate) {
  if (!descriptor) return '';
  if (descriptor.kind === 'scripted') return translate(`waves.labels.${descriptor.id}`);
  if (descriptor.kind === 'mixed') return translate('waves.labels.mixed');
  if (descriptor.kind === 'tide') {
    return translate('waves.labels.tide', {
      enemy: translate(`enemies.${descriptor.enemy}.plural`).toLowerCase(),
    });
  }
  return '';
}

/**
 * Composition lisible d'une vague : « 3× Goblin, 2× Wolf ».
 *
 * @param {{type: string, count: number}[]} composition
 * @param {(key: string, params?: object) => string} translate
 */
export function compositionText(composition, translate) {
  return composition
    .map((entry) => `${entry.count}× ${translate(`enemies.${entry.type}.label`)}`)
    .join(', ');
}
