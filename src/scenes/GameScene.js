import Phaser from 'phaser';

import balance from '../config/balance.json';
import { GridModel, DROP } from '../systems/GridModel.js';
import { EventBus } from '../systems/eventBus.js';
import { ItemSpawner, parseSpawnerConfig } from '../systems/itemSpawner.js';
import { computeLayout, cellCenterAt, nearestCellIndex } from '../systems/layout.js';
import { drawTierShape, TIER_LABEL_COLOR } from '../render/tierShapes.js';

/**
 * Scène de jeu — Lot 1 : la grille de merge.
 *
 * Cette scène ne contient **aucune règle** : elle affiche `GridModel`, lui transmet
 * les gestes du joueur (`applyDrop`), et réagit aux événements qu'il émet. Toute la
 * logique testable vit dans `src/systems/` (cf. `CLAUDE.md`, section Architecture).
 *
 * La bande de combat n'existe pas encore : sa place est réservée par un placeholder
 * (à droite en paysage, en bas en portrait) pour que le Lot 2 n'ait pas à rebouger
 * l'écran.
 */

const COLORS = {
  background: 0x12141c,
  gridPanel: 0x191d2a,
  gridBorder: 0x4d96ff,
  cell: 0x1e2333,
  cellStroke: 0x2c3350,
  battlePanel: 0x161a26,
  battleStroke: 0x2c3350,
  text: '#eef1f8',
  textDim: '#8f97b0',
};

const DEPTH = { panel: 0, cell: 1, item: 5, drag: 20, hud: 30 };

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
};

const FONT = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

export default class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  create() {
    const spawnerConfig = parseSpawnerConfig(balance);

    this.bus = new EventBus();
    this.model = new GridModel({ maxTier: spawnerConfig.maxTier, bus: this.bus });
    this.spawner = new ItemSpawner({ config: spawnerConfig, model: this.model });

    /** @type {Map<number, Phaser.GameObjects.Container>} vues d'items, par id d'item */
    this.views = new Map();
    /** Drag en cours, ou null. Un seul à la fois : le second doigt est ignoré. */
    this.dragState = null;
    this.mergeCount = 0;
    this.lastMergeTier = 0;
    this.pulseTween = null;
    this.spawnTimer = null;

    // Deux pointeurs suffisent : on n'autorise qu'un drag à la fois, mais il faut
    // pouvoir détecter (et neutraliser proprement) un second doigt.
    this.input.addPointer(2);

    this.buildDisplay();
    this.bindModel();
    this.bindInput();

    this.scale.on('resize', this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.teardown, this);

    const { width, height } = this.scale.gameSize;
    this.layout(width, height);

    // L'écran ne doit jamais être vide au chargement.
    this.spawner.fillInitial();
    this.scheduleSpawn(this.spawner.firstDelayMs());
  }

  // ------------------------------------------------------------------ affichage

  buildDisplay() {
    this.background = this.add
      .rectangle(0, 0, 10, 10, COLORS.background)
      .setOrigin(0, 0)
      .setDepth(-10);

    this.title = this.add
      .text(0, 0, 'Merge Battler', {
        fontFamily: FONT,
        fontStyle: 'bold',
        color: COLORS.text,
      })
      .setOrigin(0, 0.5)
      .setDepth(DEPTH.hud)
      .setResolution(this.textResolution());

    // Compteur de debug : c'est le témoin visible du contrat `merge { tier }` que
    // consommera la bande de combat au Lot 2.
    this.mergeCounter = this.add
      .text(0, 0, '', {
        fontFamily: MONO,
        color: COLORS.textDim,
      })
      .setOrigin(1, 0.5)
      .setDepth(DEPTH.hud)
      .setResolution(this.textResolution());

    this.gridPanel = this.add.rectangle(0, 0, 10, 10, COLORS.gridPanel).setOrigin(0, 0);
    this.gridPanel.setDepth(DEPTH.panel);

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

    this.battlePanel = this.add
      .rectangle(0, 0, 10, 10, COLORS.battlePanel)
      .setOrigin(0, 0)
      .setStrokeStyle(1, COLORS.battleStroke, 1)
      .setDepth(DEPTH.panel);

    this.battleLabel = this.add
      .text(0, 0, 'Bande de combat\n— Lot 2 —', {
        fontFamily: FONT,
        color: COLORS.textDim,
        align: 'center',
      })
      .setOrigin(0.5, 0.5)
      .setDepth(DEPTH.cell);

    this.updateMergeCounter();
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
    });
    this.layoutData = layout;

    this.background.setSize(width, height);

    const headerFont = Phaser.Math.Clamp(Math.round(Math.min(width, height) * 0.034), 11, 18);
    this.title.setFontSize(headerFont);
    this.mergeCounter.setFontSize(headerFont);
    const headerMiddle = layout.header.y + layout.header.height / 2;
    this.title.setPosition(layout.header.x, headerMiddle);
    this.mergeCounter.setPosition(layout.header.x + layout.header.width, headerMiddle);

    const gridWidth = layout.grid.cell * layout.grid.cols;
    const gridHeight = layout.grid.cell * layout.grid.rows;
    this.gridPanel.setPosition(layout.grid.x, layout.grid.y).setSize(gridWidth, gridHeight);
    this.gridBorder.setPosition(layout.grid.x, layout.grid.y).setSize(gridWidth, gridHeight);

    const cellSize = layout.grid.cell * 0.94;
    this.cellViews.forEach((cellView, index) => {
      const center = cellCenterAt(layout, index);
      cellView.setPosition(center.x, center.y).setSize(cellSize, cellSize);
    });

    this.battlePanel
      .setPosition(layout.battle.x, layout.battle.y)
      .setSize(layout.battle.width, layout.battle.height);
    this.battleLabel
      .setFontSize(Phaser.Math.Clamp(Math.round(Math.min(width, height) * 0.032), 11, 17))
      .setWordWrapWidth(Math.max(40, layout.battle.width - 16))
      .setPosition(
        layout.battle.x + layout.battle.width / 2,
        layout.battle.y + layout.battle.height / 2
      );

    this.refreshItemViews();
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
  }

  /**
   * Programme la prochaine apparition. Le spawner décide seul du délai : grille
   * pleine, il renvoie un délai court de re-vérification et le spawn reste en pause
   * (aucun item n'apparaît) jusqu'à ce qu'une case se libère.
   */
  scheduleSpawn(delayMs) {
    this.spawnTimer?.remove(false);
    this.spawnTimer = this.time.delayedCall(delayMs, () => {
      this.spawner.trySpawn();
      this.scheduleSpawn(this.spawner.nextDelayMs());
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
    this.mergeCount += 1;
    this.lastMergeTier = payload.tier;
    this.updateMergeCounter();

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

  updateMergeCounter() {
    const tier = this.lastMergeTier === 0 ? '—' : this.lastMergeTier;
    this.mergeCounter.setText(`Merges: ${this.mergeCount} (dernier tier: ${tier})`);
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
    view.setData({ itemId: item.id, index, tier: item.tier, shape, label });

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
    // Un seul item en main à la fois : un second doigt qui attrape un autre item est
    // neutralisé (il repartira à sa case au relâcher) plutôt que de créer deux drags.
    if (this.dragState) {
      view.setData('dragIgnored', true);
      return;
    }

    this.dragState = {
      view,
      itemId: view.getData('itemId'),
      fromIndex: view.getData('index'),
      pointer,
      lostSince: 0,
    };

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
    // L'item reste dans l'écran même si le doigt en sort : sinon il devient
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

  /** Applique le lâcher : la scène demande, le modèle décide. */
  resolveDrop() {
    const { view, fromIndex } = this.dragState;
    this.dragState = null;
    view.setDepth(DEPTH.item);

    const target = nearestCellIndex(this.layoutData, view.x, view.y, {
      tolerance: FEEL.dropTolerance,
    });
    const result =
      target === -1 ? { type: DROP.INVALID } : this.model.applyDrop(fromIndex, target);

    // MERGE et MOVE sont déjà rendus par les écouteurs du bus ; tout le reste
    // (case occupée par un autre tier, tier max, lâcher hors grille) revient.
    if (result.type !== DROP.MERGE && result.type !== DROP.MOVE) {
      this.returnHome(view, fromIndex);
    }
  }

  /** Ramène une vue à la case que lui donne le modèle. */
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

  // ------------------------------------------------------------------ boucle

  update(time) {
    const drag = this.dragState;
    if (!drag) return;

    // Filet de sécurité : si un `dragend` se perd (doigt sorti de la page, onglet
    // masqué, changement d'orientation), l'item ne doit pas rester collé au vide.
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
      this.returnHome(drag.view, drag.fromIndex);
    }
  }

  teardown() {
    this.scale.off('resize', this.handleResize, this);
    this.input.off('dragstart', this.onDragStart, this);
    this.input.off('drag', this.onDragMove, this);
    this.input.off('dragend', this.onDragEnd, this);
    this.spawnTimer?.remove(false);
    this.bus.clear();
    this.views.clear();
  }
}
