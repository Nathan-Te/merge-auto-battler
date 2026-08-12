import { describe, expect, it } from 'vitest';

import { isDebugEnabled, isScreenshotEnabled } from '../src/systems/debug.js';

/**
 * Les drapeaux d'URL décident de ce que **voit** le joueur : un `?screenshot=1` qui
 * s'activerait par erreur retirerait le bouton son d'une vraie partie. Ils se lisent donc
 * strictement, et se testent sans navigateur.
 */

describe('isDebugEnabled', () => {
  it('est éteint par défaut — l’écran par défaut est celui du joueur', () => {
    expect(isDebugEnabled('')).toBe(false);
    expect(isDebugEnabled('?lang=fr')).toBe(false);
  });

  it('s’allume sur `?debug=1`, avec ou sans voisins', () => {
    expect(isDebugEnabled('?debug=1')).toBe(true);
    expect(isDebugEnabled('?lang=fr&debug=1&dpr=2')).toBe(true);
  });

  it('reste éteint sur les formes qui veulent dire « non »', () => {
    expect(isDebugEnabled('?debug=0')).toBe(false);
    expect(isDebugEnabled('?debug=false')).toBe(false);
  });
});

describe('isScreenshotEnabled', () => {
  it('est éteint par défaut', () => {
    expect(isScreenshotEnabled('')).toBe(false);
    expect(isScreenshotEnabled('?debug=1')).toBe(false);
  });

  it('s’allume sur `?screenshot=1`', () => {
    expect(isScreenshotEnabled('?screenshot=1')).toBe(true);
    expect(isScreenshotEnabled('?screenshot=1&lang=en')).toBe(true);
  });

  it('reste éteint sur `0` et `false`', () => {
    expect(isScreenshotEnabled('?screenshot=0')).toBe(false);
    expect(isScreenshotEnabled('?screenshot=false')).toBe(false);
  });

  it('est indépendant du mode debug — les deux répondent à des besoins distincts', () => {
    // Le mode capture **retire** de l'écran ce que le mode debug y **ajoute** : les activer
    // ensemble n'a pas de sens, mais l'un ne doit pas impliquer l'autre.
    expect(isScreenshotEnabled('?debug=1')).toBe(false);
    expect(isDebugEnabled('?screenshot=1')).toBe(false);
  });
});
