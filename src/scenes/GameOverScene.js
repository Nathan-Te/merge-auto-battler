import Phaser from 'phaser';

import { DEPTH } from '../render/depths.js';

/**
 * Écran de game over — greybox : vagues survécues, record local, bouton rejouer.
 *
 * Lancée **par-dessus** `GameScene` mise en pause, pour que le champ de bataille reste
 * visible derrière : le joueur voit ce qui l'a tué. « Rejouer » appelle
 * `this.scene.start('GameScene')`, qui arrête cette scène puis **relance** la scène de
 * jeu de zéro : `SHUTDOWN` déclenche son `teardown()`, la session et ses écouteurs sont
 * détruits, et la partie suivante repart d'un état neuf (cf. `GameSession`).
 */

const COLORS = {
  veil: 0x0a0c12,
  panel: 0x191d2a,
  panelStroke: 0x4d96ff,
  button: 0x4d96ff,
  buttonHover: 0x6aa8ff,
  text: '#eef1f8',
  textDim: '#8f97b0',
  record: '#ffd93d',
};

const FONT = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

export default class GameOverScene extends Phaser.Scene {
  constructor() {
    super('GameOverScene');
  }

  /** @param {{wavesCleared: number, best: number, isRecord: boolean}} data */
  init(data) {
    this.wavesCleared = data?.wavesCleared ?? 0;
    this.best = data?.best ?? 0;
    this.isRecord = Boolean(data?.isRecord);
  }

  create() {
    this.veil = this.add
      .rectangle(0, 0, 10, 10, COLORS.veil, 0.82)
      .setOrigin(0, 0)
      .setDepth(DEPTH.banner);

    this.panel = this.add
      .rectangle(0, 0, 10, 10, COLORS.panel, 1)
      .setStrokeStyle(2, COLORS.panelStroke, 0.9)
      .setDepth(DEPTH.banner + 1);

    this.titleText = this.text('Game over', { fontStyle: 'bold', color: COLORS.text });
    this.scoreText = this.text(
      `${this.wavesCleared} vague${this.wavesCleared > 1 ? 's' : ''} survécue${
        this.wavesCleared > 1 ? 's' : ''
      }`,
      { color: COLORS.text }
    );
    this.bestText = this.text(
      this.isRecord ? `Nouveau record !` : `Record : ${this.best}`,
      { color: this.isRecord ? COLORS.record : COLORS.textDim }
    );

    this.button = this.add
      .rectangle(0, 0, 10, 10, COLORS.button, 1)
      .setDepth(DEPTH.banner + 2)
      .setInteractive({ useHandCursor: true });
    this.buttonText = this.text('Rejouer', { fontStyle: 'bold', color: '#12141c' });
    this.buttonText.setDepth(DEPTH.banner + 3);

    // Pointeur unifié souris + tactile, comme partout ailleurs dans le jeu.
    this.button.on('pointerover', () => this.button.setFillStyle(COLORS.buttonHover, 1));
    this.button.on('pointerout', () => this.button.setFillStyle(COLORS.button, 1));
    this.button.on('pointerup', () => this.replay());

    this.scale.on('resize', this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.handleResize, this);
    });

    const { width, height } = this.scale.gameSize;
    this.layout(width, height);

    this.panel.setScale(0.86);
    this.tweens.add({ targets: this.panel, scale: 1, duration: 220, ease: 'Back.easeOut' });
  }

  text(content, style) {
    return this.add
      .text(0, 0, content, { fontFamily: FONT, align: 'center', ...style })
      .setOrigin(0.5, 0.5)
      .setDepth(DEPTH.banner + 2)
      .setResolution(Math.min(window.devicePixelRatio || 1, 2));
  }

  handleResize(gameSize) {
    this.layout(gameSize.width, gameSize.height);
  }

  layout(width, height) {
    if (!(width > 0) || !(height > 0)) return;

    this.veil.setSize(width, height);

    const panelWidth = Phaser.Math.Clamp(Math.min(width * 0.82, height * 0.9), 180, 420);
    const panelHeight = Phaser.Math.Clamp(panelWidth * 0.78, 150, 320);
    const cx = width / 2;
    const cy = height / 2;
    this.panel.setPosition(cx, cy).setSize(panelWidth, panelHeight);

    const unit = panelHeight / 10;
    this.titleText.setFontSize(Math.round(unit * 1.7)).setPosition(cx, cy - unit * 3);
    this.scoreText.setFontSize(Math.round(unit * 1.25)).setPosition(cx, cy - unit * 0.6);
    this.bestText.setFontSize(Math.round(unit * 0.95)).setPosition(cx, cy + unit * 0.9);

    const buttonWidth = panelWidth * 0.56;
    const buttonHeight = Math.max(38, unit * 2.1);
    this.button.setPosition(cx, cy + unit * 3).setSize(buttonWidth, buttonHeight);
    // La zone tactile suit la taille du bouton : sur téléphone, viser 38 px de haut est
    // le minimum confortable.
    this.button.input?.hitArea?.setTo(0, 0, buttonWidth, buttonHeight);
    this.buttonText.setFontSize(Math.round(unit * 1.1)).setPosition(cx, cy + unit * 3);
  }

  replay() {
    // `ScenePlugin.start` arrête d'abord cette scène, puis redémarre `GameScene` :
    // celle-ci était en pause, Phaser la coupe (SHUTDOWN → teardown) avant de la
    // recréer. Rien de la partie précédente ne survit.
    this.scene.start('GameScene');
  }
}
