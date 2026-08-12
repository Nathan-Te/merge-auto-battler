/**
 * Lecture et validation de `juice.json`. **Aucune dépendance à Phaser** — testable.
 *
 * `balance.json` porte ce qui **décide** d'une partie (PV, dégâts, vagues) ; `juice.json`
 * porte ce qui la **fait sentir** : durées de tween, intensités de secousse, nombre de
 * particules, sons. Deux fichiers parce que ce sont deux métiers : on règle l'un au harness
 * de simulation, l'autre au doigt sur le téléphone, et mélanger les deux garantissait qu'on
 * casserait un équilibrage en cherchant une secousse plus douce.
 *
 * La règle est la même des deux côtés (cf. `CLAUDE.md`) : **aucune intensité de feedback
 * en dur dans le code**. Si une valeur se règle à l'œil, elle est ici.
 *
 * Comme les parseurs de `balance.json`, celui-ci **refuse** une config incomplète plutôt
 * que d'inventer un défaut : une valeur oubliée doit crier au chargement, pas produire un
 * tween de `undefined` ms trois écrans plus loin.
 */

/**
 * Chemins obligatoires. Tout ce que le code lit est déclaré ici — c'est la liste qui rend
 * l'oubli impossible, et elle sert de sommaire du fichier.
 */
const REQUIRED_NUMBERS = [
  'sound.masterVolume',
  'render.maxPixelRatio',
  'particles.poolSize',
  'particles.gravityPx',
  'particles.dragPerSecond',
  'grid.spawnPopMs',
  'grid.moveMs',
  'grid.returnMs',
  'grid.sendMs',
  'grid.dragScale',
  'grid.dragScaleMs',
  'grid.mergeAbsorbMs',
  'grid.mergePopMs',
  'grid.mergeSquash.scaleX',
  'grid.mergeSquash.scaleY',
  'grid.mergeSquash.durationMs',
  'grid.mergeBurst.count',
  'grid.mergeBurst.speedPx',
  'grid.mergeBurst.lifeMs',
  'grid.mergeBurst.sizePx',
  'grid.reject.offsetPx',
  'grid.reject.durationMs',
  'grid.reject.repeat',
  'flight.toSlotMs',
  'flight.toFieldMs',
  'flight.trail.everyMs',
  'flight.trail.lifeMs',
  'flight.trail.sizePx',
  'combat.hitFlashMs',
  'combat.tracerMs',
  'combat.recoilPx',
  'combat.recoilMs',
  'combat.unitPopMs',
  'combat.enemyPopMs',
  'combat.deathMs',
  'combat.deathBurst.count',
  'combat.deathBurst.speedPx',
  'combat.deathBurst.lifeMs',
  'combat.deathBurst.sizePx',
  'power.castMs',
  'power.ringWidthPx',
  'power.ringPulseMs',
  'power.impactRingMs',
  'power.impactRingScale',
  'power.castBurst.count',
  'power.castBurst.speedPx',
  'power.castBurst.lifeMs',
  'power.castBurst.sizePx',
  'power.blastBurst.count',
  'power.blastBurst.speedPx',
  'power.blastBurst.lifeMs',
  'power.blastBurst.sizePx',
  'power.healBurst.count',
  'power.healBurst.speedPx',
  'power.healBurst.lifeMs',
  'power.healBurst.sizePx',
  'base.flashMs',
  'base.vignetteAlpha',
  'base.vignetteFadeMs',
  'shake.minIntervalMs',
  'shake.baseDamage.intensity',
  'shake.baseDamage.durationMs',
  'shake.tankDeath.intensity',
  'shake.tankDeath.durationMs',
  'shake.gameOver.intensity',
  'shake.gameOver.durationMs',
  'ui.bannerInMs',
  'ui.bannerOutMs',
  'ui.hintMs',
  'ui.gaugePulseMs',
  'ui.scoreCountMs',
  'draft.cardInMs',
  'draft.cardStaggerMs',
  'draft.pickMs',
  'draft.dismissMs',
  'draft.chipPopMs',
  'draft.disabledAlpha',
  'draft.armFadeMs',
  'draft.pickBurst.count',
  'draft.pickBurst.speedPx',
  'draft.pickBurst.lifeMs',
  'draft.pickBurst.sizePx',
];

/** Sons attendus par le jeu. Un son manquant est une erreur, pas un silence. */
export const SFX_NAMES = [
  'merge',
  'tap',
  'reject',
  'deploy',
  'shot',
  'death',
  'baseHit',
  'wave',
  'gameOver',
  /**
   * Pouvoirs actifs (Lot 4). Trois sons distincts, et surtout **distincts de `tap`** : c'est
   * la moitié sonore de « les deux taps ne se confondent pas ».
   */
  'powerCast',
  'powerBlast',
  'powerHeal',
  /**
   * Lot 5. `slow` manquait : le gel était la seule attaque muette du jeu, ce qui la rendait
   * invisible à l'oreille alors que c'est elle qui achète du temps. Les deux temps du draft
   * et le clic de bouton complètent la liste demandée au périmètre audio.
   */
  'slow',
  'draftOpen',
  'draftPick',
  'button',
];

/** Formes d'onde reconnues par le synthétiseur (`src/systems/sfx.js`). */
export const SFX_WAVES = ['square', 'saw', 'triangle', 'sine', 'noise'];

const SFX_NUMBERS = ['freqStart', 'freqEnd', 'durationMs', 'attackMs', 'volume', 'minIntervalMs'];

/** Lit une valeur par chemin pointé, ou `undefined`. */
function at(object, path) {
  return path.split('.').reduce((node, key) => (node == null ? undefined : node[key]), object);
}

/**
 * Valide `juice.json` et le rend tel quel (structure figée, pas de copie profonde : le
 * fichier est importé une fois et personne ne le mute).
 *
 * @param {object} raw Contenu de `juice.json`
 * @returns {object} La même structure, validée
 */
export function parseJuiceConfig(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('juice.json : contenu invalide');

  for (const path of REQUIRED_NUMBERS) {
    const value = at(raw, path);
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`juice.json : ${path} manquant ou non numérique`);
    }
    if (value < 0) throw new Error(`juice.json : ${path} doit être positif`);
  }

  if (typeof raw.sound?.enabled !== 'boolean') {
    throw new Error('juice.json : sound.enabled manquant');
  }

  // Volumes par catégorie (Lot 5) : c'est le **rapport** entre effets et musique qu'on règle
  // au casque, et il n'a de sens que si les deux existent.
  for (const category of ['sfx', 'music']) {
    const value = raw.sound?.categories?.[category];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error(`juice.json : sound.categories.${category} manquant ou invalide`);
    }
  }

  for (const name of SFX_NAMES) {
    const sound = raw.sfx?.[name];
    if (!sound || typeof sound !== 'object') {
      throw new Error(`juice.json : sfx.${name} manquant`);
    }
    if (!SFX_WAVES.includes(sound.wave)) {
      throw new Error(
        `juice.json : sfx.${name}.wave inconnu « ${sound.wave} » (attendu : ${SFX_WAVES.join(', ')})`
      );
    }
    for (const key of SFX_NUMBERS) {
      const value = sound[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new Error(`juice.json : sfx.${name}.${key} manquant ou invalide`);
      }
    }
  }

  return raw;
}

export default parseJuiceConfig;
