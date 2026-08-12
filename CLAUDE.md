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
  libre, grille pleine, tier maximum) ; `BattleModel` celles de la bande de combat
  (unités, ennemis, tirs, vagues, PV de la base) ; `GameSession` possède les deux et porte
  le pont entre eux ; `itemSpawner` détient la cadence et le tirage des tiers ;
  `battleConfig` / `waves` valident `balance.json` et portent **toutes** les formules ;
  `layout` calcule les rectangles de l'écran. Ces modules tournent dans vitest sans canvas
  ni DOM, et c'est là que se trouvent les tests.
- **`src/scenes/` — rendu et orchestration.** `GameScene` crée la session, lui envoie les
  gestes du joueur (`session.applyDrop`, `session.applyUnitDrop`), et met en images ce
  qu'elle émet ; `BattleView` fait de même pour la moitié droite ; `GameOverScene` est
  lancée par-dessus la scène de jeu mise en pause. Une scène ne décide jamais si une
  fusion est légale : elle demande.
- **`src/render/` — greybox.** Formes et couleurs par tier (items) et par type (unités,
  ennemis), profondeurs d'affichage. Aucune règle, aucun état. Les tailles à l'écran
  vivent ici et non dans `balance.json` : elles n'influencent aucun calcul.
- **Bus d'événements** (`src/systems/eventBus.js`) : seul canal modèle → rendu. Le modèle
  n'appelle jamais la scène. Un système peut donc s'y brancher sans que le modèle le sache.

### Le pont grille → bande

L'événement **`merge`** relie les deux moitiés du jeu :

```js
model.events.on('merge', ({ tier, resultTier, index, from, to, item, consumed }) => { … });
```

- `tier` — tier **des deux items fusionnés**, donc le tier de l'unité qui naît sur la
  bande (seed doc : « fusionner deux items de tier N fait apparaître une unité de tier N »).
- `resultTier` (= `tier + 1`) et `item` — l'item qui reste sur la grille.
- `index` / `to` — case du résultat, point de départ du vol grille → bande.

**`GameSession`** (`src/systems/GameSession.js`) est le propriétaire d'une partie : elle
possède `GridModel`, `BattleModel`, le spawner et la file de types, s'abonne à `merge`, et
porte les règles qui appartiennent aux deux moitiés à la fois. `GridModel` n'a **pas** été
modifié par le Lot 2. Deux règles y vivent :

- une fusion de tier N produit une unité de tier N, du type dicté par `UnitQueue` ;
- **bande pleine** : quand ni les slots ni la file d'attente n'ont de place,
  `session.applyDrop()` renvoie `SESSION_DROP.BLOCKED` et émet `mergeBlocked` — la fusion
  n'a pas lieu, les deux items restent sur la grille. C'est la boucle de pression du jeu :
  pour débloquer sa grille, le joueur doit fusionner ses unités.

Rejouer = `session.destroy()` puis une session neuve. Aucun état, aucun écouteur ne
survit à une partie — c'est ce qui rend le bug classique du « rejouer » impossible par
construction, et testable sans Phaser (`tests/gameSession.test.js`).

### La bande de combat

`BattleModel` (`src/systems/BattleModel.js`) détient les slots d'unités, les ennemis, les
PV de la base et les vagues. Comme `GridModel` : aucune dépendance à Phaser, tout passe
par le bus (`enemySpawn`, `enemyDeath`, `enemyLeak`, `shot`, `baseDamage`, `waveStart`,
`waveCleared`, `unitSpawn`, `unitQueued`, `unitMerge`, `gameOver`… — liste complète en
tête du fichier).

- **Tick logique fixe.** `update(dtMs)` accumule le temps réel et exécute des pas de
  `battle.tickMs` (100 ms = 10 Hz). La simulation ne dépend donc pas du framerate et se
  rejoue à l'identique dans vitest. Le rendu **interpole** entre `enemy.prevProgress` et
  `enemy.progress` avec `model.alpha`. Au-delà de `maxTicksPerFrame`, le retard est jeté
  plutôt que rattrapé (onglet masqué).
- **Unités de couloir.** Le modèle ignore les pixels : les ennemis parcourent
  `battle.laneLength` unités, le slot k est planté à `laneLength × (k + 0.5) / slotCount`.
  C'est `computeBattleZone()` / `lanePoint()` (`src/systems/layout.js`) qui convertit en
  pixels. Une portée dans `balance.json` veut donc dire la même chose sur tous les écrans.
- **File de types** (`src/systems/unitQueue.js`) : le type de la prochaine unité suit un
  motif déterministe de `balance.json`, affiché dans le HUD. Les items de la grille ne
  sont pas typés — c'est la file qui rend la fusion planifiable.
- **Fusion d'unités** : deux unités identiques **adjacentes** donnent une version
  renforcée (★). Un lâcher sur un slot libre déplace, sur un slot occupé non fusionnable
  échange — c'est l'échange qui évite l'impasse « bande pleine, aucune paire adjacente ».

### Mode debug

`?debug=1` dans l'URL allume tout l'affichage de diagnostic (compteur de merges, fps,
ticks logiques, ennemis vivants, unités en place). Sans ce paramètre, l'écran est celui
que verra un joueur de Crazy Games. Le drapeau est lu par `isDebugEnabled()`
(`src/systems/debug.js`) ; tout nouvel affichage de debug passe derrière.

## Commandes utiles

```bash
npm run dev      # serveur de dev Vite (exposé sur le réseau local pour le test téléphone)
npm test         # vitest, une passe
npm run build    # build de production dans dist/
npm run preview  # sert le build de production en local
```

## Structure

```
src/scenes/       scènes Phaser + vues (jeu, bande de combat, game over)
src/systems/      logique pure et testable (grille, bande, session, vagues, spawner, layout)
src/render/       greybox : formes, couleurs, profondeurs (aucune règle)
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
- **Lot 2 — Bande de combat** ✅ `BattleModel` pur à tick fixe 10 Hz (4 types d'unités,
  3 types d'ennemis, vagues scriptées puis formule infinie), pont `merge` → unité avec vol
  grille → bande, file de types visible, fusion d'unités en version ★, file d'attente et
  refus de fusion quand la bande sature, game over + record local + rejouer, mode
  `?debug=1`. Une partie complète se joue de bout en bout.
- Lot 3 — Équilibrage & feel. Toutes les valeurs sont dans `balance.json` ; la première
  question du playtest est la boucle de pression « bande pleine » (voir le README).
- Lot 4 — Assets IA, vignette, soumission Basic Launch.
