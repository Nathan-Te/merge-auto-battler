import { describe, expect, it } from 'vitest';

import juiceRaw from '../src/config/juice.json';
import { parseJuiceConfig } from '../src/systems/juice.js';
import {
  coprimeStride,
  laneOffsetLength,
  laneOffsetRatio,
  laneRank,
} from '../src/systems/laneSpread.js';
import { fighterDepth, DEPTH } from '../src/render/depths.js';
import { snapToArtGrid } from '../src/systems/pixelScale.js';

/**
 * **La répartition verticale est un décor, et ces tests sont là pour qu'elle le reste.**
 *
 * Le premier vérifie la seule chose qu'on voit vraiment à l'écran — plus aucune superposition
 * parfaite dans une vague — et les suivants qu'elle ne peut ni sortir du couloir, ni sortir de
 * la trame de pixels, ni toucher au modèle.
 */

const spread = parseJuiceConfig(juiceRaw).field.spread;

describe('coprimeStride', () => {
  it('rend un pas premier avec le nombre de rangs', () => {
    for (let steps = 3; steps <= 24; steps += 1) {
      const stride = coprimeStride(steps);
      const seen = new Set();
      for (let i = 0; i < steps; i += 1) seen.add((i * stride) % steps);
      expect(seen.size).toBe(steps);
    }
  });

  it('reste défini pour une bande dégénérée', () => {
    expect(coprimeStride(1)).toBe(1);
    expect(coprimeStride(2)).toBe(1);
  });
});

describe('laneRank', () => {
  it('donne un rang différent à chaque membre consécutif d’une vague', () => {
    // C'est l'invariant que le playtest a demandé : trois squelettes qui entrent à la suite
    // ne doivent jamais se confondre en un seul. Les identifiants d'une vague sont
    // consécutifs, donc la permutation suffit — là où un hachage laisserait des doublons.
    const steps = spread.steps;
    for (let first = 1; first < 40; first += 1) {
      const ranks = new Set();
      for (let id = first; id < first + steps; id += 1) ranks.add(laneRank(id, steps));
      expect(ranks.size).toBe(steps);
    }
  });

  it('sépare les deux camps, qui ont des compteurs d’identifiants séparés', () => {
    // Sans décalage, la première unité et le premier ennemi partiraient du même rang et les
    // deux camps descendraient la bande au même rythme.
    const different = [1, 2, 3, 4, 5].filter(
      (id) => laneRank(id, spread.steps, 0) !== laneRank(id, spread.steps, 2)
    );
    expect(different.length).toBe(5);
  });

  it('reste dans la bande, et vaut toujours 0 sur une bande d’un seul rang', () => {
    for (let id = 0; id < 100; id += 1) {
      const rank = laneRank(id, spread.steps);
      expect(rank).toBeGreaterThanOrEqual(0);
      expect(rank).toBeLessThan(spread.steps);
      expect(laneRank(id, 1)).toBe(0);
    }
  });

  it('est stable : le même identifiant rend toujours le même rang', () => {
    expect(laneRank(17, spread.steps)).toBe(laneRank(17, spread.steps));
  });
});

describe('laneOffsetRatio', () => {
  it('couvre exactement [-1, 1] et touche les deux bords', () => {
    const ratios = [];
    for (let id = 1; id <= spread.steps; id += 1) ratios.push(laneOffsetRatio(id, spread));
    expect(Math.min(...ratios)).toBe(-1);
    expect(Math.max(...ratios)).toBe(1);
    for (const ratio of ratios) expect(Math.abs(ratio)).toBeLessThanOrEqual(1);
  });

  it('reste sur l’axe quand la bande n’a qu’un rang', () => {
    expect(laneOffsetRatio(7, { steps: 1 })).toBe(0);
  });
});

describe('laneOffsetLength', () => {
  const thickness = 200;

  it('garde tout le monde dans le couloir, marges comprises', () => {
    for (const ratio of [-1, -0.5, 0, 0.5, 1]) {
      const offset = laneOffsetLength(ratio, thickness, spread);
      const fromTop = thickness / 2 + offset;
      expect(fromTop).toBeGreaterThanOrEqual(thickness * spread.marginStart - 1e-9);
      expect(fromTop).toBeLessThanOrEqual(thickness * (1 - spread.marginEnd) + 1e-9);
    }
  });

  it('suit l’épaisseur du couloir plutôt qu’une valeur en pixels', () => {
    // Une marge en dur mangerait tantôt rien, tantôt toute la bande : le couloir n'a pas la
    // même épaisseur sur un téléphone en portrait et sur un écran large.
    expect(laneOffsetLength(1, 400, spread)).toBeCloseTo(laneOffsetLength(1, 200, spread) * 2);
  });

  it('retombe sur l’axe si les deux marges se recouvrent', () => {
    expect(laneOffsetLength(1, thickness, { marginStart: 0.6, marginEnd: 0.6 })).toBeCloseTo(0);
  });

  it('reste sur la trame une fois arrondi au pixel d’art', () => {
    // La contrainte pixel art du lot : un décalage de 3,5 pixels d'art ne rend pas un
    // personnage « un peu plus bas », il le sort de la grille de son voisin.
    const artPixel = 3;
    for (let id = 1; id <= 12; id += 1) {
      const raw = laneOffsetLength(laneOffsetRatio(id, spread), thickness, spread);
      expect(Math.abs(snapToArtGrid(raw, artPixel) % artPixel)).toBe(0);
    }
  });
});

describe('fighterDepth', () => {
  it('range les deux camps dans une seule bande, triée par ordonnée', () => {
    // Deux bandes séparées feraient passer un ennemi placé plus haut devant l'unité qui le
    // mord : le y-sort n'a de sens que s'il est commun.
    expect(fighterDepth(0)).toBeLessThan(fighterDepth(1));
    expect(fighterDepth(0)).toBeGreaterThanOrEqual(DEPTH.fighter);
    expect(fighterDepth(1)).toBeLessThanOrEqual(DEPTH.fighter + DEPTH.fighterSpan);
    // Sous le tracé des tirs et les particules : la profondeur répartit les combattants
    // entre eux, elle ne les fait pas passer devant les effets.
    expect(fighterDepth(1)).toBeLessThan(DEPTH.tracer);
  });

  it('borne et quantifie, pour ne pas resalir la liste d’affichage à chaque frame', () => {
    expect(fighterDepth(-3)).toBe(fighterDepth(0));
    expect(fighterDepth(9)).toBe(fighterDepth(1));
    expect(fighterDepth(0.5001)).toBe(fighterDepth(0.5));
    expect(fighterDepth(Number.NaN)).toBe(fighterDepth(0));
  });
});

describe('juice.json — le décor ne décide de rien', () => {
  it('déclare la bande et les cadences d’animation', () => {
    expect(spread.steps).toBeGreaterThanOrEqual(2);
    expect(spread.marginStart + spread.marginEnd).toBeLessThan(1);
    const fps = parseJuiceConfig(juiceRaw).sprite.fps;
    // « Volontairement basse » n'est pas une figure de style : au-delà, une marche de pixel
    // art ne devient pas plus fluide, elle devient nerveuse.
    for (const value of [fps.walk, fps.idle, fps.default]) {
      expect(value).toBeGreaterThanOrEqual(2);
      expect(value).toBeLessThanOrEqual(12);
    }
  });
});
