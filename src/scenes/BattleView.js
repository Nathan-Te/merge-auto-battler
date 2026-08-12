import Phaser from 'phaser';

import { cellCenterAt, lanePoint } from '../systems/layout.js';
import { drawTierShape, TIER_LABEL_COLOR } from '../render/tierShapes.js';
import { drawUnitShape, drawEnemyShape, enemySize, unitColor } from '../render/battleShapes.js';
import { DEPTH } from '../render/depths.js';

/**
 * Rendu de la bande de combat — **aucune règle de gameplay**.
 *
 * La vue s'abonne aux événements de `BattleModel` (via le bus de la session) et met en
 * images ce qu'ils décrivent ; entre deux ticks logiques, elle **interpole** la position
 * des ennemis avec `model.alpha`, ce qui donne un mouvement fluide à 60 fps au-dessus
 * d'une simulation à 10 Hz.
 *
 * Ce n'est pas une scène Phaser : c'est un objet de rendu possédé par `GameScene`, qui
 * lui transmet les gestes du joueur et le relayoute à chaque `resize`.
 */

const COLORS = {
  panel: 0x161a26,
  panelStroke: 0x2c3350,
  lane: 0x11141d,
  laneStroke: 0x2c3350,
  slot: 0x1e2333,
  slotStroke: 0x333b5c,
  slotBlocked: 0x5a2b34,
  base: 0x2c3350,
  baseFill: 0x6bcb77,
  baseFillLow: 0xff6b6b,
  queue: 0x1a1f2e,
  text: '#eef1f8',
  textDim: '#8f97b0',
  textWarn: '#ff9f43',
  enemyHpBg: 0x14161f,
  enemyHpFill: 0xff6b6b,
};

const FONT = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

/** Réglages de feel du rendu de combat (le polish complet est au Lot 3). */
const FEEL = {
  flightMs: 320,
  unitPopMs: 200,
  tracerMs: 140,
  bannerMs: 900,
  hintMs: 1100,
  hitFlashMs: 90,
};

export class BattleView {
  /**
   * @param {Phaser.Scene} scene
   * @param {import('../systems/GameSession.js').GameSession} session
   */
  constructor(scene, session) {
    this.scene = scene;
    this.session = session;
    this.model = session.battle;
    this.config = session.battleConfig;

    /** @type {Map<number, Phaser.GameObjects.Container>} vues d'ennemis, par id */
    this.enemyViews = new Map();
    /** @type {Map<number, Phaser.GameObjects.Container>} vues d'unités, par id */
    this.unitViews = new Map();
    /** @type {Map<number, Phaser.GameObjects.Container>} vues des unités en file, par id */
    this.queueViews = new Map();
    /** @type {{from: object, to: object, color: number, age: number, splash: number}[]} */
    this.tracers = [];
    this.unsubscribes = [];
    this.layoutData = null;

    this.build();
    this.bind(session.events);
  }

  get zone() {
    return this.layoutData?.battleZone ?? null;
  }

  textResolution() {
    return Math.min(window.devicePixelRatio || 1, 2);
  }

  // ------------------------------------------------------------------ construction

  build() {
    const scene = this.scene;

    this.panel = scene.add
      .rectangle(0, 0, 10, 10, COLORS.panel)
      .setOrigin(0, 0)
      .setStrokeStyle(1, COLORS.panelStroke, 1)
      .setDepth(DEPTH.panel);

    this.laneRect = scene.add
      .rectangle(0, 0, 10, 10, COLORS.lane)
      .setOrigin(0, 0)
      .setStrokeStyle(1, COLORS.laneStroke, 1)
      .setDepth(DEPTH.cell);

    this.baseRect = scene.add
      .rectangle(0, 0, 10, 10, COLORS.base)
      .setOrigin(0, 0)
      .setStrokeStyle(1, COLORS.panelStroke, 1)
      .setDepth(DEPTH.cell);
    this.baseFill = scene.add.rectangle(0, 0, 10, 10, COLORS.baseFill).setDepth(DEPTH.cell + 1);

    /** @type {Phaser.GameObjects.Rectangle[]} fonds de slots, un par slot du modèle */
    this.slotViews = this.model.slots.map(() =>
      scene.add
        .rectangle(0, 0, 10, 10, COLORS.slot)
        .setStrokeStyle(1, COLORS.slotStroke, 1)
        .setDepth(DEPTH.cell)
    );

    /** @type {Phaser.GameObjects.Rectangle[]} cases de la file d'attente */
    this.queueSlotViews = Array.from({ length: this.config.queueSize }, () =>
      scene.add
        .rectangle(0, 0, 10, 10, COLORS.queue)
        .setStrokeStyle(1, COLORS.slotStroke, 1)
        .setDepth(DEPTH.cell)
    );

    this.tracerGraphics = scene.add.graphics().setDepth(DEPTH.tracer);

    // Deux lignes de HUD, deux ancrages par ligne : rien ne peut se chevaucher, même
    // sur un écran de 320 px de large.
    const dim = { fontFamily: FONT, color: COLORS.textDim };
    this.hpText = scene.add.text(0, 0, '', { ...dim, color: COLORS.text }).setDepth(DEPTH.hud);
    this.waveText = scene.add.text(0, 0, '', dim).setOrigin(1, 0).setDepth(DEPTH.hud);
    this.queueText = scene.add.text(0, 0, 'File', dim).setOrigin(0, 0.5).setDepth(DEPTH.hud);
    this.nextText = scene.add.text(0, 0, '', dim).setOrigin(1, 0.5).setDepth(DEPTH.hud);

    this.banner = scene.add
      .text(0, 0, '', { fontFamily: FONT, fontStyle: 'bold', color: COLORS.text })
      .setOrigin(0.5, 0.5)
      .setAlpha(0)
      .setDepth(DEPTH.banner);

    this.hint = scene.add
      .text(0, 0, 'Fusionne tes unités !', {
        fontFamily: FONT,
        fontStyle: 'bold',
        color: COLORS.textWarn,
      })
      .setOrigin(0.5, 0.5)
      .setAlpha(0)
      .setDepth(DEPTH.banner);

    for (const text of [this.hpText, this.waveText, this.nextText, this.queueText, this.banner, this.hint]) {
      text.setResolution(this.textResolution());
    }
  }

  // ------------------------------------------------------------------ layout

  layout(layoutData) {
    this.layoutData = layoutData;
    const zone = layoutData.battleZone;
    const { battle } = layoutData;

    this.panel.setPosition(battle.x, battle.y).setSize(battle.width, battle.height);
    this.laneRect.setPosition(zone.lane.x, zone.lane.y).setSize(zone.lane.width, zone.lane.height);
    this.baseRect.setPosition(zone.base.x, zone.base.y).setSize(zone.base.width, zone.base.height);

    this.slotViews.forEach((view, index) => {
      const slot = zone.slots[index];
      view.setPosition(slot.x, slot.y).setSize(slot.size, slot.size);
    });
    this.queueSlotViews.forEach((view, index) => {
      const cell = zone.queue[index];
      view.setPosition(cell.x, cell.y).setSize(cell.size, cell.size);
    });

    // La police tient compte de la largeur : « PV 100/100 » et « Vague 12 » doivent
    // cohabiter sur une ligne, même sur le plus petit écran visé.
    const hudFont = Phaser.Math.Clamp(
      Math.round(Math.min(zone.hud.height * 0.62, zone.hud.width * 0.06)),
      9,
      18
    );
    const smallFont = Phaser.Math.Clamp(Math.round(hudFont * 0.88), 8, 16);

    this.hpText.setFontSize(hudFont).setPosition(zone.hud.x, zone.hud.y);
    this.waveText.setFontSize(hudFont).setPosition(zone.hud.x + zone.hud.width, zone.hud.y);
    this.queueText.setFontSize(smallFont).setPosition(zone.queueLabel.x, zone.queueLabel.y);
    this.nextText
      .setFontSize(smallFont)
      .setPosition(zone.hud.x + zone.hud.width, zone.queueLabel.y);

    const bannerFont = Phaser.Math.Clamp(Math.round(zone.laneThickness * 0.4), 14, 34);
    const laneCenter = lanePoint(zone, 0.5);
    this.banner.setFontSize(bannerFont).setPosition(laneCenter.x, laneCenter.y);
    this.hint
      .setFontSize(Phaser.Math.Clamp(Math.round(bannerFont * 0.62), 10, 20))
      .setWordWrapWidth(Math.max(60, zone.lane.width))
      .setPosition(laneCenter.x, laneCenter.y);

    this.refreshBaseBar();
    this.refreshUnitViews();
    this.refreshQueueViews();
    this.refreshEnemyViews();
    this.refreshHud();
  }

  /** Taille de la zone de saisie d'une unité : l'écart entre deux slots, au minimum. */
  grabSize() {
    const zone = this.zone;
    return Math.max(zone.slotSize, zone.slotPitch * 0.98);
  }

  refreshUnitViews() {
    const zone = this.zone;
    if (!zone) return;
    for (const unit of this.model.slots) {
      if (!unit) continue;
      const view = this.unitViews.get(unit.id);
      if (!view) continue;
      this.resizeUnitView(view, zone.unitSize, this.grabSize());
      if (view.getData('dragging')) continue;
      const slot = zone.slots[unit.slot];
      view.setPosition(slot.x, slot.y);
    }
  }

  refreshQueueViews() {
    const zone = this.zone;
    if (!zone) return;
    this.model.pending.forEach((unit, position) => {
      const view = this.queueViews.get(unit.id);
      if (!view) return;
      const cell = zone.queue[position] ?? zone.queue[zone.queue.length - 1];
      this.resizeUnitView(view, cell.size * 0.86, cell.size);
      view.setPosition(cell.x, cell.y);
    });
  }

  refreshEnemyViews() {
    const zone = this.zone;
    if (!zone) return;
    for (const enemy of this.model.enemies) {
      const view = this.enemyViews.get(enemy.id);
      if (view) this.resizeEnemyView(view, enemy);
    }
  }

  // ------------------------------------------------------------------ abonnements

  bind(bus) {
    const on = (type, handler) => this.unsubscribes.push(bus.on(type, handler));

    on('enemySpawn', ({ enemy }) => this.createEnemyView(enemy));
    on('enemyDeath', ({ enemy }) => this.popEnemyView(enemy, { leaked: false }));
    on('enemyLeak', ({ enemy }) => this.popEnemyView(enemy, { leaked: true }));
    on('baseDamage', () => this.onBaseDamage());
    on('shot', (payload) => this.onShot(payload));

    on('unitSpawn', ({ unit, slot, origin }) => this.onUnitSpawn(unit, slot, origin));
    on('unitQueued', ({ unit, position, origin }) => this.onUnitQueued(unit, position, origin));
    on('unitMove', ({ unit }) => this.moveUnitView(unit));
    on('unitSwap', ({ source, target }) => {
      this.moveUnitView(source);
      this.moveUnitView(target);
    });
    on('unitMerge', (payload) => this.onUnitMerge(payload));

    on('waveStart', ({ wave }) => this.showBanner(`Vague ${wave}`));
    on('waveCountdown', ({ wave }) => {
      if (wave > 1) this.showBanner(`Vague ${wave}\nen approche`);
    });
    on('mergeBlocked', () => this.showBlockedHint());
    on('unitRejected', () => this.showBlockedHint());
  }

  // ------------------------------------------------------------------ ennemis

  createEnemyView(enemy) {
    const zone = this.zone;
    if (!zone) return null;

    const shape = this.scene.add.graphics();
    const hpBg = this.scene.add.rectangle(0, 0, 10, 3, COLORS.enemyHpBg).setOrigin(0, 0.5);
    const hpFill = this.scene.add.rectangle(0, 0, 10, 3, COLORS.enemyHpFill).setOrigin(0, 0.5);

    const view = this.scene.add.container(0, 0, [shape, hpBg, hpFill]);
    view.setDepth(DEPTH.enemy);
    view.setData({ enemyId: enemy.id, shape, hpBg, hpFill });

    this.enemyViews.set(enemy.id, view);
    this.resizeEnemyView(view, enemy);
    this.positionEnemyView(view, enemy, 1);

    view.setScale(0.4);
    this.scene.tweens.add({ targets: view, scale: 1, duration: 160, ease: 'Back.easeOut' });
    return view;
  }

  resizeEnemyView(view, enemy) {
    const zone = this.zone;
    const size = enemySize(enemy.type, zone.enemyReference);
    drawEnemyShape(view.getData('shape'), enemy.type, size, { horizontal: zone.horizontal });

    const barWidth = size * 1.1;
    const barHeight = Math.max(2, size * 0.13);
    const barY = -size * 0.78;
    view.getData('hpBg').setPosition(-barWidth / 2, barY).setSize(barWidth, barHeight);
    view.getData('hpFill').setPosition(-barWidth / 2, barY).setSize(barWidth, barHeight);
    view.setData('barWidth', barWidth);
  }

  positionEnemyView(view, enemy, alpha) {
    const zone = this.zone;
    const progress = enemy.prevProgress + (enemy.progress - enemy.prevProgress) * alpha;
    const point = lanePoint(zone, progress / this.config.laneLength);
    view.setPosition(point.x, point.y);

    const ratio = Phaser.Math.Clamp(enemy.hp / enemy.maxHp, 0, 1);
    const hpFill = view.getData('hpFill');
    hpFill.width = view.getData('barWidth') * ratio;
    hpFill.setVisible(ratio < 1);
    view.getData('hpBg').setVisible(ratio < 1);
  }

  /**
   * Retire la vue d'un ennemi : il implose s'il a été tué, il gonfle s'il a atteint la
   * base — deux issues opposées, deux animations opposées.
   */
  popEnemyView(enemy, { leaked = false } = {}) {
    const view = this.enemyViews.get(enemy.id);
    if (!view) return;
    this.enemyViews.delete(enemy.id);

    this.scene.tweens.killTweensOf(view);
    this.scene.tweens.add({
      targets: view,
      scale: leaked ? 1.6 : 0.2,
      alpha: 0,
      duration: 180,
      ease: 'Quad.easeOut',
      onComplete: () => view.destroy(),
    });
  }

  onBaseDamage() {
    this.refreshBaseBar();
    this.baseRect.setFillStyle(0x7a3341, 1);
    this.scene.time.delayedCall(220, () => {
      if (this.baseRect.active) this.baseRect.setFillStyle(COLORS.base, 1);
    });
  }

  refreshBaseBar() {
    const zone = this.zone;
    if (!zone) return;
    const ratio = Phaser.Math.Clamp(this.model.baseHp / this.model.maxBaseHp, 0, 1);
    const { base } = zone;
    const inset = 3;
    const fullHeight = Math.max(1, base.height - inset * 2);
    const height = fullHeight * ratio;

    this.baseFill
      .setFillStyle(ratio > 0.35 ? COLORS.baseFill : COLORS.baseFillLow, 1)
      .setSize(Math.max(1, base.width - inset * 2), Math.max(0, height))
      // La jauge se vide par le haut : le bloc « base » se consume, c'est lisible même
      // du coin de l'œil pendant qu'on manipule la grille.
      .setPosition(base.x + base.width / 2, base.y + base.height - inset - height / 2)
      .setVisible(height > 0);
  }

  // ------------------------------------------------------------------ tirs

  onShot({ from, target, hits, role, splashRadius, unit }) {
    const zone = this.zone;
    if (!zone) return;

    this.tracers.push({
      from: lanePoint(zone, from / this.config.laneLength),
      to: lanePoint(zone, target.progress / this.config.laneLength),
      color: unitColor(unit.type),
      age: 0,
      splash: role === 'aoe' ? (splashRadius / this.config.laneLength) * zone.laneLengthPx : 0,
    });

    for (const hit of hits) {
      const view = this.enemyViews.get(hit.enemy.id);
      if (!view || hit.killed) continue;
      this.scene.tweens.killTweensOf(view.getData('shape'));
      view.getData('shape').setAlpha(0.45);
      this.scene.tweens.add({
        targets: view.getData('shape'),
        alpha: 1,
        duration: FEEL.hitFlashMs,
      });
    }
  }

  drawTracers(deltaMs) {
    const graphics = this.tracerGraphics;
    graphics.clear();
    if (this.tracers.length === 0) return;

    for (let i = this.tracers.length - 1; i >= 0; i -= 1) {
      const tracer = this.tracers[i];
      tracer.age += deltaMs;
      const life = 1 - tracer.age / FEEL.tracerMs;
      if (life <= 0) {
        this.tracers.splice(i, 1);
        continue;
      }

      graphics.lineStyle(Math.max(1, 3 * life), tracer.color, life);
      graphics.lineBetween(tracer.from.x, tracer.from.y, tracer.to.x, tracer.to.y);
      if (tracer.splash > 0) {
        graphics.strokeCircle(tracer.to.x, tracer.to.y, tracer.splash * (1.1 - life * 0.6));
      }
    }
  }

  // ------------------------------------------------------------------ unités

  onUnitSpawn(unit, slot, origin) {
    // L'unité pouvait attendre en file : sa vignette de file cède la place à sa vraie vue.
    this.releaseQueueView(unit.id);
    const view = this.createUnitView(unit);
    if (!view) return;

    const target = this.zone.slots[slot];
    const start = this.flightOrigin(origin);
    if (!start) {
      this.revealUnit(view);
      return;
    }

    // Le vol grille → bande : c'est le lien que le seed doc veut lisible en permanence.
    view.setPosition(target.x, target.y).setScale(0).setVisible(true);
    this.flight(start, target, unit, () => this.revealUnit(view));
  }

  onUnitQueued(unit, position, origin) {
    const zone = this.zone;
    const cell = zone.queue[position] ?? zone.queue[zone.queue.length - 1];
    const view = this.createUnitView(unit, { size: cell.size * 0.86, hitSize: cell.size });
    if (!view) return;
    this.queueViews.set(unit.id, view);
    this.unitViews.delete(unit.id);
    // Une unité en file n'est pas manipulable : elle attend son slot.
    view.disableInteractive();

    const start = this.flightOrigin(origin);
    view.setPosition(cell.x, cell.y).setScale(0).setVisible(true);
    if (!start) {
      this.revealUnit(view);
      return;
    }
    this.flight(start, cell, unit, () => this.revealUnit(view));
  }

  /** Point de départ d'un vol, d'après l'`origin` transmis par le modèle. */
  flightOrigin(origin) {
    if (!origin || !this.layoutData) return null;
    if (origin.kind === 'merge' && Number.isInteger(origin.gridIndex)) {
      return cellCenterAt(this.layoutData, origin.gridIndex);
    }
    if (origin.kind === 'queue') {
      // L'unité sort de la file : elle part de la première case de la file.
      return this.zone.queue[0];
    }
    return null;
  }

  /** Objet volant temporaire : la forme de l'item de la grille, qui rejoint la bande. */
  flight(from, to, unit, onComplete) {
    const zone = this.zone;
    const shape = this.scene.add.graphics().setDepth(DEPTH.flight);
    drawTierShape(shape, unit.tier, this.layoutData.itemSize);

    const flyer = this.scene.add.container(from.x, from.y, [shape]).setDepth(DEPTH.flight);

    this.scene.tweens.add({
      targets: flyer,
      x: to.x,
      y: to.y,
      scale: (zone.unitSize / Math.max(1, this.layoutData.itemSize)) * 0.9,
      duration: FEEL.flightMs,
      ease: 'Cubic.easeIn',
      onComplete: () => {
        flyer.destroy();
        onComplete?.();
      },
    });
  }

  createUnitView(unit, { size, hitSize } = {}) {
    const zone = this.zone;
    if (!zone) return null;

    const shape = this.scene.add.graphics();
    const label = this.scene.add
      .text(0, 0, String(unit.tier), {
        fontFamily: FONT,
        fontStyle: 'bold',
        color: TIER_LABEL_COLOR,
      })
      .setOrigin(0.5, 0.5)
      .setResolution(this.textResolution());
    const star = this.scene.add
      .text(0, 0, '★', { fontFamily: FONT, color: '#ffd93d' })
      .setOrigin(0.5, 0.5)
      .setVisible(false)
      .setResolution(this.textResolution());

    const view = this.scene.add.container(0, 0, [shape, label, star]);
    view.setDepth(DEPTH.item).setVisible(false);
    view.setData({ kind: 'unit', unitId: unit.id, unit, shape, label, star });

    const grab = hitSize ?? this.grabSize();
    this.resizeUnitView(view, size ?? zone.unitSize, grab);
    view.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, grab, grab),
      Phaser.Geom.Rectangle.Contains
    );
    this.scene.input.setDraggable(view);

    this.unitViews.set(unit.id, view);
    return view;
  }

  resizeUnitView(view, size, hitSize) {
    const unit = view.getData('unit');
    drawUnitShape(view.getData('shape'), unit.type, unit.tier, size, { buffed: unit.buffed });

    const label = view.getData('label');
    label.setText(String(unit.tier)).setFontSize(Math.max(8, Math.round(size * 0.42)));
    label.setColor(unit.buffed ? '#14161f' : TIER_LABEL_COLOR);

    const star = view.getData('star');
    star
      .setVisible(unit.buffed)
      .setFontSize(Math.max(8, Math.round(size * 0.34)))
      .setPosition(0, -size * 0.52);

    view.setSize(hitSize, hitSize);
    // Même piège que sur la grille : la zone de saisie d'un conteneur se décrit depuis
    // son coin haut-gauche (Phaser ajoute `displayOrigin` avant le test).
    if (view.input?.hitArea) view.input.hitArea.setTo(0, 0, hitSize, hitSize);
  }

  revealUnit(view) {
    if (!view.active) return;
    view.setVisible(true).setScale(0.3);
    this.scene.tweens.add({
      targets: view,
      scale: 1,
      duration: FEEL.unitPopMs,
      ease: 'Back.easeOut',
    });
  }

  moveUnitView(unit) {
    const view = this.unitViews.get(unit.id);
    const zone = this.zone;
    if (!view || !zone) return;
    const slot = zone.slots[unit.slot];
    this.scene.tweens.killTweensOf(view);
    this.scene.tweens.add({
      targets: view,
      x: slot.x,
      y: slot.y,
      scale: 1,
      duration: 150,
      ease: 'Quad.easeOut',
    });
  }

  onUnitMerge({ slot, unit, consumed }) {
    const [source] = consumed;
    const zone = this.zone;
    const target = zone.slots[slot];

    const sourceView = this.unitViews.get(source.id);
    if (sourceView) {
      this.unitViews.delete(source.id);
      this.scene.tweens.killTweensOf(sourceView);
      this.scene.tweens.add({
        targets: sourceView,
        x: target.x,
        y: target.y,
        scale: 0.3,
        alpha: 0,
        duration: 140,
        ease: 'Quad.easeIn',
        onComplete: () => sourceView.destroy(),
      });
    }

    const view = this.unitViews.get(unit.id);
    if (view) {
      this.resizeUnitView(view, zone.unitSize, this.grabSize());
      this.scene.tweens.add({
        targets: view,
        scale: { from: 1.35, to: 1 },
        duration: 260,
        ease: 'Back.easeOut',
      });
    }
    // Une unité sortie de la file a pu prendre le slot libéré : on resynchronise.
    this.refreshQueueViews();
  }

  /** Retire la vue d'une unité qui quitte la file pour un slot. */
  releaseQueueView(unitId) {
    const view = this.queueViews.get(unitId);
    if (!view) return;
    this.queueViews.delete(unitId);
    this.scene.tweens.killTweensOf(view);
    view.destroy();
  }

  // ------------------------------------------------------------------ gestes

  /** Slot d'origine d'une vue d'unité en cours de drag. */
  slotOfView(view) {
    const unit = view.getData('unit');
    return unit ? unit.slot : -1;
  }

  /** Ramène une vue d'unité à son slot. */
  returnUnitHome(view) {
    const unit = view.getData('unit');
    const zone = this.zone;
    if (!view.active || !unit || !zone) return;
    const slot = zone.slots[unit.slot] ?? zone.slots[0];
    this.scene.tweens.killTweensOf(view);
    this.scene.tweens.add({
      targets: view,
      x: slot.x,
      y: slot.y,
      scale: 1,
      duration: 170,
      ease: 'Back.easeOut',
    });
  }

  // ------------------------------------------------------------------ feedback

  showBanner(text) {
    this.banner.setText(text).setAlpha(0).setScale(0.7);
    this.scene.tweens.killTweensOf(this.banner);
    this.scene.tweens.add({
      targets: this.banner,
      alpha: { from: 0, to: 1 },
      scale: 1,
      duration: 180,
      ease: 'Back.easeOut',
      yoyo: true,
      hold: FEEL.bannerMs,
    });
  }

  /** Feedback du refus de fusion : la bande crie qu'elle sature. */
  showBlockedHint() {
    this.scene.tweens.killTweensOf(this.hint);
    this.hint.setAlpha(1).setScale(1);
    this.scene.tweens.add({
      targets: this.hint,
      alpha: 0,
      duration: FEEL.hintMs,
      ease: 'Quad.easeIn',
    });

    for (const view of this.queueSlotViews) view.setFillStyle(COLORS.slotBlocked, 1);
    this.scene.time.delayedCall(FEEL.hintMs * 0.6, () => {
      for (const view of this.queueSlotViews) {
        if (view.active) view.setFillStyle(COLORS.queue, 1);
      }
    });
  }

  // ------------------------------------------------------------------ boucle

  update(deltaMs) {
    const zone = this.zone;
    if (!zone) return;

    const alpha = this.model.alpha;
    for (const enemy of this.model.enemies) {
      const view = this.enemyViews.get(enemy.id);
      if (view) this.positionEnemyView(view, enemy, alpha);
    }

    this.drawTracers(deltaMs);
    this.refreshBaseBar();
    this.refreshHud();
    this.syncQueueViews();
  }

  /** Les vues de file suivent l'état du modèle (une unité peut en être sortie au tick). */
  syncQueueViews() {
    if (this.queueViews.size === 0) return;
    const pendingIds = new Set(this.model.pending.map((unit) => unit.id));
    for (const id of [...this.queueViews.keys()]) {
      if (!pendingIds.has(id)) this.releaseQueueView(id);
    }
    this.refreshQueueViews();
  }

  refreshHud() {
    const hud = this.session.hud();
    // Le HUD est relu à chaque frame mais n'écrit que sur changement : `setText` force
    // un re-rendu de texture, inutile 60 fois par seconde pour un compteur qui bouge peu.
    const signature = `${Math.ceil(hud.baseHp)}|${hud.wave}|${hud.nextUnitLabel}|${hud.queueLength}|${hud.blocked}`;
    if (signature === this.hudSignature) return;
    this.hudSignature = signature;

    this.hpText.setText(`PV ${Math.ceil(hud.baseHp)}/${hud.maxBaseHp}`);
    this.waveText.setText(hud.wave === 0 ? 'Préparation' : `Vague ${hud.wave}`);
    this.nextText.setText(`→ ${hud.nextUnitLabel}`);
    this.queueText.setText(`File ${hud.queueLength}/${hud.queueSize}`);
    this.queueText.setColor(hud.blocked ? COLORS.textWarn : COLORS.textDim);
  }

  // ------------------------------------------------------------------ fin de vie

  destroy() {
    for (const off of this.unsubscribes) off();
    this.unsubscribes = [];
    for (const view of [...this.enemyViews.values(), ...this.unitViews.values(), ...this.queueViews.values()]) {
      this.scene.tweens.killTweensOf(view);
      view.destroy();
    }
    this.enemyViews.clear();
    this.unitViews.clear();
    this.queueViews.clear();
    this.tracers.length = 0;
  }
}

export default BattleView;
