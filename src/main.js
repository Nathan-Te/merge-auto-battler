import Phaser from 'phaser';

import juiceConfig from './config/juice.json';
import { parseJuiceConfig } from './systems/juice.js';
import { HiDpi } from './render/hiDpi.js';
import { pixelRatioOverride } from './systems/debug.js';
import { currentLocale, detectLocale, setLocale, t } from './i18n/index.js';
import BootScene from './scenes/BootScene.js';
import GameScene from './scenes/GameScene.js';
import GameOverScene from './scenes/GameOverScene.js';
import DraftScene from './scenes/DraftScene.js';
import HelpScene from './scenes/HelpScene.js';
import CreditsScene from './scenes/CreditsScene.js';

const juice = parseJuiceConfig(juiceConfig);

/**
 * La langue est choisie **une fois**, avant que la moindre scène ne se crée.
 *
 * Anglais par défaut, français si le navigateur l'est, `?lang=` pour forcer (cf. `src/i18n/`).
 * Il n'y a pas de sélecteur en jeu : le seed doc impose un démarrage direct sans menu, et
 * changer de langue en cours de partie obligerait chaque scène à se réécrire.
 */
setLocale(detectLocale({ search: window.location.search, languages: navigator.languages ?? [] }));

// L'onglet et l'écran d'accueil du navigateur suivent la langue du joueur, comme le reste.
// `lang` est réécrit et non complété : `index.html` doit bien porter une valeur, mais c'est
// la langue **réellement choisie** qui compte pour les lecteurs d'écran et pour le portail.
document.title = t('game.title');
document.documentElement.lang = currentLocale();

const config = {
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#12141c',
  scale: {
    // RESIZE plutôt que FIT : le canvas prend exactement la taille du viewport,
    // donc jamais de bandes noires ni de déformation en portrait comme en paysage.
    // Contrepartie : chaque scène doit se relayouter sur l'événement `resize`.
    // Justification détaillée dans le README.
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: '100%',
    height: '100%',
  },
  // Pas de moteur physique : la grille se joue aux tweens, et la bande de combat est
  // simulée par `BattleModel` à tick fixe — aucun besoin d'un moteur de collisions.
  render: {
    /**
     * **Direction artistique pixel art** : aucun filtrage, aucune interpolation.
     *
     * `pixelArt` met l'échantillonnage des textures au plus proche voisin. C'est ce qui rend
     * un sprite de 16 px affiché en ×4 net au pixel près plutôt que fondu ; sans lui, toute
     * la chaîne de pixelisation du pipeline serait défaite à la dernière étape, par le
     * filtrage bilinéaire du GPU.
     *
     * Il coupe aussi le lissage géométrique, et c'est le prix assumé : le greybox est
     * vectoriel, donc ses cercles et ses hexagones font désormais un escalier. Deux raisons
     * de ne pas s'en émouvoir — c'est un **repli** dont la place est de disparaître planche
     * après planche, et un escalier de pixels sur fond de pixel art est bien moins étranger
     * à l'écran qu'un cercle parfaitement lisse posé à côté d'un personnage de 16 px.
     */
    pixelArt: true,
    /**
     * Réactivé par la même décision. Il colle les objets à la grille de pixels de jeu, ce
     * qui n'avait pas de sens quand le zoom pouvait valoir 2,625 — Phaser le débranchait de
     * lui-même. Le ratio est maintenant **entier** (cf. `src/systems/pixelRatio.js`), donc
     * un pixel de jeu vaut un nombre entier de pixels d'écran et l'arrondi retombe juste :
     * un sprite en mouvement ne se met plus à osciller entre deux trames.
     */
    roundPixels: true,
  },
  // `BootScene` charge les atlas générés par `npm run assets` puis passe la main : elle est
  // première dans la liste, donc elle démarre. Les suivantes ne sont pas démarrées d'office.
  //
  // `GameOverScene`, `DraftScene`, `HelpScene` et `CreditsScene` sont lancées **par-dessus**
  // `GameScene` mise en pause, pas à sa place : le champ de bataille reste visible derrière,
  // et la partie ne peut pas avancer d'un tick pendant qu'un de ces écrans est ouvert.
  scene: [BootScene, GameScene, GameOverScene, DraftScene, HelpScene, CreditsScene],
};

const game = new Phaser.Game(config);

/**
 * Rendu à la résolution physique de l'écran (cf. `src/render/hiDpi.js`).
 *
 * Le plafond vient de `juice.json` ; `?dpr=N` le force, pour comparer la netteté et le coût
 * de rendu sur un vrai téléphone sans rebuilder.
 */
game.hiDpi = new HiDpi(game, {
  maxRatio: pixelRatioOverride() ?? juice.render.maxPixelRatio,
}).attach();

// Poignée de debug : permet d'inspecter la scène depuis la console du téléphone
// (Safari/Chrome remote debug) et sert de point d'entrée aux tests navigateur.
window.__game = game;

export default game;
