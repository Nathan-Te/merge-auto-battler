import { describe, it, expect } from 'vitest';
import {
  computeLayout,
  computeBattleZone,
  lanePoint,
  slotCenter,
  nearestSlotIndex,
} from '../src/systems/layout.js';

/** Écrans représentatifs du parc visé (téléphone en priorité). */
const SCREENS = [
  { name: 'téléphone portrait', width: 390, height: 844 },
  { name: 'téléphone paysage', width: 844, height: 390 },
  { name: 'téléphone étroit', width: 320, height: 568 },
  { name: 'tablette portrait', width: 820, height: 1180 },
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'carré', width: 600, height: 600 },
];

const SLOT_COUNT = 8;

describe('computeBattleZone', () => {
  for (const screen of SCREENS) {
    describe(screen.name, () => {
      const layout = computeLayout(screen.width, screen.height, { slotCount: SLOT_COUNT });
      const zone = layout.battleZone;

      it('tient entièrement dans la bande réservée', () => {
        const { battle } = layout;
        const inside = (rect) =>
          rect.x >= battle.x - 0.001 &&
          rect.y >= battle.y - 0.001 &&
          rect.x + rect.width <= battle.x + battle.width + 0.001 &&
          rect.y + rect.height <= battle.y + battle.height + 0.001;

        expect(inside(zone.hud)).toBe(true);
        expect(inside(zone.lane)).toBe(true);
        expect(inside(zone.base)).toBe(true);
      });

      it('donne un couloir et une base non dégénérés', () => {
        expect(zone.laneLengthPx).toBeGreaterThan(30);
        expect(zone.laneThickness).toBeGreaterThan(6);
        expect(zone.base.width).toBeGreaterThan(0);
        expect(zone.base.height).toBeGreaterThan(0);
      });

      it('garde une taille d’ennemi compatible avec la bande', () => {
        expect(zone.enemyReference).toBeGreaterThan(6);
        expect(zone.enemyReference).toBeLessThanOrEqual(zone.laneThickness + 0.001);
        // Un ennemi ne doit jamais manger une part absurde du couloir.
        expect(zone.enemyReference).toBeLessThan(zone.laneLengthPx / 4);
      });

      it('fait entrer les ennemis à l’intérieur du couloir', () => {
        const inLane = (p) =>
          p.x >= zone.lane.x - 0.001 &&
          p.y >= zone.lane.y - 0.001 &&
          p.x <= zone.lane.x + zone.lane.width + 0.001 &&
          p.y <= zone.lane.y + zone.lane.height + 0.001;
        expect(inLane(lanePoint(zone, 0))).toBe(true);
        expect(inLane(lanePoint(zone, 1))).toBe(true);
        if (zone.horizontal) expect(lanePoint(zone, 0).x).toBeGreaterThan(zone.lane.x);
        else expect(lanePoint(zone, 0).y).toBeGreaterThan(zone.lane.y);
      });

      it('colle la base au bout du couloir, du côté opposé aux ennemis', () => {
        if (zone.horizontal) {
          expect(zone.base.x).toBeCloseTo(zone.lane.x + zone.lane.width);
          expect(zone.base.y).toBeCloseTo(zone.lane.y);
        } else {
          expect(zone.base.y).toBeCloseTo(zone.lane.y + zone.lane.height);
          expect(zone.base.x).toBeCloseTo(zone.lane.x);
        }
      });

      it('aligne un slot par unité, en face de son segment de couloir', () => {
        expect(zone.slots).toHaveLength(SLOT_COUNT);
        expect(zone.slotSize).toBeGreaterThan(8);

        zone.slots.forEach((slot, index) => {
          const facing = lanePoint(zone, (index + 0.5) / SLOT_COUNT);
          if (zone.horizontal) expect(slot.x).toBeCloseTo(facing.x);
          else expect(slot.y).toBeCloseTo(facing.y);
        });
      });

      it('ne fait jamais chevaucher deux slots voisins', () => {
        for (let i = 1; i < zone.slots.length; i += 1) {
          const previous = zone.slots[i - 1];
          const slot = zone.slots[i];
          const distance = Math.hypot(slot.x - previous.x, slot.y - previous.y);
          expect(distance).toBeGreaterThanOrEqual(zone.slotSize);
        }
      });

      it('réserve une case par place de file d’attente', () => {
        expect(zone.queue).toHaveLength(3);
        for (const cell of zone.queue) {
          expect(cell.size).toBeGreaterThan(4);
          expect(cell.y).toBeLessThanOrEqual(layout.battle.y + layout.battle.height + 0.001);
        }
      });
    });
  }
});

describe('lanePoint', () => {
  const zone = computeLayout(390, 844, { slotCount: SLOT_COUNT }).battleZone;

  it('va de l’entrée des ennemis à la face de la base', () => {
    const start = lanePoint(zone, 0);
    const end = lanePoint(zone, 1);
    if (zone.horizontal) {
      expect(end.x).toBeCloseTo(zone.lane.x + zone.lane.width);
      expect(start.y).toBeCloseTo(end.y);
    } else {
      expect(end.y).toBeCloseTo(zone.lane.y + zone.lane.height);
      expect(start.x).toBeCloseTo(end.x);
    }
    // La face de la base est bien le bout du couloir côté base.
    expect(end).toEqual(
      zone.horizontal
        ? { x: zone.base.x, y: zone.lane.y + zone.lane.height / 2 }
        : { x: zone.lane.x + zone.lane.width / 2, y: zone.base.y }
    );
  });

  it('progresse de façon monotone', () => {
    const axis = zone.horizontal ? 'x' : 'y';
    let previous = -Infinity;
    for (let t = 0; t <= 1.0001; t += 0.1) {
      const value = lanePoint(zone, t)[axis];
      expect(value).toBeGreaterThan(previous);
      previous = value;
    }
  });

  it('borne une progression hors plage plutôt que de sortir de l’écran', () => {
    expect(lanePoint(zone, -3)).toEqual(lanePoint(zone, 0));
    expect(lanePoint(zone, 42)).toEqual(lanePoint(zone, 1));
  });
});

describe('nearestSlotIndex', () => {
  const zone = computeLayout(844, 390, { slotCount: SLOT_COUNT }).battleZone;

  it('retrouve chaque slot depuis son centre', () => {
    zone.slots.forEach((slot, index) => {
      expect(nearestSlotIndex(zone, slot.x, slot.y)).toBe(index);
    });
  });

  it('tolère un lâcher approximatif autour du slot', () => {
    const slot = zone.slots[3];
    expect(nearestSlotIndex(zone, slot.x + zone.slotSize * 0.4, slot.y)).toBe(3);
    expect(nearestSlotIndex(zone, slot.x, slot.y + zone.slotSize * 0.4)).toBe(3);
  });

  it('rend -1 quand le point est loin de la rangée de slots', () => {
    expect(nearestSlotIndex(zone, 0, 0)).toBe(-1);
    expect(nearestSlotIndex(zone, zone.slots[0].x, zone.slots[0].y - zone.slotSize * 5)).toBe(-1);
  });
});

describe('slotCenter', () => {
  const zone = computeLayout(600, 600, { slotCount: SLOT_COUNT }).battleZone;

  it('rend le centre d’un slot existant, null sinon', () => {
    expect(slotCenter(zone, 0)).toEqual({ x: zone.slots[0].x, y: zone.slots[0].y });
    expect(slotCenter(zone, SLOT_COUNT)).toBeNull();
    expect(slotCenter(zone, -1)).toBeNull();
  });
});

describe('computeBattleZone — configurations extrêmes', () => {
  it('reste cohérente avec beaucoup de slots sur un petit écran', () => {
    const zone = computeBattleZone({ x: 0, y: 0, width: 200, height: 90 }, { slotCount: 12 });
    expect(zone.slots).toHaveLength(12);
    expect(zone.slotSize).toBeGreaterThan(0);
    expect(zone.laneLengthPx).toBeGreaterThan(0);
  });

  it('bascule en couloir vertical quand la bande est plus haute que large', () => {
    const zone = computeBattleZone({ x: 0, y: 0, width: 120, height: 500 });
    expect(zone.horizontal).toBe(false);
    expect(zone.lane.height).toBeGreaterThan(zone.lane.width);
  });
});
