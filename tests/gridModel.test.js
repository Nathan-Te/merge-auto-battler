import { describe, it, expect, beforeEach } from 'vitest';
import { GridModel, DROP, ITEM_FAMILY, sameKind } from '../src/systems/GridModel.js';

/** RNG déterministe : renvoie les valeurs fournies, puis 0. */
function fakeRng(...values) {
  let i = 0;
  return () => (i < values.length ? values[i++] : 0);
}

/** Collecte les événements émis par un modèle, pour les assertions. */
function record(model, type) {
  const received = [];
  model.events.on(type, (payload) => received.push(payload));
  return received;
}

describe('GridModel — état de base', () => {
  let model;
  beforeEach(() => {
    model = new GridModel({ maxTier: 11 });
  });

  it('démarre vide, en 5x5', () => {
    expect(model.size).toBe(25);
    expect(model.count()).toBe(0);
    expect(model.isFull()).toBe(false);
    expect(model.emptyIndices()).toHaveLength(25);
  });

  it('refuse une configuration absurde', () => {
    expect(() => new GridModel({ cols: 0 })).toThrow();
    expect(() => new GridModel({ maxTier: 1 })).toThrow();
  });

  it('convertit index et coordonnées dans les deux sens', () => {
    expect(model.indexOf(2, 3)).toBe(17);
    expect(model.coordsOf(17)).toEqual({ x: 2, y: 3 });
    expect(model.indexOf(5, 0)).toBe(-1);
    expect(model.coordsOf(25)).toBeNull();
  });
});

describe('GridModel — placement', () => {
  let model;
  beforeEach(() => {
    model = new GridModel({ maxTier: 11 });
  });

  it('place un item sur une case libre et émet `spawn`', () => {
    const spawns = record(model, 'spawn');
    const item = model.placeItem(4, 1);

    expect(item).toMatchObject({ tier: 1 });
    expect(model.itemAt(4)).toBe(item);
    expect(model.count()).toBe(1);
    expect(spawns).toEqual([{ index: 4, item }]);
  });

  it('refuse une case déjà occupée, un index hors grille ou un tier illégal', () => {
    model.placeItem(4, 1);
    expect(model.placeItem(4, 1)).toBeNull();
    expect(model.placeItem(25, 1)).toBeNull();
    expect(model.placeItem(-1, 1)).toBeNull();
    expect(model.placeItem(5, 0)).toBeNull();
    expect(model.placeItem(5, 12)).toBeNull();
    expect(model.placeItem(5, 1.5)).toBeNull();
    expect(model.count()).toBe(1);
  });

  it('donne un identifiant unique à chaque item', () => {
    const a = model.placeItem(0, 1);
    const b = model.placeItem(1, 1);
    expect(a.id).not.toBe(b.id);
  });
});

describe('GridModel — spawn', () => {
  it('ne fait apparaître un item que sur une case libre', () => {
    const model = new GridModel({ maxTier: 11 });
    // Toutes les cases sont prises sauf la 12.
    for (let i = 0; i < 25; i += 1) if (i !== 12) model.placeItem(i, 3);

    const result = model.spawn(1, fakeRng(0.99));

    expect(result.index).toBe(12);
    expect(model.itemAt(12).tier).toBe(1);
  });

  it('couvre toutes les cases libres selon le tirage', () => {
    const model = new GridModel({ maxTier: 11 });
    const first = model.spawn(1, fakeRng(0));
    const last = model.spawn(1, fakeRng(0.999));

    expect(first.index).toBe(0);
    expect(last.index).toBe(24);
  });

  it('renvoie null quand la grille est pleine, sans rien écraser', () => {
    const model = new GridModel({ maxTier: 11 });
    for (let i = 0; i < 25; i += 1) model.placeItem(i, 2);
    const snapshot = [...model.cells];

    expect(model.spawn(1, fakeRng(0.5))).toBeNull();
    expect(model.cells).toEqual(snapshot);
  });
});

describe('GridModel — grille pleine', () => {
  it('émet `full` sur transition, une seule fois, et `unfull` au dégagement', () => {
    const model = new GridModel({ maxTier: 11 });
    const full = record(model, 'full');
    const unfull = record(model, 'unfull');

    for (let i = 0; i < 24; i += 1) model.placeItem(i, 1 + (i % 2));
    expect(full).toHaveLength(0);
    expect(model.isFull()).toBe(false);

    model.placeItem(24, 5);
    expect(model.isFull()).toBe(true);
    expect(full).toHaveLength(1);
    expect(unfull).toHaveLength(0);

    model.removeItem(24);
    expect(full).toHaveLength(1);
    expect(unfull).toHaveLength(1);
  });

  it('se libère par une fusion : deux items deviennent un', () => {
    const model = new GridModel({ maxTier: 11 });
    for (let i = 0; i < 25; i += 1) model.placeItem(i, 1);
    const unfull = record(model, 'unfull');

    expect(model.isFull()).toBe(true);
    model.applyDrop(0, 1);

    expect(model.isFull()).toBe(false);
    expect(unfull).toHaveLength(1);
    expect(model.spawn(1, fakeRng(0))).not.toBeNull();
  });
});

describe('GridModel — déplacement', () => {
  let model;
  beforeEach(() => {
    model = new GridModel({ maxTier: 11 });
  });

  it('déplace un item sur une case vide et émet `move`', () => {
    const item = model.placeItem(0, 3);
    const moves = record(model, 'move');

    expect(model.applyDrop(0, 7)).toEqual({ type: DROP.MOVE, from: 0, to: 7 });
    expect(model.itemAt(0)).toBeNull();
    expect(model.itemAt(7)).toBe(item);
    expect(moves).toEqual([{ from: 0, to: 7, item }]);
  });

  it('déplace vers une case lointaine : le merge n’exige pas l’adjacence', () => {
    model.placeItem(0, 2);
    expect(model.applyDrop(0, 24).type).toBe(DROP.MOVE);
    expect(model.itemAt(24).tier).toBe(2);
  });

  it('traite le lâcher sur sa propre case comme une annulation', () => {
    model.placeItem(6, 4);
    const moves = record(model, 'move');

    expect(model.applyDrop(6, 6)).toEqual({ type: DROP.CANCEL });
    expect(model.itemAt(6).tier).toBe(4);
    expect(moves).toHaveLength(0);
  });

  it('refuse un déplacement depuis une case vide ou hors grille', () => {
    model.placeItem(3, 1);
    expect(model.applyDrop(9, 10).type).toBe(DROP.INVALID);
    expect(model.applyDrop(3, 25).type).toBe(DROP.INVALID);
    expect(model.applyDrop(3, -1).type).toBe(DROP.INVALID);
    expect(model.itemAt(3).tier).toBe(1);
  });
});

describe('GridModel — fusion', () => {
  let model;
  beforeEach(() => {
    model = new GridModel({ maxTier: 11 });
  });

  it('fusionne deux items identiques en un item de tier+1 sur la case cible', () => {
    const source = model.placeItem(0, 3);
    const target = model.placeItem(8, 3);

    const result = model.applyDrop(0, 8);

    expect(result.type).toBe(DROP.MERGE);
    expect(model.itemAt(0)).toBeNull();
    expect(model.itemAt(8).tier).toBe(4);
    expect(model.count()).toBe(1);
    // L'item résultant est un nouvel item, pas l'un des deux fusionnés.
    expect(model.itemAt(8).id).not.toBe(source.id);
    expect(model.itemAt(8).id).not.toBe(target.id);
  });

  it('émet `merge` avec le tier fusionné — contrat d’entrée du Lot 2', () => {
    model.placeItem(0, 5);
    model.placeItem(1, 5);
    const merges = record(model, 'merge');

    model.applyDrop(0, 1);

    expect(merges).toHaveLength(1);
    // `tier` = tier des deux items fusionnés = tier de l'unité à faire apparaître.
    expect(merges[0].tier).toBe(5);
    expect(merges[0].resultTier).toBe(6);
    expect(merges[0].index).toBe(1);
    expect(merges[0].consumed.map((item) => item.tier)).toEqual([5, 5]);
  });

  it('n’émet `merge` que sur fusion réussie', () => {
    model.placeItem(0, 2);
    model.placeItem(1, 3);
    const merges = record(model, 'merge');

    model.applyDrop(0, 1); // tiers différents
    model.applyDrop(0, 5); // case vide -> déplacement

    expect(merges).toHaveLength(0);
  });

  it('ne fusionne pas deux tiers différents : elle les échange', () => {
    model.placeItem(0, 2);
    model.placeItem(1, 3);

    const result = model.applyDrop(0, 1);

    expect(result).toMatchObject({ type: DROP.SWAP, from: 0, to: 1, reason: 'tierDifferent' });
    // Aucune fusion : les deux tiers existent toujours, ils ont juste changé de case.
    expect(model.itemAt(0).tier).toBe(3);
    expect(model.itemAt(1).tier).toBe(2);
    expect(model.count()).toBe(2);
  });

  it('refuse de dépasser le tier maximum — deux items plafonnés s’échangent', () => {
    model.placeItem(0, 11);
    model.placeItem(1, 11);

    const result = model.applyDrop(0, 1);

    expect(result).toMatchObject({ type: DROP.SWAP, reason: 'tierMax' });
    expect(model.count()).toBe(2);
    expect(model.itemAt(0).tier).toBe(11);
    expect(model.itemAt(1).tier).toBe(11);
    expect(model.canMerge(0, 1)).toBe(false);
  });

  it('enchaîne les fusions jusqu’au tier maximum', () => {
    // 1 + 1 -> 2, puis 2 + 2 -> 3 : la cascade tient sur plusieurs paliers.
    model.placeItem(0, 1);
    model.placeItem(1, 1);
    model.placeItem(2, 1);
    model.placeItem(3, 1);

    model.applyDrop(0, 1); // case 1 : tier 2
    model.applyDrop(2, 3); // case 3 : tier 2
    model.applyDrop(1, 3); // case 3 : tier 3

    expect(model.count()).toBe(1);
    expect(model.itemAt(3).tier).toBe(3);
  });

  it('canMerge ne se laisse pas piéger par une case vide ou identique', () => {
    model.placeItem(0, 4);
    expect(model.canMerge(0, 0)).toBe(false);
    expect(model.canMerge(0, 1)).toBe(false);
    expect(model.canMerge(1, 0)).toBe(false);
  });
});

describe('GridModel — échange de deux items', () => {
  let model;
  beforeEach(() => {
    model = new GridModel({ maxTier: 11, powerMaxTier: 6 });
  });

  it('échange deux items qui ne fusionnent pas, et émet `swap`', () => {
    const source = model.placeItem(0, 2);
    const target = model.placeItem(1, 5);
    const swaps = record(model, 'swap');

    const result = model.applyDrop(0, 1);

    expect(result.type).toBe(DROP.SWAP);
    expect(model.itemAt(0)).toBe(target);
    expect(model.itemAt(1)).toBe(source);
    expect(swaps).toHaveLength(1);
    expect(swaps[0]).toMatchObject({ from: 0, to: 1, source, target });
  });

  it('conserve les items eux-mêmes : un échange ne crée ni ne détruit rien', () => {
    const a = model.placeItem(3, 4);
    const b = model.placeItem(9, 7);
    const ids = [a.id, b.id];

    model.applyDrop(3, 9);
    model.applyDrop(9, 3);

    // Deux échanges successifs ramènent tout en place, aux mêmes identifiants.
    expect(model.itemAt(3).id).toBe(ids[0]);
    expect(model.itemAt(9).id).toBe(ids[1]);
    expect(model.count()).toBe(2);
  });

  it('la fusion reste prioritaire : deux items identiques fusionnent, ils ne s’échangent pas', () => {
    model.placeItem(0, 3);
    model.placeItem(1, 3);
    const swaps = record(model, 'swap');

    expect(model.applyDrop(0, 1).type).toBe(DROP.MERGE);
    expect(swaps).toHaveLength(0);
  });

  it('échange par-dessus les familles — c’est tout l’intérêt pour ranger', () => {
    const unit = model.placeItem(0, 1);
    const power = model.placeItem(1, 4, { family: ITEM_FAMILY.POWER, power: 'meteor' });

    expect(model.applyDrop(0, 1).type).toBe(DROP.SWAP);
    expect(model.itemAt(0)).toBe(power);
    expect(model.itemAt(1)).toBe(unit);
  });

  it('reste possible grille pleine — le moment où on en a le plus besoin', () => {
    for (let i = 0; i < model.size; i += 1) model.placeItem(i, 1 + (i % 3));
    expect(model.isFull()).toBe(true);

    // Deux tiers différents (1 et 2) : rien ne peut fusionner, et pourtant le geste passe.
    const a = model.itemAt(0);
    const b = model.itemAt(1);
    expect(a.tier).not.toBe(b.tier);
    expect(model.applyDrop(0, 1).type).toBe(DROP.SWAP);

    expect(model.itemAt(0)).toBe(b);
    expect(model.itemAt(1)).toBe(a);
    expect(model.isFull()).toBe(true);
  });

  it('n’échange pas avec une case vide (c’est un déplacement) ni avec soi-même', () => {
    model.placeItem(0, 2);
    const swaps = record(model, 'swap');

    expect(model.applyDrop(0, 4).type).toBe(DROP.MOVE);
    expect(model.applyDrop(4, 4).type).toBe(DROP.CANCEL);
    expect(model.swapItems(4, 4)).toBeNull();
    expect(model.swapItems(4, 7)).toBeNull();
    expect(swaps).toHaveLength(0);
  });

  it('ne change jamais le nombre d’items, quelle que soit la paire', () => {
    model.placeItem(0, 2);
    model.placeItem(1, 9);
    model.placeItem(2, 6, { family: ITEM_FAMILY.POWER, power: 'heal' });

    for (const [from, to] of [[0, 1], [1, 2], [2, 0], [0, 2]]) {
      model.applyDrop(from, to);
      expect(model.count()).toBe(3);
    }
  });
});

describe('GridModel — deux familles d’items (Lot 4)', () => {
  let model;
  beforeEach(() => {
    model = new GridModel({ maxTier: 11, powerMaxTier: 6 });
  });

  const putUnit = (index, tier) => model.placeItem(index, tier, { silent: true });
  const putPower = (index, tier, power) =>
    model.placeItem(index, tier, { silent: true, family: ITEM_FAMILY.POWER, power });

  it('sameKind compare la famille et le type, jamais le tier', () => {
    const heal1 = { tier: 1, family: ITEM_FAMILY.POWER, power: 'heal' };
    const heal5 = { tier: 5, family: ITEM_FAMILY.POWER, power: 'heal' };
    const meteor1 = { tier: 1, family: ITEM_FAMILY.POWER, power: 'meteor' };
    const unit1 = { tier: 1, family: ITEM_FAMILY.UNIT, power: null };

    expect(sameKind(heal1, heal5)).toBe(true);
    expect(sameKind(heal1, meteor1)).toBe(false);
    expect(sameKind(heal1, unit1)).toBe(false);
  });

  it('marque tout item d’une famille, `unit` par défaut', () => {
    expect(putUnit(0, 1)).toMatchObject({ family: ITEM_FAMILY.UNIT, power: null });
    expect(putPower(1, 1, 'heal')).toMatchObject({ family: ITEM_FAMILY.POWER, power: 'heal' });
  });

  it('refuse un pouvoir sans type : ce serait un item qui ne fusionne avec rien', () => {
    expect(model.placeItem(0, 1, { family: ITEM_FAMILY.POWER })).toBeNull();
    expect(model.count()).toBe(0);
  });

  it('fusionne deux pouvoirs identiques, et conserve leur sorte', () => {
    putPower(0, 2, 'meteor');
    putPower(1, 2, 'meteor');

    const result = model.applyDrop(0, 1);

    expect(result.type).toBe(DROP.MERGE);
    expect(model.itemAt(1)).toMatchObject({
      tier: 3,
      family: ITEM_FAMILY.POWER,
      power: 'meteor',
    });
  });

  it('ne fusionne **jamais** un item d’unité avec un pouvoir de même tier', () => {
    putUnit(0, 3);
    putPower(1, 3, 'heal');

    expect(model.canMerge(0, 1)).toBe(false);
    expect(model.canMerge(1, 0)).toBe(false);
    // Pas de fusion, mais un échange : les deux sortes sont intactes, aux cases près.
    expect(model.applyDrop(0, 1)).toMatchObject({
      type: DROP.SWAP,
      reason: 'familleDifferente',
    });
    expect(model.itemAt(0)).toMatchObject({ tier: 3, family: ITEM_FAMILY.POWER, power: 'heal' });
    expect(model.itemAt(1)).toMatchObject({ tier: 3, family: ITEM_FAMILY.UNIT });
    expect(model.count()).toBe(2);
  });

  it('ne fusionne **jamais** deux pouvoirs de types différents', () => {
    putPower(0, 2, 'heal');
    putPower(1, 2, 'meteor');

    expect(model.canMerge(0, 1)).toBe(false);
    expect(model.applyDrop(0, 1)).toMatchObject({
      type: DROP.SWAP,
      reason: 'pouvoirDifferent',
    });
    // Les deux pouvoirs existent toujours : ils ont échangé leur case, rien de plus.
    expect(model.itemAt(0).power).toBe('meteor');
    expect(model.itemAt(1).power).toBe('heal');
  });

  it('déplacer reste libre : seule la fusion regarde la sorte', () => {
    putPower(0, 1, 'heal');
    expect(model.applyDrop(0, 7)).toMatchObject({ type: DROP.MOVE });
    expect(model.itemAt(7)).toMatchObject({ family: ITEM_FAMILY.POWER, power: 'heal' });
  });

  it('les pouvoirs plafonnent à leur propre tier maximum, plus bas que les unités', () => {
    expect(model.maxTierOf(ITEM_FAMILY.POWER)).toBe(6);
    expect(model.maxTierOf(ITEM_FAMILY.UNIT)).toBe(11);

    putPower(0, 6, 'heal');
    putPower(1, 6, 'heal');
    expect(model.canMerge(0, 1)).toBe(false);
    expect(model.applyDrop(0, 1)).toMatchObject({ type: DROP.SWAP, reason: 'tierMax' });
    expect(model.count()).toBe(2);

    // Les items d'unité, eux, montent toujours jusqu'à 11.
    putUnit(2, 6);
    putUnit(3, 6);
    expect(model.canMerge(2, 3)).toBe(true);
  });

  it('refuse de poser un pouvoir au-dessus de son plafond', () => {
    expect(model.placeItem(0, 7, { family: ITEM_FAMILY.POWER, power: 'heal' })).toBeNull();
    expect(putUnit(0, 7)).not.toBeNull();
  });

  it('refuse un plafond de pouvoirs incohérent avec celui de la grille', () => {
    expect(() => new GridModel({ maxTier: 11, powerMaxTier: 12 })).toThrow();
    expect(() => new GridModel({ maxTier: 11, powerMaxTier: 1 })).toThrow();
  });

  it('enchaîne les fusions de pouvoirs comme celles des items d’unité', () => {
    for (const index of [0, 1, 2, 3]) putPower(index, 1, 'meteor');

    model.applyDrop(0, 1); // case 1 : météorite tier 2
    model.applyDrop(2, 3); // case 3 : météorite tier 2
    model.applyDrop(1, 3); // case 3 : météorite tier 3

    expect(model.count()).toBe(1);
    expect(model.itemAt(3)).toMatchObject({ tier: 3, power: 'meteor' });
  });
});
