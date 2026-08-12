import Phaser from 'phaser';

import juiceConfig from '../config/juice.json';
import { parseJuiceConfig } from '../systems/juice.js';
import { OverlayGuard } from '../systems/overlayGuard.js';
import { iconColor } from '../render/draftIcons.js';
import { createVisual, repaintVisual } from '../render/visuals.js';
import { Skin } from '../render/skin.js';
import { FONTS } from '../render/fonts.js';
import { DEPTH } from '../render/depths.js';
import { sceneTextResolution } from '../render/hiDpi.js';
import { t } from '../i18n/index.js';

/**
 * Écran de draft — trois cartes, un choix, effet permanent pour la partie.
 *
 * Lancée **par-dessus** `GameScene` mise en pause, comme `GameOverScene` : le champ de
 * bataille reste visible derrière, et la partie ne peut pas avancer d'un tick pendant que
 * le joueur lit (la session est gelée de son côté par `GameSession.pendingDraft`, la scène
 * l'est du sien — les deux verrous sont indépendants, et c'est voulu : un bug de rendu ne
 * doit pas pouvoir laisser filer la simulation).
 *
 * **Le draft est un moment de plaisir, pas un menu** (prompt du Lot 3.5) : les cartes
 * entrent en cascade, la carte choisie se gonfle et éclate en particules, les deux autres
 * s'effacent. Toutes les durées viennent de `juice.json` — rien en dur ici.
 *
 * **Aucune carte ne peut être prise par accident** (playtest) : le draft s'ouvre pile quand
 * le joueur est en train de fusionner, doigt posé. `OverlayGuard`
 * (`src/systems/overlayGuard.js`) exige un appui **postérieur à l'ouverture** et attend un
 * délai de grâce (`input.overlayGraceMs`) avant d'accepter quoi que ce soit ; pendant ce
 * délai les cartes sont visiblement en attente. La logique est dans un module pur pour être
 * testable sans navigateur — la scène ne fait que la brancher sur les pointeurs.
 *
 * La scène ne décide de rien : elle rend les cartes qu'on lui donne et rappelle
 * `onChoose(id)`, qui va à `GameSession.chooseDraft()`.
 */

const COLORS = {
  veil: 0x0a0c12,
  card: 0x191d2a,
  cardHover: 0x222839,
  cardStroke: 0x333b5c,
  text: '#eef1f8',
  textDim: '#8f97b0',
  title: '#ffd93d',
};

export default class DraftScene extends Phaser.Scene {
  constructor() {
    super('DraftScene');
  }

  /**
   * @param {{cards: object[], wave: number, graceMs: number,
   *          onChoose: (id: string) => void,
   *          juice: import('../render/juiceKit.js').JuiceKit}} data
   */
  init(data) {
    this.cards = data?.cards ?? [];
    this.wave = data?.wave ?? 0;
    this.onChoose = data?.onChoose ?? (() => {});
    // La boîte à juice de `GameScene` est prêtée, pas dupliquée : un second pool de
    // particules et un second contexte audio pour un écran de dix secondes seraient un
    // gaspillage exact du budget de performance du Lot 3.
    this.juice = data?.juice ?? null;
    this.juiceConfig = parseJuiceConfig(juiceConfig);
    // Le délai vient de `balance.json` via `GameScene` : la scène ne lit aucune config
    // elle-même, comme le reste du rendu.
    this.guard = new OverlayGuard({ graceMs: data?.graceMs ?? 0 });
    this.chosen = false;
    this.armed = false;
  }

  create() {
    this.skin = new Skin(this, this.registry.get('assetIndex'));

    // Opaque, pas juste sombre : le playtest a montré qu'un voile transparent laissait
    // croire que la grille restait jouable. Elle est gelée, ça doit se voir.
    this.veil = this.add
      .rectangle(0, 0, 10, 10, COLORS.veil, 0.94)
      .setOrigin(0, 0)
      .setDepth(DEPTH.banner)
      // Avale les gestes qui tombent à côté d'une carte : sans ça, un doigt maladroit
      // toucherait la grille derrière l'écran de draft.
      .setInteractive();

    this.guard.open(this.now());

    this.titleText = this.add
      .text(0, 0, t('draft.title'), { fontFamily: FONTS.body, fontStyle: 'bold', color: COLORS.title })
      .setOrigin(0.5, 0.5)
      .setDepth(DEPTH.banner + 2)
      .setResolution(this.textResolution());
    this.subtitleText = this.add
      .text(0, 0, t('draft.subtitle', { wave: this.wave }), {
        fontFamily: FONTS.body,
        color: COLORS.textDim,
        align: 'center',
      })
      .setOrigin(0.5, 0.5)
      .setDepth(DEPTH.banner + 2)
      .setResolution(this.textResolution());

    this.views = this.cards.map((card) => this.buildCard(card));

    this.scale.on('resize', this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.handleResize, this);
    });

    const { width, height } = this.scale.gameSize;
    this.layout(width, height);
    this.playIntro();
  }

  textResolution() {
    return sceneTextResolution(this);
  }

  /**
   * Horloge du délai de grâce — celle de la **boucle de jeu**, pas celle de la scène.
   *
   * `this.time.now` vaut 0 tant que le premier `preUpdate` de la scène n'a pas eu lieu,
   * c'est-à-dire pendant tout `create()` : ouvrir la garde là-dessus donnait une origine à
   * zéro, donc un délai déjà écoulé et une protection inopérante. Vérifié au navigateur —
   * c'est exactement le genre de bug qu'un test unitaire ne voit pas, puisqu'il porte sur
   * l'horloge et non sur la logique.
   */
  now() {
    return this.game.loop.time;
  }

  // ------------------------------------------------------------------ cartes

  buildCard(card) {
    const box = this.add
      .rectangle(0, 0, 10, 10, COLORS.card, 1)
      .setStrokeStyle(2, iconColor(card.icon), 0.85)
      .setDepth(DEPTH.banner + 1)
      .setInteractive({ useHandCursor: true });

    const icon = createVisual(this, this.skin, { kind: 'draftIcon', icon: card.icon }, 32).setDepth(
      DEPTH.banner + 2
    );
    const label = this.add
      .text(0, 0, t(`draft.upgrades.${card.id}.label`), {
        fontFamily: FONTS.body,
        fontStyle: 'bold',
        color: COLORS.text,
      })
      .setOrigin(0.5, 0.5)
      .setDepth(DEPTH.banner + 2)
      .setResolution(this.textResolution());
    const description = this.add
      .text(0, 0, t(`draft.upgrades.${card.id}.description`), {
        fontFamily: FONTS.body,
        color: COLORS.textDim,
        align: 'center',
      })
      .setOrigin(0.5, 0)
      .setDepth(DEPTH.banner + 2)
      .setResolution(this.textResolution());
    // « Niveau 2/3 » : une amélioration déjà prise doit se voir, sinon on la reprend sans
    // savoir qu'on l'empile — et le build cesse d'être un choix.
    const level = this.add
      .text(0, 0, t('draft.level', { level: card.level, max: card.maxLevel }), {
        fontFamily: FONTS.body,
        color: COLORS.textDim,
      })
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.banner + 2)
      .setResolution(this.textResolution());

    const view = { card, box, icon, label, description, level };

    // Le geste doit être **complet et postérieur à l'ouverture** : un doigt déjà posé quand
    // l'écran s'ouvre n'émet aucun `pointerdown` ici, donc son `pointerup` ne trouve rien
    // et n'active rien. C'est le verrou principal, et il ne dépend d'aucun réglage.
    box.on('pointerover', () => {
      if (this.armed) box.setFillStyle(COLORS.cardHover, 1);
    });
    box.on('pointerout', (pointer) => {
      box.setFillStyle(COLORS.card, 1);
      // Doigt qui quitte la carte : le geste n'est plus délibéré, on l'oublie.
      this.guard.cancel(pointer.id);
    });
    box.on('pointerdown', (pointer) => this.guard.press(pointer.id, view, this.now()));
    box.on('pointerup', (pointer) => {
      if (this.guard.release(pointer.id, view)) this.pick(view);
    });
    return view;
  }

  /**
   * Fin du délai de grâce : les cartes reprennent leur pleine opacité et deviennent
   * choisissables. L'estompage est ce qui rend l'attente lisible — sans lui, le joueur
   * croirait à des boutons cassés plutôt qu'à des boutons pas encore prêts.
   */
  armCards() {
    if (this.armed) return;
    this.armed = true;
    for (const view of this.views) {
      this.tweens.add({
        targets: [view.box, view.icon, view.label, view.description, view.level],
        alpha: 1,
        duration: this.juiceConfig.draft.armFadeMs,
        ease: 'Quad.easeOut',
      });
    }
  }

  update() {
    if (!this.armed && this.guard.isArmed(this.now())) this.armCards();
  }

  /**
   * Choix d'une carte. Verrouillé après le premier : un double-tap ne doit pas consommer
   * deux améliorations, et l'animation de sortie dure plus longtemps qu'un doigt pressé.
   */
  pick(view) {
    if (this.chosen) return;
    this.chosen = true;

    const draft = this.juiceConfig.draft;
    for (const other of this.views) {
      other.box.disableInteractive();
      if (other === view) continue;
      this.fadeOut(other);
    }

    this.juice?.play('draftPick');
    this.juice?.burst(view.box.x, view.box.y, draft.pickBurst, iconColor(view.card.icon));

    this.tweens.add({
      targets: [view.box, view.icon, view.label, view.description, view.level],
      scale: 1.12,
      alpha: 0,
      duration: draft.pickMs,
      ease: 'Back.easeIn',
      onComplete: () => this.finish(view.card.id),
    });
    this.tweens.add({
      targets: [this.veil, this.titleText, this.subtitleText],
      alpha: 0,
      duration: draft.pickMs,
      ease: 'Quad.easeIn',
    });
  }

  fadeOut(view) {
    this.tweens.add({
      targets: [view.box, view.icon, view.label, view.description, view.level],
      alpha: 0,
      scale: 0.88,
      duration: this.juiceConfig.draft.dismissMs,
      ease: 'Quad.easeIn',
    });
  }

  /** Rend la main à la partie : le choix s'applique, puis la scène de jeu repart. */
  finish(id) {
    this.guard.close();
    this.onChoose(id);
    this.scene.resume('GameScene');
    this.scene.stop();
  }

  /**
   * Entrée en cascade : les cartes arrivent l'une après l'autre. Le décalage est ce qui
   * fait la différence entre « un menu s'ouvre » et « on me propose quelque chose ».
   */
  playIntro() {
    const draft = this.juiceConfig.draft;
    this.juice?.play('draftOpen');

    this.titleText.setScale(0.7).setAlpha(0);
    this.tweens.add({
      targets: this.titleText,
      scale: 1,
      alpha: 1,
      duration: draft.cardInMs,
      ease: 'Back.easeOut',
    });

    this.views.forEach((view, index) => {
      const targets = [view.box, view.icon, view.label, view.description, view.level];
      for (const target of targets) target.setAlpha(0);
      view.box.setScale(0.8);
      this.tweens.add({
        targets,
        // Les cartes n'entrent qu'à demi-opacité : elles sont là, lisibles, mais
        // visiblement pas encore prenables. `armCards()` les allume à la fin de la grâce.
        alpha: draft.disabledAlpha,
        duration: draft.cardInMs,
        delay: index * draft.cardStaggerMs,
        ease: 'Quad.easeOut',
      });
      this.tweens.add({
        targets: view.box,
        scale: 1,
        duration: draft.cardInMs,
        delay: index * draft.cardStaggerMs,
        ease: 'Back.easeOut',
      });
    });
  }

  // ------------------------------------------------------------------ layout

  handleResize(gameSize) {
    this.layout(gameSize.width, gameSize.height);
  }

  layout(width, height) {
    if (!(width > 0) || !(height > 0)) return;
    this.veil.setSize(width, height);
    this.veil.input?.hitArea?.setTo(0, 0, width, height);

    const count = Math.max(1, this.views.length);
    // En portrait les cartes s'empilent, en paysage elles se rangent côte à côte : trois
    // colonnes sur un téléphone tenu debout donneraient des cartes intappables.
    const stacked = height > width;
    const pad = Phaser.Math.Clamp(Math.round(Math.min(width, height) * 0.03), 6, 20);
    const headerY = height * (stacked ? 0.12 : 0.14);

    this.titleText.setFontSize(Phaser.Math.Clamp(Math.round(Math.min(width, height) * 0.06), 16, 34));
    this.titleText.setPosition(width / 2, headerY);
    this.subtitleText
      .setFontSize(Phaser.Math.Clamp(Math.round(Math.min(width, height) * 0.032), 10, 17))
      .setWordWrapWidth(width * 0.86)
      .setPosition(width / 2, headerY + this.titleText.height * 0.9);

    const top = this.subtitleText.y + this.subtitleText.height / 2 + pad * 1.5;
    const available = Math.max(60, height - top - pad * 2);

    const cardWidth = stacked
      ? Math.min(width - pad * 2, 420)
      : Math.min((width - pad * (count + 1)) / count, 260);
    const cardHeight = stacked
      ? Math.min((available - pad * (count - 1)) / count, 150)
      : Math.min(available, 260);

    // Le bloc de cartes est centré dans la place qui lui reste, dans les deux sens : sur
    // un grand écran, elles ne doivent pas se tasser en haut à gauche.
    const rowWidth = cardWidth * count + pad * (count - 1);
    const columnHeight = cardHeight * count + pad * (count - 1);
    const left = (width - rowWidth) / 2;
    const columnTop = top + Math.max(0, (available - columnHeight) / 2);

    this.views.forEach((view, index) => {
      const cx = stacked ? width / 2 : left + cardWidth / 2 + index * (cardWidth + pad);
      const cy = stacked
        ? columnTop + cardHeight / 2 + index * (cardHeight + pad)
        : top + available / 2;
      this.placeCard(view, cx, cy, cardWidth, cardHeight, stacked);
    });
  }

  placeCard(view, cx, cy, cardWidth, cardHeight, stacked) {
    view.box.setPosition(cx, cy).setSize(cardWidth, cardHeight);
    view.box.input?.hitArea?.setTo(0, 0, cardWidth, cardHeight);

    const unit = Math.min(cardWidth, cardHeight);
    const iconSize = Math.round(unit * (stacked ? 0.34 : 0.3));
    // Empilées, les cartes sont larges et basses : l'icône se range à gauche du texte
    // plutôt qu'au-dessus, sinon la description n'a plus de place.
    const iconX = stacked ? cx - cardWidth / 2 + iconSize : cx;
    const iconY = stacked ? cy : cy - cardHeight * 0.28;
    repaintVisual(view.icon, this.skin, { kind: 'draftIcon', icon: view.card.icon }, iconSize);
    view.icon.setPosition(iconX, iconY);

    const textX = stacked ? cx + iconSize * 0.6 : cx;
    const textWidth = stacked ? cardWidth - iconSize * 2.4 : cardWidth * 0.86;

    view.label
      .setFontSize(Phaser.Math.Clamp(Math.round(unit * (stacked ? 0.19 : 0.13)), 12, 24))
      .setPosition(textX, stacked ? cy - cardHeight * 0.2 : cy + cardHeight * 0.02);
    view.description
      .setFontSize(Phaser.Math.Clamp(Math.round(unit * (stacked ? 0.13 : 0.085)), 9, 15))
      .setWordWrapWidth(textWidth)
      .setPosition(textX, stacked ? cy - cardHeight * 0.06 : cy + cardHeight * 0.1);
    view.level
      .setFontSize(Phaser.Math.Clamp(Math.round(unit * (stacked ? 0.11 : 0.075)), 8, 13))
      .setPosition(textX, cy + cardHeight / 2 - Math.max(6, unit * 0.06));
  }
}
