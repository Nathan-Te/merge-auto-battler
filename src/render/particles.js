/**
 * Champ de particules **poolé** — greybox : des carrés colorés, rien d'autre.
 *
 * Contrainte du Lot 3 : 60 fps sur mobile milieu de gamme avec le cap d'unités atteint et
 * une grosse vague à l'écran. D'où trois choix, tous dictés par le profil d'allocation :
 *
 *   - **un seul `Graphics`** pour tout le champ, redessiné à chaque frame, plutôt qu'un
 *     GameObject par particule (créer/détruire 200 objets par seconde tue le GC mobile) ;
 *   - **un pool de taille fixe** alloué au démarrage : `emit()` réutilise un emplacement
 *     mort, et n'alloue **jamais** — quand le pool est plein, la plus vieille particule
 *     est recyclée. Une particule perdue est invisible ; une pause GC ne l'est pas ;
 *   - **aucun objet créé dans `update()`** : les particules sont des enregistrements plats
 *     mutés en place.
 *
 * Aucune règle de gameplay ici (cf. `CLAUDE.md`) : les intensités viennent de `juice.json`,
 * l'appelant décide quoi émettre et où.
 */

export class ParticleField {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} options
   * @param {number} options.poolSize Particules simultanées maximum
   * @param {number} options.gravityPx Accélération verticale, en px/s²
   * @param {number} options.dragPerSecond Frottement (1.6 = la vitesse fond vite)
   * @param {number} [options.depth]
   */
  constructor(scene, { poolSize, gravityPx, dragPerSecond, depth = 0 }) {
    this.scene = scene;
    this.gravityPx = gravityPx;
    this.dragPerSecond = dragPerSecond;
    this.graphics = scene.add.graphics().setDepth(depth);

    /** Pool figé : tout est alloué ici, une fois pour toutes. */
    this.pool = Array.from({ length: Math.max(1, Math.floor(poolSize)) }, () => ({
      active: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      lifeMs: 0,
      maxLifeMs: 1,
      size: 1,
      color: 0xffffff,
    }));
    /** Curseur de recyclage : évite de rebalayer le pool à chaque émission. */
    this.cursor = 0;
    this.activeCount = 0;
  }

  /** Emplacement libre, ou le plus ancien si le pool est saturé. */
  claim() {
    const { pool } = this;
    for (let i = 0; i < pool.length; i += 1) {
      const particle = pool[this.cursor];
      this.cursor = (this.cursor + 1) % pool.length;
      if (!particle.active) return particle;
    }
    // Pool plein : on écrase l'emplacement suivant. Perdre une particule est préférable à
    // en allouer une — c'est exactement le cas que le pool existe pour couvrir.
    const particle = pool[this.cursor];
    this.cursor = (this.cursor + 1) % pool.length;
    return particle;
  }

  /**
   * Émet une gerbe de particules depuis un point.
   *
   * @param {number} x
   * @param {number} y
   * @param {object} options
   * @param {number} options.count
   * @param {number} options.speedPx Vitesse initiale, en px/s (variée de ±40 %)
   * @param {number} options.lifeMs
   * @param {number} options.sizePx
   * @param {number} options.color
   * @param {number} [options.spread] Ouverture en radians (2π par défaut : tout autour)
   * @param {number} [options.angle] Direction centrale, en radians
   */
  burst(x, y, { count, speedPx, lifeMs, sizePx, color, spread = Math.PI * 2, angle = 0 }) {
    for (let i = 0; i < count; i += 1) {
      // Répartition régulière plutôt qu'aléatoire : une gerbe lisible, et rien à tirer.
      const theta = angle + spread * (i / Math.max(1, count) - 0.5);
      const speed = speedPx * (0.6 + 0.8 * ((i * 7919) % 100) / 100);
      this.spawn(x, y, Math.cos(theta) * speed, Math.sin(theta) * speed, {
        lifeMs,
        sizePx,
        color,
      });
    }
  }

  /** Émet **une** particule. C'est ce qu'utilisent les traînées. */
  spawn(x, y, vx, vy, { lifeMs, sizePx, color }) {
    const particle = this.claim();
    if (!particle.active) this.activeCount += 1;
    particle.active = true;
    particle.x = x;
    particle.y = y;
    particle.vx = vx;
    particle.vy = vy;
    particle.lifeMs = lifeMs;
    particle.maxLifeMs = Math.max(1, lifeMs);
    particle.size = sizePx;
    particle.color = color;
  }

  /**
   * Intègre et redessine. Un seul `clear()` + N `fillRect` : le coût est linéaire en
   * particules vivantes, et nul quand il n'y en a pas.
   */
  update(deltaMs) {
    const graphics = this.graphics;
    graphics.clear();
    if (this.activeCount === 0) return;

    const seconds = Math.min(deltaMs, 100) / 1000; // une frame longue ne téléporte rien
    const drag = Math.max(0, 1 - this.dragPerSecond * seconds);

    for (const particle of this.pool) {
      if (!particle.active) continue;

      particle.lifeMs -= deltaMs;
      if (particle.lifeMs <= 0) {
        particle.active = false;
        this.activeCount -= 1;
        continue;
      }

      particle.vy += this.gravityPx * seconds;
      particle.vx *= drag;
      particle.vy *= drag;
      particle.x += particle.vx * seconds;
      particle.y += particle.vy * seconds;

      const life = particle.lifeMs / particle.maxLifeMs;
      const size = particle.size * (0.35 + 0.65 * life);
      graphics.fillStyle(particle.color, life);
      graphics.fillRect(particle.x - size / 2, particle.y - size / 2, size, size);
    }
  }

  /** Éteint tout sans rien désallouer (changement de partie). */
  reset() {
    for (const particle of this.pool) particle.active = false;
    this.activeCount = 0;
    this.graphics.clear();
  }

  destroy() {
    this.graphics.destroy();
    this.pool.length = 0;
    this.activeCount = 0;
  }
}

export default ParticleField;
