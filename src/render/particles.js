/**
 * Champ de particules **poolé** — des carrés colorés, rien d'autre.
 *
 * ## Pourquoi des carrés, et pourquoi ils sont maintenant sur la grille
 *
 * Le carré était au départ le choix du greybox : la forme la moins chère à dessiner. La
 * bascule en pixel art en a fait le bon choix tout court — un effet de particules cohérent
 * avec du pixel art est fait de **pixels d'art**, pas de petits carrés de taille quelconque
 * posés à des coordonnées quelconques. Deux conséquences, et elles tiennent dans `pixelSize` :
 *
 *   - **la taille d'une particule est un multiple entier du pixel d'art.** Une particule de
 *     5,3 px sur une trame de 3 px n'appartient à aucun dessin ; arrondie à 6, elle est deux
 *     pixels d'art, ce qui se lit ;
 *   - **sa position est alignée sur la même trame.** Elle continue de se déplacer en
 *     flottant — la physique doit rester lisse, sinon une gerbe lente avance par à-coups —
 *     mais elle est **dessinée** sur la grille. C'est exactement ce que fait un jeu pixel art
 *     qui bouge bien : simuler fin, afficher grossier.
 *
 * Les intensités, elles, n'ont pas bougé de `juice.json` : `sizePx` y reste une taille en
 * unités de jeu, et c'est ici qu'elle rencontre la trame. Un réglage de feel ne doit pas
 * avoir à connaître la résolution native, sans quoi il faudrait le refaire à chaque écran.
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

import { snapToArtGrid, snapToArtPixels } from '../systems/pixelScale.js';

export class ParticleField {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} options
   * @param {number} options.poolSize Particules simultanées maximum
   * @param {number} options.gravityPx Accélération verticale, en px/s²
   * @param {number} options.dragPerSecond Frottement (1.6 = la vitesse fond vite)
   * @param {number} [options.depth]
   * @param {number} [options.pixelSize] Côté d'un pixel d'art, en unités de jeu
   */
  constructor(scene, { poolSize, gravityPx, dragPerSecond, depth = 0, pixelSize = 1 }) {
    this.scene = scene;
    this.gravityPx = gravityPx;
    this.dragPerSecond = dragPerSecond;
    /**
     * Trame de dessin. Vaut 1 tant que personne ne l'a réglée, ce qui redonne exactement le
     * comportement d'avant la bascule : un champ de particules doit fonctionner même monté
     * par une vue qui ne sait rien du pixel art.
     */
    this.pixelSize = Math.max(1, Math.floor(pixelSize));
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

  /**
   * Change la trame de dessin. Appelée à chaque relayout : la taille d'un pixel d'art dépend
   * de la place que le layout accorde à la grille, donc elle change avec l'écran et à la
   * rotation. Rien à recalculer par ailleurs — la trame n'est lue qu'au dessin.
   */
  setPixelSize(pixelSize) {
    this.pixelSize = Math.max(1, Math.floor(pixelSize));
    return this;
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
    const unit = this.pixelSize;

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
      // La particule **rétrécit par paliers entiers** de pixels d'art au lieu de fondre en
      // continu : c'est la même information (elle s'éteint), dite dans le vocabulaire du
      // dessin. Un carré qui passe de 5,3 à 5,1 px ne raconte rien à personne.
      const size = snapToArtPixels(particle.size * (0.35 + 0.65 * life), unit);
      graphics.fillStyle(particle.color, life);
      // Position simulée en flottant, **dessinée** sur la grille : le mouvement reste lisse
      // et l'image reste alignée. Le décalage d'un demi-pixel centre le carré sur son point.
      graphics.fillRect(
        snapToArtGrid(particle.x - size / 2, unit),
        snapToArtGrid(particle.y - size / 2, unit),
        size,
        size
      );
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
