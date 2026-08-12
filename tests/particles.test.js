import { describe, it, expect } from 'vitest';
import { ParticleField } from '../src/render/particles.js';

/**
 * Le pool est une **garantie de performance**, pas un détail d'implémentation : le budget
 * du Lot 3 (60 fps mobile en charge) tient à ce que rien ne soit alloué pendant le jeu.
 * Ces tests vérifient exactement ça — taille constante, recyclage, et redessin borné.
 *
 * `Graphics` est remplacé par un espion : on teste le pool, pas Phaser.
 */

function fakeScene() {
  const calls = { fillRect: 0, clear: 0 };
  const graphics = {
    calls,
    setDepth() {
      return this;
    },
    clear() {
      calls.clear += 1;
    },
    fillStyle() {},
    fillRect() {
      calls.fillRect += 1;
    },
    destroy() {},
  };
  return { scene: { add: { graphics: () => graphics } }, graphics };
}

const OPTIONS = { poolSize: 8, gravityPx: 200, dragPerSecond: 1 };
const SPEC = { lifeMs: 100, sizePx: 4, color: 0xffffff };

describe('ParticleField', () => {
  it('alloue son pool une fois pour toutes', () => {
    const { scene } = fakeScene();
    const field = new ParticleField(scene, OPTIONS);
    expect(field.pool).toHaveLength(8);

    field.burst(0, 0, { count: 6, speedPx: 100, ...SPEC });
    field.update(16);
    expect(field.pool).toHaveLength(8);
  });

  it('ne dépasse jamais la taille du pool, même sous une pluie d’émissions', () => {
    const { scene } = fakeScene();
    const field = new ParticleField(scene, OPTIONS);

    for (let i = 0; i < 50; i += 1) field.burst(0, 0, { count: 10, speedPx: 100, ...SPEC });
    expect(field.activeCount).toBeLessThanOrEqual(8);
    expect(field.pool.filter((particle) => particle.active).length).toBeLessThanOrEqual(8);
  });

  it('recycle les emplacements morts plutôt que d’en créer', () => {
    const { scene } = fakeScene();
    const field = new ParticleField(scene, OPTIONS);

    field.burst(0, 0, { count: 4, speedPx: 100, ...SPEC });
    expect(field.activeCount).toBe(4);

    field.update(SPEC.lifeMs + 1);
    expect(field.activeCount).toBe(0);

    field.burst(0, 0, { count: 4, speedPx: 100, ...SPEC });
    expect(field.activeCount).toBe(4);
  });

  it('ne dessine que les particules vivantes', () => {
    const { scene, graphics } = fakeScene();
    const field = new ParticleField(scene, OPTIONS);

    field.update(16);
    expect(graphics.calls.fillRect).toBe(0);

    field.burst(0, 0, { count: 3, speedPx: 100, ...SPEC });
    field.update(16);
    expect(graphics.calls.fillRect).toBe(3);

    graphics.calls.fillRect = 0;
    field.update(SPEC.lifeMs + 1);
    expect(graphics.calls.fillRect).toBe(0);
  });

  it('fait bouger les particules, gravité comprise', () => {
    const { scene } = fakeScene();
    const field = new ParticleField(scene, OPTIONS);
    field.spawn(10, 10, 100, 0, { lifeMs: 1000, sizePx: 4, color: 0 });

    const particle = field.pool.find((p) => p.active);
    field.update(100);
    expect(particle.x).toBeGreaterThan(10);
    expect(particle.y).toBeGreaterThan(10); // la gravité l'a fait descendre
  });

  it('une frame très longue ne téléporte pas les particules', () => {
    const { scene } = fakeScene();
    const field = new ParticleField(scene, { ...OPTIONS, dragPerSecond: 0 });
    field.spawn(0, 0, 1000, 0, { lifeMs: 5000, sizePx: 4, color: 0 });
    const particle = field.pool.find((p) => p.active);

    field.update(2000); // onglet masqué pendant deux secondes
    expect(particle.x).toBeLessThanOrEqual(100); // plafonné à 100 ms de déplacement
  });

  it('reset éteint tout sans désallouer', () => {
    const { scene } = fakeScene();
    const field = new ParticleField(scene, OPTIONS);
    field.burst(0, 0, { count: 5, speedPx: 100, ...SPEC });
    field.reset();
    expect(field.activeCount).toBe(0);
    expect(field.pool).toHaveLength(8);
  });
});
