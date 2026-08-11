import Phaser from 'phaser';

/**
 * Scène de validation du Lot 0.
 *
 * Elle ne contient aucun gameplay : elle prouve que la chaîne complète
 * (Vite -> Phaser -> build -> GitHub Pages -> téléphone) fonctionne, et que les
 * briques dont les lots suivants dépendent sont opérationnelles :
 *   - rendu et canvas responsive (portrait / paysage, sans déformation) ;
 *   - physique arcade (gravité, rebond, collisions) ;
 *   - input unifié souris + tactile (drag, multi-touch) ;
 *   - boucle de jeu fluide, mesurée par le compteur FPS.
 *
 * Aucune valeur ci-dessous n'est une stat de gameplay : `balance.json` reste vide
 * au Lot 0 (cf. src/config/balance.schema.md).
 */

/** Réglages purement visuels / de démo, propres à cette scène. */
const DEMO = {
  spawnIntervalMs: 700,
  maxCircles: 26,
  minRadius: 16,
  maxRadius: 34,
  bounce: 0.72,
  drag: 60,
  /** Fraction de la vitesse du doigt imprimée au cercle au relâcher. */
  throwFactor: 0.85,
  maxThrowSpeed: 1800,
  groundHeight: 56,
};

const PALETTE = [0xff6b6b, 0xffd93d, 0x6bcb77, 0x4d96ff, 0xb983ff, 0x4ecdc4];

const COLORS = {
  sky: 0x12141c,
  ground: 0x2b2f45,
  groundEdge: 0x4d96ff,
  text: '#eef1f8',
  textDim: '#8f97b0',
};

export default class ValidationScene extends Phaser.Scene {
  constructor() {
    super('ValidationScene');
    /** @type {Phaser.GameObjects.Arc[]} */
    this.circles = [];
    this.fpsAccumulator = 0;
  }

  create() {
    const { width, height } = this.scale.gameSize;
    this.circles = []; // le constructeur ne rejoue pas sur un restart de scène

    // Le drag tactile a besoin de plus d'un pointeur pour rester agréable :
    // deux doigts qui attrapent deux cercles doivent fonctionner.
    this.input.addPointer(3);

    this.background = this.add
      .rectangle(0, 0, width, height, COLORS.sky)
      .setOrigin(0, 0)
      .setDepth(-10);

    this.ground = this.add
      .rectangle(0, 0, width, DEMO.groundHeight, COLORS.ground)
      .setOrigin(0, 0)
      .setDepth(-5);
    this.physics.add.existing(this.ground, true);

    this.groundEdge = this.add
      .rectangle(0, 0, width, 2, COLORS.groundEdge)
      .setOrigin(0, 0)
      .setDepth(-4);

    this.title = this.add
      .text(0, 0, 'Merge Battler — Lot 0', {
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        fontSize: '28px', // recalculé selon la largeur dans layout()
        fontStyle: 'bold',
        color: COLORS.text,
      })
      .setOrigin(0.5, 0)
      .setDepth(10)
      .setResolution(this.textResolution());

    this.subtitle = this.add
      .text(0, 0, 'Attrape et lance les cercles — doigt ou souris', {
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        fontSize: '15px',
        color: COLORS.textDim,
      })
      .setOrigin(0.5, 0)
      .setDepth(10)
      .setResolution(this.textResolution());

    // HUD en bas à gauche : en portrait étroit, le titre centré occupe toute la
    // largeur du haut de l'écran.
    this.hud = this.add
      .text(0, 0, '', {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '13px',
        color: COLORS.textDim,
        lineSpacing: 2,
      })
      .setOrigin(0, 1)
      .setDepth(10)
      .setResolution(this.textResolution());

    // Un seul collider pour tout le groupe (plutôt qu'un par cercle), et les
    // cercles se repoussent entre eux : le tas au sol reste lisible.
    this.circleGroup = this.physics.add.group();
    this.physics.add.collider(this.circleGroup, this.ground);
    this.physics.add.collider(this.circleGroup, this.circleGroup);

    this.registerDragHandlers();

    this.spawnTimer = this.time.addEvent({
      delay: DEMO.spawnIntervalMs,
      loop: true,
      callback: () => this.spawnCircle(),
    });

    this.scale.on('resize', this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.handleResize, this);
    });

    this.layout(width, height);

    // Quelques cercles d'emblée : l'écran ne doit jamais être vide au chargement.
    for (let i = 0; i < 5; i += 1) this.spawnCircle();
  }

  /** Texte net sur écran haute densité, sans exploser le fillrate au-delà de 2x. */
  textResolution() {
    return Math.min(window.devicePixelRatio || 1, 2);
  }

  // ---------------------------------------------------------------- layout

  handleResize(gameSize) {
    this.layout(gameSize.width, gameSize.height);
  }

  layout(width, height) {
    if (width === 0 || height === 0) return;

    this.physics.world.setBounds(0, 0, width, height);

    this.background.setSize(width, height);

    const groundTop = height - DEMO.groundHeight;
    this.ground.setPosition(0, groundTop).setSize(width, DEMO.groundHeight);
    this.ground.body.updateFromGameObject();
    this.groundEdge.setPosition(0, groundTop).setSize(width, 2);

    // Le titre s'adapte à la largeur : sur un téléphone étroit en portrait, une
    // taille fixe déborderait.
    this.title.setFontSize(Phaser.Math.Clamp(Math.round(width * 0.062), 20, 34));
    this.subtitle.setFontSize(Phaser.Math.Clamp(Math.round(width * 0.036), 12, 17));

    this.title.setPosition(width / 2, Math.max(14, height * 0.035));
    this.subtitle.setPosition(width / 2, this.title.y + this.title.height + 6);
    this.hud.setPosition(12, groundTop - 10);

    // Après une rotation, un cercle peut se retrouver hors écran : on le ramène.
    for (const circle of this.circles) {
      circle.x = Phaser.Math.Clamp(circle.x, circle.radius, width - circle.radius);
      if (circle.y > height - circle.radius) circle.y = height - circle.radius;
    }
  }

  // ---------------------------------------------------------------- cercles

  spawnCircle() {
    if (this.circles.length >= DEMO.maxCircles) this.removeOldestCircle();

    const { width } = this.scale.gameSize;
    const radius = Phaser.Math.Between(DEMO.minRadius, DEMO.maxRadius);
    const x = Phaser.Math.Between(radius, Math.max(radius, width - radius));
    const color = Phaser.Utils.Array.GetRandom(PALETTE);

    const circle = this.add.circle(x, -radius, radius, color);
    this.circleGroup.add(circle); // ajoute et active le corps physique

    circle.body
      .setCircle(radius)
      .setBounce(DEMO.bounce, DEMO.bounce)
      .setDragX(DEMO.drag)
      .setCollideWorldBounds(true);
    circle.body.setVelocityX(Phaser.Math.Between(-60, 60));

    circle
      .setInteractive(
        new Phaser.Geom.Circle(radius, radius, radius),
        Phaser.Geom.Circle.Contains
      )
      .setDepth(1);
    this.input.setDraggable(circle);

    this.circles.push(circle);

    return circle;
  }

  removeOldestCircle() {
    // On ne supprime jamais un cercle qu'un doigt tient : ça casserait le drag.
    const index = this.circles.findIndex((c) => !c.getData('dragging'));
    const victim = this.circles[index === -1 ? 0 : index];
    Phaser.Utils.Array.Remove(this.circles, victim);
    victim.destroy();
  }

  // ------------------------------------------------------------------ input

  registerDragHandlers() {
    // Phaser unifie souris et tactile derrière les mêmes événements de pointeur :
    // un seul chemin de code couvre les deux entrées exigées par le seed doc.
    this.input.on('dragstart', (pointer, circle) => {
      circle.setData('dragging', true);
      circle.setDepth(5);
      circle.body.setAllowGravity(false);
      circle.body.setVelocity(0, 0);
      // Immobile pendant le drag : ce sont les autres cercles qui se font
      // pousser, pas le cercle tenu par le doigt.
      circle.body.setImmovable(true);
      this.tweens.add({
        targets: circle,
        scale: 1.15,
        duration: 120,
        ease: 'Back.easeOut',
      });
    });

    this.input.on('drag', (pointer, circle, dragX, dragY) => {
      const { width, height } = this.scale.gameSize;
      circle.x = Phaser.Math.Clamp(dragX, circle.radius, width - circle.radius);
      circle.y = Phaser.Math.Clamp(dragY, circle.radius, height - circle.radius);
    });

    this.input.on('dragend', (pointer, circle) => {
      circle.setData('dragging', false);
      circle.setDepth(1);
      circle.body.setAllowGravity(true);
      circle.body.setImmovable(false);

      // Le cercle part dans la direction du geste : c'est ce qui rend le drag
      // « physique » plutôt que téléporté.
      const throwX = pointer.velocity.x * DEMO.throwFactor;
      const throwY = pointer.velocity.y * DEMO.throwFactor;
      circle.body.setVelocity(
        Phaser.Math.Clamp(throwX, -DEMO.maxThrowSpeed, DEMO.maxThrowSpeed),
        Phaser.Math.Clamp(throwY, -DEMO.maxThrowSpeed, DEMO.maxThrowSpeed)
      );

      this.tweens.add({
        targets: circle,
        scale: 1,
        duration: 160,
        ease: 'Back.easeOut',
      });
    });
  }

  // ------------------------------------------------------------------ update

  update(time, delta) {
    this.fpsAccumulator += delta;
    if (this.fpsAccumulator < 250) return;
    this.fpsAccumulator = 0;

    const fps = Math.round(this.game.loop.actualFps);
    const { width, height } = this.scale.gameSize;
    const orientation = width >= height ? 'paysage' : 'portrait';

    this.hud.setText(
      `${fps} FPS\n${Math.round(width)}x${Math.round(height)} (${orientation})\n${this.circles.length} cercles`
    );
  }
}
