import Phaser from 'phaser';

import { cellCenterAt, lanePoint } from '../systems/layout.js';
import { drawTierShape, TIER_LABEL_COLOR } from '../render/tierShapes.js';
import { drawUnitShape, drawEnemyShape, enemySize, unitColor } from '../render/battleShapes.js';
import { DEPTH } from '../render/depths.js';

/**
 * Rendu du champ de bataille et de la file de déploiement — **aucune règle de gameplay**.
 *
 * La vue s'abonne aux événements de `BattleModel` et de `DeployQueue` (via le bus de la
 * session) et met en images ce qu'ils décrivent ; entre deux ticks logiques, elle
 * **interpole** la position des deux camps avec `model.alpha`, ce qui donne un mouvement
 * fluide à 60 fps au-dessus d'une simulation à 10 Hz.
 *
 * Ce n'est pas une scène Phaser : c'est un objet de rendu possédé par `GameScene`, qui le
 * relayoute à chaque `resize`. Depuis le Lot 2.5, la vue ne reçoit plus aucun geste : on
 * ne manipule plus rien sur la bande, tout se joue sur la grille.
 */

const COLORS = {
  panel: 0x161a26,
  panelStroke: 0x2c3350,
  lane: 0x11141d,
  laneStroke: 0x2c3350,
  slot: 0x1e2333,
  slotStroke: 0x333b5c,
  slotHead: 0x28304a,
  slotBlocked: 0x5a2b34,
  gauge: 0x4d96ff,
  gaugeReady: 0x6bcb77,
  base: 0x2c3350,
  baseFill: 0x6bcb77,
  baseFillLow: 0xff6b6b,
  text: '#eef1f8',
  textDim: '#8f97b0',
  textWarn: '#ff9f43',
  hpBg: 0x14161f,
  enemyHpFill: 0xff6b6b,
  unitHpFill: 0x6bcb77,
};

const FONT = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

/** Réglages de feel du rendu de combat (le polish complet est au Lot 3). */
const FEEL = {
  flightMs: 300,
  unitPopMs: 200,
  tracerMs: 140,
  bannerMs: 900,
  hintMs: 1100,
  hitFlashMs: 90,
  slotShiftMs: 160,
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
    this.queue = session.deployQueue;
    this.config = session.battleConfig;

    /** @type {Map<number, Phaser.GameObjects.Container>} vues d'ennemis, par id */
    this.enemyViews = new Map();
    /** @type {Map<number, Phaser.GameObjects.Container>} vues d'unités au combat, par id */
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

    /** @type {Phaser.GameObjects.Rectangle[]} fonds des slots de déploiement */
    this.slotViews = Array.from({ length: this.config.slotCount }, (_, index) =>
      scene.add
        .rectangle(0, 0, 10, 10, index === 0 ? COLORS.slotHead : COLORS.slot)
        .setStrokeStyle(1, COLORS.slotStroke, 1)
        .setDepth(DEPTH.cell)
    );

    // Jauge de sortie : un liseré qui se remplit sous le slot de tête. C'est le seul
    // repère de rythme du jeu, il doit être lisible du coin de l'œil.
    this.gaugeBg = scene.add.rectangle(0, 0, 10, 3, COLORS.hpBg).setOrigin(0, 0.5).setDepth(DEPTH.hud);
    this.gauge = scene.add.rectangle(0, 0, 10, 3, COLORS.gauge).setOrigin(0, 0.5).setDepth(DEPTH.hud);

    this.tracerGraphics = scene.add.graphics().setDepth(DEPTH.tracer);

    // Deux lignes de HUD, deux ancrages par ligne : rien ne peut se chevaucher, même
    // sur un écran de 320 px de large.
    const dim = { fontFamily: FONT, color: COLORS.textDim };
    this.hpText = scene.add.text(0, 0, '', { ...dim, color: COLORS.text }).setDepth(DEPTH.hud);
    this.waveText = scene.add.text(0, 0, '', dim).setOrigin(1, 0).setDepth(DEPTH.hud);
    this.queueText = scene.add.text(0, 0, '', dim).setOrigin(0, 1).setDepth(DEPTH.hud);
    this.nextText = scene.add.text(0, 0, '', dim).setOrigin(1, 1).setDepth(DEPTH.hud);

    this.banner = scene.add
      .text(0, 0, '', { fontFamily: FONT, fontStyle: 'bold', color: COLORS.text })
      .setOrigin(0.5, 0.5)
      .setAlpha(0)
      .setDepth(DEPTH.banner);

    this.hint = scene.add
      .text(0, 0, 'File pleine — ça part dans un instant', {
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

    // Jauge posée **dans** le slot de tête, le long de son bord bas : sur un petit écran,
    // tout ce qui déborde d'un slot finit hors du panneau.
    const head = zone.slots[0];
    const gaugeWidth = head.size * 0.84;
    const gaugeHeight = Math.max(3, head.size * 0.11);
    const gaugeY = head.y + head.size / 2 - gaugeHeight;
    this.gaugeBg.setPosition(head.x - gaugeWidth / 2, gaugeY).setSize(gaugeWidth, gaugeHeight);
    this.gauge.setPosition(head.x - gaugeWidth / 2, gaugeY).setSize(gaugeWidth, gaugeHeight);
    this.gaugeWidth = gaugeWidth;

    // La police tient compte de la largeur (« PV 100/100 » et « Vague 12 » cohabitent sur
    // une ligne) **et** de la hauteur, qui doit loger les deux lignes sans qu'elles se
    // chevauchent — d'où le 0,42 plutôt qu'une pleine hauteur de ligne.
    const hudFont = Phaser.Math.Clamp(
      Math.round(Math.min(zone.hud.height * 0.42, zone.hud.width * 0.055)),
      9,
      18
    );
    const smallFont = Phaser.Math.Clamp(Math.round(hudFont * 0.82), 8, 15);

    // Deux lignes, deux ancrages par ligne : rien ne peut se chevaucher, même à 320 px.
    this.hpText.setFontSize(hudFont).setPosition(zone.hud.x, zone.hud.y);
    this.waveText.setFontSize(hudFont).setPosition(zone.hud.x + zone.hud.width, zone.hud.y);
    this.queueText.setFontSize(smallFont).setPosition(zone.hud.x, zone.hud.y + zone.hud.height);
    this.nextText
      .setFontSize(smallFont)
      .setPosition(zone.hud.x + zone.hud.width, zone.hud.y + zone.hud.height);

    // Le bandeau se plie à la **largeur** du couloir : en portrait, celui-ci est une
    // colonne étroite, et « en approche » déborderait sur la grille à pleine taille.
    const bannerFont = Phaser.Math.Clamp(
      Math.round(Math.min(zone.laneThickness * 0.4, zone.lane.width / 7)),
      12,
      34
    );
    const laneCenter = lanePoint(zone, 0.5);
    this.banner.setFontSize(bannerFont).setPosition(laneCenter.x, laneCenter.y);
    this.hint
      .setFontSize(Phaser.Math.Clamp(Math.round(bannerFont * 0.55), 10, 18))
      .setWordWrapWidth(Math.max(60, zone.lane.width))
      .setPosition(laneCenter.x, laneCenter.y);

    this.refreshBaseBar();
    this.refreshQueueViews({ immediate: true });
    this.refreshUnitViews();
    this.refreshEnemyViews();
    this.refreshHud();
  }

  /** Repositionne et redimensionne les vignettes de la file de déploiement. */
  refreshQueueViews({ immediate = false } = {}) {
    const zone = this.zone;
    if (!zone) return;

    this.queue.slots.forEach((unit, position) => {
      const view = this.queueViews.get(unit.id);
      if (!view) return;
      const slot = zone.slots[position] ?? zone.slots[zone.slots.length - 1];
      this.resizeUnitView(view, zone.unitSize);
      if (immediate || view.getData('flying')) {
        view.setPosition(slot.x, slot.y);
        return;
      }
      if (view.x === slot.x && view.y === slot.y) return;
      // La file avance d'un cran : les vignettes glissent vers la sortie.
      this.scene.tweens.killTweensOf(view);
      this.scene.tweens.add({
        targets: view,
        x: slot.x,
        y: slot.y,
        duration: FEEL.slotShiftMs,
        ease: 'Quad.easeOut',
      });
    });
  }

  refreshUnitViews() {
    const zone = this.zone;
    if (!zone) return;
    for (const unit of this.model.units) {
      const view = this.unitViews.get(unit.id);
      if (view) this.resizeFighterView(view, zone.fieldUnitSize, unit.type, unit.tier);
    }
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
    on('enemyAttack', ({ unit }) => this.flashFighter(this.unitViews.get(unit.id)));
    on('baseDamage', () => this.onBaseDamage());
    on('unitAttack', (payload) => this.onUnitAttack(payload));

    on('unitQueued', ({ unit, position, origin }) => this.onUnitQueued(unit, position, origin));
    on('deployUnit', ({ unit }) => this.onDeployed(unit));
    on('unitSpawn', ({ unit }) => this.createUnitView(unit));
    on('unitDeath', ({ unit }) => this.popUnitView(unit));

    on('waveStart', ({ wave }) => this.showBanner(`Vague ${wave}`));
    on('waveCountdown', ({ wave }) => {
      if (wave > 1) this.showBanner(`Vague ${wave}\nen approche`);
    });
    on('tapRejected', () => this.showBlockedHint());
    on('queueRejected', () => this.showBlockedHint());
  }

  // ------------------------------------------------------------------ file de déploiement

  onUnitQueued(unit, position, origin) {
    const zone = this.zone;
    if (!zone) return;
    const slot = zone.slots[position] ?? zone.slots[zone.slots.length - 1];

    const view = this.buildFighterView(unit.type, unit.tier, zone.unitSize);
    view.setDepth(DEPTH.item).setPosition(slot.x, slot.y).setVisible(false);
    this.queueViews.set(unit.id, view);

    // Le vol grille → slot : c'est le lien que le seed doc veut lisible en permanence.
    const start = this.flightOrigin(origin);
    if (!start) {
      this.revealView(view);
      return;
    }
    view.setData('flying', true);
    this.flight(start, slot, unit.tier, () => {
      view.setData('flying', false);
      if (view.active) this.revealView(view);
    });
  }

  /** La tête de file part au combat : sa vignette disparaît, la file se resserre. */
  onDeployed(unit) {
    const view = this.queueViews.get(unit.id);
    if (view) {
      this.queueViews.delete(unit.id);
      this.scene.tweens.killTweensOf(view);
      this.scene.tweens.add({
        targets: view,
        scale: 0.4,
        alpha: 0,
        duration: 140,
        ease: 'Quad.easeIn',
        onComplete: () => view.destroy(),
      });
    }
    this.refreshQueueViews();
  }

  /** Point de départ d'un vol, d'après l'`origin` transmis par la session. */
  flightOrigin(origin) {
    if (!origin || !this.layoutData) return null;
    if (origin.kind === 'tap' && Number.isInteger(origin.gridIndex)) {
      return cellCenterAt(this.layoutData, origin.gridIndex);
    }
    return null;
  }

  /** Objet volant temporaire : la forme de l'item de la grille, qui rejoint son slot. */
  flight(from, to, tier, onComplete) {
    const zone = this.zone;
    const shape = this.scene.add.graphics();
    drawTierShape(shape, tier, this.layoutData.itemSize);
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

  // ------------------------------------------------------------------ combattants

  /** Conteneur commun aux unités (file et champ) : forme + numéro de tier + barre de vie. */
  buildFighterView(type, tier, size) {
    const shape = this.scene.add.graphics();
    const label = this.scene.add
      .text(0, 0, String(tier), {
        fontFamily: FONT,
        fontStyle: 'bold',
        color: TIER_LABEL_COLOR,
      })
      .setOrigin(0.5, 0.5)
      .setResolution(this.textResolution());
    const hpBg = this.scene.add.rectangle(0, 0, 10, 3, COLORS.hpBg).setOrigin(0, 0.5).setVisible(false);
    const hpFill = this.scene.add
      .rectangle(0, 0, 10, 3, COLORS.unitHpFill)
      .setOrigin(0, 0.5)
      .setVisible(false);

    const view = this.scene.add.container(0, 0, [shape, label, hpBg, hpFill]);
    view.setData({ shape, label, hpBg, hpFill });
    this.resizeFighterView(view, size, type, tier);
    return view;
  }

  resizeUnitView(view, size) {
    this.resizeFighterView(view, size, view.getData('type'), view.getData('tier'));
  }

  resizeFighterView(view, size, type, tier) {
    view.setData({ type, tier });
    drawUnitShape(view.getData('shape'), type, tier, size);
    view.getData('label').setText(String(tier)).setFontSize(Math.max(8, Math.round(size * 0.42)));

    const barWidth = size * 1.15;
    const barHeight = Math.max(2, size * 0.14);
    const barY = -size * 0.8;
    view.getData('hpBg').setPosition(-barWidth / 2, barY).setSize(barWidth, barHeight);
    view.getData('hpFill').setPosition(-barWidth / 2, barY).setSize(barWidth, barHeight);
    view.setData('barWidth', barWidth);
  }

  /** Vue d'une unité **sur le champ de bataille** : elle marche, elle encaisse, elle meurt. */
  createUnitView(unit) {
    const zone = this.zone;
    if (!zone) return null;

    const view = this.buildFighterView(unit.type, unit.tier, zone.fieldUnitSize);
    view.setDepth(DEPTH.item);
    this.unitViews.set(unit.id, view);
    this.positionFighterView(view, unit, 1, COLORS.unitHpFill);
    this.revealView(view);
    return view;
  }

  popUnitView(unit) {
    const view = this.unitViews.get(unit.id);
    if (!view) return;
    this.unitViews.delete(unit.id);
    this.scene.tweens.killTweensOf(view);
    this.scene.tweens.add({
      targets: view,
      scale: 0.15,
      alpha: 0,
      angle: 45,
      duration: 200,
      ease: 'Quad.easeOut',
      onComplete: () => view.destroy(),
    });
  }

  revealView(view) {
    if (!view.active) return;
    view.setVisible(true).setScale(0.3);
    this.scene.tweens.add({
      targets: view,
      scale: 1,
      duration: FEEL.unitPopMs,
      ease: 'Back.easeOut',
    });
  }

  /**
   * Place un combattant sur le couloir d'après sa progression interpolée, et met à jour
   * sa barre de vie. Unités et ennemis partagent exactement le même code : ils vivent
   * sur le même axe.
   */
  positionFighterView(view, fighter, alpha, fillColor) {
    const zone = this.zone;
    const progress = fighter.prevProgress + (fighter.progress - fighter.prevProgress) * alpha;
    const point = lanePoint(zone, progress / this.config.laneLength);
    view.setPosition(point.x, point.y);

    const ratio = Phaser.Math.Clamp(fighter.hp / fighter.maxHp, 0, 1);
    const damaged = ratio < 1;
    const hpFill = view.getData('hpFill');
    hpFill.width = view.getData('barWidth') * ratio;
    hpFill.setFillStyle(fillColor, 1).setVisible(damaged);
    view.getData('hpBg').setVisible(damaged);
  }

  // ------------------------------------------------------------------ ennemis

  createEnemyView(enemy) {
    const zone = this.zone;
    if (!zone) return null;

    const shape = this.scene.add.graphics();
    const hpBg = this.scene.add.rectangle(0, 0, 10, 3, COLORS.hpBg).setOrigin(0, 0.5);
    const hpFill = this.scene.add.rectangle(0, 0, 10, 3, COLORS.enemyHpFill).setOrigin(0, 0.5);

    const view = this.scene.add.container(0, 0, [shape, hpBg, hpFill]);
    view.setDepth(DEPTH.enemy);
    view.setData({ shape, hpBg, hpFill });

    this.enemyViews.set(enemy.id, view);
    this.resizeEnemyView(view, enemy);
    this.positionFighterView(view, enemy, 1, COLORS.enemyHpFill);

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

  // ------------------------------------------------------------------ frappes

  onUnitAttack({ from, target, hits, unit, splashRadius, role }) {
    const zone = this.zone;
    if (!zone) return;

    this.tracers.push({
      from: lanePoint(zone, from / this.config.laneLength),
      to: lanePoint(zone, target.progress / this.config.laneLength),
      color: unitColor(unit.type),
      age: 0,
      splash:
        role === 'aoe' || role === 'slow'
          ? (splashRadius / this.config.laneLength) * zone.laneLengthPx
          : 0,
    });

    for (const hit of hits) {
      if (hit.killed) continue;
      this.flashFighter(this.enemyViews.get(hit.enemy.id));
    }
  }

  /** Éclair blanc sur un combattant touché — même feedback des deux côtés. */
  flashFighter(view) {
    if (!view?.active) return;
    const shape = view.getData('shape');
    this.scene.tweens.killTweensOf(shape);
    shape.setAlpha(0.45);
    this.scene.tweens.add({ targets: shape, alpha: 1, duration: FEEL.hitFlashMs });
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

  /** Feedback du tap refusé : la file crie qu'elle est pleine — mais plus pour longtemps. */
  showBlockedHint() {
    this.scene.tweens.killTweensOf(this.hint);
    this.hint.setAlpha(1).setScale(1);
    this.scene.tweens.add({
      targets: this.hint,
      alpha: 0,
      duration: FEEL.hintMs,
      ease: 'Quad.easeIn',
    });

    for (const view of this.slotViews) view.setFillStyle(COLORS.slotBlocked, 1);
    this.scene.tweens.killTweensOf(this.gauge);
    this.scene.tweens.add({
      targets: this.gauge,
      scaleY: { from: 2.4, to: 1 },
      duration: 320,
      ease: 'Back.easeOut',
    });
    this.scene.time.delayedCall(FEEL.hintMs * 0.6, () => this.restoreSlotColors());
  }

  restoreSlotColors() {
    this.slotViews.forEach((view, index) => {
      if (view.active) view.setFillStyle(index === 0 ? COLORS.slotHead : COLORS.slot, 1);
    });
  }

  // ------------------------------------------------------------------ boucle

  update(deltaMs) {
    const zone = this.zone;
    if (!zone) return;

    const alpha = this.model.alpha;
    for (const enemy of this.model.enemies) {
      const view = this.enemyViews.get(enemy.id);
      if (view) this.positionFighterView(view, enemy, alpha, COLORS.enemyHpFill);
    }
    for (const unit of this.model.units) {
      const view = this.unitViews.get(unit.id);
      if (view) this.positionFighterView(view, unit, alpha, COLORS.unitHpFill);
    }

    this.drawTracers(deltaMs);
    this.refreshBaseBar();
    this.refreshGauge();
    this.refreshHud();
  }

  /** La jauge de sortie suit le cooldown de `DeployQueue`, frame par frame. */
  refreshGauge() {
    const ratio = this.queue.slots.length === 0 ? 1 : this.queue.cooldownRatio();
    this.gauge.width = Math.max(0.5, this.gaugeWidth * ratio);
    this.gauge.setFillStyle(ratio >= 1 ? COLORS.gaugeReady : COLORS.gauge, 1);
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
    this.nextText.setText(`Unité : ${hud.nextUnitLabel}`);
    this.queueText.setText(`File ${hud.queueLength}/${hud.slotCount}`);
    this.queueText.setColor(hud.blocked ? COLORS.textWarn : COLORS.textDim);
  }

  // ------------------------------------------------------------------ fin de vie

  destroy() {
    for (const off of this.unsubscribes) off();
    this.unsubscribes = [];
    for (const view of [
      ...this.enemyViews.values(),
      ...this.unitViews.values(),
      ...this.queueViews.values(),
    ]) {
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
