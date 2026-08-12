import Phaser from 'phaser';

import balance from '../config/balance.json';
import { GameSession, SESSION_DROP } from '../systems/GameSession.js';
import { UNIT_DROP } from '../systems/BattleModel.js';
import { computeLayout, cellCenterAt, nearestCellIndex, nearestSlotIndex } from '../systems/layout.js';
import { drawTierShape, TIER_LABEL_COLOR } from '../render/tierShapes.js';
import { DEPTH } from '../render/depths.js';
import { isDebugEnabled } from '../systems/debug.js';
import { submitScore } from '../systems/highScore.js';
import { BattleView } from './BattleView.js';

/**
 * Scène de jeu — grille de merge (Lot 1) + bande de combat (Lot 2).
 *
 * Cette scène ne contient **aucune règle** : elle affiche les modèles portés par
 * `GameSession`, lui transmet les gestes du joueur (`applyDrop`, `applyUnitDrop`), et met
 * en images ce qu'ils émettent sur le bus. Que la bande sature, qu'une fusion soit
 * refusée ou qu'une unité naisse d'une fusion : c'est la session qui décide, jamais elle.
 *
 * Le rendu de la moitié droite est délégué à `BattleView`, qui possède ses propres objets
 * d'affichage mais partage le layout et le bus.
 */

const COLORS = {
  background: 0x12141c,
  gridPanel: 0x191d2a,
  gridBorder: 0x4d96ff,
  cell: 0x1e2333,
  cellStroke: 0x2c3350,
  text: '#eef1f8',
  textDim: '#8f97b0',
};

/** Réglages d'interaction, purement de feel (le vrai polish arrive au Lot 3). */
const FEEL = {
  /** Agrandissement de l'item tenu, pour qu'il reste visible sous le doigt. */
  dragScale: 1.18,
  dragScaleMs: 110,
  returnMs: 170,
  spawnPopMs: 200,
  moveMs: 130,
  mergeAbsorbMs: 110,
  mergePopMs: 220,
  /** Tolérance de drop, en fraction de case, autour du centre de la case visée. */
  dropTolerance: 0.9,
  /** Délai au-delà duquel un pointeur « perdu » (drag interrompu) annule le drag. */
  lostPointerMs: 140,
  /** Sursaut des deux items quand une fusion est refusée par une bande saturée. */
  rejectMs: 90,
  rejectPx: 7,
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

    this.session = new GameSession({ balance });
    this.model = this.session.grid;
    this.bus = this.session.events;

    /** @type {Map<number, Phaser.GameObjects.Container>} vues d'items, par id d'item */
    this.views = new Map();
    /** Drag en cours, ou null. Un seul à la fois : le second doigt est ignoré. */
    this.dragState = null;
    this.pulseTween = null;
    this.spawnTimer = null;
    this.gameOverStarted = false;

    // Deux pointeurs suffisent : on n'autorise qu'un drag à la fois, mais il faut
    // pouvoir détecter (et neutraliser proprement) un second doigt.
    this.input.addPointer(2);

    this.buildDisplay();
    this.battleView = new BattleView(this, this.session);
    this.bindModel();
    this.bindInput();

    this.scale.on('resize', this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.teardown, this);

    const { width, height } = this.scale.gameSize;
    this.layout(width, height);

    this.session.start();
    this.scheduleSpawn(this.session.spawner.firstDelayMs());
  }

  // ------------------------------------------------------------------ affichage

  buildDisplay() {
    this.background = this.add
      .rectangle(0, 0, 10, 10, COLORS.background)
      .setOrigin(0, 0)
      .setDepth(DEPTH.background);

    this.title = this.add
      .text(0, 0, 'Merge Battler', {
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

  /** Texte net sur écran haute densité, sans exploser le fillrate au-delà de 2x. */
  textResolution() {
    return Math.min(window.devicePixelRatio || 1, 2);
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
      slotCount: this.session.battleConfig.slotCount,
      queueSize: this.session.battleConfig.queueSize,
    });
    this.layoutData = layout;

    this.background.setSize(width, height);

    const headerFont = Phaser.Math.Clamp(Math.round(Math.min(width, height) * 0.034), 11, 18);
    this.title.setFontSize(headerFont);
    // Plus petit que le titre : la ligne de debug est dense et partage la même rangée.
    this.debugText.setFontSize(Phaser.Math.Clamp(Math.round(headerFont * 0.78), 8, 14));
    const headerMiddle = layout.header.y + layout.header.height / 2;
    this.title.setPosition(layout.header.x, headerMiddle);
    this.debugText.setPosition(layout.header.x + layout.header.width, headerMiddle);

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
    this.bus.on('merge', (payload) => this.onModelMerge(payload));
    this.bus.on('full', () => this.startGridPulse());
    this.bus.on('unfull', () => this.stopGridPulse());
    this.bus.on('gameOver', (payload) => this.onGameOver(payload));
  }

  /**
   * Programme la prochaine apparition. Le spawner décide seul du délai : grille
   * pleine, il renvoie un délai court de re-vérification et le spawn reste en pause
   * (aucun item n'apparaît) jusqu'à ce qu'une case se libère.
   */
  scheduleSpawn(delayMs) {
    this.spawnTimer?.remove(false);
    this.spawnTimer = this.time.delayedCall(delayMs, () => {
      if (this.session.over) return;
      this.session.trySpawnItem();
      this.scheduleSpawn(this.session.spawner.nextDelayMs());
    });
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
      scale: 1,
      duration: FEEL.moveMs,
      ease: 'Quad.easeOut',
    });
  }

  onModelMerge(payload) {
    const [sourceItem, targetItem] = payload.consumed;
    const sourceView = this.views.get(sourceItem.id);
    const center = cellCenterAt(this.layoutData, payload.index);

    const finish = () => {
      this.destroyItemView(sourceItem.id);
      this.destroyItemView(targetItem.id);
      this.createItemView(payload.index, payload.item, { pop: FEEL.mergePopMs });
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
      scale: 0.5,
      duration: FEEL.mergeAbsorbMs,
      ease: 'Quad.easeIn',
      onComplete: finish,
    });
  }

  // ------------------------------------------------------------------ vues d'items

  /**
   * Crée la vue d'un item : un conteneur (forme + numéro de tier), draggable au
   * doigt comme à la souris.
   */
  createItemView(index, item, { pop = FEEL.spawnPopMs } = {}) {
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
    view.setData({ kind: 'item', itemId: item.id, index, tier: item.tier, shape, label });

    this.resizeItemView(view, layout.itemSize, layout.grid.cell);

    // Zone de saisie = la case entière, pas seulement la forme : au doigt, viser le
    // contour exact d'une étoile serait injouable.
    view.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, layout.grid.cell, layout.grid.cell),
      Phaser.Geom.Rectangle.Contains
    );
    this.input.setDraggable(view);

    this.views.set(item.id, view);

    if (pop > 0) {
      view.setScale(0.25);
      this.tweens.add({
        targets: view,
        scale: 1,
        duration: pop,
        ease: 'Back.easeOut',
      });
    }

    return view;
  }

  /** Redimensionne une vue (forme, numéro, zone de saisie) après un changement de layout. */
  resizeItemView(view, itemSize, cellSize) {
    const shape = view.getData('shape');
    const label = view.getData('label');

    drawTierShape(shape, view.getData('tier'), itemSize);
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
    this.input.on('dragstart', this.onDragStart, this);
    this.input.on('drag', this.onDragMove, this);
    this.input.on('dragend', this.onDragEnd, this);
  }

  onDragStart(pointer, view) {
    // Un seul objet en main à la fois : un second doigt qui en attrape un autre est
    // neutralisé (il repartira chez lui au relâcher) plutôt que de créer deux drags.
    if (this.dragState || this.session.over) {
      view.setData('dragIgnored', true);
      return;
    }

    const kind = view.getData('kind');
    this.dragState = {
      kind,
      view,
      pointer,
      fromIndex: kind === 'item' ? view.getData('index') : -1,
      fromSlot: kind === 'unit' ? this.battleView.slotOfView(view) : -1,
      lostSince: 0,
    };
    if (kind === 'unit') view.setData('dragging', true);

    this.tweens.killTweensOf(view);
    view.setDepth(DEPTH.drag);
    this.tweens.add({
      targets: view,
      scale: FEEL.dragScale,
      duration: FEEL.dragScaleMs,
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
      this.returnDragged(view, view.getData('kind'));
      return;
    }
    if (this.dragState?.view !== view) return;
    this.resolveDrop();
  }

  /** Applique le lâcher : la scène demande, la session décide. */
  resolveDrop() {
    const { view, kind, fromIndex, fromSlot } = this.dragState;
    this.dragState = null;
    view.setDepth(DEPTH.item);

    if (kind === 'unit') {
      view.setData('dragging', false);
      this.resolveUnitDrop(view, fromSlot);
      return;
    }

    const target = nearestCellIndex(this.layoutData, view.x, view.y, {
      tolerance: FEEL.dropTolerance,
    });
    const result =
      target === -1 ? { type: SESSION_DROP.INVALID } : this.session.applyDrop(fromIndex, target);

    if (result.type === SESSION_DROP.BLOCKED) {
      // Bande saturée : les deux items se repoussent, `BattleView` affiche le hint.
      this.returnHome(view, fromIndex);
      this.pushBack(this.views.get(this.model.itemAt(target)?.id));
      return;
    }

    // MERGE et MOVE sont déjà rendus par les écouteurs du bus ; tout le reste
    // (case occupée par un autre tier, tier max, lâcher hors grille) revient.
    if (result.type !== SESSION_DROP.MERGE && result.type !== SESSION_DROP.MOVE) {
      this.returnHome(view, fromIndex);
    }
  }

  resolveUnitDrop(view, fromSlot) {
    const zone = this.layoutData.battleZone;
    const target = nearestSlotIndex(zone, view.x, view.y);
    const result =
      target === -1
        ? { type: UNIT_DROP.INVALID }
        : this.session.applyUnitDrop(fromSlot, target);

    // MOVE, SWAP et MERGE sont rendus par `BattleView` via le bus ; le reste revient.
    if (result.type === UNIT_DROP.INVALID || result.type === UNIT_DROP.CANCEL) {
      this.battleView.returnUnitHome(view);
    }
  }

  /** Renvoie l'objet traîné chez lui, quelle que soit sa nature. */
  returnDragged(view, kind) {
    if (kind === 'unit') this.battleView.returnUnitHome(view);
    else this.returnHome(view);
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
      scale: 1,
      duration: FEEL.returnMs,
      ease: 'Back.easeOut',
    });
  }

  /** Petit sursaut de refus sur l'item resté en place. */
  pushBack(view) {
    if (!view?.active) return;
    const home = cellCenterAt(this.layoutData, view.getData('index'));
    this.tweens.killTweensOf(view);
    this.tweens.add({
      targets: view,
      x: home.x + FEEL.rejectPx,
      duration: FEEL.rejectMs,
      yoyo: true,
      repeat: 1,
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

    this.spawnTimer?.remove(false);
    this.spawnTimer = null;
    this.input.enabled = false;

    const { best, isRecord } = submitScore(wavesCleared);

    // Court délai : le dernier ennemi finit son animation avant que l'écran ne tombe.
    this.time.delayedCall(FEEL.gameOverDelayMs, () => {
      this.scene.launch('GameOverScene', { wavesCleared, best, isRecord });
      this.scene.pause();
    });
  }

  // ------------------------------------------------------------------ boucle

  update(time, delta) {
    this.session.update(delta);
    this.battleView.update(delta);
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
    if (time - drag.lostSince > FEEL.lostPointerMs) {
      this.dragState = null;
      drag.view.setDepth(DEPTH.item);
      if (drag.kind === 'unit') {
        drag.view.setData('dragging', false);
        this.battleView.returnUnitHome(drag.view);
      } else {
        this.returnHome(drag.view, drag.fromIndex);
      }
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
    // m = merges, t = ticks logiques, e = ennemis vivants, u = unités / slots.
    this.debugText.setText(
      `${Math.round(this.game.loop.actualFps)}fps m${hud.mergeCount} t${battle.tickCount} ` +
        `e${battle.enemies.length} u${battle.unitCount()}/${battle.slots.length}`
    );
  }

  teardown() {
    this.scale.off('resize', this.handleResize, this);
    this.input.off('dragstart', this.onDragStart, this);
    this.input.off('drag', this.onDragMove, this);
    this.input.off('dragend', this.onDragEnd, this);
    this.spawnTimer?.remove(false);
    this.spawnTimer = null;

    this.battleView?.destroy();
    this.session.destroy();
    // Le bus meurt avec la session : aucun écouteur ne survit à la partie, donc aucune
    // fuite d'un `rejouer` à l'autre.
    this.bus.clear();
    this.views.clear();
    this.input.enabled = true;
  }
}
