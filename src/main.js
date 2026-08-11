import Phaser from 'phaser';
import GameScene from './scenes/GameScene.js';

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
  // Pas de moteur physique : la grille de merge se joue entièrement aux tweens.
  // Le Lot 2 réintroduira `physics` s'il en a besoin pour la bande de combat.
  render: {
    antialias: true,
    roundPixels: true,
  },
  scene: [GameScene],
};

const game = new Phaser.Game(config);

// Poignée de debug : permet d'inspecter la scène depuis la console du téléphone
// (Safari/Chrome remote debug) et sert de point d'entrée aux tests navigateur.
window.__game = game;

export default game;
