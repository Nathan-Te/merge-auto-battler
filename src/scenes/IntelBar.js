import Phaser from 'phaser';

import { drawEnemyShape, drawUnitShape, unitColor } from '../render/battleShapes.js';
import { DEPTH } from '../render/depths.js';
import { sceneTextResolution } from '../render/hiDpi.js';

/**
 * Barre de décision — **le cœur d'interface du Lot 3.5**. Aucune règle de gameplay.
 *
 * Le playtest du Lot 3 a montré que l'information existait mais ne nourrissait aucun choix :
 * on ne regardait ni la bataille ni la file de types. La barre y répond en mettant les deux
 * moitiés de la décision **côte à côte**, sur une seule ligne :
 *
 * ```
 * ┌──────────────────────────────┬───────────────────────────┐
 * │ Vague 7 · Rush blindé   4 s  │  ◆  ●  ▲        [ passer ]│
 * │ ▲×20  ⬢×5                    │  tête                     │
 * └──────────────────────────────┴───────────────────────────┘
 *      ce qui arrive                 ce que je peux envoyer
 * ```
 *
 * Les séparer, c'est retirer la décision : le joueur doit pouvoir lire « 20 rapides
 * arrivent » et « ma tête de file est un mono-cible » dans le même coup d'œil, puis
 * décider — envoyer, préparer plus gros, ou **passer** pour changer de type.
 *
 * Ce n'est pas une scène Phaser mais un objet de rendu possédé par `GameScene`, relayouté
 * à chaque `resize`, comme `BattleView`. Il lit `session.hud()` et ne décide de rien : le
 * bouton « passer » appelle `session.skipUnitType()`, qui accepte ou refuse.
 */

const COLORS = {
  panel: 0x161a26,
  panelStroke: 0x2c3350,
  divider: 0x2c3350,
  chip: 0x1e2333,
  chipHead: 0x28304a,
  chipStroke: 0x333b5c,
  skip: 0x2a3350,
  skipReady: 0x4d96ff,
  text: '#eef1f8',
  textDim: '#8f97b0',
  textWarn: '#ff9f43',
  urgent: '#ff6b6b',
};

const FONT = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

/** Types d'ennemis annoncés au maximum. Au-delà, la ligne devient illisible au doigt. */
const MAX_ENEMY_ICONS = 3;
/** Types d'unités montrés dans la file (tête + deux suivants). */
const QUEUE_PREVIEW = 3;

export class IntelBar {
  /**
   * @param {Phaser.Scene} scene
   * @param {import('../systems/GameSession.js').GameSession} session
   * @param {import('../render/juiceKit.js').JuiceKit} juice
   */
  constructor(scene, session, juice) {
    this.scene = scene;
    this.session = session;
    this.juice = juice;
    this.juiceConfig = juice.config;
    this.layoutData = null;
    this.signature = '';

    this.build();
  }

  textResolution() {
    return sceneTextResolution(this);
  }

  // ------------------------------------------------------------------ construction

  build() {
    const scene = this.scene;
    const dim = { fontFamily: FONT, color: COLORS.textDim };

    this.panel = scene.add
      .rectangle(0, 0, 10, 10, COLORS.panel)
      .setOrigin(0, 0)
      .setStrokeStyle(1, COLORS.panelStroke, 1)
      .setDepth(DEPTH.panel + 1);

    this.divider = scene.add.rectangle(0, 0, 1, 10, COLORS.divider).setOrigin(0.5, 0).setDepth(DEPTH.cell);

    // --- moitié gauche : ce qui arrive
    this.waveText = scene.add
      .text(0, 0, '', { ...dim, color: COLORS.text, fontStyle: 'bold' })
      .setOrigin(0, 0.5)
      .setDepth(DEPTH.hud);
    // Le compte à rebours ouvre la **seconde** ligne, devant les icônes de composition :
    // « 6 s ▮×3 » se lit d'une traite, et le titre de vague garde toute la première ligne
    // — en portrait, le mettre en bout de titre le faisait chevaucher les chips.
    this.countdownText = scene.add.text(0, 0, '', dim).setOrigin(0, 0.5).setDepth(DEPTH.hud);

    /** @type {{shape: Phaser.GameObjects.Graphics, text: Phaser.GameObjects.Text}[]} */
    this.enemyIcons = Array.from({ length: MAX_ENEMY_ICONS }, () => ({
      shape: scene.add.graphics().setDepth(DEPTH.hud),
      text: scene.add.text(0, 0, '', dim).setOrigin(0, 0.5).setDepth(DEPTH.hud),
    }));

    // --- moitié droite : ce que je peux envoyer
    /** @type {object[]} Chips de la file de types, tête en premier. */
    this.chips = Array.from({ length: QUEUE_PREVIEW }, (_, index) => ({
      box: scene.add
        .rectangle(0, 0, 10, 10, index === 0 ? COLORS.chipHead : COLORS.chip)
        .setStrokeStyle(1, COLORS.chipStroke, 1)
        .setDepth(DEPTH.cell),
      shape: scene.add.graphics().setDepth(DEPTH.hud),
    }));

    this.skipBox = scene.add
      .rectangle(0, 0, 10, 10, COLORS.skip, 1)
      .setStrokeStyle(1, COLORS.chipStroke, 1)
      .setDepth(DEPTH.cell)
      .setInteractive({ useHandCursor: true });
    // Jauge de recharge : dessinée **dans** le bouton, elle se remplit par la gauche.
    this.skipFill = scene.add.rectangle(0, 0, 10, 10, COLORS.skipReady, 0.32).setOrigin(0, 0.5).setDepth(DEPTH.cell + 1);
    this.skipText = scene.add
      .text(0, 0, 'passer', { fontFamily: FONT, fontStyle: 'bold', color: COLORS.textDim })
      .setOrigin(0.5, 0.5)
      .setDepth(DEPTH.hud);

    this.skipBox.on('pointerup', () => this.onSkip());

    for (const text of [
      this.waveText,
      this.countdownText,
      this.skipText,
      ...this.enemyIcons.map((icon) => icon.text),
    ]) {
      text.setResolution(this.textResolution());
    }
  }

  // ------------------------------------------------------------------ geste

  /**
   * Bouton « passer » : la barre demande, la session décide.
   *
   * Un refus (cooldown en cours) n'est pas silencieux — sans retour, le joueur croirait à
   * un bouton cassé plutôt qu'à un bouton pas prêt.
   */
  onSkip() {
    const result = this.session.skipUnitType();
    if (!result) {
      this.juice.play('reject');
      this.nudge(this.skipBox);
      return;
    }

    this.juice.play('tap');
    // La tête vient de disparaître : la file se resserre visiblement d'un cran.
    for (const chip of this.chips) this.popChip(chip);
    this.refresh({ force: true });
  }

  /** Petit sursaut de refus, sur le bouton lui-même. */
  nudge(target) {
    const reject = this.juiceConfig.grid.reject;
    const home = target.x;
    this.scene.tweens.killTweensOf(target);
    this.scene.tweens.add({
      targets: target,
      x: home + reject.offsetPx,
      duration: reject.durationMs,
      yoyo: true,
      repeat: reject.repeat,
      ease: 'Sine.easeInOut',
      onComplete: () => target.setX(home),
    });
  }

  popChip(chip) {
    this.scene.tweens.killTweensOf(chip.shape);
    chip.shape.setScale(0.55);
    this.scene.tweens.add({
      targets: chip.shape,
      scale: 1,
      duration: this.juiceConfig.draft.chipPopMs,
      ease: 'Back.easeOut',
    });
  }

  // ------------------------------------------------------------------ layout

  layout(layoutData) {
    this.layoutData = layoutData;
    const bar = layoutData.battleZone.intel;

    this.panel.setPosition(bar.x, bar.y).setSize(bar.width, bar.height);

    const pad = Math.max(4, Math.round(bar.height * 0.12));
    const midY = bar.y + bar.height / 2;
    // La file de types et son bouton mangent une largeur fixe ; l'annonce prend le reste.
    // Dans l'autre sens, une annonce longue rognerait le bouton « passer » jusqu'à le
    // rendre intappable.
    const chipSize = Phaser.Math.Clamp(Math.round(bar.height * 0.52), 14, 34);
    const skipWidth = Phaser.Math.Clamp(Math.round(bar.width * 0.19), 44, 92);
    const skipHeight = Math.max(24, Math.round(bar.height * 0.62));
    const queueWidth = chipSize * QUEUE_PREVIEW + pad * (QUEUE_PREVIEW - 1) + skipWidth + pad * 2;

    const rightX = bar.x + bar.width - pad;
    this.skipBox.setPosition(rightX - skipWidth / 2, midY).setSize(skipWidth, skipHeight);
    this.skipBox.input?.hitArea?.setTo(0, 0, skipWidth, skipHeight);
    this.skipFill.setPosition(rightX - skipWidth, midY).setSize(skipWidth, skipHeight);
    this.skipWidth = skipWidth;
    this.skipText
      .setFontSize(Phaser.Math.Clamp(Math.round(skipHeight * 0.38), 8, 14))
      .setPosition(rightX - skipWidth / 2, midY);

    // Les chips se lisent de gauche à droite, tête en premier — le même sens que la file
    // de déploiement plus bas.
    const chipsLeft = rightX - skipWidth - pad * 2 - (chipSize * QUEUE_PREVIEW + pad * (QUEUE_PREVIEW - 1));
    this.chips.forEach((chip, index) => {
      const cx = chipsLeft + chipSize / 2 + index * (chipSize + pad);
      chip.box.setPosition(cx, midY).setSize(chipSize, chipSize);
      chip.shape.setPosition(cx, midY);
      chip.size = chipSize * (index === 0 ? 0.78 : 0.62);
    });

    const leftWidth = Math.max(40, bar.width - queueWidth - pad * 2);
    // Une marge, pour que le titre de vague ne vienne jamais lécher le séparateur.
    this.leftWidth = Math.max(30, leftWidth - pad * 2);
    const font = Phaser.Math.Clamp(Math.round(Math.min(bar.height * 0.3, leftWidth * 0.1)), 8, 15);
    this.waveText.setFontSize(font).setScale(1).setPosition(bar.x + pad, bar.y + bar.height * 0.3);

    this.divider.setPosition(chipsLeft - pad / 2, bar.y + pad).setSize(1, bar.height - pad * 2);

    this.iconSize = Phaser.Math.Clamp(Math.round(bar.height * 0.34), 8, 22);
    this.iconFont = Phaser.Math.Clamp(Math.round(bar.height * 0.26), 7, 13);
    this.iconRow = { x: bar.x + pad, y: bar.y + bar.height * 0.72, width: leftWidth };
    this.countdownText
      .setFontSize(Phaser.Math.Clamp(Math.round(font * 0.95), 8, 14))
      .setPosition(this.iconRow.x, this.iconRow.y);

    this.refresh({ force: true });
  }

  // ------------------------------------------------------------------ boucle

  update() {
    this.refresh();
  }

  /**
   * Réécrit la barre depuis `session.hud()`.
   *
   * Le contenu est relu à chaque frame mais n'est **écrit que sur changement** : `setText`
   * force un re-rendu de texture, et la barre porte cinq textes. Le compte à rebours
   * s'arrondit à la seconde, ce qui en fait un changement par seconde et non par frame.
   */
  refresh({ force = false } = {}) {
    if (!this.layoutData) return;
    const hud = this.session.hud();
    const countdown = hud.countdown;
    const seconds = Math.ceil(countdown.remainingMs / 1000);

    const signature = [
      countdown.wave,
      countdown.pending ? seconds : `r${countdown.total}`,
      countdown.description,
      hud.nextTypes.map((entry) => entry.type).join(','),
      hud.canSkip,
    ].join('|');
    if (!force && signature === this.signature) {
      // Le remplissage du bouton, lui, bouge en continu : c'est la seule chose qui doit
      // suivre la frame plutôt que la seconde.
      this.refreshSkipFill(hud);
      return;
    }
    this.signature = signature;

    this.refreshWave(countdown, seconds);
    this.refreshQueue(hud);
    this.refreshSkipFill(hud);
  }

  refreshWave(countdown, seconds) {
    const label = countdown.label ? ` · ${countdown.label}` : '';
    this.waveText.setText(`Vague ${countdown.wave}${label}`).setScale(1);
    // Une texture au nom long (« Marée de basiques ») déborderait sur la file de types en
    // portrait : plutôt que de la tronquer, on la resserre. Elle reste lisible, et elle ne
    // mange jamais la moitié droite de la barre.
    if (this.waveText.width > this.leftWidth) {
      this.waveText.setScale(this.leftWidth / this.waveText.width);
    }

    if (countdown.pending) {
      this.countdownText.setText(`${seconds} s`);
      // Trois secondes : le moment où « je prépare » devient « je pose ». Le rouge le dit
      // sans texte, du coin de l'œil, pendant qu'on manipule la grille.
      this.countdownText.setColor(seconds <= 3 ? COLORS.urgent : COLORS.textWarn);
    } else {
      // Pendant le combat, la barre est **la version compacte du bandeau** : elle ne dit
      // plus ce qui arrive mais ce qui arrive **encore**, et elle reste là tout le temps
      // que dure la vague.
      this.countdownText.setText(`reste ${countdown.total}`).setColor(COLORS.textDim);
    }

    // Composition : les icônes des types d'ennemis et leur nombre. C'est **calculé par le
    // modèle**, formule infinie comprise — l'annonce ne s'éteint pas passé la vague 10.
    const entries = countdown.composition.slice(0, MAX_ENEMY_ICONS);
    let cursor = this.iconRow.x + this.countdownText.width + this.iconSize * 0.5;
    this.enemyIcons.forEach((icon, index) => {
      const entry = entries[index];
      if (!entry) {
        icon.shape.clear();
        icon.text.setText('');
        return;
      }
      drawEnemyShape(icon.shape, entry.type, this.iconSize, { horizontal: true });
      icon.shape.setPosition(cursor + this.iconSize / 2, this.iconRow.y);
      icon.text
        .setFontSize(this.iconFont)
        .setText(`×${entry.count}`)
        .setPosition(cursor + this.iconSize + 3, this.iconRow.y);
      cursor = icon.text.x + icon.text.width + this.iconSize * 0.6;
    });
  }

  refreshQueue(hud) {
    this.chips.forEach((chip, index) => {
      const entry = hud.nextTypes[index];
      if (!entry) {
        chip.shape.clear();
        return;
      }
      // Tête plus grosse et fond plus clair : la file se lit sans légende.
      drawUnitShape(chip.shape, entry.type, 1, chip.size);
      chip.shape.setAlpha(index === 0 ? 1 : 0.62);
      chip.box.setFillStyle(index === 0 ? COLORS.chipHead : COLORS.chip, 1);
      chip.box.setStrokeStyle(1, index === 0 ? unitColor(entry.type) : COLORS.chipStroke, 1);
    });
  }

  refreshSkipFill(hud) {
    const ratio = Phaser.Math.Clamp(hud.skipRatio, 0, 1);
    this.skipFill.width = Math.max(0.5, this.skipWidth * ratio);
    this.skipFill.setFillStyle(COLORS.skipReady, hud.canSkip ? 0.42 : 0.24);
    this.skipText.setColor(hud.canSkip ? COLORS.text : COLORS.textDim);
    this.skipBox.setStrokeStyle(1, hud.canSkip ? COLORS.skipReady : COLORS.chipStroke, 1);
  }

  // ------------------------------------------------------------------ fin de vie

  destroy() {
    this.skipBox.removeAllListeners();
    for (const object of [
      this.panel,
      this.divider,
      this.waveText,
      this.countdownText,
      this.skipBox,
      this.skipFill,
      this.skipText,
      ...this.enemyIcons.flatMap((icon) => [icon.shape, icon.text]),
      ...this.chips.flatMap((chip) => [chip.box, chip.shape]),
    ]) {
      this.scene.tweens.killTweensOf(object);
      object.destroy();
    }
    this.chips = [];
    this.enemyIcons = [];
  }
}

export default IntelBar;
