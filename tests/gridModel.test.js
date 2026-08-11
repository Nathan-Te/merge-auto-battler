import { describe, it, expect, beforeEach } from 'vitest';
import { GridModel, DROP } from '../src/systems/GridModel.js';

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

  it('refuse la fusion de deux tiers différents, sans rien déplacer', () => {
    model.placeItem(0, 2);
    model.placeItem(1, 3);

    const result = model.applyDrop(0, 1);

    expect(result).toEqual({ type: DROP.INVALID, reason: 'tierDifferent' });
    expect(model.itemAt(0).tier).toBe(2);
    expect(model.itemAt(1).tier).toBe(3);
  });

  it('refuse de dépasser le tier maximum', () => {
    model.placeItem(0, 11);
    model.placeItem(1, 11);

    const result = model.applyDrop(0, 1);

    expect(result).toEqual({ type: DROP.INVALID, reason: 'tierMax' });
    expect(model.count()).toBe(2);
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
