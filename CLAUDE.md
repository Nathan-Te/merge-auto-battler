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
- **Toute nouvelle logique de gameplay naît dans un module pur et testable**
  (`src/systems/`), jamais dans une scène. Le rendu Phaser ne contient aucune règle : il
  affiche un modèle, lui transmet les gestes, et réagit à ses événements. Si une règle est
  écrite dans une scène, elle est au mauvais endroit — voir la section Architecture.
- **Chaque prompt de lot indique les modifications à apporter à ce fichier** ; le lot les
  applique lui-même à la livraison.

## Architecture

```
input (pointeur)  ->  scène Phaser  ->  modèle pur  ->  bus d'événements  ->  scène (rendu)
```

- **`src/systems/` — logique pure, sans Phaser.** `GridModel` détient l'état de la grille
  et toutes ses règles (placement, validité d'une fusion, déplacement, spawn sur case
  libre, grille pleine, tier maximum) ; `itemSpawner` détient la cadence et le tirage des
  tiers ; `layout` calcule les rectangles de l'écran. Ces modules tournent dans vitest sans
  canvas ni DOM, et c'est là que se trouvent les tests.
- **`src/scenes/` — rendu et orchestration.** La scène crée le modèle, lui envoie les
  gestes du joueur (`model.applyDrop(from, to)`), et met en images ce qu'il émet. Elle ne
  décide jamais si une fusion est légale : elle demande.
- **`src/render/` — greybox.** Formes et couleurs par tier. Aucune règle, aucun état.
- **Bus d'événements** (`src/systems/eventBus.js`) : seul canal modèle → rendu. Le modèle
  n'appelle jamais la scène. Un système peut donc s'y brancher sans que le modèle le sache.

### Contrat d'entrée du Lot 2

L'événement **`merge`** est le pont entre la grille et la bande de combat :

```js
model.events.on('merge', ({ tier, resultTier, index, from, to, item, consumed }) => { … });
```

- `tier` — tier **des deux items fusionnés**, donc le tier de l'unité à faire apparaître
  sur la bande (seed doc : « fusionner deux items de tier N fait apparaître une unité de
  tier N »).
- `resultTier` (= `tier + 1`) et `item` — l'item qui reste sur la grille.
- `index` / `to` — case du résultat, point de départ du vol grille → bande.

Le Lot 1 s'y branche déjà pour le compteur de debug affiché à l'écran ; le Lot 2 s'y
branche pour faire naître les unités, **sans modifier `GridModel`**. Les autres événements
du modèle (`spawn`, `move`, `full`, `unfull`, `remove`) sont documentés dans
`src/systems/GridModel.js`.

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
src/systems/      logique pure et testable (grille, merge, vagues, spawner, layout)
src/render/       greybox : formes et couleurs par tier (aucune règle)
src/config/       balance.json + son schéma documenté
public/           fichiers copiés tels quels dans dist/
tests/            tests vitest
docs/seed.md      périmètre — source de vérité
```

Règle de découpage : tout ce qui peut être testé sans Phaser vit dans `src/systems/` en
fonctions pures ; les scènes orchestrent et affichent.

## État des lots

- **Lot 0 — Squelette** ✅ Vite + Phaser, scène de validation, CI/CD GitHub Pages, tests.
- **Lot 1 — Grille de merge** ✅ `GridModel` pur + bus d'événements, spawner piloté par
  `balance.json`, drag souris/tactile (fusion, déplacement, retour animé), 11 tiers en
  greybox, place de la bande de combat réservée, compteur de merges de debug.
- Lot 2 — Bande de combat + pont grille → bande + game over (greybox). Lot critique.
- Lot 3 — Équilibrage & feel.
- Lot 4 — Assets IA, vignette, soumission Basic Launch.
