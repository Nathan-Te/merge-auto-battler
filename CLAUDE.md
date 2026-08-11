# CLAUDE.md — Merge Battler

## Le projet en trois lignes

Merge Battler est un mini-jeu web mobile-first : un **merge en grille 5×5** alimente un
**auto-battler** sur une bande de combat — fusionner deux items de tier N fait apparaître
une unité de tier N qui combat les vagues d'ennemis.
Stack Phaser 3 + Vite, JavaScript, timebox ferme de deux semaines, publication en Basic
Launch sur Crazy Games.
**`docs/seed.md` est la source de vérité du périmètre** : tout arbitrage de scope se
tranche là-bas, et rien hors de ce document n'entre en V1.

## Règles de travail

- **Équilibrage exclusivement via `src/config/balance.json`.** Aucune stat de gameplay en
  dur dans le code : PV, dégâts, vitesses, cadences, courbes de vagues, tiers. Si une
  valeur influence le jeu, elle vit dans `balance.json` et est documentée dans
  `src/config/balance.schema.md` (JSON ne supportant pas les commentaires). Le réglage se
  fait par micro-itérations sur ce seul fichier.
- **Greybox jusqu'au Lot 3.** Formes colorées et texte, pas d'assets. Les sprites, sons et
  musique arrivent au Lot 4 — n'anticipe pas, le fun se valide sur les formes.
- **Souris + tactile obligatoires sur toute interaction.** Chaque geste doit fonctionner au
  doigt comme à la souris, dès son écriture. On passe par les événements de pointeur
  Phaser (`pointerdown` / `drag` / `pointerup`), jamais par des événements souris ou
  clavier spécifiques. Le jeu se teste sur téléphone via l'URL publique.
- **Poids surveillé à chaque lot.** Le seed doc impose ≤ 20 Mo de téléchargement initial
  (limite dure 50 Mo) et un chargement < 3 s. Le workflow CI affiche le poids de `dist/` à
  chaque build : le regarder, et justifier toute hausse notable dans la PR.
- **Chaque lot livre une PR + un README de livraison court** (ce qui a été fait, ce qui est
  testable, ce qui reste ouvert). Une branche par lot.
- **Tests unitaires sur la logique**, pas sur le feel : règles de merge, spawn d'items,
  logique de vagues sont couverts par vitest. Le feel se valide à la main sur téléphone.
- **Le layout est responsive par construction.** Le canvas est en `Scale.RESIZE` : chaque
  scène se relayoute dans un `layout(width, height)` appelé au `create` et sur l'événement
  `resize`. Pas de positions absolues calculées une seule fois au démarrage.
- **Chaque prompt de lot indique les modifications à apporter à ce fichier** ; le lot les
  applique lui-même à la livraison.

## Commandes utiles

```bash
npm run dev      # serveur de dev Vite (exposé sur le réseau local pour le test téléphone)
npm test         # vitest, une passe
npm run build    # build de production dans dist/
npm run preview  # sert le build de production en local
```

## Structure

```
src/scenes/       scènes Phaser (une par écran : jeu, game over…)
src/systems/      logique pure et testable (grille, merge, vagues, spawner)
src/config/       balance.json + son schéma documenté
public/           fichiers copiés tels quels dans dist/
tests/            tests vitest
docs/seed.md      périmètre — source de vérité
```

Règle de découpage : tout ce qui peut être testé sans Phaser vit dans `src/systems/` en
fonctions pures ; les scènes orchestrent et affichent.

## État des lots

- **Lot 0 — Squelette** ✅ Vite + Phaser, scène de validation, CI/CD GitHub Pages, tests.
- Lot 1 — Grille de merge complète (greybox).
- Lot 2 — Bande de combat + pont grille → bande + game over (greybox). Lot critique.
- Lot 3 — Équilibrage & feel.
- Lot 4 — Assets IA, vignette, soumission Basic Launch.
