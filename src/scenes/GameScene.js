import Phaser from 'phaser';

import balance from '../config/balance.json';
import juiceConfig from '../config/juice.json';
import { GameSession, SESSION_DROP, SESSION_TAP } from '../systems/GameSession.js';
import { computeLayout, cellCenterAt, nearestCellIndex } from '../systems/layout.js';
import { isTap } from '../systems/tapGesture.js';
import { parseJuiceConfig } from '../systems/juice.js';
import { drawItemShape, itemColor, TIER_LABEL_COLOR } from '../render/tierShapes.js';
import { powerColor } from '../render/powerShapes.js';
import { DEPTH } from '../render/depths.js';
import { JuiceKit } from '../render/juiceKit.js';
import { isDebugEnabled } from '../systems/debug.js';
import { t } from '../i18n/index.js';
import { submitScore } from '../systems/highScore.js';
import { BattleView } from './BattleView.js';
import { IntelBar } from './IntelBar.js';
import { DebugPanel } from './DebugPanel.js';
import { sceneTextResolution } from '../render/hiDpi.js';

/**
 * Scène de jeu — grille de merge + champ de bataille.
 *
 * Cette scène ne contient **aucune règle** : elle affiche les modèles portés par
 * `GameSession`, lui transmet les gestes du joueur (`applyTap`, `applyDrop`), et met en
 * images ce qu'ils émettent sur le bus. Qu'un tap soit refusé ou qu'une fusion soit
 * légale : c'est la session qui décide, jamais elle.
 *
 * **Deux gestes, un seul doigt** (Lot 2.5) : un tap envoie l'item en file de déploiement,
 * un glisser fusionne ou déplace. Les deux ne doivent jamais se confondre — c'est le rôle
 * du seuil de `isTap()`, le même que celui donné à `input.dragDistanceThreshold` pour que
 * Phaser ne démarre pas un drag pendant qu'on juge encore d'un tap.
 *
 * **Toutes les intensités de feedback viennent de `juice.json`** (Lot 3) : durées de tween,
 * squash de fusion, gerbes de particules, secousses, sons. Rien de tout cela n'est écrit
 * en dur ici — voir `src/systems/juice.js`.
 *
 * Le rendu de la moitié droite est délégué à `BattleView`, qui possède ses propres objets
 * d'affichage mais partage le layout, le bus et la boîte à juice.
 */

const COLORS = {
  background: 0x12141c,
  gridPanel: 0x191d2a,
  gridBorder: 0x4d96ff,
  cell: 0x1e2333,
  cellStroke: 0x2c3350,
  text: '#eef1f8',
  textDim: '#8f97b0',
  soundOn: 0x4d96ff,
  soundOff: 0x2c3350,
  helpButton: 0x2c3350,
};

/** Réglages d'interaction qui ne sont pas du feel : ergonomie du geste. */
const INPUT = {
  /** Tolérance de drop, en fraction de case, autour du centre de la case visée. */
  dropTolerance: 0.9,
  /** Délai au-delà duquel un pointeur « perdu » (drag interrompu) annule le drag. */
  lostPointerMs: 140,
  /** Délai avant l'écran de game over : le dernier ennemi doit avoir le temps d'arriver. */
  gameOverDelayMs: 650,
};

const FONT = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

export default class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  create() {
    this.debug = isDebugEnabled();
    this.juiceConfig = parseJuiceConfig(juiceConfig);

    this.session = new GameSession({ balance });
    this.model = this.session.grid;
    this.bus = this.session.events;

    /** @type {Map<number, Phaser.GameObjects.Container>} vues d'items, par id d'item */
    this.views = new Map();
    /** Drag en cours, ou null. Un seul à la fois : le second doigt est ignoré. */
    this.dragState = null;
    /** Item sous le doigt tant que le geste peut encore devenir un tap. */
    this.tapCandidate = null;
    this.pulseTween = null;
    this.gameOverStarted = false;
    /** Multiplicateur de temps du panneau de debug (×1 en jeu normal). */
    this.speed = 1;

    // Deux pointeurs suffisent : on n'autorise qu'un drag à la fois, mais il faut
    // pouvoir détecter (et neutraliser proprement) un second doigt.
    this.input.addPointer(2);

    this.buildDisplay();
    this.juice = new JuiceKit(this, this.juiceConfig);
    this.battleView = new BattleView(this, this.session, this.juice);
    this.intelBar = new IntelBar(this, this.session, this.juice);
    this.debugPanel = this.debug ? this.buildDebugPanel() : null;
    this.bindModel();
    this.bindInput();

    this.scale.on('resize', this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.teardown, this);

    const { width, height } = this.scale.gameSize;
    this.layout(width, height);

    this.session.start();
  }

  // ------------------------------------------------------------------ affichage

  buildDisplay() {
    this.background = this.add
      .rectangle(0, 0, 10, 10, COLORS.background)
      .setOrigin(0, 0)
      .setDepth(DEPTH.background);

    this.title = this.add
      .text(0, 0, t('game.title'), {
        fontFamily: FONT,
        fontStyle: 'bold',
        color: COLORS.text,
      })
      .setOrigin(0, 0.5)
      .setDepth(DEPTH.hud)
      .setResolution(this.textResolution());

    // Tout le diagnostic passe derrière `?debug=1` : l'écran par défaut est celui que
    // verra un joueur de Crazy Games.
    this.debugText = this.add
      .text(0, 0, '', { fontFamily: MONO, color: COLORS.textDim })
      .setOrigin(1, 0.5)
      .setDepth(DEPTH.hud)
      .setVisible(this.debug)
      .setResolution(this.textResolution());
    this.debugAccumulator = 0;

    this.buildSoundButton();
    this.buildHelpButton();

    this.gridPanel = this.add
      .rectangle(0, 0, 10, 10, COLORS.gridPanel)
      .setOrigin(0, 0)
      .setDepth(DEPTH.panel);

    // Bordure séparée du panneau : c'est elle qui pulse quand la grille est pleine.
    this.gridBorder = this.add
      .rectangle(0, 0, 10, 10)
      .setOrigin(0, 0)
      .setFillStyle()
      .setStrokeStyle(2, COLORS.gridBorder, 1)
      .setAlpha(0.25)
      .setDepth(DEPTH.hud);

    /** @type {Phaser.GameObjects.Rectangle[]} fonds de case, indexés comme le modèle */
    this.cellViews = [];
    for (let i = 0; i < this.model.size; i += 1) {
      this.cellViews.push(
        this.add
          .rectangle(0, 0, 10, 10, COLORS.cell)
          .setStrokeStyle(1, COLORS.cellStroke, 1)
          .setDepth(DEPTH.cell)
      );
    }
  }

  /**
   * Bouton « ? » — l'aide en pause.
   *
   * Le playtest du Lot 3.5 a montré qu'aucune interface ne disait ce que font les quatre
   * types d'unités ni à quel rythme revient le draft : on apprenait les règles en perdant.
   * Discret à côté du bouton son, il ouvre `HelpScene` par-dessus la partie gelée.
   */
  buildHelpButton() {
    this.helpButton = this.add
      .rectangle(0, 0, 10, 10, COLORS.helpButton, 1)
      .setDepth(DEPTH.hud)
      .setInteractive({ useHandCursor: true });
    this.helpIcon = this.add
      .text(0, 0, '?', { fontFamily: FONT, fontStyle: 'bold', color: COLORS.text })
      .setOrigin(0.5, 0.5)
      .setDepth(DEPTH.hud + 1)
      .setResolution(this.textResolution());

    this.helpButton.on('pointerup', () => this.openHelp());
  }

  /** Ouvre l'aide. Comme le draft : geste en cours reposé, puis scène gelée. */
  openHelp() {
    if (this.session.over || this.gameOverStarted || this.session.draftPending) return;

    this.juice.sfx.unlock();
    this.cancelPendingGesture();
    this.juice.clearVignette();
    this.scene.launch('HelpScene', {
      // Le panneau ne connaît ni `balance.json` ni les règles : il affiche ce que la
      // session lui donne, comme tout le reste du rendu.
      // Des identifiants de type, pas des libellés : `HelpScene` va chercher les siens
      // dans `src/i18n/`. La scène de jeu n'a pas à traduire pour une autre.
      units: Object.values(this.session.battleConfig.units).map((def) => def.id),
      powers: Object.values(this.session.powersConfig.types).map((def) => def.id),
      draftEveryWaves: this.session.draftConfig.everyWaves,
      skipCooldownMs: this.session.battleConfig.skipCooldownMs,
      graceMs: this.session.inputConfig.overlayGraceMs,
      juice: this.juice,
      onClose: () => {},
    });
    this.scene.pause();
  }

  /** Bouton son — exigé au périmètre V1 (seed doc), et le choix survit au rechargement. */
  buildSoundButton() {
    this.soundButton = this.add
      .rectangle(0, 0, 10, 10, COLORS.soundOn, 1)
      .setDepth(DEPTH.hud)
      .setInteractive({ useHandCursor: true });
    this.soundIcon = this.add
      .text(0, 0, '♪', { fontFamily: FONT, fontStyle: 'bold', color: '#12141c' })
      .setOrigin(0.5, 0.5)
      .setDepth(DEPTH.hud + 1)
      .setResolution(this.textResolution());

    this.soundButton.on('pointerup', () => {
      // Le premier geste sur le bouton déverrouille aussi l'audio : sans ça, rallumer le
      // son avant d'avoir touché la grille ne produirait rien.
      this.juice.sfx.unlock();
      this.juice.sfx.toggle();
      this.refreshSoundButton();
      if (this.juice.sfx.enabled) this.juice.play('tap');
    });
  }

  refreshSoundButton() {
    const on = this.juice?.sfx.enabled ?? true;
    this.soundButton.setFillStyle(on ? COLORS.soundOn : COLORS.soundOff, 1);
    this.soundIcon.setText(on ? '♪' : '✕').setColor(on ? '#12141c' : COLORS.textDim);
  }

  buildDebugPanel() {
    return new DebugPanel(this, {
      onSpeed: (speed) => {
        this.speed = speed;
        // Les timers de la scène suivent la même horloge que la simulation, sinon les
        // délais d'animation dérivent du jeu à ×4.
        this.time.timeScale = speed;
      },
      onSkipWave: () => this.session.battle.skipWave(),
      onToggleInvincible: () => {
        const battle = this.session.battle;
        battle.invincible = !battle.invincible;
        return battle.invincible;
      },
    });
  }

  /** Texte net sur écran haute densité, sans exploser le fillrate au-delà de 2x. */
  textResolution() {
    return sceneTextResolution(this);
  }

  // ------------------------------------------------------------------ layout

  handleResize(gameSize) {
    this.layout(gameSize.width, gameSize.height);
  }

  layout(width, height) {
    if (!(width > 0) || !(height > 0)) return;

    const layout = computeLayout(width, height, {
      cols: this.model.cols,
      rows: this.model.rows,
      // La file peut s'élargir au draft : on demande sa taille **courante**, pas celle de
      // `balance.json`.
      slotCount: this.session.deployQueue.slotCount(),
      // La bande de boutons de debug se réserve sa place dans le layout plutôt que de se
      // poser par-dessus le jeu : en mode normal elle vaut 0 et rien ne bouge.
      debugRowPx: this.debug
        ? Phaser.Math.Clamp(Math.round(Math.min(width, height) * 0.055), 22, 40)
        : 0,
    });
    this.layoutData = layout;

    this.background.setSize(width, height);
    this.juice.layout(width, height);

    const headerFont = Phaser.Math.Clamp(Math.round(Math.min(width, height) * 0.034), 11, 18);
    this.title.setFontSize(headerFont);
    const headerMiddle = layout.header.y + layout.header.height / 2;
    this.title.setPosition(layout.header.x, headerMiddle);

    // Deux boutons collés au bord droit de l'en-tête : son puis « ? ». La ligne de debug se
    // range à leur gauche.
    const soundSize = Phaser.Math.Clamp(Math.round(layout.header.height * 0.72), 20, 40);
    const gap = Math.max(4, Math.round(soundSize * 0.22));
    const soundX = layout.header.x + layout.header.width - soundSize / 2;
    this.soundButton.setPosition(soundX, headerMiddle).setSize(soundSize, soundSize);
    this.soundButton.input?.hitArea?.setTo(0, 0, soundSize, soundSize);
    this.soundIcon.setFontSize(Math.round(soundSize * 0.55)).setPosition(soundX, headerMiddle);

    const helpX = soundX - soundSize - gap;
    this.helpButton.setPosition(helpX, headerMiddle).setSize(soundSize, soundSize);
    this.helpButton.input?.hitArea?.setTo(0, 0, soundSize, soundSize);
    this.helpIcon.setFontSize(Math.round(soundSize * 0.55)).setPosition(helpX, headerMiddle);

    // Plus petit que le titre : la ligne de debug est dense et partage la même rangée.
    this.debugText.setFontSize(Phaser.Math.Clamp(Math.round(headerFont * 0.78), 8, 14));
    this.debugText.setPosition(helpX - soundSize / 2 - layout.pad / 2, headerMiddle);

    const gridWidth = layout.grid.cell * layout.grid.cols;
    const gridHeight = layout.grid.cell * layout.grid.rows;
    this.gridPanel.setPosition(layout.grid.x, layout.grid.y).setSize(gridWidth, gridHeight);
    this.gridBorder.setPosition(layout.grid.x, layout.grid.y).setSize(gridWidth, gridHeight);

    const cellSize = layout.grid.cell * 0.94;
    this.cellViews.forEach((cellView, index) => {
      const center = cellCenterAt(layout, index);
      cellView.setPosition(center.x, center.y).setSize(cellSize, cellSize);
    });

    this.refreshItemViews();
    this.battleView.layout(layout);
    this.intelBar.layout(layout);
    this.debugPanel?.layout(layout);
    this.refreshSoundButton();
  }

  /**
   * Repositionne et redimensionne les vues d'items d'après le modèle.
   *
   * L'item en cours de drag est redimensionné mais **pas** repositionné : il doit
   * rester sous le doigt, y compris si l'écran tourne pendant le geste.
   */
  refreshItemViews() {
    const layout = this.layoutData;
    this.model.cells.forEach((item, index) => {
      if (item === null) return;
      const view = this.views.get(item.id);
      if (!view) return;

      view.setData('index', index);
      this.resizeItemView(view, layout.itemSize, layout.grid.cell);
      if (this.dragState?.view === view) return;

      const center = cellCenterAt(layout, index);
      view.setPosition(center.x, center.y);
    });
  }

  // ------------------------------------------------------------------ modèle

  bindModel() {
    this.bus.on('spawn', ({ index, item }) => this.createItemView(index, item));
    this.bus.on('move', ({ to, item }) => this.onModelMove(to, item));
    this.bus.on('swap', ({ from, to, source, target }) => this.onModelSwap(from, to, source, target));
    this.bus.on('merge', (payload) => this.onModelMerge(payload));
    // Un item quitte la grille pour la file de déploiement : sa vue s'aspire pendant que
    // `BattleView` fait voler sa vignette vers le slot.
    this.bus.on('remove', ({ item }) => this.onModelRemove(item));
    this.bus.on('full', () => this.startGridPulse());
    this.bus.on('unfull', () => this.stopGridPulse());
    this.bus.on('draftOffer', (payload) => this.onDraftOffer(payload));
    this.bus.on('gameOver', (payload) => this.onGameOver(payload));
  }

  /**
   * Un draft s'ouvre : la scène se met en pause et `DraftScene` prend le dessus.
   *
   * **Deux verrous, à dessein.** La session est déjà gelée de son côté
   * (`GameSession.pendingDraft`) ; la mise en pause de la scène gèle en plus ses tweens et
   * ses entrées. Un bug de rendu ne peut donc pas laisser filer la simulation, ni un doigt
   * atteindre la grille derrière les cartes.
   */
  onDraftOffer({ wave, cards }) {
    if (this.gameOverStarted) return;

    // Le draft s'ouvre pile quand le joueur manipule la grille : un item resté sous le
    // doigt se figerait au milieu de l'écran pendant tout le draft. On repose ce qui est
    // en main **avant** de geler la scène — et on le fait sans tween, qui serait figé lui
    // aussi.
    this.cancelPendingGesture();

    // Même précaution que pour le game over : une vignette prise en plein fondu resterait
    // rouge derrière l'écran de draft, la scène étant figée.
    this.juice.clearVignette();
    this.scene.launch('DraftScene', {
      wave,
      cards,
      juice: this.juice,
      graceMs: this.session.inputConfig.overlayGraceMs,
      onChoose: (id) => this.onDraftChosen(id),
    });
    this.scene.pause();
  }

  /**
   * Repose immédiatement l'item en cours de drag et oublie le tap en attente.
   *
   * Sans tween : la scène est sur le point d'être mise en pause, et un tween figé laisserait
   * l'item à mi-chemin, agrandi, par-dessus tout le reste.
   */
  cancelPendingGesture() {
    this.tapCandidate = null;
    const drag = this.dragState;
    if (!drag) return;
    this.dragState = null;

    const view = drag.view;
    if (!view?.active) return;
    this.tweens.killTweensOf(view);
    const center = cellCenterAt(this.layoutData, drag.fromIndex);
    view.setDepth(DEPTH.item).setPosition(center.x, center.y).setScale(1);
  }

  /**
   * Le joueur a choisi : la session applique l'amélioration, puis la scène se remet en
   * page — « File élargie » ajoute une place, et le layout doit la faire apparaître.
   */
  onDraftChosen(id) {
    const chosen = this.session.chooseDraft(id);
    if (!chosen) return;
    const { width, height } = this.scale.gameSize;
    this.layout(width, height);
  }

  onModelMove(index, item) {
    const view = this.views.get(item.id);
    if (!view) return;
    const center = cellCenterAt(this.layoutData, index);
    view.setData('index', index);
    this.tweens.killTweensOf(view);
    this.tweens.add({
      targets: view,
      x: center.x,
      y: center.y,
      scaleX: 1,
      scaleY: 1,
      duration: this.juiceConfig.grid.moveMs,
      ease: 'Quad.easeOut',
    });
  }

  /**
   * Deux items échangent leur case : les deux vues glissent en même temps, avec le tween de
   * déplacement ordinaire. C'est volontairement le **même** feedback qu'un déplacement vers
   * une case vide — un échange est un rangement, pas un événement.
   */
  onModelSwap(from, to, source, target) {
    this.onModelMove(to, source);
    this.onModelMove(from, target);
  }

  onModelRemove(item) {
    const view = this.views.get(item.id);
    if (!view) return;
    this.views.delete(item.id);
    this.tweens.killTweensOf(view);
    this.tweens.add({
      targets: view,
      scaleX: 0,
      scaleY: 0,
      alpha: 0,
      duration: this.juiceConfig.grid.sendMs,
      ease: 'Quad.easeIn',
      onComplete: () => view.destroy(),
    });
  }

  onModelMerge(payload) {
    const grid = this.juiceConfig.grid;
    const [sourceItem, targetItem] = payload.consumed;
    const sourceView = this.views.get(sourceItem.id);
    const center = cellCenterAt(this.layoutData, payload.index);

    const finish = () => {
      this.destroyItemView(sourceItem.id);
      this.destroyItemView(targetItem.id);
      const view = this.createItemView(payload.index, payload.item, { pop: false });
      this.squashPop(view);

      // La gerbe part à la couleur de l'item **produit** : l'œil suit la promotion, et un
      // merge de pouvoirs éclate à la teinte du pouvoir, pas à celle d'un tier d'unité.
      this.juice.burst(center.x, center.y, grid.mergeBurst, itemColor(payload.item));
      this.juice.play('merge');
    };

    if (!sourceView) {
      // Fusion déclenchée hors drag (tests, futurs automatismes) : pas d'absorption.
      finish();
      return;
    }

    // L'item traîné est absorbé par sa cible, puis l'item de tier supérieur éclôt.
    this.tweens.killTweensOf(sourceView);
    this.tweens.add({
      targets: sourceView,
      x: center.x,
      y: center.y,
      scaleX: 0.5,
      scaleY: 0.5,
      duration: grid.mergeAbsorbMs,
      ease: 'Quad.easeIn',
      onComplete: finish,
    });
  }

  /**
   * Squash & stretch de fusion : l'item naît écrasé, se détend, puis rebondit à sa taille.
   * C'est ce qui donne du poids à la fusion — sans lui, un item de tier supérieur
   * apparaîtrait simplement, et le geste principal du jeu n'aurait pas d'impact.
   */
  squashPop(view) {
    if (!view?.active) return;
    const { mergeSquash, mergePopMs } = this.juiceConfig.grid;

    view.setScale(mergeSquash.scaleX * 0.7, mergeSquash.scaleY * 0.7);
    this.tweens.chain({
      targets: view,
      tweens: [
        {
          scaleX: mergeSquash.scaleX,
          scaleY: mergeSquash.scaleY,
          duration: mergeSquash.durationMs,
          ease: 'Quad.easeOut',
        },
        {
          scaleX: 1,
          scaleY: 1,
          duration: mergePopMs,
          ease: 'Back.easeOut',
        },
      ],
    });
  }

  // ------------------------------------------------------------------ vues d'items

  /**
   * Crée la vue d'un item : un conteneur (forme + numéro de tier), draggable au
   * doigt comme à la souris.
   */
  createItemView(index, item, { pop = true } = {}) {
    const layout = this.layoutData;
    const center = cellCenterAt(layout, index);

    const shape = this.add.graphics();
    const label = this.add
      .text(0, 0, String(item.tier), {
        fontFamily: FONT,
        fontStyle: 'bold',
        color: TIER_LABEL_COLOR,
      })
      .setOrigin(0.5, 0.5)
      .setResolution(this.textResolution());

    const view = this.add.container(center.x, center.y, [shape, label]);
    view.setDepth(DEPTH.item);
    // `item` est conservé tel quel : c'est lui qui porte la famille et le type de pouvoir,
    // donc la silhouette à redessiner à chaque changement de layout.
    view.setData({ kind: 'item', itemId: item.id, index, item, tier: item.tier, shape, label });

    this.resizeItemView(view, layout.itemSize, layout.grid.cell);

    // Zone de saisie = la case entière, pas seulement la forme : au doigt, viser le
    // contour exact d'une étoile serait injouable.
    view.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, layout.grid.cell, layout.grid.cell),
      Phaser.Geom.Rectangle.Contains
    );
    this.input.setDraggable(view);

    this.views.set(item.id, view);

    if (pop) {
      view.setScale(0.25);
      this.tweens.add({
        targets: view,
        scaleX: 1,
        scaleY: 1,
        duration: this.juiceConfig.grid.spawnPopMs,
        ease: 'Back.easeOut',
      });
    }

    return view;
  }

  /** Redimensionne une vue (forme, numéro, zone de saisie) après un changement de layout. */
  resizeItemView(view, itemSize, cellSize) {
    const shape = view.getData('shape');
    const label = view.getData('label');

    drawItemShape(shape, view.getData('item'), itemSize);
    label.setFontSize(Math.max(9, Math.round(itemSize * 0.4)));
    view.setSize(cellSize, cellSize);
    // Phaser ajoute `displayOrigin` (= moitié de la taille du conteneur) aux
    // coordonnées avant de tester la zone de saisie : celle-ci se décrit donc
    // depuis le coin haut-gauche, pas centrée sur (0, 0). Une zone centrée ne
    // couvrirait que le quart haut-gauche de l'item — un item quasi impossible à
    // attraper au doigt.
    if (view.input?.hitArea) {
      view.input.hitArea.setTo(0, 0, cellSize, cellSize);
    }
  }

  destroyItemView(itemId) {
    const view = this.views.get(itemId);
    if (!view) return;
    this.views.delete(itemId);
    this.tweens.killTweensOf(view);
    view.destroy();
  }

  // ------------------------------------------------------------------ input

  bindInput() {
    // Phaser unifie souris et tactile derrière les mêmes événements de pointeur :
    // un seul chemin de code couvre les deux entrées exigées par le seed doc.
    //
    // Le seuil de distance est confié à Phaser : tant que le doigt n'a pas dépassé
    // `tapMaxDistancePx`, aucun `dragstart` n'est émis, et le geste peut encore devenir
    // un tap. C'est ce qui garantit que les deux gestes ne se déclenchent jamais ensemble.
    this.input.dragDistanceThreshold = this.session.inputConfig.tapMaxDistancePx;

    this.input.on('pointerdown', this.onPointerDown, this);
    this.input.on('gameobjectdown', this.onObjectDown, this);
    this.input.on('pointerup', this.onPointerUp, this);
    this.input.on('dragstart', this.onDragStart, this);
    this.input.on('drag', this.onDragMove, this);
    this.input.on('dragend', this.onDragEnd, this);
  }

  /**
   * Les navigateurs n'autorisent l'audio qu'après un geste : le premier appui, où qu'il
   * soit, réveille la banque de sons. Idempotent, donc appelé sans état à tenir.
   */
  onPointerDown() {
    this.juice.sfx.unlock();
  }

  // --------------------------------------------------------------- tap (envoi)

  onObjectDown(pointer, view) {
    if (this.dragState || this.tapCandidate || this.session.over) return;
    if (view.getData('kind') !== 'item') return;
    this.tapCandidate = { view, pointerId: pointer.id };
  }

  /**
   * Fin de geste : si le doigt n'a ni bougé ni traîné en longueur, c'est un tap et l'item
   * part au combat. Sinon, le drag a déjà pris la main (ou rien ne se passe).
   */
  onPointerUp(pointer) {
    const candidate = this.tapCandidate;
    this.tapCandidate = null;
    if (!candidate || candidate.pointerId !== pointer.id) return;
    if (!candidate.view.active || this.session.over) return;

    const gesture = {
      startX: pointer.downX,
      startY: pointer.downY,
      endX: pointer.upX,
      endY: pointer.upY,
      startTime: pointer.downTime,
      endTime: pointer.upTime,
    };
    if (!isTap(gesture, this.session.inputConfig)) return;

    const index = candidate.view.getData('index');
    const result = this.session.applyTap(index);

    if (result.type === SESSION_TAP.SENT) {
      this.juice.play('tap');
      return;
    }
    // Pouvoir dépensé : la case s'illumine sur place. Le reste du feedback (le trajet vers
    // la bataille, la zone annoncée, l'impact) appartient à `BattleView`, qui écoute
    // `powerCast` et `powerResolved`.
    if (result.type === SESSION_TAP.POWER) {
      this.flashPowerCell(index, result.power);
      this.juice.play('powerCast');
      return;
    }
    // Refus : file de déploiement pleine, ou pouvoir sans la moindre cible. L'item secoue et
    // reste en place — `BattleView` met la jauge en évidence de son côté.
    if (result.type === SESSION_TAP.BLOCKED) {
      this.shake(candidate.view);
      this.juice.play('reject');
    }
  }

  /**
   * Éclair sur la case d'où part un pouvoir.
   *
   * C'est la moitié « grille » de la règle « les deux taps ne se confondent pas » : un envoi
   * d'unité aspire discrètement son item vers la file, un pouvoir **éclate** sur place à sa
   * propre teinte. Le son diffère aussi, et le trajet ensuite.
   */
  flashPowerCell(index, power) {
    const center = cellCenterAt(this.layoutData, index);
    this.juice.burst(center.x, center.y, this.juiceConfig.power.castBurst, powerColor(power));
  }

  // --------------------------------------------------------------- drag (merge)

  onDragStart(pointer, view) {
    // Ce doigt-là a dépassé le seuil : son geste n'est plus un tap, quoi qu'il arrive
    // ensuite. Un candidat porté par un **autre** doigt, lui, reste valable.
    if (this.tapCandidate?.pointerId === pointer.id) this.tapCandidate = null;

    // Un seul objet en main à la fois : un second doigt qui en attrape un autre est
    // neutralisé (il repartira chez lui au relâcher) plutôt que de créer deux drags.
    if (this.dragState || this.session.over) {
      view.setData('dragIgnored', true);
      return;
    }

    this.dragState = {
      view,
      pointer,
      fromIndex: view.getData('index'),
      lostSince: 0,
    };

    const grid = this.juiceConfig.grid;
    this.tweens.killTweensOf(view);
    view.setDepth(DEPTH.drag);
    this.tweens.add({
      targets: view,
      scaleX: grid.dragScale,
      scaleY: grid.dragScale,
      duration: grid.dragScaleMs,
      ease: 'Back.easeOut',
    });
  }

  onDragMove(pointer, view, dragX, dragY) {
    if (this.dragState?.view !== view) return;
    const { width, height } = this.scale.gameSize;
    // L'objet reste dans l'écran même si le doigt en sort : sinon il devient
    // impossible de voir où on le lâche.
    view.setPosition(Phaser.Math.Clamp(dragX, 0, width), Phaser.Math.Clamp(dragY, 0, height));
  }

  onDragEnd(pointer, view) {
    if (view.getData('dragIgnored')) {
      view.setData('dragIgnored', false);
      this.returnHome(view);
      return;
    }
    if (this.dragState?.view !== view) return;
    this.resolveDrop();
  }

  /** Applique le lâcher : la scène demande, la session décide. */
  resolveDrop() {
    const { view, fromIndex } = this.dragState;
    this.dragState = null;
    view.setDepth(DEPTH.item);

    const target = nearestCellIndex(this.layoutData, view.x, view.y, {
      tolerance: INPUT.dropTolerance,
    });
    const result =
      target === -1 ? { type: SESSION_DROP.INVALID } : this.session.applyDrop(fromIndex, target);

    // MERGE, MOVE et SWAP sont déjà rendus par les écouteurs du bus ; le reste (lâcher hors
    // grille, lâcher sur sa propre case) ramène l'item chez lui.
    const handled =
      result.type === SESSION_DROP.MERGE ||
      result.type === SESSION_DROP.MOVE ||
      result.type === SESSION_DROP.SWAP;
    if (!handled) this.returnHome(view, fromIndex);
  }

  /** Ramène une vue d'item à la case que lui donne le modèle. */
  returnHome(view, index = view.getData('index')) {
    if (!view.active) return;
    const center = cellCenterAt(this.layoutData, index);
    this.tweens.killTweensOf(view);
    this.tweens.add({
      targets: view,
      x: center.x,
      y: center.y,
      scaleX: 1,
      scaleY: 1,
      duration: this.juiceConfig.grid.returnMs,
      ease: 'Back.easeOut',
    });
  }

  /** Secousse de refus sur l'item resté en place (tap sur une file pleine). */
  shake(view) {
    if (!view?.active) return;
    const reject = this.juiceConfig.grid.reject;
    const home = cellCenterAt(this.layoutData, view.getData('index'));
    this.tweens.killTweensOf(view);
    this.tweens.add({
      targets: view,
      x: home.x + reject.offsetPx,
      duration: reject.durationMs,
      yoyo: true,
      repeat: reject.repeat,
      ease: 'Sine.easeInOut',
      onComplete: () => view.setPosition(home.x, home.y),
    });
  }

  // ------------------------------------------------------------------ grille pleine

  startGridPulse() {
    if (this.pulseTween) return;
    this.pulseTween = this.tweens.add({
      targets: this.gridBorder,
      alpha: { from: 0.2, to: 0.85 },
      duration: 620,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  stopGridPulse() {
    this.pulseTween?.stop();
    this.pulseTween = null;
    this.gridBorder.setAlpha(0.25);
  }

  // ------------------------------------------------------------------ fin de partie

  onGameOver({ wavesCleared }) {
    if (this.gameOverStarted) return;
    this.gameOverStarted = true;

    this.input.enabled = false;
    this.juice.shake('gameOver');
    this.juice.play('gameOver');

    const { best, isRecord } = submitScore(wavesCleared);
    // Depuis le Lot 3.5, le récap est **pour le joueur** : c'est lui qui donne l'idée du
    // build à tenter à la partie suivante. Le détail de réglage (fuites, taps refusés,
    // occupation de la grille) reste derrière `?debug=1`.
    const recap = this.session.recap();

    // Court délai : le dernier ennemi finit son animation avant que l'écran ne tombe.
    this.time.delayedCall(INPUT.gameOverDelayMs, () => {
      // Mettre la scène en pause **gèle ses tweens** : une vignette prise en plein fondu
      // resterait rouge derrière l'écran de fin. On l'éteint avant de figer.
      this.juice.clearVignette();
      this.scene.launch('GameOverScene', { wavesCleared, best, isRecord, recap, debug: this.debug });
      this.scene.pause();
    });
  }

  // ------------------------------------------------------------------ boucle

  update(time, delta) {
    // Le multiplicateur de debug étire le temps du jeu, pas celui du navigateur : la
    // simulation reste à tick fixe, elle défile simplement plus vite.
    const scaled = delta * this.speed;
    this.session.update(scaled);
    this.battleView.update(scaled);
    this.intelBar.update();
    this.juice.update(delta);
    this.updateDebug(delta);

    const drag = this.dragState;
    if (!drag) return;

    // Filet de sécurité : si un `dragend` se perd (doigt sorti de la page, onglet
    // masqué, changement d'orientation), l'objet ne doit pas rester collé au vide.
    if (drag.pointer.isDown) {
      drag.lostSince = 0;
      return;
    }
    if (drag.lostSince === 0) {
      drag.lostSince = time;
      return;
    }
    if (time - drag.lostSince > INPUT.lostPointerMs) {
      this.dragState = null;
      drag.view.setDepth(DEPTH.item);
      this.returnHome(drag.view, drag.fromIndex);
    }
  }

  updateDebug(delta) {
    if (!this.debug) return;
    this.debugAccumulator += delta;
    if (this.debugAccumulator < 250) return;
    this.debugAccumulator = 0;

    const hud = this.session.hud();
    const battle = this.session.battle;
    // Dense à dessein : cette ligne doit tenir à côté du titre sur un écran de 320 px.
    // m = merges, s = envois, p = pouvoirs dépensés, t = ticks logiques, e = ennemis,
    // u = unités au combat, f = file de déploiement, g = items sur la grille.
    this.debugText.setText(
      `${Math.round(this.game.loop.actualFps)}fps m${hud.mergeCount} s${hud.sentCount} ` +
        `p${hud.powersUsed} t${battle.tickCount} e${battle.enemies.length} ` +
        `u${hud.fieldUnits}/${hud.maxFieldUnits} f${hud.queueLength}/${hud.slotCount} ` +
        `g${this.model.count()}`
    );
  }

  teardown() {
    this.scale.off('resize', this.handleResize, this);
    this.input.off('pointerdown', this.onPointerDown, this);
    this.input.off('gameobjectdown', this.onObjectDown, this);
    this.input.off('pointerup', this.onPointerUp, this);
    this.input.off('dragstart', this.onDragStart, this);
    this.input.off('drag', this.onDragMove, this);
    this.input.off('dragend', this.onDragEnd, this);
    this.dragState = null;
    this.tapCandidate = null;
    this.time.timeScale = 1;

    this.debugPanel?.destroy();
    this.intelBar?.destroy();
    this.battleView?.destroy();
    this.juice?.destroy();
    this.session.destroy();
    // Le bus meurt avec la session : aucun écouteur ne survit à la partie, donc aucune
    // fuite d'un `rejouer` à l'autre.
    this.bus.clear();
    this.views.clear();
    this.input.enabled = true;
  }
}
