/**
 * Localisation — **anglais par défaut, français si le navigateur est en français**.
 *
 * Crazy Games est un portail international : la V1 sort en anglais, et le français n'est
 * qu'une langue de plus. C'est l'inversion du Lot 4, où tout était écrit en dur en français
 * dans les scènes et dans `balance.json`.
 *
 * ## La règle : aucun texte affiché en dur
 *
 * Aucune chaîne montrée au joueur ne s'écrit dans une scène, ni dans `balance.json`. Tout
 * passe par une **clé** résolue ici. `balance.json` garde les nombres — c'est-à-dire ce qui
 * décide qui gagne la partie — et ne garde que des **identifiants** là où il portait des
 * libellés : `waves.scripted[].labelId`, l'`id` d'une carte de draft, le nom d'un type
 * d'unité. Les libellés vivent dans `en.json` et `fr.json`, côte à côte, ce qui rend une
 * traduction manquante visible d'un coup d'œil au lieu de se découvrir en jeu.
 *
 * Seule exception, assumée : la **ligne de diagnostic de `?debug=1`**, qui est un vidage
 * d'identifiants dense destiné au réglage et lu par une seule personne.
 *
 * ## Choix de la langue
 *
 * 1. `?lang=fr` dans l'URL — pour tester les deux langues sur un téléphone sans changer les
 *    réglages du système, et pour les captures de la page du portail ;
 * 2. sinon la langue du navigateur, si sa **racine** est connue (`fr-CA` → `fr`) ;
 * 3. sinon l'anglais.
 *
 * La détection est une fonction pure (`detectLocale`), donc testable sans navigateur.
 *
 * La mécanique (gabarits, pluriel, repli) vit dans `format.js`, qui n'importe aucun
 * dictionnaire : c'est ce qui permet à `npm run docs` de générer la référence avec
 * exactement le même moteur, depuis Node.
 */

import en from './en.json';
import fr from './fr.json';
import { compositionText as formatComposition, makeTranslator, waveLabelText as formatWaveLabel } from './format.js';

/** Dictionnaires disponibles. L'anglais fait référence : c'est lui qui doit être complet. */
export const LOCALES = { en, fr };
export const DEFAULT_LOCALE = 'en';

export { makeTranslator } from './format.js';

/**
 * Choisit la langue à partir de l'URL et des préférences du navigateur.
 *
 * @param {object} [options]
 * @param {string} [options.search] Chaîne de requête (`window.location.search`)
 * @param {string[]} [options.languages] `navigator.languages`, du plus au moins préféré
 * @returns {string} clé de `LOCALES`
 */
export function detectLocale({ search = '', languages = [] } = {}) {
  const forced = new URLSearchParams(search).get('lang');
  if (forced && LOCALES[forced.toLowerCase()]) return forced.toLowerCase();

  for (const tag of languages) {
    // `fr-CA`, `fr_FR` et `FR` désignent tous le même dictionnaire : on ne compare que la
    // racine, sinon la détection échouerait sur la majorité des navigateurs réels.
    const root = String(tag).toLowerCase().split(/[-_]/)[0];
    if (LOCALES[root]) return root;
  }
  return DEFAULT_LOCALE;
}

/**
 * Traducteur figé sur une langue.
 *
 * Utile partout où l'on ne veut pas dépendre de l'état global : les tests, et tout code qui
 * doit produire les deux langues au cours d'une même exécution.
 *
 * @param {string} locale
 * @returns {(key: string, params?: object) => string}
 */
export function createTranslator(locale) {
  return makeTranslator(LOCALES[locale] ?? LOCALES[DEFAULT_LOCALE], LOCALES[DEFAULT_LOCALE]);
}

// --------------------------------------------------------------------- état global

let activeLocale = DEFAULT_LOCALE;
let activeTranslator = createTranslator(activeLocale);

/**
 * Fixe la langue de la partie. Appelé une fois au démarrage (`src/main.js`).
 *
 * Il n'existe **pas** de sélecteur de langue en jeu : le seed doc impose un démarrage direct,
 * sans menu, et une langue qui change en cours de partie obligerait chaque scène à se
 * réécrire. `?lang=` couvre le besoin de test.
 */
export function setLocale(locale) {
  activeLocale = LOCALES[locale] ? locale : DEFAULT_LOCALE;
  activeTranslator = createTranslator(activeLocale);
  return activeLocale;
}

/** Langue active. */
export function currentLocale() {
  return activeLocale;
}

/**
 * Traduit une clé dans la langue active.
 *
 * @param {string} key Clé pointée, par exemple `help.title`
 * @param {object} [params] Valeurs des gabarits `{nom}`, et `count` pour le pluriel
 * @returns {string}
 */
export function t(key, params) {
  return activeTranslator(key, params);
}

/** Texture d'une vague, dans la langue active (cf. `format.waveLabelText`). */
export function waveLabelText(descriptor, translate = t) {
  return formatWaveLabel(descriptor, translate);
}

/** Composition d'une vague, dans la langue active (cf. `format.compositionText`). */
export function compositionText(composition, translate = t) {
  return formatComposition(composition, translate);
}

export default t;
