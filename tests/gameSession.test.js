import { describe, it, expect, beforeEach } from 'vitest';
import balance from '../src/config/balance.json';
import { GameSession, SESSION_TAP } from '../src/systems/GameSession.js';
import { EventBus } from '../src/systems/eventBus.js';
import { DROP, ITEM_FAMILY } from '../src/systems/GridModel.js';

/**
 * Tests du **pont** grille → champ de bataille : ce que le Lot 2.5 pose par-dessus des
 * modèles déjà testés séparément. Tout est déterministe, sans Phaser ni horloge.
 *
 * La chaîne complète est ici : tap → `enqueueUnit` → `DeployQueue` → `deployUnit` →
 * `BattleModel`.
 */

const PATTERN = balance.battle.unitTypePattern;
const SLOT_COUNT = balance.battle.slotCount;
const COOLDOWN = balance.battle.deployCooldownMs;

function makeSession(overrides) {
  // `rng: () => 0` fige le spawner d'items : les apparitions automatiques ne viennent
  // pas perturber les cases posées à la main.
  return new GameSession({ balance, rng: () => 0, ...overrides });
}

/** Pose un item sur une case et le tape. */
function tapItem(session, index, tier) {
  session.grid.placeItem(index, tier, { silent: true });
  return session.applyTap(index);
}

/** Remplit la file de déploiement (la première unité tapée part tout de suite). */
function fillDeployQueue(session, tier = 1) {
  for (let i = 0; i < SLOT_COUNT + 1; i += 1) tapItem(session, i, tier);
}

describe('GameSession — le tap envoie au combat', () => {
  let session;
  beforeEach(() => {
    session = makeSession();
  });

  it('consomme l’item et met une unité **de son tier** en file', () => {
    const queued = [];
    session.events.on('unitQueued', (payload) => queued.push(payload));

    const result = tapItem(session, 0, 4);

    expect(result).toMatchObject({ type: SESSION_TAP.SENT, tier: 4, index: 0 });
    expect(session.grid.itemAt(0)).toBeNull();
    expect(queued[0].unit).toMatchObject({ tier: 4 });
  });

  it('donne à l’unité le type annoncé par la file de types, puis avance la file', () => {
    expect(session.hud().nextUnitType).toBe(PATTERN[0]);

    expect(tapItem(session, 0, 1).unitType).toBe(PATTERN[0]);
    expect(session.hud().nextUnitType).toBe(PATTERN[1]);
    expect(tapItem(session, 1, 1).unitType).toBe(PATTERN[1]);
  });

  it('transmet la case de départ pour que le rendu fasse voler l’item', () => {
    const origins = [];
    session.events.on('unitQueued', ({ origin }) => origins.push(origin));

    tapItem(session, 12, 2);
    expect(origins).toEqual([{ kind: 'tap', gridIndex: 12 }]);
  });

  it('fait entrer la première unité au combat sans attendre, puis remplit la file', () => {
    tapItem(session, 0, 1);
    expect(session.battle.unitCount()).toBe(1);
    expect(session.hud().queueLength).toBe(0);

    tapItem(session, 1, 1);
    tapItem(session, 2, 1);
    expect(session.battle.unitCount()).toBe(1);
    expect(session.hud().queueLength).toBe(2);
  });

  it('ne fait rien sur une case vide ou après le game over', () => {
    expect(session.applyTap(3).type).toBe(SESSION_TAP.INVALID);

    session.grid.placeItem(0, 1, { silent: true });
    session.battle.endGame();
    expect(session.applyTap(0).type).toBe(SESSION_TAP.INVALID);
    expect(session.grid.itemAt(0)).not.toBeNull();
  });
});

describe('GameSession — file de déploiement pleine', () => {
  let session;
  beforeEach(() => {
    session = makeSession();
    fillDeployQueue(session);
  });

  it('refuse le tap et laisse l’item sur la grille', () => {
    const rejected = [];
    session.events.on('tapRejected', (payload) => rejected.push(payload));

    session.grid.placeItem(20, 6, { silent: true });
    const result = session.applyTap(20);

    expect(result.type).toBe(SESSION_TAP.BLOCKED);
    expect(rejected).toHaveLength(1);
    // Rien ne doit disparaître pour une unité que la file n'accepterait pas.
    expect(session.grid.itemAt(20).tier).toBe(6);
    expect(session.hud().queueLength).toBe(SLOT_COUNT);
    expect(session.hud().blocked).toBe(true);
  });

  it('ne consomme pas la file de types sur un tap refusé', () => {
    const next = session.hud().nextUnitType;
    session.grid.placeItem(20, 1, { silent: true });
    session.applyTap(20);
    expect(session.hud().nextUnitType).toBe(next);
  });

  it('laisse merges et déplacements parfaitement libres', () => {
    session.grid.placeItem(20, 3, { silent: true });
    session.grid.placeItem(21, 3, { silent: true });
    expect(session.applyDrop(20, 21).type).toBe(DROP.MERGE);
    expect(session.grid.itemAt(21).tier).toBe(4);
    expect(session.applyDrop(21, 22).type).toBe(DROP.MOVE);
  });

  it('se débloque toute seule au cooldown suivant', () => {
    expect(session.hud().blocked).toBe(true);
    session.update(COOLDOWN);
    expect(session.hud().blocked).toBe(false);

    session.grid.placeItem(20, 2, { silent: true });
    expect(session.applyTap(20).type).toBe(SESSION_TAP.SENT);
  });
});

describe('GameSession — le merge ne déclenche plus rien', () => {
  it('monte l’item d’un tier sans produire d’unité', () => {
    const session = makeSession();
    session.grid.placeItem(0, 3, { silent: true });
    session.grid.placeItem(1, 3, { silent: true });

    const result = session.applyDrop(0, 1);

    expect(result.type).toBe(DROP.MERGE);
    expect(session.grid.itemAt(1).tier).toBe(4);
    expect(session.mergeCount).toBe(1);
    expect(session.battle.unitCount()).toBe(0);
    expect(session.hud().queueLength).toBe(0);
    // La file de types n'avance qu'au tap : le joueur choisit quand la consommer.
    expect(session.hud().nextUnitType).toBe(PATTERN[0]);
  });

  it('récompense la préparation : merger puis envoyer donne un tier de plus', () => {
    const session = makeSession();
    session.grid.placeItem(0, 2, { silent: true });
    session.grid.placeItem(1, 2, { silent: true });
    session.applyDrop(0, 1);

    expect(session.applyTap(1).tier).toBe(3);
    expect(session.battle.units[0].tier).toBe(3);
  });
});

describe('GameSession — rythme de sortie', () => {
  it('fait sortir les unités une par une, au rythme du cooldown', () => {
    const session = makeSession();
    fillDeployQueue(session);
    expect(session.battle.unitCount()).toBe(1);

    session.update(COOLDOWN);
    expect(session.battle.unitCount()).toBe(2);
    session.update(COOLDOWN - 1);
    expect(session.battle.unitCount()).toBe(2);
    session.update(1);
    expect(session.battle.unitCount()).toBe(3);
  });

  it('ne fait plus sortir personne après le game over', () => {
    const session = makeSession();
    fillDeployQueue(session);
    session.battle.endGame();

    const units = session.battle.unitCount();
    session.update(COOLDOWN * 3);
    expect(session.battle.unitCount()).toBe(units);
  });

  it('retient la sortie quand le champ de bataille est plein, sans rien perdre', () => {
    const session = makeSession();
    const max = balance.battle.maxFieldUnits;
    for (let i = 0; i < max; i += 1) session.battle.spawnUnit(1, 'single');
    expect(session.battle.canAcceptUnit()).toBe(false);

    tapItem(session, 0, 1);
    session.update(COOLDOWN * 5);
    expect(session.battle.unitCount()).toBe(max);
    expect(session.deployQueue.slots).toHaveLength(1);

    // Une place se libère : la sortie reprend immédiatement.
    session.battle.killUnit(session.battle.units[0]);
    session.update(16);
    expect(session.deployQueue.slots).toHaveLength(0);
    expect(session.battle.unitCount()).toBe(max);
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
      slotCount: SLOT_COUNT,
      fieldUnits: 0,
      mergeCount: 0,
      sentCount: 0,
      cooldownRatio: 1,
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
    expect(bus.listenerCount('enqueueUnit')).toBe(1);
    expect(bus.listenerCount('deployUnit')).toBe(1);

    session.destroy();
    expect(bus.listenerCount('merge')).toBe(0);
    expect(bus.listenerCount('enqueueUnit')).toBe(0);
    expect(bus.listenerCount('deployUnit')).toBe(0);
    expect(session.destroyed).toBe(true);

    // Détruire deux fois ne doit rien casser.
    session.destroy();
  });

  it('enchaîne deux parties sur un bus partagé sans rien traîner de la première', () => {
    const bus = new EventBus();

    const first = new GameSession({ balance, bus, rng: () => 0 }).start();
    for (let i = 0; i < SLOT_COUNT; i += 1) {
      tapItem(first, i, 3);
      first.update(COOLDOWN);
    }
    first.update(60_000);
    first.battle.damageBase(balance.battle.baseHp);

    expect(first.over).toBe(true);
    const firstSent = first.sentCount;
    const firstTypes = first.battle.units.map((unit) => unit.type);
    first.destroy();

    // Aucun écouteur de la partie 1 ne doit survivre : sinon la partie 2 verrait ses
    // taps comptés deux fois. C'est le bug classique du « rejouer ».
    expect(bus.listenerCount('enqueueUnit')).toBe(0);
    expect(bus.listenerCount('deployUnit')).toBe(0);

    const second = new GameSession({ balance, bus, rng: () => 0 }).start();
    expect(second.over).toBe(false);
    expect(second.sentCount).toBe(0);
    expect(second.battle.unitCount()).toBe(0);
    expect(second.deployQueue.slots).toHaveLength(0);
    expect(second.battle.baseHp).toBe(balance.battle.baseHp);
    expect(second.hud().nextUnitType).toBe(PATTERN[0]);

    for (let i = 0; i < SLOT_COUNT; i += 1) {
      tapItem(second, i, 3);
      second.update(COOLDOWN);
    }
    expect(second.sentCount).toBe(firstSent);
    expect(second.battle.unitCount()).toBe(SLOT_COUNT);
    // La file de types repart du début : mêmes gestes, mêmes unités.
    expect(second.battle.units.map((unit) => unit.type)).toEqual(firstTypes);
    expect(firstTypes).toEqual(PATTERN.slice(0, SLOT_COUNT));
    second.destroy();
  });

  it('joue deux parties identiques quand on rejoue les mêmes gestes', () => {
    const play = () => {
      const session = makeSession().start();
      for (let step = 0; step < 40; step += 1) {
        session.update(250);
        session.trySpawnItem();
        // Tente systématiquement la première fusion possible, puis envoie la case 0.
        for (let a = 0; a < session.grid.size; a += 1) {
          for (let b = 0; b < session.grid.size; b += 1) {
            if (session.grid.canMerge(a, b)) {
              session.applyDrop(a, b);
              a = session.grid.size;
              break;
            }
          }
        }
        session.applyTap(0);
      }
      return {
        baseHp: session.battle.baseHp,
        wave: session.battle.wave,
        merges: session.mergeCount,
        sent: session.sentCount,
        units: session.battle.units.map((unit) => `${unit.type}${unit.tier}@${unit.progress}`),
      };
    };

    expect(play()).toEqual(play());
  });
});

/**
 * L'horloge d'apparition des items vit dans la session depuis le Lot 3 (elle était dans
 * la scène Phaser). C'est ce qui permet au harness headless de produire **exactement** le
 * même rythme que le jeu — sans quoi ses conclusions d'équilibrage ne vaudraient rien.
 */
describe('GameSession — horloge d’apparition des items', () => {
  const SPAWNER = balance.itemSpawner;

  it('n’ajoute rien avant le premier délai, puis pose un item', () => {
    const session = makeSession().start();
    const start = session.grid.count();

    session.update(SPAWNER.firstSpawnDelayMs - 1);
    expect(session.grid.count()).toBe(start);

    session.update(1);
    expect(session.grid.count()).toBe(start + 1);
  });

  it('rattrape plusieurs apparitions dans une frame longue, sans en perdre', () => {
    const session = makeSession().start();
    const start = session.grid.count();
    // Une seconde et demie couvre le premier délai puis plusieurs intervalles.
    session.update(SPAWNER.firstSpawnDelayMs + SPAWNER.intervalMs * 3);
    expect(session.grid.count()).toBeGreaterThan(start + 2);
  });

  it('s’arrête net au game over', () => {
    const session = makeSession().start();
    session.battle.endGame();
    const count = session.grid.count();
    session.update(60_000);
    expect(session.grid.count()).toBe(count);
  });

  it('n’ajoute rien sur grille pleine, et reprend quand elle a vraiment de la place', () => {
    const session = makeSession().start();
    for (let i = 0; i < session.grid.size; i += 1) {
      session.grid.placeItem(i, 1, { silent: true });
    }
    expect(session.grid.isFull()).toBe(true);

    session.update(10_000);
    expect(session.grid.count()).toBe(session.grid.size);

    // Une seule case libérée ne relance rien : à 96 % de remplissage, la régulation du
    // Lot 4.5 est encore à fond. C'est le comportement voulu — rendre une case ne doit pas
    // suffire à rouvrir les vannes.
    session.grid.removeItem(0);
    session.update(SPAWNER.intervalMs * 2);
    expect(session.grid.count()).toBe(session.grid.size - 1);

    // Vidée pour de bon, la grille retrouve la cadence nominale.
    for (let i = 1; i < session.grid.size - 4; i += 1) session.grid.removeItem(i);
    session.update(SPAWNER.intervalMs);
    expect(session.grid.count()).toBeGreaterThan(4);
  });

  it('ralentit à mesure que la grille se remplit, sans jamais la saturer', () => {
    // Un joueur qui ne touche à rien pendant une minute : la régulation doit tenir la
    // grille sous son seuil haut, là où l'ancien intervalle fixe la noyait.
    const session = makeSession().start();
    const stopFill = session.spawnerConfig.fillPressure.stopFill;

    for (let step = 0; step < 600; step += 1) session.update(100);

    expect(session.grid.isFull()).toBe(false);
    expect(session.grid.count() / session.grid.size).toBeLessThanOrEqual(stopFill + 0.05);
  });

  it('ne met rien en réserve pendant que la grille est pleine', () => {
    // Sans cette remise à zéro, le temps passé bloqué serait capitalisé et le premier merge
    // ferait tomber un item **instantanément** — la punition arriverait pile au moment où le
    // joueur vient de se dégager de la place.
    const session = makeSession().start();
    for (let i = 0; i < session.grid.size; i += 1) {
      session.grid.placeItem(i, 1, { silent: true });
    }

    session.update(60_000);
    expect(session.spawnProgress).toBe(0);

    // Une case se libère : le décompte démarre **maintenant**, à zéro.
    session.grid.removeItem(0);
    session.update(1);
    expect(session.grid.count()).toBe(session.grid.size - 1);
    expect(session.spawnProgress).toBeLessThan(0.05);
  });

  it('reprend le rythme quand le joueur vide sa grille', () => {
    const session = makeSession().start();
    // Grille chargée : la cadence est freinée, presque rien n'apparaît.
    for (let i = session.grid.count(); i < session.grid.size - 2; i += 1) {
      session.grid.placeItem(i, 1, { silent: true });
    }
    const chargedBefore = session.grid.count();
    session.update(SPAWNER.intervalMs * 2);
    const chargedGain = session.grid.count() - chargedBefore;

    // La même durée, grille vidée : le débit revient sans attendre la fin d'un long délai
    // décidé quand elle était pleine. C'est ce que la jauge d'avancement garantit.
    for (let i = 0; i < session.grid.size; i += 1) session.grid.removeItem(i);
    session.update(SPAWNER.intervalMs * 2);

    expect(session.grid.count()).toBeGreaterThan(chargedGain);
    expect(session.grid.count()).toBeGreaterThanOrEqual(2);
  });
});

describe('GameSession — récap de fin de partie', () => {
  it('rend de quoi lire une partie sans fouiller les modèles', () => {
    // Sans `start()` : la grille reste vide, donc chaque case posée ici est bien celle
    // qu'on tape (les items de départ occuperaient les premiers index).
    const session = makeSession();
    tapItem(session, 0, 3);
    tapItem(session, 1, 3);
    session.grid.placeItem(2, 5, { silent: true });
    session.grid.placeItem(3, 5, { silent: true });
    session.applyDrop(2, 3);

    const recap = session.recap();
    expect(recap.sent).toBe(2);
    expect(recap.sentByTier).toEqual({ 3: 2 });
    expect(recap.merges).toBe(1);
    expect(recap.gridFullShare).toBeGreaterThanOrEqual(0);
    expect(Object.keys(recap.damageByType).sort()).toEqual(
      Object.keys(balance.units).sort()
    );
  });

  it('compte les taps refusés, pour repérer une file trop courte au réglage', () => {
    const session = makeSession();
    fillDeployQueue(session);
    session.grid.placeItem(20, 1, { silent: true });
    session.applyTap(20);
    expect(session.recap().blockedTaps).toBe(1);
  });
});

describe('GameSession — le tap sur un pouvoir (Lot 4)', () => {
  let session;
  beforeEach(() => {
    session = makeSession().start();
  });

  /** Pose un item de pouvoir sur une case **libérée pour l'occasion**, et le tape. */
  const tapPower = (session, index, tier, power) => {
    session.grid.removeItem(index);
    session.grid.placeItem(index, tier, { silent: true, family: ITEM_FAMILY.POWER, power });
    return session.applyTap(index);
  };

  /** Amène une unité sur le champ de bataille (une cible pour le soin). */
  const deployOneUnit = (session) => {
    session.grid.removeItem(0);
    session.grid.placeItem(0, 1, { silent: true });
    session.applyTap(0);
    session.update(COOLDOWN);
    return session.battle.units[0];
  };

  it('émet `usePower` — le contrat du lot — et consomme l’item', () => {
    const casts = [];
    session.events.on('usePower', (payload) => casts.push(payload));
    deployOneUnit(session);

    const result = tapPower(session, 4, 2, 'heal');

    expect(result.type).toBe(SESSION_TAP.POWER);
    expect(result).toMatchObject({ power: 'heal', tier: 2, index: 4 });
    expect(session.grid.itemAt(4)).toBeNull();
    expect(casts).toEqual([
      { type: 'heal', tier: 2, origin: { kind: 'tap', gridIndex: 4 } },
    ]);
  });

  it('ne passe **ni** par la file de déploiement **ni** par le compteur d’envois', () => {
    deployOneUnit(session);
    const queued = session.deployQueue.slots.length;
    const sent = session.sentCount;
    const nextType = session.hud().nextUnitType;

    tapPower(session, 5, 1, 'heal');

    expect(session.deployQueue.slots).toHaveLength(queued);
    expect(session.sentCount).toBe(sent);
    // La file de types ne doit pas avancer : un pouvoir n'est pas une unité.
    expect(session.hud().nextUnitType).toBe(nextType);
    expect(session.powersUsed).toBe(1);
    expect(session.powersByType).toEqual({ heal: 1 });
  });

  it('reste utilisable file de déploiement pleine — c’est tout l’intérêt', () => {
    deployOneUnit(session);
    fillDeployQueue(session, 1);
    expect(session.deployQueue.canAccept()).toBe(false);

    // Un item d'unité serait refusé ici…
    session.grid.removeItem(20);
    session.grid.placeItem(20, 1, { silent: true });
    expect(session.applyTap(20).type).toBe(SESSION_TAP.BLOCKED);
    // …le pouvoir, lui, part.
    expect(tapPower(session, 21, 1, 'heal').type).toBe(SESSION_TAP.POWER);
  });

  it('refuse un pouvoir sans cible et laisse l’item sur la grille', () => {
    // Aucune unité sur le champ : le soin n'a rien à soigner.
    const rejected = [];
    session.events.on('tapRejected', (payload) => rejected.push(payload));

    const result = tapPower(session, 6, 1, 'heal');

    expect(result).toMatchObject({ type: SESSION_TAP.BLOCKED, reason: 'aucuneCible' });
    expect(session.grid.itemAt(6)).not.toBeNull();
    expect(session.powersUsed).toBe(0);
    expect(rejected).toHaveLength(1);
  });

  it('gèle avec le reste pendant un draft', () => {
    deployOneUnit(session);
    session.pendingDraft = [{ id: 'fictive' }];
    expect(tapPower(session, 7, 1, 'heal').type).toBe(SESSION_TAP.INVALID);
    expect(session.powersUsed).toBe(0);
  });

  it('fait avancer les télégraphies dans `update`, jamais pendant un draft', () => {
    const telegraphMs = session.powersConfig.types.meteor.telegraphMs;
    expect(telegraphMs).toBeGreaterThan(0);
    session.battle.startWave(1);
    session.battle.spawnEnemy('basic');
    const enemy = session.battle.enemies[0];

    tapPower(session, 8, 1, 'meteor');
    expect(session.powers.pending).toHaveLength(1);

    session.pendingDraft = [{ id: 'fictive' }];
    session.update(telegraphMs * 3);
    expect(session.powers.pending).toHaveLength(1);
    expect(enemy.hp).toBe(enemy.maxHp);

    session.pendingDraft = null;
    session.update(telegraphMs);
    expect(session.powers.pending).toHaveLength(0);
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
  });

  it('les pouvoirs figurent dans le récap de fin de partie', () => {
    deployOneUnit(session);
    tapPower(session, 9, 1, 'heal');

    const recap = session.recap();
    expect(recap.powersUsed).toBe(1);
    expect(recap.powersByType).toEqual({ heal: 1 });
    expect(recap.powerLabels.heal).toBe(balance.powers.types.heal.label);
  });

  it('ne survit pas à une partie : la seconde repart sans pouvoir en vol', () => {
    const bus = new EventBus();
    const first = new GameSession({ balance, bus, rng: () => 0 }).start();
    first.battle.startWave(1);
    first.battle.spawnEnemy('basic');
    first.grid.removeItem(0);
    first.grid.placeItem(0, 1, { silent: true, family: ITEM_FAMILY.POWER, power: 'meteor' });
    first.applyTap(0);
    expect(first.powers.pending).toHaveLength(1);
    first.destroy();

    // Plus un seul écouteur : un `usePower` égaré ne doit toucher aucune partie.
    expect(bus.listenerCount('usePower')).toBe(0);

    const second = new GameSession({ balance, bus, rng: () => 0 }).start();
    expect(second.powers.pending).toHaveLength(0);
    expect(second.powersUsed).toBe(0);
    expect(second.recap().powerDamage).toBe(0);
    second.destroy();
  });
});
