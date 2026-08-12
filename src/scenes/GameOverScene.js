import Phaser from 'phaser';

import juiceConfig from '../config/juice.json';
import { DEPTH } from '../render/depths.js';
import { parseJuiceConfig } from '../systems/juice.js';

/**
 * Écran de game over — greybox : vagues survécues, record local, bouton rejouer.
 *
 * Lancée **par-dessus** `GameScene` mise en pause, pour que le champ de bataille reste
 * visible derrière : le joueur voit ce qui l'a tué. « Rejouer » appelle
 * `this.scene.start('GameScene')`, qui arrête cette scène puis **relance** la scène de
 * jeu de zéro : `SHUTDOWN` déclenche son `teardown()`, la session et ses écouteurs sont
 * détruits, et la partie suivante repart d'un état neuf (cf. `GameSession`).
 *
 * Deux ajouts du Lot 3 :
 *
 *   - **le score se compte** — le nombre monte de 0 jusqu'aux vagues survécues, ce qui
 *     donne au chiffre le poids d'une récompense au lieu d'un constat ;
 *   - **le récap d'équilibrage** (`?debug=1` uniquement) : dégâts par type d'unité,
 *     envois par tier, vague atteinte. C'est ce qu'on lit après une partie de réglage.
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
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

export default class GameOverScene extends Phaser.Scene {
  constructor() {
    super('GameOverScene');
  }

  /** @param {{wavesCleared: number, best: number, isRecord: boolean, recap: object|null}} data */
  init(data) {
    this.wavesCleared = data?.wavesCleared ?? 0;
    this.best = data?.best ?? 0;
    this.isRecord = Boolean(data?.isRecord);
    this.recap = data?.recap ?? null;
    this.juiceConfig = parseJuiceConfig(juiceConfig);
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
    this.scoreText = this.text(this.scoreLabel(0), { color: COLORS.text });
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

    this.recapText = this.recap
      ? this.add
          .text(0, 0, this.formatRecap(this.recap), {
            fontFamily: MONO,
            color: COLORS.textDim,
            align: 'left',
          })
          .setOrigin(0.5, 0)
          .setDepth(DEPTH.banner + 2)
          .setResolution(Math.min(window.devicePixelRatio || 1, 2))
      : null;

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
    this.countScore();
  }

  scoreLabel(value) {
    const plural = value > 1 ? 's' : '';
    return `${value} vague${plural} survécue${plural}`;
  }

  /**
   * Le score monte de 0 à sa valeur. Sur une petite valeur (2 vagues), compter serait
   * ridicule : la durée est proportionnelle, et un tout petit score s'affiche presque
   * directement.
   */
  countScore() {
    if (this.wavesCleared <= 0) return;
    const counter = { value: 0 };
    this.tweens.add({
      targets: counter,
      value: this.wavesCleared,
      duration: this.juiceConfig.ui.scoreCountMs,
      ease: 'Cubic.easeOut',
      onUpdate: () => {
        this.scoreText.setText(this.scoreLabel(Math.round(counter.value)));
      },
      onComplete: () => this.scoreText.setText(this.scoreLabel(this.wavesCleared)),
    });
  }

  /** Récap de fin de partie — lecture de réglage, jamais affiché à un joueur. */
  formatRecap(recap) {
    const seconds = Math.round(recap.durationMs / 1000);
    const duration = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    const damage = Object.entries(recap.damageByType)
      .sort((a, b) => b[1] - a[1])
      .map(([type, value]) => `${type} ${Math.round(value)}`)
      .join('  ');
    const tiers = Object.entries(recap.sentByTier)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([tier, count]) => `T${tier}×${count}`)
      .join(' ');

    return [
      `vague ${recap.wave} · ${duration} · ${recap.merges} fusions`,
      `envois ${recap.sent} : ${tiers || '—'}`,
      `dégâts ${damage}`,
      `unités perdues ${recap.unitsLost} · fuites ${recap.enemiesLeaked} · refus ${recap.blockedTaps}`,
    ].join('\n');
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

    // Le récap se pose **sous** le panneau : il ne doit rien recouvrir, et il n'existe
    // que sous `?debug=1`.
    this.recapText
      ?.setFontSize(Phaser.Math.Clamp(Math.round(unit * 0.62), 8, 13))
      .setPosition(cx, cy + panelHeight / 2 + unit * 0.6);
  }

  replay() {
    // `ScenePlugin.start` arrête d'abord cette scène, puis redémarre `GameScene` :
    // celle-ci était en pause, Phaser la coupe (SHUTDOWN → teardown) avant de la
    // recréer. Rien de la partie précédente ne survit.
    this.scene.start('GameScene');
  }
}
