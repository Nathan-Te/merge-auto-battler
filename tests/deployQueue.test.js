import { describe, it, expect, beforeEach } from 'vitest';
import { DeployQueue } from '../src/systems/DeployQueue.js';
import { EventBus } from '../src/systems/eventBus.js';

/**
 * `DeployQueue` ne lit que deux clés de la config : inutile de charger tout
 * `balance.json` ici, un objet minimal aux nombres ronds rend chaque assertion lisible.
 */
const CONFIG = { slotCount: 3, deployCooldownMs: 1000 };

function makeQueue({ config = CONFIG, canDeploy } = {}) {
  const bus = new EventBus();
  const queue = new DeployQueue({ config, bus, canDeploy });
  const deployed = [];
  const queued = [];
  const rejected = [];
  bus.on('deployUnit', (payload) => deployed.push(payload));
  bus.on('unitQueued', (payload) => queued.push(payload));
  bus.on('queueRejected', (payload) => rejected.push(payload));
  return { queue, bus, deployed, queued, rejected };
}

describe('DeployQueue — mise en file', () => {
  let context;
  beforeEach(() => {
    context = makeQueue();
  });

  it('consomme `enqueueUnit` et place l’unité dans le premier slot libre', () => {
    context.bus.emit('enqueueUnit', { tier: 4, type: 'aoe', origin: { kind: 'tap', gridIndex: 7 } });

    // La file était vide et le cooldown prêt : l'unité repart aussitôt.
    expect(context.queued[0]).toMatchObject({
      position: 0,
      origin: { kind: 'tap', gridIndex: 7 },
    });
    expect(context.queued[0].unit).toMatchObject({ tier: 4, type: 'aoe' });
    expect(context.deployed).toHaveLength(1);
  });

  it('empile les unités suivantes dans l’ordre des slots', () => {
    const { queue, queued } = context;
    queue.enqueue(1, 'single');
    queue.enqueue(2, 'aoe');
    queue.enqueue(3, 'slow');

    expect(queued.map((payload) => payload.position)).toEqual([0, 0, 1]);
    expect(queue.slots.map((unit) => unit.tier)).toEqual([2, 3]);
  });

  it('refuse une unité de plus quand tous les slots sont pris', () => {
    const { queue, rejected } = context;
    // La première part tout de suite, les `slotCount` suivantes remplissent la file.
    for (let i = 0; i < CONFIG.slotCount + 1; i += 1) queue.enqueue(1, 'single');

    expect(queue.canAccept()).toBe(false);
    expect(queue.freeSlots()).toBe(0);
    expect(queue.enqueue(9, 'single')).toBeNull();
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ tier: 9, type: 'single' });
    expect(queue.slots).toHaveLength(CONFIG.slotCount);
  });

  it('se désabonne du bus à la destruction', () => {
    const { queue, bus, queued } = context;
    queue.destroy();
    bus.emit('enqueueUnit', { tier: 1, type: 'single' });
    expect(queued).toHaveLength(0);
    expect(queue.slots).toHaveLength(0);
  });
});

describe('DeployQueue — rythme de sortie', () => {
  it('sort immédiatement quand la file est vide et le cooldown prêt', () => {
    const { queue, deployed } = makeQueue();
    expect(queue.cooldownRatio()).toBe(1);

    queue.enqueue(2, 'single');
    expect(deployed).toHaveLength(1);
    expect(deployed[0]).toMatchObject({ tier: 2, type: 'single' });
    expect(queue.slots).toHaveLength(0);
    expect(queue.cooldownRatio()).toBe(0);
  });

  it('fait attendre les suivantes le temps du cooldown, puis les sort une par une', () => {
    const { queue, deployed } = makeQueue();
    queue.enqueue(1, 'single'); // part tout de suite
    queue.enqueue(2, 'aoe');
    queue.enqueue(3, 'slow');
    expect(deployed).toHaveLength(1);

    queue.update(999);
    expect(deployed).toHaveLength(1);

    queue.update(1);
    expect(deployed).toHaveLength(2);
    expect(deployed[1].tier).toBe(2);

    queue.update(500);
    expect(deployed).toHaveLength(2);
    queue.update(500);
    expect(deployed.map((payload) => payload.tier)).toEqual([1, 2, 3]);
  });

  it('respecte l’ordre FIFO, quels que soient les tiers', () => {
    const { queue, deployed } = makeQueue();
    for (const tier of [5, 1, 9, 3]) queue.enqueue(tier, 'single');

    for (let i = 0; i < 4; i += 1) queue.update(1000);
    expect(deployed.map((payload) => payload.tier)).toEqual([5, 1, 9, 3]);
  });

  it('garde le cooldown prêt tant que rien n’attend', () => {
    const { queue, deployed } = makeQueue();
    queue.update(5000);
    expect(deployed).toHaveLength(0);
    expect(queue.cooldownRatio()).toBe(1);

    // Le joueur qui a laissé sa file se vider n'est pas puni : ça repart aussitôt.
    queue.enqueue(7, 'single');
    expect(deployed).toHaveLength(1);
  });

  it('remplit la jauge proportionnellement au temps écoulé', () => {
    const { queue } = makeQueue();
    queue.enqueue(1, 'single'); // consomme le cooldown
    queue.enqueue(2, 'single'); // reste en file : la jauge devient lisible
    expect(queue.cooldownRatio()).toBe(0);

    queue.update(250);
    expect(queue.cooldownRatio()).toBeCloseTo(0.25);
    queue.update(500);
    expect(queue.cooldownRatio()).toBeCloseTo(0.75);
  });

  it('ignore un delta absurde sans avancer le cooldown', () => {
    const { queue } = makeQueue();
    queue.enqueue(1, 'single');
    queue.enqueue(2, 'single');

    queue.update(NaN);
    queue.update(-500);
    expect(queue.cooldownRatio()).toBe(0);
  });

  it('expose la tête de file — la prochaine à partir', () => {
    const { queue } = makeQueue();
    expect(queue.head()).toBeNull();
    queue.enqueue(1, 'single');
    queue.enqueue(2, 'aoe');
    queue.enqueue(3, 'slow');
    expect(queue.head()).toMatchObject({ tier: 2, type: 'aoe' });
  });
});

describe('DeployQueue — champ de bataille saturé', () => {
  it('retient la sortie sans consommer le cooldown', () => {
    let open = false;
    const { queue, deployed } = makeQueue({ canDeploy: () => open });

    queue.enqueue(1, 'single');
    queue.enqueue(2, 'single');
    expect(deployed).toHaveLength(0);

    queue.update(10_000);
    expect(deployed).toHaveLength(0);
    // Le cooldown est resté prêt : dès que la place se libère, la sortie reprend.
    expect(queue.cooldownRatio()).toBe(1);

    open = true;
    queue.update(16);
    expect(deployed).toHaveLength(1);
    expect(queue.cooldownRatio()).toBe(0);
  });

  it('laisse toujours mettre en file, même champ saturé', () => {
    const { queue } = makeQueue({ canDeploy: () => false });
    expect(queue.enqueue(1, 'single')).not.toBeNull();
    expect(queue.slots).toHaveLength(1);
  });
});

describe('DeployQueue — remise à zéro', () => {
  it('vide la file et remet le cooldown prêt', () => {
    const { queue } = makeQueue();
    queue.enqueue(1, 'single');
    queue.enqueue(2, 'single');

    queue.reset();

    expect(queue.slots).toEqual([]);
    expect(queue.cooldownRatio()).toBe(1);
    expect(queue.canAccept()).toBe(true);
  });
});

describe('DeployQueue — améliorations de draft (Lot 3.5)', () => {
  /**
   * Les modificateurs sont lus **à chaque appel**, jamais figés à la construction : une
   * place gagnée au draft doit s'ouvrir immédiatement, sans reconstruire la file ni perdre
   * ce qu'elle contient.
   */
  function makeModified(modifiers) {
    const bus = new EventBus();
    const deployed = [];
    bus.on('deployUnit', (payload) => deployed.push(payload));
    const queue = new DeployQueue({ config: CONFIG, bus, getModifiers: () => modifiers });
    return { queue, deployed };
  }

  it('ouvre les places supplémentaires sans vider la file', () => {
    const modifiers = { slotBonus: 0, deployCooldown: 1 };
    const { queue } = makeModified(modifiers);

    for (let i = 0; i < CONFIG.slotCount + 1; i += 1) queue.enqueue(1, 'single');
    const before = queue.slots.length;
    expect(queue.canAccept()).toBe(false);

    modifiers.slotBonus = 2;
    expect(queue.slotCount()).toBe(CONFIG.slotCount + 2);
    expect(queue.canAccept()).toBe(true);
    expect(queue.slots).toHaveLength(before);
  });

  it('raccourcit le cooldown de sortie, jauge comprise', () => {
    const { queue, deployed } = makeModified({ slotBonus: 0, deployCooldown: 0.5 });

    queue.enqueue(1, 'single');
    queue.enqueue(2, 'single');
    expect(deployed).toHaveLength(1);
    expect(queue.cooldownMs).toBe(CONFIG.deployCooldownMs * 0.5);

    queue.update(CONFIG.deployCooldownMs * 0.5);
    expect(deployed).toHaveLength(2);
  });
});

