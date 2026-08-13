import Phaser from 'phaser';

import { cellCenterAt, lanePoint } from '../systems/layout.js';
import { styleTierLabel, TIER_LABEL_COLOR } from '../render/tierShapes.js';
import { powerColor } from '../render/powerShapes.js';
import { enemySize, unitColor, enemyColor } from '../render/battleShapes.js';
import { createVisual, repaintVisual, spriteNameFor } from '../render/visuals.js';
import { SpriteAnimator } from '../render/spriteAnim.js';
import { createDecor } from '../render/decor.js';
import { FONTS, pixelFontSize } from '../render/fonts.js';
import { DEPTH, fighterDepth } from '../render/depths.js';
import { laneOffsetLength, laneOffsetRatio } from '../systems/laneSpread.js';
import { DEFAULT_NATIVE_SIZE, artPixelSize, snapToArtGrid } from '../systems/pixelScale.js';
import { sceneTextResolution } from '../render/hiDpi.js';
import { compositionText, t, waveLabelText } from '../i18n/index.js';

/**
 * Rendu du champ de bataille et de la file de déploiement — **aucune règle de gameplay**.
 *
 * La vue s'abonne aux événements de `BattleModel` et de `DeployQueue` (via le bus de la
 * session) et met en images ce qu'ils décrivent ; entre deux ticks logiques, elle
 * **interpole** la position des deux camps avec `model.alpha`, ce qui donne un mouvement
 * fluide à 60 fps au-dessus d'une simulation à 10 Hz.
 *
 * Ce n'est pas une scène Phaser : c'est un objet de rendu possédé par `GameScene`, qui le
 * relayoute à chaque `resize` et lui prête sa boîte à juice (particules, secousses, sons).
 * Depuis le Lot 2.5, la vue ne reçoit plus aucun geste : on ne manipule plus rien sur la
 * bande, tout se joue sur la grille.
 *
 * **Les deux trajets sont la lisibilité du concept** (Lot 3) : grille → slot au tap, puis
 * slot → couloir à la sortie. Les deux volent avec une traînée, et c'est ce qui rend
 * visible le lien entre les deux moitiés du jeu.
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
  baseHit: 0x7a3341,
  baseFill: 0x6bcb77,
  baseFillLow: 0xff6b6b,
  text: '#eef1f8',
  textDim: '#8f97b0',
  textWarn: '#ff9f43',
  hpBg: 0x14161f,
  enemyHpFill: 0xff6b6b,
  unitHpFill: 0x6bcb77,
};

/** Durée du glissement d'une vignette d'un slot au suivant. Purement mécanique. */
const SLOT_SHIFT_MS = 160;

/**
 * Décalage des identifiants dans la permutation de répartition verticale.
 *
 * Unités et ennemis ont des **compteurs séparés** dans `BattleModel`, tous deux partant de 1.
 * Sans ce décalage, la première unité et le premier ennemi de la partie prendraient le même
 * rang, puis les deux camps descendraient la bande au même rythme — ce qui se remarque
 * exactement autant qu'un empilement.
 */
const SPREAD_SALT = { unit: 2, enemy: 0 };

export class BattleView {
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
    this.model = session.battle;
    this.queue = session.deployQueue;
    this.config = session.battleConfig;
    // Le skin appartient à `GameScene` et se prête, comme `JuiceKit` : il ne porte aucun
    // état de partie, seulement la table des sprites disponibles.
    this.skin = scene.skin;

    /** @type {Map<number, Phaser.GameObjects.Container>} vues d'ennemis, par id */
    this.enemyViews = new Map();
    /** @type {Map<number, Phaser.GameObjects.Container>} vues d'unités au combat, par id */
    this.unitViews = new Map();
    /** @type {Map<number, Phaser.GameObjects.Container>} vues des unités en file, par id */
    this.queueViews = new Map();
    /** @type {{from: object, to: object, color: number, age: number, splash: number}[]} */
    this.tracers = [];
    /** @type {Set<Phaser.GameObjects.Graphics>} Anneaux de zone en cours (Lot 4). */
    this.telegraphs = new Set();
    this.unsubscribes = [];
    this.layoutData = null;
    /** Texte du bandeau d'annonce, sans sa ligne de compte à rebours. */
    this.announceText = '';
    this.announceSeconds = -1;
    this.announceVisible = false;
    /** Vue d'unité créée par `unitSpawn` et attendue par `onDeployed` (le vol slot → couloir). */
    this.pendingDeploy = null;

    this.build();
    this.bind(session.events);
  }

  get zone() {
    return this.layoutData?.battleZone ?? null;
  }

  textResolution() {
    return sceneTextResolution(this);
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

    /**
     * Décor du champ : le sol, et les deux bouts du couloir.
     *
     * Le sol se **tuile** sur toute la longueur ; le château et le portail sont deux objets
     * posés aux extrémités, aux progressions 1 et 0. Les trois se posent par-dessus les
     * rectangles existants, qui restent le repli — et **sous** les combattants
     * (`DEPTH.fighter` vaut 5), donc jamais devant ce qui compte.
     *
     * Le château est délibérément posé **au bout du couloir** et non dans le bloc de PV : la
     * jauge verte reste une jauge, lisible du coin de l'œil, et le décor reste du décor. Les
     * mettre au même endroit obligeait à choisir entre les deux.
     */
    this.decor = {
      field: createDecor(scene, this.skin, 'decor.field', DEPTH.cell + 0.1),
      portal: createDecor(scene, this.skin, 'decor.portal', DEPTH.cell + 0.2),
      castle: createDecor(scene, this.skin, 'decor.castle', DEPTH.cell + 0.2),
    };

    /**
     * @type {Phaser.GameObjects.Rectangle[]} fonds des slots de déploiement.
     *
     * Créés à la demande : l'amélioration « File élargie » ajoute une place **en cours de
     * partie**, et un tableau figé à la construction laisserait la nouvelle place invisible
     * jusqu'au prochain rechargement.
     */
    this.slotViews = [];
    this.ensureSlotViews(this.config.slotCount);

    // Jauge de sortie : un liseré qui se remplit sous le slot de tête. C'est le seul
    // repère de rythme du jeu, il doit être lisible du coin de l'œil.
    this.gaugeBg = scene.add.rectangle(0, 0, 10, 3, COLORS.hpBg).setOrigin(0, 0.5).setDepth(DEPTH.hud);
    this.gauge = scene.add.rectangle(0, 0, 10, 3, COLORS.gauge).setOrigin(0, 0.5).setDepth(DEPTH.hud);

    this.tracerGraphics = scene.add.graphics().setDepth(DEPTH.tracer);

    // Deux lignes de HUD, deux ancrages par ligne : rien ne peut se chevaucher, même
    // sur un écran de 320 px de large.
    // Une seule ligne depuis le Lot 3.5 : PV à gauche, file de déploiement à droite. Ce
    // qui occupait la seconde (prochaine unité, numéro de vague) est passé à `IntelBar`,
    // qui le dit mieux — et à côté de l'annonce de vague, là où ça sert à décider.
    const dim = { fontFamily: FONTS.body, color: COLORS.textDim };
    this.hpText = scene.add.text(0, 0, '', { ...dim, color: COLORS.text }).setDepth(DEPTH.hud);
    this.queueText = scene.add.text(0, 0, '', dim).setOrigin(1, 0).setDepth(DEPTH.hud);

    this.banner = scene.add
      .text(0, 0, '', { fontFamily: FONTS.body, fontStyle: 'bold', color: COLORS.text, align: 'center' })
      .setOrigin(0.5, 0.5)
      .setAlpha(0)
      .setDepth(DEPTH.banner);

    this.hint = scene.add
      .text(0, 0, t('hud.queueFull'), {
        fontFamily: FONTS.body,
        fontStyle: 'bold',
        color: COLORS.textWarn,
      })
      .setOrigin(0.5, 0.5)
      .setAlpha(0)
      .setDepth(DEPTH.banner);

    for (const text of [this.hpText, this.queueText, this.banner, this.hint]) {
      text.setResolution(this.textResolution());
    }
  }

  /**
   * Boîte de décor à l'un des deux bouts du couloir.
   *
   * Deux précautions, apprises en regardant un château se poser sur la jauge de PV :
   *
   * - **la taille se mesure en combattants**, pas en épaisseur de couloir. Un décor calé sur
   *   l'épaisseur occupe toute la largeur sur un écran étroit et devient minuscule sur un
   *   écran large ; calé sur la taille de référence des combattants, il garde le même rapport
   *   au personnage partout, ce qui est la seule échelle que l'œil compare vraiment ;
   * - **la boîte est poussée vers l'intérieur** d'une demi-longueur. Centrée sur l'extrémité,
   *   la moitié du décor déborde du couloir — sur la jauge de PV d'un côté, hors panneau de
   *   l'autre.
   *
   * @param {0|1} end 0 = l'entrée des ennemis, 1 = la face de la base
   */
  laneEndBox(end) {
    const zone = this.zone;
    const size = Math.min(
      zone.enemyReference * this.juiceConfig.field.decor.endSize,
      zone.laneThickness
    );
    const point = lanePoint(zone, end);
    const inward = (end === 0 ? 1 : -1) * (size / 2);
    const x = (zone.horizontal ? point.x + inward : point.x) - size / 2;
    const y = (zone.horizontal ? point.y : point.y + inward) - size / 2;
    return { x, y, width: size, height: size };
  }

  /** Complète la rangée de slots jusqu'à `count` vues. */
  ensureSlotViews(count) {
    while (this.slotViews.length < count) {
      const index = this.slotViews.length;
      this.slotViews.push(
        this.scene.add
          .rectangle(0, 0, 10, 10, index === 0 ? COLORS.slotHead : COLORS.slot)
          .setStrokeStyle(1, COLORS.slotStroke, 1)
          .setDepth(DEPTH.cell)
      );
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

    this.ensureSlotViews(zone.slots.length);
    this.slotViews.forEach((view, index) => {
      const slot = zone.slots[index];
      // Plus de vue que de places (la file a rétréci d'une partie à l'autre) : on cache
      // plutôt que de détruire, la vue resservira.
      view.setVisible(Boolean(slot));
      if (slot) view.setPosition(slot.x, slot.y).setSize(slot.size, slot.size);
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

    // La police tient compte de la largeur (« PV 100/100 » et « File 3/5 » cohabitent sur
    // une ligne) **et** de la hauteur de la bande qui leur est réservée.
    const hudFont = Phaser.Math.Clamp(
      Math.round(Math.min(zone.hud.height * 0.82, zone.hud.width * 0.055)),
      9,
      18
    );

    // Une ligne, deux ancrages : rien ne peut se chevaucher, même à 320 px.
    this.hpText.setFontSize(pixelFontSize(hudFont)).setPosition(zone.hud.x, zone.hud.y);
    this.queueText.setFontSize(pixelFontSize(hudFont)).setPosition(zone.hud.x + zone.hud.width, zone.hud.y);

    // Le bandeau se plie à la **largeur** du couloir : en portrait, celui-ci est une
    // colonne étroite, et une texture au nom long déborderait sur la grille à pleine taille.
    // Il compte jusqu'à quatre lignes depuis le playtest (titre, texture, composition,
    // compte à rebours) : l'épaisseur du couloir se divise donc par ce nombre de lignes,
    // sinon l'annonce dépasse du couloir au lieu de tenir dedans.
    const bannerFont = Phaser.Math.Clamp(
      Math.round(Math.min(zone.laneThickness * 0.19, zone.lane.width / 9)),
      11,
      30
    );
    const laneCenter = lanePoint(zone, 0.5);
    this.banner
      .setFontSize(pixelFontSize(bannerFont))
      .setWordWrapWidth(Math.max(60, zone.lane.width))
      .setPosition(laneCenter.x, laneCenter.y);
    this.hint
      .setFontSize(pixelFontSize(Phaser.Math.Clamp(Math.round(bannerFont * 0.55), 10, 18)))
      .setWordWrapWidth(Math.max(60, zone.lane.width))
      .setPosition(laneCenter.x, laneCenter.y);

    /**
     * Côté d'un pixel d'art à l'écran, en unités de jeu.
     *
     * **C'est la trame de tout l'écran, calculée par `GameScene` sur la case de la grille**,
     * et non une trame propre au champ de bataille : deux surfaces voisines dont les pixels
     * n'ont pas la même grosseur cessent d'appartenir au même dessin, et ça se voit dès
     * qu'une particule traverse de l'une à l'autre. Le repli local ne sert qu'aux bancs
     * d'essai, où la vue tourne sans sa scène.
     */
    this.artPixel =
      this.scene.artPixel ??
      artPixelSize(zone.fieldUnitSize, this.skin?.nativeSize ?? DEFAULT_NATIVE_SIZE);

    // Le sol couvre le couloir entier ; le portail et le château ferment ses deux bouts.
    this.decor.field?.resize(zone.lane, this.artPixel);
    this.decor.portal?.resize(this.laneEndBox(0), this.artPixel);
    this.decor.castle?.resize(this.laneEndBox(1), this.artPixel);

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
        duration: SLOT_SHIFT_MS,
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
    on('enemyDeath', ({ enemy }) => this.onEnemyDeath(enemy));
    on('enemyLeak', ({ enemy }) => this.popEnemyView(enemy, { leaked: true }));
    on('enemyAttack', ({ unit }) => this.onEnemyAttack(unit));
    on('baseDamage', () => this.onBaseDamage());
    on('unitAttack', (payload) => this.onUnitAttack(payload));

    on('unitQueued', ({ unit, position, origin }) => this.onUnitQueued(unit, position, origin));
    on('deployUnit', ({ unit }) => this.onDeployed(unit));
    on('unitSpawn', ({ unit, origin }) => this.createUnitView(unit, origin));
    on('unitDeath', ({ unit }) => this.popUnitView(unit));

    // Pouvoirs actifs (Lot 4) : l'annonce de la zone, puis l'impact. Deux événements parce
    // que ce sont deux moments du jeu, séparés par la télégraphie.
    on('powerCast', (payload) => this.onPowerCast(payload));
    on('powerResolved', (payload) => this.onPowerResolved(payload));
    on('powerFizzled', () => this.clearTelegraphs());

    on('waveStart', () => this.onWaveStart());
    // **L'annonce de vague du Lot 3.5.** Le bandeau ne dit plus « en approche » mais *ce
    // qui* approche : c'est cette composition, croisée avec la file de types, qui doit
    // changer ce que le joueur envoie pendant la préparation.
    on('waveCountdown', (payload) => this.onWaveCountdown(payload));
    on('baseHeal', ({ amount }) => this.onBaseHeal(amount));
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
    this.flight(start, slot, {
      durationMs: this.juiceConfig.flight.toSlotMs,
      ease: 'Cubic.easeIn',
      color: unitColor(unit.type),
      // Ce qui vole de la grille au slot est **l'orbe**, pas encore l'unité : c'est ce qui
      // rend lisible le lien entre les deux moitiés du jeu.
      visual: { kind: 'item', item: { tier: unit.tier } },
      size: this.layoutData.itemSize,
      endScale: (zone.unitSize / Math.max(1, this.layoutData.itemSize)) * 0.9,
      onComplete: () => {
        view.setData('flying', false);
        if (view.active) this.revealView(view);
      },
    });
  }

  /**
   * La tête de file part au combat : sa vignette disparaît, la file se resserre, et un
   * second vol l'emmène du slot jusqu'à l'entrée du couloir.
   *
   * L'unité correspondante a déjà été créée (cachée) par `createUnitView` : `deployUnit`
   * est d'abord consommé par `BattleModel`, qui émet `unitSpawn` avant que cette
   * méthode-ci ne s'exécute. `pendingDeploy` est le relais entre les deux.
   */
  onDeployed(unit) {
    const zone = this.zone;
    const view = this.queueViews.get(unit.id);
    const from = view ? { x: view.x, y: view.y } : zone?.slots[0];
    const target = this.pendingDeploy;
    this.pendingDeploy = null;

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

    // Second trajet : le slot vers l'entrée du couloir. L'unité attend cachée et
    // n'apparaît qu'à l'arrivée du vol.
    if (target?.active) {
      if (zone && from) {
        this.flight(
          from,
          { x: target.x, y: target.y },
          {
            durationMs: this.juiceConfig.flight.toFieldMs,
            ease: 'Cubic.easeOut',
            color: unitColor(unit.type),
            visual: { kind: 'unit', type: unit.type, tier: unit.tier },
            size: zone.unitSize,
            endScale: zone.fieldUnitSize / Math.max(1, zone.unitSize),
            onComplete: () => {
              if (target.active) this.revealView(target);
            },
          }
        );
      } else {
        // Sans zone de départ, on ne laisse **jamais** une unité invisible sur le champ.
        this.revealView(target);
      }
    }

    this.juice.play('deploy');
    this.pulseGauge();
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

  /**
   * Objet volant temporaire, avec traînée.
   *
   * Les deux trajets du jeu (grille → slot, slot → couloir) passent par ici : c'est le
   * seul endroit où se règle leur feel, et la traînée est ce qui rend le lien lisible
   * même quand l'œil est ailleurs.
   */
  flight(from, to, { durationMs, ease, color, visual, size, endScale = 1, onComplete }) {
    // L'objet volant est **la même chose que ce qu'il représente** : un orbe qui part vers
    // un slot est l'orbe qu'on vient de taper, pas un rectangle de la bonne couleur. Il
    // passe donc par `createVisual` comme tout le reste, sprite ou greybox.
    const body = createVisual(this.scene, this.skin, visual, size);
    const flyer = this.scene.add.container(from.x, from.y, [body]).setDepth(DEPTH.flight);

    const trail = this.juiceConfig.flight.trail;
    // Horodatage plutôt qu'accumulateur : `onUpdate` est appelé une fois par propriété
    // tweenée, et compter les frames y déposerait trois fois trop de particules.
    let lastTrailAt = 0;

    this.scene.tweens.add({
      targets: flyer,
      x: to.x,
      y: to.y,
      scale: endScale,
      duration: durationMs,
      ease,
      onUpdate: () => {
        const now = this.scene.time.now;
        if (now - lastTrailAt < trail.everyMs) return;
        lastTrailAt = now;
        this.juice.particles.spawn(flyer.x, flyer.y, 0, 0, {
          lifeMs: trail.lifeMs,
          sizePx: trail.sizePx,
          color,
        });
      },
      onComplete: () => {
        flyer.destroy();
        onComplete?.();
      },
    });
  }

  // ------------------------------------------------------------------ pouvoirs actifs

  /**
   * Un pouvoir vient d'être dépensé : l'item quitte sa case et la zone visée s'annonce.
   *
   * Le trajet est **volontairement différent** de celui d'une unité : il ne passe pas par
   * les slots de déploiement, il file droit sur le couloir. Vu du coin de l'œil, la
   * trajectoire suffit à dire lequel des deux taps on vient de faire.
   */
  onPowerCast({ type, tier, kind, center, radius, telegraphMs, origin }) {
    const zone = this.zone;
    if (!zone) return;

    const color = powerColor(type);
    const target =
      kind === 'blast'
        ? lanePoint(zone, center / this.config.laneLength)
        : lanePoint(zone, 1); // le soin part vers la base, là où tient la ligne

    const start = this.flightOrigin(origin);
    if (start) {
      this.flight(start, target, {
        durationMs: this.juiceConfig.power.castMs,
        // Une courbe rapide au départ, tendue : un pouvoir « tombe » sur la bataille.
        ease: 'Quad.easeIn',
        color,
        visual: { kind: 'power', type, tier },
        size: this.layoutData.itemSize,
        endScale: 0.7,
      });
    }

    if (kind !== 'blast') return;
    this.showTelegraph(target, radius, color, telegraphMs);
  }

  /**
   * Cercle d'annonce de l'impact, qui se resserre pendant toute la télégraphie.
   *
   * Sa durée est celle du **modèle** (`telegraphMs`, dans `balance.json`) et non un réglage
   * de feel : l'anneau doit se fermer **exactement** quand l'impact tombe, sinon il ment sur
   * ce qui va se passer. `juice.json` ne règle que son épaisseur et sa pulsation.
   */
  showTelegraph(point, radius, color, durationMs) {
    const zone = this.zone;
    const power = this.juiceConfig.power;
    const radiusPx = (radius / this.config.laneLength) * zone.laneLengthPx;

    const ring = this.scene.add.graphics().setDepth(DEPTH.tracer);
    ring.lineStyle(power.ringWidthPx, color, 0.9);
    ring.strokeCircle(0, 0, radiusPx);
    ring.setPosition(point.x, point.y).setScale(1.6).setAlpha(0.25);
    this.telegraphs.add(ring);

    this.scene.tweens.add({
      targets: ring,
      scale: 1,
      alpha: 0.95,
      duration: Math.max(1, durationMs),
      ease: 'Quad.easeIn',
      onComplete: () => {
        this.telegraphs.delete(ring);
        ring.destroy();
      },
    });
  }

  /** Impact ou soin : ce que le pouvoir a produit, une fois la télégraphie écoulée. */
  onPowerResolved({ type, kind, center, radius, healed }) {
    const zone = this.zone;
    if (!zone) return;
    const power = this.juiceConfig.power;
    const color = powerColor(type);

    if (kind === 'heal') {
      this.juice.play('powerHeal');
      // Une gerbe **par unité soignée** : le soin se lit sur l'armée, pas sur un point de
      // l'écran. Le pool de particules absorbe le pic, il est dimensionné pour.
      for (const entry of healed) {
        const view = this.unitViews.get(entry.unit.id);
        if (!view?.active) continue;
        this.juice.burst(view.x, view.y, power.healBurst, color);
        this.flashFighter(view);
      }
      return;
    }

    const point = lanePoint(zone, center / this.config.laneLength);
    const radiusPx = (radius / this.config.laneLength) * zone.laneLengthPx;

    this.juice.play('powerBlast');
    this.juice.burst(point.x, point.y, power.blastBurst, color);

    // Onde de choc : un anneau qui s'ouvre et s'efface, à l'exact inverse de la télégraphie.
    const ring = this.scene.add.graphics().setDepth(DEPTH.tracer);
    ring.lineStyle(power.ringWidthPx * 1.5, color, 1);
    ring.strokeCircle(0, 0, radiusPx);
    ring.setPosition(point.x, point.y);
    this.telegraphs.add(ring);
    this.scene.tweens.add({
      targets: ring,
      scale: power.impactRingScale,
      alpha: 0,
      duration: power.impactRingMs,
      ease: 'Quad.easeOut',
      onComplete: () => {
        this.telegraphs.delete(ring);
        ring.destroy();
      },
    });
  }

  /**
   * Efface toutes les zones en cours.
   *
   * Appelé quand une télégraphie n'aboutira jamais (partie finie) et à la destruction de la
   * vue : un anneau laissé derrière survivrait à sa propre bataille.
   */
  clearTelegraphs() {
    for (const ring of this.telegraphs) {
      this.scene.tweens.killTweensOf(ring);
      ring.destroy();
    }
    this.telegraphs.clear();
  }

  // ------------------------------------------------------------------ combattants

  /** Conteneur commun aux unités (file et champ) : forme + numéro de tier + barre de vie. */
  buildFighterView(type, tier, size) {
    const shape = createVisual(this.scene, this.skin, { kind: 'unit', type, tier }, size);
    const label = this.scene.add
      .text(0, 0, String(tier), {
        fontFamily: FONTS.body,
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
    view.setData({ shape, label, hpBg, hpFill, animator: this.createAnimator() });
    this.resizeFighterView(view, size, type, tier);
    return view;
  }

  /**
   * Animateur de frames d'un combattant.
   *
   * Il est créé pour **tout le monde**, sprite livré ou repli greybox : c'est lui qui rend
   * `null` quand il n'y a rien à jouer, et c'est ce qui évite d'écrire un `if (le sprite
   * existe)` dans la boucle de rendu — la même promesse que `visuals.js` tient pour les
   * images (cf. `CLAUDE.md`).
   */
  createAnimator() {
    return new SpriteAnimator(this.skin, this.juiceConfig.sprite?.fps);
  }

  /**
   * Avance l'animation d'un combattant d'une frame de rendu.
   *
   * `walk` pendant le déplacement, `idle` à l'arrêt — et l'arrêt, c'est le modèle qui le dit :
   * une unité qui tire, un ennemi au contact et une armée figée pendant une pause ont tous
   * `progress === prevProgress`. Rien de plus n'est nécessaire, et surtout aucun état de
   * mouvement n'a besoin d'exister dans `BattleModel`.
   *
   * @param {Phaser.GameObjects.Container} view
   * @param {number} dtMs
   * @param {string} [state] Animation forcée (les vignettes de la file attendent, donc `idle`)
   */
  animateFighter(view, dtMs, state) {
    const animator = view.getData('animator');
    if (!animator) return;
    const wanted = state ?? (view.getData('moving') ? 'walk' : 'idle');
    const frame = animator.update(view.getData('spriteName'), wanted, dtMs);
    if (frame) this.skin.setFrameName(view.getData('shape'), frame);
  }

  resizeUnitView(view, size) {
    this.resizeFighterView(view, size, view.getData('type'), view.getData('tier'));
  }

  resizeFighterView(view, size, type, tier) {
    const spec = { kind: 'unit', type, tier };
    // Le nom d'ancre est relu à chaque habillage : c'est lui que l'animateur suit, et un
    // changement de palier visuel doit emmener la marche avec lui.
    view.setData({ type, tier, spriteName: this.skin ? spriteNameFor(spec, this.skin) : null });
    repaintVisual(view.getData('shape'), this.skin, spec, size);
    // La taille est ramenée à la grille **avant** d'habiller le liseré : les deux doivent
    // parler de la même police, sinon le contour est calculé pour un corps qui n'existe pas.
    const fontSize = pixelFontSize(Math.max(8, Math.round(size * 0.42)));
    styleTierLabel(view.getData('label').setText(String(tier)).setFontSize(fontSize), fontSize);

    const barWidth = size * 1.15;
    const barHeight = Math.max(2, size * 0.14);
    const barY = -size * 0.8;
    view.getData('hpBg').setPosition(-barWidth / 2, barY).setSize(barWidth, barHeight);
    view.getData('hpFill').setPosition(-barWidth / 2, barY).setSize(barWidth, barHeight);
    view.setData('barWidth', barWidth);
  }

  /**
   * Rang normalisé d'une entité dans la bande de répartition, figé pour toute sa vie.
   *
   * Il se **dérive de l'identifiant** et ne tire rien : consommer le générateur seedé de la
   * partie déplacerait la composition des vagues et le tirage du draft, et le harness
   * rendrait d'autres chiffres pour cause de décor (cf. `src/systems/laneSpread.js`).
   */
  spreadRatio(id, kind) {
    return laneOffsetRatio(id, {
      steps: this.juiceConfig.field.spread.steps,
      salt: SPREAD_SALT[kind] ?? 0,
    });
  }

  /** Vue d'une unité **sur le champ de bataille** : elle marche, elle encaisse, elle meurt. */
  createUnitView(unit, origin) {
    const zone = this.zone;
    if (!zone) return null;

    const view = this.buildFighterView(unit.type, unit.tier, zone.fieldUnitSize);
    view.setData('spreadRatio', this.spreadRatio(unit.id, 'unit'));
    this.unitViews.set(unit.id, view);
    // La profondeur est posée par `positionFighterView` : elle dépend de l'ordonnée finale,
    // décalage compris, donc elle ne peut se décider qu'une fois la vue placée.
    this.positionFighterView(view, unit, 1, COLORS.unitHpFill);

    // Sortie de file : l'unité reste cachée le temps que le vol slot → couloir la rejoigne
    // (`onDeployed`). Hors de ce chemin (tests, bancs d'essai), elle apparaît tout de suite.
    if (origin?.kind === 'deploy') {
      view.setVisible(false);
      this.pendingDeploy = view;
    } else {
      this.revealView(view);
    }
    return view;
  }

  popUnitView(unit) {
    const view = this.unitViews.get(unit.id);
    if (!view) return;
    this.unitViews.delete(unit.id);
    this.stopFighterTweens(view);

    const combat = this.juiceConfig.combat;
    this.juice.burst(view.x, view.y, combat.deathBurst, unitColor(unit.type));
    this.juice.play('death');

    this.scene.tweens.killTweensOf(view);
    // **Écrasement, et surtout pas rotation.** Une rotation libre rééchantillonne le sprite
    // à chaque frame et fabrique des pixels qui n'existent dans aucune planche : c'est la
    // seule chose formellement interdite sur un sprite depuis la bascule en pixel art
    // (cf. `CLAUDE.md`). Un combattant qui s'aplatit au sol raconte la même chose que le
    // basculement à 45° qu'il remplace, en ne touchant qu'aux deux axes d'échelle.
    this.scene.tweens.add({
      targets: view,
      scaleX: combat.deathSquash.scaleX,
      scaleY: combat.deathSquash.scaleY,
      alpha: 0,
      duration: combat.deathMs,
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
      duration: this.juiceConfig.combat.unitPopMs,
      ease: 'Back.easeOut',
    });
  }

  /**
   * Décalage cosmétique d'un combattant hors de l'axe du couloir, en unités de jeu.
   *
   * Le **rang** est figé à l'apparition (`spreadRatio`) et le **décalage** se recalcule ici :
   * l'épaisseur du couloir change à chaque `resize`, et une valeur figée en pixels sortirait
   * du couloir dès la première rotation de téléphone. L'arrondi sur la trame du dessin est ce
   * qui garde les pixels alignés (cf. `artPixel`).
   */
  spreadOffset(view) {
    const spread = this.juiceConfig.field.spread;
    const raw = laneOffsetLength(view.getData('spreadRatio') ?? 0, this.zone.laneThickness, spread);
    return snapToArtGrid(raw, this.artPixel ?? 1);
  }

  /**
   * Place un combattant sur le couloir d'après sa progression interpolée, et met à jour
   * sa barre de vie. Unités et ennemis partagent exactement le même code : ils vivent
   * sur le même axe — **et sur la même bande de profondeur**, sans quoi un ennemi placé plus
   * haut passerait devant l'unité qui le mord.
   */
  positionFighterView(view, fighter, alpha, fillColor) {
    const zone = this.zone;
    const progress = fighter.prevProgress + (fighter.progress - fighter.prevProgress) * alpha;
    const point = lanePoint(zone, progress / this.config.laneLength);

    // Le décalage est perpendiculaire à la marche : en ordonnée sur un couloir horizontal,
    // en abscisse sur la colonne du mode portrait.
    const offset = this.spreadOffset(view);
    const x = zone.horizontal ? point.x : point.x + offset;
    const y = zone.horizontal ? point.y + offset : point.y;
    view.setPosition(x, y);

    // `walk` ou `idle` : le modèle a bougé, ou non. Lu par `animateFighter`, qui tourne juste
    // après dans la même boucle.
    view.setData('moving', fighter.progress !== fighter.prevProgress);

    // **Y-sort.** Plus bas à l'écran = plus près du spectateur = dessiné devant. En portrait
    // le couloir est vertical, et la même formule trie alors par avancement — ce qui est
    // exactement ce qu'on veut voir de ce côté-là aussi.
    const depth = fighterDepth((y - zone.lane.y) / Math.max(1, zone.lane.height));
    if (view.getData('depthValue') !== depth) {
      view.setDepth(depth).setData('depthValue', depth);
    }

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

    const shape = createVisual(
      this.scene,
      this.skin,
      { kind: 'enemy', type: enemy.type, horizontal: zone.horizontal },
      enemySize(enemy.type, zone.enemyReference)
    );
    const hpBg = this.scene.add.rectangle(0, 0, 10, 3, COLORS.hpBg).setOrigin(0, 0.5);
    const hpFill = this.scene.add.rectangle(0, 0, 10, 3, COLORS.enemyHpFill).setOrigin(0, 0.5);

    const view = this.scene.add.container(0, 0, [shape, hpBg, hpFill]);
    view.setData({ shape, hpBg, hpFill, animator: this.createAnimator() });
    view.setData('spreadRatio', this.spreadRatio(enemy.id, 'enemy'));

    this.enemyViews.set(enemy.id, view);
    this.resizeEnemyView(view, enemy);
    this.positionFighterView(view, enemy, 1, COLORS.enemyHpFill);

    view.setScale(0.4);
    this.scene.tweens.add({
      targets: view,
      scale: 1,
      duration: this.juiceConfig.combat.enemyPopMs,
      ease: 'Back.easeOut',
    });
    return view;
  }

  resizeEnemyView(view, enemy) {
    const zone = this.zone;
    const size = enemySize(enemy.type, zone.enemyReference);
    const spec = { kind: 'enemy', type: enemy.type, horizontal: zone.horizontal };
    view.setData('spriteName', this.skin ? spriteNameFor(spec, this.skin) : null);
    repaintVisual(view.getData('shape'), this.skin, spec, size);

    const barWidth = size * 1.1;
    const barHeight = Math.max(2, size * 0.13);
    const barY = -size * 0.78;
    view.getData('hpBg').setPosition(-barWidth / 2, barY).setSize(barWidth, barHeight);
    view.getData('hpFill').setPosition(-barWidth / 2, barY).setSize(barWidth, barHeight);
    view.setData('barWidth', barWidth);
  }

  /** Mort d'un ennemi : gerbe, son, et secousse **réservée aux tanks**. */
  onEnemyDeath(enemy) {
    const view = this.enemyViews.get(enemy.id);
    if (view) {
      this.juice.burst(view.x, view.y, this.juiceConfig.combat.deathBurst, enemyColor(enemy.type));
    }
    this.juice.play('death');
    // Parcimonie : seule la mort d'un tank secoue l'écran. Si chaque ennemi secouait, la
    // secousse ne voudrait plus rien dire (et le jeu serait illisible en vague 10).
    if (enemy.type === 'tank') this.juice.shake('tankDeath');
    this.popEnemyView(enemy, { leaked: false });
  }

  /**
   * Retire la vue d'un ennemi : il implose s'il a été tué, il gonfle s'il a atteint la
   * base — deux issues opposées, deux animations opposées.
   */
  popEnemyView(enemy, { leaked = false } = {}) {
    const view = this.enemyViews.get(enemy.id);
    if (!view) return;
    this.enemyViews.delete(enemy.id);
    this.stopFighterTweens(view);

    this.scene.tweens.killTweensOf(view);
    this.scene.tweens.add({
      targets: view,
      scale: leaked ? 1.6 : 0.2,
      alpha: 0,
      duration: this.juiceConfig.combat.deathMs * 0.9,
      ease: 'Quad.easeOut',
      onComplete: () => view.destroy(),
    });
  }

  onBaseDamage() {
    this.refreshBaseBar();
    this.baseRect.setFillStyle(COLORS.baseHit, 1);
    this.scene.time.delayedCall(this.juiceConfig.base.flashMs, () => {
      if (this.baseRect.active) this.baseRect.setFillStyle(COLORS.base, 1);
    });

    // Le seul feedback plein écran du jeu : la base encaisse, tout tremble et rougit.
    this.juice.shake('baseDamage');
    this.juice.flashVignette();
    this.juice.play('baseHit');
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

  /**
   * Point visuel d'un combattant : sa vue si elle existe, l'axe du couloir sinon.
   *
   * Le repli couvre le cas où la cible vient de mourir dans le même tick que le tir qui l'a
   * tuée — sa vue est déjà partie, sa progression est encore là.
   */
  fighterPoint(view, progress) {
    if (view?.active) return { x: view.x, y: view.y };
    return lanePoint(this.zone, progress / this.config.laneLength);
  }

  onUnitAttack({ from, target, hits, unit, splashRadius, role }) {
    const zone = this.zone;
    if (!zone) return;

    // **Le trait part et arrive où les corps sont vraiment**, décalage de répartition compris.
    // Depuis que les combattants ne marchent plus tous sur l'axe, un tracé calculé sur la
    // seule progression rate visiblement sa cible — il traverse la vague sans toucher
    // personne pendant qu'un ennemi meurt deux rangs plus bas.
    const shooterView = this.unitViews.get(unit.id);
    const targetView = this.enemyViews.get(target.id);

    this.tracers.push({
      from: this.fighterPoint(shooterView, from),
      to: this.fighterPoint(targetView, target.progress),
      color: unitColor(unit.type),
      age: 0,
      splash:
        role === 'aoe' || role === 'slow'
          ? (splashRadius / this.config.laneLength) * zone.laneLengthPx
          : 0,
    });

    // Le gel a son propre son depuis le Lot 5 : c'était la seule attaque muette du jeu,
    // alors que c'est elle qui achète du temps — l'entendre, c'est savoir qu'elle a pris.
    this.juice.play(role === 'slow' ? 'slow' : 'shot');
    // Recul du tireur, vers la base : le coup a un poids, même quand la cible meurt.
    this.recoil(this.unitViews.get(unit.id), 1);

    for (const hit of hits) {
      if (hit.killed) continue;
      this.flashFighter(this.enemyViews.get(hit.enemy.id));
    }
  }

  /** Corps à corps ennemi : l'unité touchée encaisse, et recule dans l'autre sens. */
  onEnemyAttack(unit) {
    const view = this.unitViews.get(unit.id);
    this.flashFighter(view);
    this.recoil(view, 1);
  }

  /**
   * Petit recul du corps du combattant, **dans son conteneur**.
   *
   * La position du conteneur est réécrite à chaque frame depuis le modèle : c'est donc la
   * forme qui recule, pas la vue. Sans cette ruse, le recul serait effacé à la frame
   * suivante et on ne verrait rien.
   */
  recoil(view, direction) {
    if (!view?.active) return;
    const zone = this.zone;
    const shape = view.getData('shape');
    if (!shape) return;

    const combat = this.juiceConfig.combat;
    const axis = zone.horizontal ? 'x' : 'y';
    // On arrête **le recul précédent**, pas tous les tweens de la forme : un
    // `killTweensOf` global tuerait le flash de touche en cours et laisserait le
    // combattant à demi transparent pour toujours.
    view.getData('recoilTween')?.stop();
    shape[axis] = combat.recoilPx * direction;
    view.setData(
      'recoilTween',
      this.scene.tweens.add({
        targets: shape,
        [axis]: 0,
        duration: combat.recoilMs,
        ease: 'Quad.easeOut',
      })
    );
  }

  /** Éclair blanc sur un combattant touché — même feedback des deux côtés. */
  flashFighter(view) {
    if (!view?.active) return;
    const shape = view.getData('shape');
    if (!shape) return;

    // Même précaution que pour le recul : on ne coupe que le flash précédent.
    view.getData('flashTween')?.stop();
    shape.setAlpha(0.45);
    view.setData(
      'flashTween',
      this.scene.tweens.add({
        targets: shape,
        alpha: 1,
        duration: this.juiceConfig.combat.hitFlashMs,
      })
    );
  }

  /** Arrête les tweens posés sur la **forme** d'un combattant, avant de le détruire. */
  stopFighterTweens(view) {
    view.getData('recoilTween')?.stop();
    view.getData('flashTween')?.stop();
  }

  drawTracers(deltaMs) {
    const graphics = this.tracerGraphics;
    graphics.clear();
    if (this.tracers.length === 0) return;

    const tracerMs = this.juiceConfig.combat.tracerMs;
    for (let i = this.tracers.length - 1; i >= 0; i -= 1) {
      const tracer = this.tracers[i];
      tracer.age += deltaMs;
      const life = 1 - tracer.age / tracerMs;
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

  /**
   * Bandeau d'annonce, au début de chaque préparation.
   *
   * Il **reste affiché pendant toute la préparation** (playtest du Lot 3.5 : un bandeau qui
   * apparaît et disparaît en une seconde ne se lit pas, surtout au doigt sur un téléphone
   * où l'œil est sur la grille). Il ne s'efface qu'au lancement de la vague, et ce qu'il
   * disait continue de vivre dans la barre de décision — qui bascule alors sur ce qu'il
   * **reste** à encaisser.
   *
   * La vague 1 y a droit comme les autres : c'est la première chose que voit un joueur, et
   * lui montrer d'emblée que le jeu **prévient** est ce qui lui apprend à lire l'annonce.
   */
  onWaveCountdown({ wave, label, composition }) {
    // `label` est un **descripteur** rendu par le modèle, pas une phrase : c'est ici, au
    // rendu, qu'il devient du texte dans la langue du joueur.
    const texture = waveLabelText(label);
    const title = texture ? t('hud.waveNamed', { wave, label: texture }) : t('hud.wave', { wave });
    this.announceText = `${title}\n${compositionText(composition)}`;
    this.announceSeconds = -1;
    this.showAnnounce();
  }

  /** Fait entrer le bandeau d'annonce, et l'y laisse. */
  showAnnounce() {
    const ui = this.juiceConfig.ui;
    this.announceVisible = true;
    this.banner.setText(this.announceText).setAlpha(0).setScale(0.7);
    this.scene.tweens.killTweensOf(this.banner);
    this.scene.tweens.add({
      targets: this.banner,
      alpha: 1,
      scale: 1,
      duration: ui.bannerInMs,
      ease: 'Back.easeOut',
    });
  }

  /**
   * Réécrit la ligne de compte à rebours du bandeau, une fois par seconde.
   *
   * Appelé depuis la boucle : `setText` reconstruit une texture, le faire 60 fois par
   * seconde pour un nombre qui change une fois par seconde serait du gaspillage pur.
   */
  refreshAnnounce(countdown) {
    if (!this.announceVisible || !countdown.pending) return;
    const seconds = Math.ceil(countdown.remainingMs / 1000);
    if (seconds === this.announceSeconds) return;
    this.announceSeconds = seconds;
    this.banner.setText(`${this.announceText}\n${t('hud.countdown', { seconds })}`);
  }

  /** Efface le bandeau : la vague commence, la lecture est finie. */
  hideAnnounce() {
    if (!this.announceVisible) return;
    this.announceVisible = false;
    const ui = this.juiceConfig.ui;
    this.scene.tweens.killTweensOf(this.banner);
    this.scene.tweens.add({
      targets: this.banner,
      alpha: 0,
      scale: 1.15,
      duration: ui.bannerOutMs,
      ease: 'Quad.easeIn',
    });
  }

  /** La base vient d'être renforcée par un draft : la jauge remonte, en vert. */
  onBaseHeal(amount) {
    this.refreshBaseBar();
    if (!(amount > 0)) return;
    const zone = this.zone;
    if (!zone) return;
    this.juice.burst(
      zone.base.x + zone.base.width / 2,
      zone.base.y + zone.base.height / 2,
      this.juiceConfig.combat.deathBurst,
      COLORS.baseFill
    );
  }

  /**
   * La vague part : le grand bandeau s'efface, et la barre de décision prend le relais avec
   * la version compacte (icônes + décompte de ce qui reste), visible tout le combat.
   */
  onWaveStart() {
    this.hideAnnounce();
    this.juice.play('wave');
  }

  /** Feedback du tap refusé : la file crie qu'elle est pleine — mais plus pour longtemps. */
  showBlockedHint() {
    const hintMs = this.juiceConfig.ui.hintMs;
    this.scene.tweens.killTweensOf(this.hint);
    this.hint.setAlpha(1).setScale(1);
    this.scene.tweens.add({
      targets: this.hint,
      alpha: 0,
      duration: hintMs,
      ease: 'Quad.easeIn',
    });

    for (const view of this.slotViews) view.setFillStyle(COLORS.slotBlocked, 1);
    this.pulseGauge();
    this.scene.time.delayedCall(hintMs * 0.6, () => this.restoreSlotColors());
  }

  /** La jauge de sortie sursaute : quelque chose vient de partir, ou de se bloquer. */
  pulseGauge() {
    this.scene.tweens.killTweensOf(this.gauge);
    this.scene.tweens.add({
      targets: this.gauge,
      scaleY: { from: 2.4, to: 1 },
      duration: this.juiceConfig.ui.gaugePulseMs,
      ease: 'Back.easeOut',
    });
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
      if (!view) continue;
      this.positionFighterView(view, enemy, alpha, COLORS.enemyHpFill);
      this.animateFighter(view, deltaMs);
    }
    for (const unit of this.model.units) {
      const view = this.unitViews.get(unit.id);
      if (!view) continue;
      this.positionFighterView(view, unit, alpha, COLORS.unitHpFill);
      this.animateFighter(view, deltaMs);
    }
    // Les vignettes de la file **attendent** : elles jouent l'arrêt, jamais la marche.
    for (const view of this.queueViews.values()) this.animateFighter(view, deltaMs, 'idle');

    this.drawTracers(deltaMs);
    this.refreshBaseBar();
    this.refreshGauge();
    this.refreshAnnounce(this.model.countdown());
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
    const signature = `${Math.ceil(hud.baseHp)}|${hud.maxBaseHp}|${hud.queueLength}|${hud.slotCount}|${hud.blocked}`;
    if (signature === this.hudSignature) return;
    this.hudSignature = signature;

    this.hpText.setText(t('hud.baseHp', { current: Math.ceil(hud.baseHp), max: hud.maxBaseHp }));
    this.queueText.setText(t('hud.queue', { current: hud.queueLength, max: hud.slotCount }));
    this.queueText.setColor(hud.blocked ? COLORS.textWarn : COLORS.textDim);
  }

  // ------------------------------------------------------------------ fin de vie

  destroy() {
    for (const off of this.unsubscribes) off();
    this.unsubscribes = [];
    for (const piece of Object.values(this.decor ?? {})) piece?.destroy();
    this.clearTelegraphs();
    for (const view of [
      ...this.enemyViews.values(),
      ...this.unitViews.values(),
      ...this.queueViews.values(),
    ]) {
      this.stopFighterTweens(view);
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
