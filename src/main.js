import Phaser from 'phaser';

import juiceConfig from './config/juice.json';
import { parseJuiceConfig } from './systems/juice.js';
import { HiDpi } from './render/hiDpi.js';
import { pixelRatioOverride } from './systems/debug.js';
import { detectLocale, setLocale, t } from './i18n/index.js';
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
document.title = t('game.title');
document.documentElement.lang = document.documentElement.lang || 'en';

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
    // Tout le greybox est **vectoriel** (cercles, hexagones, croix) et du texte : sans
    // lissage, chaque bord fait un escalier, et c'est l'écran de desktop en ratio 1 qui
    // trinquerait le plus. Non négociable ici.
    antialias: true,
    // Désactivé depuis le passage en résolution physique (cf. README). Il servait à coller
    // les objets à la grille de pixels quand un pixel de jeu valait un pixel d'écran. Ce
    // n'est plus le cas : l'arrondi se ferait au pixel **de mémoire de rendu**, donc sur
    // une fraction de pixel CSS, et Phaser le désactive de toute façon dès que le zoom
    // n'est pas entier (écrans en 1,5 ou 2,625). Le laisser actif ferait bouger le jeu
    // différemment selon le téléphone, pour un gain que personne ne voit.
    roundPixels: false,
  },
  // `GameOverScene`, `DraftScene`, `HelpScene` et `CreditsScene` sont lancées **par-dessus**
  // `GameScene` mise en pause, pas à sa place : le champ de bataille reste visible derrière,
  // et la partie ne peut pas avancer d'un tick pendant qu'un de ces écrans est ouvert.
  scene: [GameScene, GameOverScene, DraftScene, HelpScene, CreditsScene],
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
