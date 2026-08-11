import { describe, it, expect, beforeEach } from 'vitest';
import balance from '../src/config/balance.json';
import { GameSession, SESSION_DROP } from '../src/systems/GameSession.js';
import { UNIT_DROP } from '../src/systems/BattleModel.js';
import { EventBus } from '../src/systems/eventBus.js';
import { DROP } from '../src/systems/GridModel.js';

/**
 * Tests du **pont** grille → bande : ce que le Lot 2 ajoute par-dessus deux modèles déjà
 * testés séparément. Tout est déterministe, sans Phaser ni horloge.
 */

const PATTERN = balance.battle.unitTypePattern;
const SLOT_COUNT = balance.battle.slotCount;
const QUEUE_SIZE = balance.battle.queueSize;

function makeSession(overrides) {
  // `rng: () => 0` fige le spawner d'items : les apparitions automatiques ne viennent
  // pas perturber les cases posées à la main.
  return new GameSession({ balance, rng: () => 0, ...overrides });
}

/** Pose deux items de même tier sur deux cases et les fusionne par un lâcher. */
function mergeOnGrid(session, tier, from = 0, to = 1) {
  session.grid.placeItem(from, tier, { silent: true });
  session.grid.placeItem(to, tier, { silent: true });
  return session.applyDrop(from, to);
}

describe('GameSession — le pont grille → bande', () => {
  let session;
  beforeEach(() => {
    session = makeSession();
  });

  it('fait naître une unité du **tier fusionné**, pas du tier résultant', () => {
    const result = mergeOnGrid(session, 4);

    expect(result.type).toBe(DROP.MERGE);
    expect(result.tier).toBe(4);
    expect(session.grid.itemAt(1).tier).toBe(5); // l'item restant monte d'un cran
    expect(session.battle.slots[0]).toMatchObject({ tier: 4 });
  });

  it('donne à l’unité le type annoncé par la file, puis avance la file', () => {
    expect(session.hud().nextUnitType).toBe(PATTERN[0]);

    mergeOnGrid(session, 1, 0, 1);
    expect(session.battle.slots[0].type).toBe(PATTERN[0]);
    expect(session.hud().nextUnitType).toBe(PATTERN[1]);

    mergeOnGrid(session, 1, 2, 3);
    expect(session.battle.slots[1].type).toBe(PATTERN[1]);
  });

  it('transmet la case de départ pour que le rendu fasse voler l’item', () => {
    const origins = [];
    session.events.on('unitSpawn', ({ origin }) => origins.push(origin));

    mergeOnGrid(session, 2, 7, 12);
    expect(origins).toEqual([{ kind: 'merge', gridIndex: 12 }]);
  });

  it('remplit les slots un par un, fusion après fusion', () => {
    for (let i = 0; i < SLOT_COUNT; i += 1) {
      mergeOnGrid(session, 1, i * 2, i * 2 + 1);
    }
    expect(session.battle.unitCount()).toBe(SLOT_COUNT);
    expect(session.battle.slots.every((unit) => unit !== null)).toBe(true);
    expect(session.mergeCount).toBe(SLOT_COUNT);
  });

  it('envoie les unités en surplus dans la file d’attente visible', () => {
    for (let i = 0; i < SLOT_COUNT + QUEUE_SIZE; i += 1) {
      session.grid.reset();
      mergeOnGrid(session, 1);
    }
    expect(session.battle.unitCount()).toBe(SLOT_COUNT);
    expect(session.hud().queueLength).toBe(QUEUE_SIZE);
    expect(session.hud().blocked).toBe(true);
  });
});

describe('GameSession — la boucle de pression', () => {
  let session;
  beforeEach(() => {
    session = makeSession();
    // Sature la bande et sa file : c'est l'état que le joueur doit débloquer.
    for (let i = 0; i < SLOT_COUNT + QUEUE_SIZE; i += 1) {
      session.grid.reset();
      mergeOnGrid(session, 1);
    }
    session.grid.reset();
  });

  it('refuse une fusion de grille quand la bande et la file sont pleines', () => {
    const blocked = [];
    session.events.on('mergeBlocked', (payload) => blocked.push(payload));

    session.grid.placeItem(0, 3, { silent: true });
    session.grid.placeItem(1, 3, { silent: true });
    const result = session.applyDrop(0, 1);

    expect(result.type).toBe(SESSION_DROP.BLOCKED);
    expect(blocked).toHaveLength(1);
    // Les deux items restent en place : rien ne doit disparaître pour rien.
    expect(session.grid.itemAt(0).tier).toBe(3);
    expect(session.grid.itemAt(1).tier).toBe(3);
    expect(session.battle.unitCount()).toBe(SLOT_COUNT);
  });

  it('laisse passer les déplacements et les lâchers invalides', () => {
    session.grid.placeItem(0, 3, { silent: true });
    session.grid.placeItem(5, 4, { silent: true });

    expect(session.applyDrop(0, 2).type).toBe(DROP.MOVE);
    expect(session.applyDrop(2, 5).type).toBe(DROP.INVALID);
  });

  it('débloque la grille dès qu’une fusion d’unités libère un slot', () => {
    // Deux unités identiques adjacentes existent : le motif de types se répète.
    const slots = session.battle.slots;
    slots[0].type = slots[1].type;
    slots[0].tier = slots[1].tier;

    expect(session.applyUnitDrop(0, 1).type).toBe(UNIT_DROP.MERGE);
    // Le slot libéré est repris par la file : une place s'ouvre en file, pas sur la bande.
    expect(session.battle.unitCount()).toBe(SLOT_COUNT);
    expect(session.hud().queueLength).toBe(QUEUE_SIZE - 1);
    expect(session.hud().blocked).toBe(false);

    session.grid.placeItem(0, 2, { silent: true });
    session.grid.placeItem(1, 2, { silent: true });
    expect(session.applyDrop(0, 1).type).toBe(DROP.MERGE);
  });

  it('ne bloque plus rien après un game over (la partie est finie, pas coincée)', () => {
    session.battle.endGame();
    session.grid.placeItem(0, 2, { silent: true });
    session.grid.placeItem(1, 2, { silent: true });
    // La fusion est refusée : la bande sature toujours. Aucune exception, aucun état bancal.
    expect(session.applyDrop(0, 1).type).toBe(SESSION_DROP.BLOCKED);
  });
});

describe('GameSession — HUD', () => {
  it('expose tout ce dont l’écran a besoin, sans que la scène fouille les modèles', () => {
    const session = makeSession();
    const hud = session.hud();

    expect(hud).toMatchObject({
      baseHp: balance.battle.baseHp,
      maxBaseHp: balance.battle.baseHp,
      wave: 0,
      wavesCleared: 0,
      queueLength: 0,
      queueSize: QUEUE_SIZE,
      mergeCount: 0,
      blocked: false,
    });
    expect(hud.nextUnitLabel).toBe(balance.units[PATTERN[0]].label);
    expect(hud.followingUnitLabel).toBe(balance.units[PATTERN[1]].label);
  });

  it('suit la partie : vague en cours et vagues survécues', () => {
    const session = makeSession().start();
    expect(session.hud().wave).toBe(0);

    // Frames de 100 ms, comme en jeu : le modèle plafonne le rattrapage par frame.
    const frames = Math.ceil(balance.waves.firstWaveDelayMs / balance.battle.tickMs) + 1;
    for (let i = 0; i < frames; i += 1) session.update(balance.battle.tickMs);

    expect(session.hud().wave).toBe(1);
    expect(session.hud().phase).toBe('wave');
  });
});

describe('GameSession — démarrage et remise à zéro', () => {
  it('pose les items de départ et arme la première vague', () => {
    const session = makeSession().start();
    expect(session.grid.count()).toBe(balance.itemSpawner.startingItems);
    expect(session.battle.phase).toBe('pause');
  });

  it('ne fait plus apparaître d’items après le game over', () => {
    const session = makeSession().start();
    session.battle.endGame();
    expect(session.trySpawnItem()).toBeNull();
  });

  it('libère tous ses écouteurs à la destruction', () => {
    const bus = new EventBus();
    const session = new GameSession({ balance, bus });
    expect(bus.listenerCount('merge')).toBe(1);

    session.destroy();
    expect(bus.listenerCount('merge')).toBe(0);
    expect(session.destroyed).toBe(true);

    // Détruire deux fois ne doit rien casser.
    session.destroy();
  });

  it('enchaîne deux parties sur un bus partagé sans rien traîner de la première', () => {
    const bus = new EventBus();

    const first = new GameSession({ balance, bus, rng: () => 0 }).start();
    for (let i = 0; i < SLOT_COUNT; i += 1) {
      first.grid.reset();
      mergeOnGrid(first, 3);
    }
    first.update(60_000);
    first.battle.damageBase(balance.battle.baseHp);

    expect(first.over).toBe(true);
    const firstUnits = first.battle.unitCount();
    const firstMerges = first.mergeCount;
    first.destroy();

    // Aucun écouteur de la partie 1 ne doit survivre : sinon la partie 2 verrait ses
    // fusions comptées deux fois. C'est le bug classique du « rejouer ».
    expect(bus.listenerCount('merge')).toBe(0);

    const second = new GameSession({ balance, bus, rng: () => 0 }).start();
    expect(second.over).toBe(false);
    expect(second.mergeCount).toBe(0);
    expect(second.battle.unitCount()).toBe(0);
    expect(second.battle.baseHp).toBe(balance.battle.baseHp);
    expect(second.hud().nextUnitType).toBe(PATTERN[0]);

    for (let i = 0; i < SLOT_COUNT; i += 1) {
      second.grid.reset();
      mergeOnGrid(second, 3);
    }
    expect(second.mergeCount).toBe(firstMerges);
    expect(second.battle.unitCount()).toBe(firstUnits);
    expect(second.battle.slots.map((unit) => unit.type)).toEqual(
      first.battle.slots.map((unit) => unit.type)
    );
    second.destroy();
  });

  it('joue deux parties identiques quand on rejoue les mêmes gestes', () => {
    const play = () => {
      const session = makeSession().start();
      for (let step = 0; step < 40; step += 1) {
        session.update(250);
        const free = session.grid.emptyIndices();
        if (free.length > 0) session.trySpawnItem();
        // Tente systématiquement la première fusion possible.
        for (let a = 0; a < session.grid.size; a += 1) {
          for (let b = 0; b < session.grid.size; b += 1) {
            if (session.grid.canMerge(a, b)) {
              session.applyDrop(a, b);
              a = session.grid.size;
              break;
            }
          }
        }
      }
      return {
        baseHp: session.battle.baseHp,
        wave: session.battle.wave,
        merges: session.mergeCount,
        units: session.battle.slots.map((unit) => (unit ? `${unit.type}${unit.tier}` : '-')),
      };
    };

    expect(play()).toEqual(play());
  });
});
