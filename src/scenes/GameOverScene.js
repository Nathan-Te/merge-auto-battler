import Phaser from 'phaser';

import juiceConfig from '../config/juice.json';
import { DEPTH } from '../render/depths.js';
import { parseJuiceConfig } from '../systems/juice.js';
import { sceneTextResolution } from '../render/hiDpi.js';

/**
 * Écran de game over — greybox : vagues survécues, record local, bouton rejouer.
 *
 * Lancée **par-dessus** `GameScene` mise en pause, pour que le champ de bataille reste
 * visible derrière : le joueur voit ce qui l'a tué. « Rejouer » appelle
 * `this.scene.start('GameScene')`, qui arrête cette scène puis **relance** la scène de
 * jeu de zéro : `SHUTDOWN` déclenche son `teardown()`, la session et ses écouteurs sont
 * détruits, et la partie suivante repart d'un état neuf (cf. `GameSession`).
 *
 * **Le score se compte** (Lot 3) : le nombre monte de 0 jusqu'aux vagues survécues, ce qui
 * donne au chiffre le poids d'une récompense au lieu d'un constat.
 *
 * **Le récap est le vrai ajout du Lot 3.5**, et il s'adresse maintenant au **joueur** et
 * non au régleur : le build joué (les améliorations prises, avec leur niveau), la part de
 * dégâts par type d'unité, ce qui a été envoyé. C'est ce qui répond à « rien ne motive une
 * seconde partie » — on sort de l'écran avec une idée de build à essayer, pas seulement un
 * score. La ligne de diagnostic d'équilibrage (fuites, taps refusés) reste, elle, derrière
 * `?debug=1`.
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

  /**
   * @param {{wavesCleared: number, best: number, isRecord: boolean, recap: object|null,
   *          debug: boolean}} data
   */
  init(data) {
    this.wavesCleared = data?.wavesCleared ?? 0;
    this.best = data?.best ?? 0;
    this.isRecord = Boolean(data?.isRecord);
    this.recap = data?.recap ?? null;
    this.debug = Boolean(data?.debug);
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

    // Le build, dans le panneau : c'est ce qu'on relit avant de rappuyer sur « rejouer ».
    this.buildText = this.recap
      ? this.text(this.formatBuild(this.recap), { color: COLORS.textDim, align: 'center' })
      : null;

    // Le diagnostic d'équilibrage, sous le panneau et seulement en mode debug.
    this.recapText =
      this.recap && this.debug
        ? this.add
            .text(0, 0, this.formatRecap(this.recap), {
              fontFamily: MONO,
              color: COLORS.textDim,
              align: 'left',
            })
            .setOrigin(0.5, 0)
            .setDepth(DEPTH.banner + 2)
            .setResolution(sceneTextResolution(this))
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
        // Le libellé s'allonge en comptant (« 1 vague » → « 12 vagues survécues ») : il
        // faut le recadrer à chaque pas, sinon il déborde du panneau en cours de route.
        this.setScore(Math.round(counter.value));
      },
      onComplete: () => this.setScore(this.wavesCleared),
    });
  }

  /**
   * Récap **joueur** : le build joué et ce qu'il a produit.
   *
   * Trois lignes, pas davantage — au-delà, l'écran devient un tableau de bord et plus
   * personne ne le lit. On garde ce qui donne une idée pour la partie suivante : les
   * améliorations prises (avec leur niveau), le type d'unité qui a porté les dégâts, et le
   * tier auquel on a joué.
   */
  formatBuild(recap) {
    const upgrades = recap.upgrades ?? [];
    const build = upgrades.length
      ? upgrades.map((entry) => (entry.level > 1 ? `${entry.label} ×${entry.level}` : entry.label)).join(' · ')
      : 'aucune amélioration prise';

    const best = Object.entries(recap.damageByType)
      .filter(([, value]) => value > 0)
      .sort((a, b) => b[1] - a[1])[0];
    const total = Object.values(recap.damageByType).reduce((sum, value) => sum + value, 0);
    const share = best && total > 0 ? Math.round((best[1] / total) * 100) : 0;

    const tiers = Object.entries(recap.sentByTier).sort((a, b) => Number(b[0]) - Number(a[0]));
    const topTier = tiers.length > 0 ? tiers[0][0] : '—';

    return [
      `Build : ${build}`,
      best
        ? `${recap.unitLabels?.[best[0]] ?? best[0]} a porté ${share} % des dégâts`
        : 'aucun dégât infligé',
      `${recap.sent} envois · ${recap.merges} fusions · meilleur tier ${topTier}`,
    ].join('\n');
  }

  /** Récap de réglage — lecture d'équilibrage, `?debug=1` seulement. */
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

  /** Écrit le score et le recadre dans le panneau. */
  setScore(value) {
    this.scoreText.setText(this.scoreLabel(value));
    this.fitWidth(this.scoreText, this.panelInnerWidth ?? this.scale.gameSize.width);
  }

  /** Resserre un texte qui déborde de la largeur donnée. Rend le texte, pour chaîner. */
  fitWidth(text, maxWidth) {
    text.setScale(1);
    if (text.width > maxWidth) text.setScale(maxWidth / text.width);
    return text;
  }

  text(content, style) {
    return this.add
      .text(0, 0, content, { fontFamily: FONT, align: 'center', ...style })
      .setOrigin(0.5, 0.5)
      .setDepth(DEPTH.banner + 2)
      .setResolution(sceneTextResolution(this));
  }

  handleResize(gameSize) {
    this.layout(gameSize.width, gameSize.height);
  }

  layout(width, height) {
    if (!(width > 0) || !(height > 0)) return;

    this.veil.setSize(width, height);

    // Le panneau est plus haut depuis le Lot 3.5 : il loge le récap de build entre le
    // record et le bouton, sans que rien ne se chevauche sur un écran de 320 px.
    const panelWidth = Phaser.Math.Clamp(Math.min(width * 0.86, height * 0.9), 180, 440);
    const panelHeight = Phaser.Math.Clamp(
      Math.min(panelWidth * 1.02, height * 0.82),
      190,
      400
    );
    const cx = width / 2;
    const cy = height / 2;
    this.panel.setPosition(cx, cy).setSize(panelWidth, panelHeight);

    const unit = panelHeight / 14;
    // Le panneau est dimensionné sur sa **hauteur**, mais « 12 vagues survécues » se mesure
    // en largeur : sans ce recadrage, la ligne de score déborde du panneau sur un écran
    // étroit. On resserre plutôt que de tronquer — un score coupé serait absurde.
    const inner = panelWidth * 0.9;
    this.fitWidth(this.titleText.setFontSize(Math.round(unit * 1.9)), inner);
    this.fitWidth(this.scoreText.setFontSize(Math.round(unit * 1.4)), inner);
    this.fitWidth(this.bestText.setFontSize(Math.round(unit * 1.05)), inner);
    this.panelInnerWidth = inner;

    this.titleText.setPosition(cx, cy - unit * 5.4);
    this.scoreText.setPosition(cx, cy - unit * 3.1);
    this.bestText.setPosition(cx, cy - unit * 1.5);

    this.buildText
      ?.setFontSize(Phaser.Math.Clamp(Math.round(unit * 0.95), 9, 15))
      .setWordWrapWidth(panelWidth * 0.88)
      .setPosition(cx, cy + unit * 1.2);

    const buttonWidth = panelWidth * 0.56;
    const buttonHeight = Math.max(38, unit * 2.4);
    const buttonY = cy + panelHeight / 2 - buttonHeight / 2 - unit * 0.7;
    this.button.setPosition(cx, buttonY).setSize(buttonWidth, buttonHeight);
    // La zone tactile suit la taille du bouton : sur téléphone, viser 38 px de haut est
    // le minimum confortable.
    this.button.input?.hitArea?.setTo(0, 0, buttonWidth, buttonHeight);
    this.buttonText.setFontSize(Math.round(unit * 1.3)).setPosition(cx, buttonY);

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
