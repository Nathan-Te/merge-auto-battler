import Phaser from 'phaser';
import GameScene from './scenes/GameScene.js';
import GameOverScene from './scenes/GameOverScene.js';
import DraftScene from './scenes/DraftScene.js';
import HelpScene from './scenes/HelpScene.js';

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
    antialias: true,
    roundPixels: true,
  },
  // `GameOverScene`, `DraftScene` et `HelpScene` sont lancées **par-dessus** `GameScene`
  // mise en pause, pas à sa place : le champ de bataille reste visible derrière, et la
  // partie ne peut pas avancer d'un tick pendant qu'un de ces écrans est ouvert.
  scene: [GameScene, GameOverScene, DraftScene, HelpScene],
};

const game = new Phaser.Game(config);

// Poignée de debug : permet d'inspecter la scène depuis la console du téléphone
// (Safari/Chrome remote debug) et sert de point d'entrée aux tests navigateur.
window.__game = game;

export default game;
