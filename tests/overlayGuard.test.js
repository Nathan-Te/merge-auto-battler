import { describe, it, expect } from 'vitest';
import balance from '../src/config/balance.json';
import { OverlayGuard } from '../src/systems/overlayGuard.js';
import { parseInputConfig } from '../src/systems/tapGesture.js';

/**
 * Protection d'inputs des écrans qui s'ouvrent par-dessus le jeu.
 *
 * Le bug qu'elle corrige, remonté au playtest du Lot 3.5 : le draft s'ouvre à la fin d'une
 * vague, c'est-à-dire pile pendant qu'on fusionne. Le doigt est déjà posé, il se relève sur
 * une carte, et l'amélioration est prise **sans avoir été lue** — pour toute la partie.
 *
 * La logique vit dans un module pur précisément pour pouvoir être testée ici, sans
 * navigateur, sur les scénarios de doigt qui posent problème.
 */

const GRACE = parseInputConfig(balance).overlayGraceMs;

/** Un pointeur, tel que Phaser en émet les événements. */
const POINTER = 1;
const OTHER = 2;
const CARD = { id: 'power' };
const OTHER_CARD = { id: 'slot' };

describe('OverlayGuard — le doigt déjà posé', () => {
  it('n’active rien quand le geste a commencé **avant** l’ouverture', () => {
    const guard = new OverlayGuard({ graceMs: GRACE });

    // Le joueur tient un item : Phaser a émis `pointerdown` sur la grille, pas sur une
    // carte qui n'existait pas encore. L'écran s'ouvre là-dessus.
    guard.open(1000);

    // Il relève le doigt sur une carte, bien après la grâce. Rien ne doit se passer :
    // aucun appui n'a jamais été enregistré pour ce pointeur.
    expect(guard.release(POINTER, CARD)).toBe(false);
  });

  it('n’active rien même si le doigt se relève très tard', () => {
    const guard = new OverlayGuard({ graceMs: GRACE });
    guard.open(1000);
    expect(guard.isArmed(1000 + GRACE * 10)).toBe(true);
    // Armé ou pas, un relâchement sans appui préalable ne vaut rien.
    expect(guard.release(POINTER, CARD)).toBe(false);
  });

  it('simulation d’un merge frénétique à l’ouverture : aucune carte activée', () => {
    const guard = new OverlayGuard({ graceMs: GRACE });

    // Le joueur enchaîne les gestes sur la grille. Le draft s'ouvre au milieu d'un drag,
    // puis le doigt continue de bouger et se relève sur une carte.
    guard.open(2000);
    guard.cancel(POINTER); // le drag est annulé côté scène de jeu
    expect(guard.release(POINTER, CARD)).toBe(false);

    // Il repose aussitôt le doigt — mais on est encore dans le délai de grâce.
    expect(guard.press(POINTER, CARD, 2000 + GRACE / 4)).toBe(false);
    expect(guard.release(POINTER, CARD)).toBe(false);

    // Et une seconde fois, toujours dans la grâce.
    expect(guard.press(POINTER, OTHER_CARD, 2000 + GRACE / 2)).toBe(false);
    expect(guard.release(POINTER, OTHER_CARD)).toBe(false);
  });
});

describe('OverlayGuard — le délai de grâce', () => {
  it('ignore les appuis tant qu’il n’est pas écoulé', () => {
    const guard = new OverlayGuard({ graceMs: 400 });
    guard.open(0);

    expect(guard.isArmed(0)).toBe(false);
    expect(guard.press(POINTER, CARD, 399)).toBe(false);
    expect(guard.release(POINTER, CARD)).toBe(false);
  });

  it('accepte un geste complet une fois écoulé', () => {
    const guard = new OverlayGuard({ graceMs: 400 });
    guard.open(0);

    expect(guard.isArmed(400)).toBe(true);
    expect(guard.press(POINTER, CARD, 400)).toBe(true);
    expect(guard.release(POINTER, CARD)).toBe(true);
  });

  it('rend l’avancement de la grâce, pour que l’attente se voie', () => {
    const guard = new OverlayGuard({ graceMs: 400 });
    guard.open(1000);
    expect(guard.armRatio(1000)).toBe(0);
    expect(guard.armRatio(1200)).toBeCloseTo(0.5, 6);
    expect(guard.armRatio(1400)).toBe(1);
    expect(guard.armRatio(9999)).toBe(1);
  });

  it('sans grâce, seul le verrou de l’appui postérieur subsiste', () => {
    const guard = new OverlayGuard({ graceMs: 0 });
    guard.open(0);

    expect(guard.isArmed(0)).toBe(true);
    expect(guard.armRatio(0)).toBe(1);
    // Le doigt déjà posé est **toujours** refusé : ce verrou-là ne se règle pas.
    expect(guard.release(POINTER, CARD)).toBe(false);
    expect(guard.press(POINTER, CARD, 0)).toBe(true);
    expect(guard.release(POINTER, CARD)).toBe(true);
  });
});

describe('OverlayGuard — gestes délibérés', () => {
  it('refuse un doigt qui glisse d’une carte à l’autre', () => {
    const guard = new OverlayGuard({ graceMs: 0 });
    guard.open(0);

    guard.press(POINTER, CARD, 0);
    // Relevé sur une autre carte que celle appuyée : ce n'est pas un choix, c'est un
    // glissement.
    expect(guard.release(POINTER, OTHER_CARD)).toBe(false);
  });

  it('oublie un appui annulé (doigt sorti de la carte)', () => {
    const guard = new OverlayGuard({ graceMs: 0 });
    guard.open(0);

    guard.press(POINTER, CARD, 0);
    guard.cancel(POINTER);
    expect(guard.release(POINTER, CARD)).toBe(false);
  });

  it('suit chaque doigt séparément', () => {
    const guard = new OverlayGuard({ graceMs: 0 });
    guard.open(0);

    guard.press(POINTER, CARD, 0);
    guard.press(OTHER, OTHER_CARD, 0);
    expect(guard.release(OTHER, OTHER_CARD)).toBe(true);
    expect(guard.release(POINTER, CARD)).toBe(true);
  });

  it('ne rejoue pas un appui déjà consommé', () => {
    const guard = new OverlayGuard({ graceMs: 0 });
    guard.open(0);

    guard.press(POINTER, CARD, 0);
    expect(guard.release(POINTER, CARD)).toBe(true);
    // Un second `pointerup` sur le même doigt (rebond d'événement) ne prend pas deux cartes.
    expect(guard.release(POINTER, CARD)).toBe(false);
  });

  it('ne laisse rien passer avant l’ouverture ni après la fermeture', () => {
    const guard = new OverlayGuard({ graceMs: 0 });

    expect(guard.isArmed(0)).toBe(false);
    expect(guard.press(POINTER, CARD, 0)).toBe(false);

    guard.open(0);
    guard.press(POINTER, CARD, 0);
    guard.close();
    expect(guard.isArmed(0)).toBe(false);
    expect(guard.release(POINTER, CARD)).toBe(false);
  });
});

describe('input.overlayGraceMs', () => {
  it('est lu depuis balance.json et vaut au moins le temps de voir la carte', () => {
    expect(GRACE).toBeGreaterThanOrEqual(250);
  });

  it('est obligatoire : une valeur oubliée doit crier au chargement', () => {
    const without = { ...balance, input: { ...balance.input } };
    delete without.input.overlayGraceMs;
    expect(() => parseInputConfig(without)).toThrow(/overlayGraceMs/);
  });
});
