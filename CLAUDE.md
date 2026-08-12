# CLAUDE.md — Merge Battler

## Le projet en trois lignes

Merge Battler est un mini-jeu web mobile-first : un **merge en grille 5×5** alimente un
**auto-battler** sur une bande de combat — le joueur **tape** un item de tier N pour
l'envoyer au combat en unité de tier N, et **glisse** pour fusionner et préparer plus gros.
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
- **Tap = envoyer, glisser = fusionner. Rien ne part automatiquement.** Taper un item de la
  grille le consomme et met une unité de son tier en file de déploiement, du type dicté par
  la file de types (visible dans le HUD, fixée **au moment du tap**). Glisser fusionne ou
  déplace, et le merge ne déclenche **rien** côté combat. La file se vide toute seule au
  rythme de `battle.deployCooldownMs` : c'est le métronome du jeu, et c'est ce qui rend le
  spam de petites unités perdant. Décision actée au Lot 2.5 — les deux gestes ne doivent
  jamais se confondre, seuils dans `balance.json` (`input`), logique dans `tapGesture.js`.
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
  libre, grille pleine, tier maximum) ; `DeployQueue` la file de déploiement (slots, FIFO,
  cooldown de sortie) ; `BattleModel` le champ de bataille (unités, ennemis, marche,
  combat mutuel, vagues, PV de la base) ; `GameSession` possède le tout et porte le pont ;
  `tapGesture` distingue tap et glisser ; `itemSpawner` détient la cadence et le tirage des
  tiers ; `battleConfig` / `waves` valident `balance.json` et portent **toutes** les
  formules ; `layout` calcule les rectangles de l'écran. Ces modules tournent dans vitest
  sans canvas ni DOM, et c'est là que se trouvent les tests.
- **`src/scenes/` — rendu et orchestration.** `GameScene` crée la session, lui envoie les
  gestes du joueur (`session.applyTap`, `session.applyDrop`), et met en images ce qu'elle
  émet ; `BattleView` fait de même pour la moitié droite ; `GameOverScene` est lancée
  par-dessus la scène de jeu mise en pause. Une scène ne décide jamais si une fusion est
  légale ni si un envoi est possible : elle demande.
- **`src/render/` — greybox.** Formes et couleurs par tier (items) et par type (unités,
  ennemis), profondeurs d'affichage. Aucune règle, aucun état. Les tailles à l'écran
  vivent ici et non dans `balance.json` : elles n'influencent aucun calcul.
- **Bus d'événements** (`src/systems/eventBus.js`) : seul canal entre les systèmes, et
  seul canal modèle → rendu. Un modèle n'appelle jamais la scène, ni un autre modèle.

### Le pont grille → champ de bataille

Depuis le Lot 2.5, **le merge ne déclenche plus rien côté combat**. Le pont est une chaîne
de deux événements, chacun consommé par le module dont c'est le métier :

```js
// 1. le tap, émis par GameSession — le type vient de `UnitQueue`, fixé à cet instant
events.emit('enqueueUnit', { tier, type, origin: { kind: 'tap', gridIndex } });

// 2. la sortie, émise par DeployQueue quand son cooldown expire — FIFO
events.emit('deployUnit', { tier, type, unit, origin });
```

`DeployQueue` s'abonne au premier, `BattleModel` au second ; chacun se désabonne dans son
`destroy()`. Une unité n'entre donc en jeu **que** par `deployUnit` — il n'existe aucun
autre chemin, ce qui rend le rythme de sortie impossible à contourner par erreur.

**`GameSession`** (`src/systems/GameSession.js`) est le propriétaire d'une partie : elle
possède `GridModel`, `DeployQueue`, `BattleModel`, le spawner et la file de types, et porte
les règles qui appartiennent à plusieurs moitiés à la fois. `GridModel` n'a été modifié ni
par le Lot 2 ni par le Lot 2.5. Deux règles vivent dans la session :

- **tap** : `session.applyTap(index)` consomme l'item, prend le type courant de `UnitQueue`
  et émet `enqueueUnit`. Le tier de l'unité est celui de l'item tapé.
- **file pleine** : le refus se décide **avant** de retirer l'item — `applyTap` renvoie
  `SESSION_TAP.BLOCKED` et émet `tapRejected`, l'item reste sur la grille et la file de
  types n'avance pas. Ce n'est jamais un blocage durable (la file se vide au cooldown), et
  **les merges et déplacements restent libres en permanence**.

Rejouer = `session.destroy()` puis une session neuve. Aucun état, aucun écouteur ne
survit à une partie — c'est ce qui rend le bug classique du « rejouer » impossible par
construction, et testable sans Phaser (`tests/gameSession.test.js`).

### La file de déploiement

`DeployQueue` (`src/systems/DeployQueue.js`) est la **file d'attente visible** entre la
grille et le combat : `battle.slotCount` places, ordre FIFO, et une sortie chaque fois que
`battle.deployCooldownMs` s'écoule. Si la file est vide le cooldown reste prêt, donc la
prochaine unité tapée part immédiatement — on ne punit pas le joueur qui a laissé sa file
se vider. Si le champ de bataille est saturé (`battle.maxFieldUnits`), la sortie est
retenue **sans** consommer le cooldown, via le prédicat `canDeploy` injecté par la session.

### Le champ de bataille

`BattleModel` (`src/systems/BattleModel.js`) détient les unités, les ennemis, les PV de la
base et les vagues. Comme `GridModel` : aucune dépendance à Phaser, tout passe par le bus
(`enemySpawn`, `enemyDeath`, `enemyLeak`, `enemyAttack`, `unitSpawn`, `unitAttack`,
`unitDeath`, `baseDamage`, `waveStart`, `waveCleared`, `gameOver`… — liste complète en tête
du fichier).

- **Combat mutuel, plus de banc de tir.** Les unités entrent au bout « base » du couloir
  (progression `laneLength`) et **marchent** vers les ennemis, qui entrent à 0 et marchent
  vers la base. Chaque camp s'arrête quand un adversaire est à portée et frappe : les
  unités ont des PV et **meurent**. Une ligne d'unités retient donc une vague, et c'est en
  la brisant que les ennemis atteignent la base. Le `support` ne frappe jamais mais garde
  sa distance et projette son aura sur les alliés à `auraRadius` ; le `slow` ralentit en
  zone autour de sa cible.
- **Tick logique fixe.** `update(dtMs)` accumule le temps réel et exécute des pas de
  `battle.tickMs` (100 ms = 10 Hz). La simulation ne dépend donc pas du framerate et se
  rejoue à l'identique dans vitest. Le rendu **interpole** entre `prevProgress` et
  `progress` avec `model.alpha`, pour les deux camps. Au-delà de `maxTicksPerFrame`, le
  retard est jeté plutôt que rattrapé (onglet masqué).
- **Unités de couloir.** Le modèle ignore les pixels : tout le monde vit sur un axe de
  `battle.laneLength` unités. C'est `computeBattleZone()` / `lanePoint()`
  (`src/systems/layout.js`) qui convertit en pixels. Une portée dans `balance.json` veut
  donc dire la même chose sur tous les écrans.
- **File de types** (`src/systems/unitQueue.js`) : le type de la prochaine unité suit un
  motif déterministe de `balance.json`, affiché dans le HUD, et se fige **au tap**. Les
  items de la grille ne sont pas typés — c'est la file qui rend l'envoi planifiable.
- **Fusion d'unités ★ : retirée de la V1.** Elle appartenait au banc de tir statique, qui
  n'existe plus (on ne manipule plus rien sur la bande). Candidate à revenir après la V1,
  probablement en fusionnant **dans les slots de déploiement** plutôt que sur le champ.

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
src/scenes/       scènes Phaser + vues (jeu, champ de bataille, game over)
src/systems/      logique pure et testable (grille, file de déploiement, combat, session,
                  gestes, vagues, spawner, layout)
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
  grille → bande, file de types visible, game over + record local + rejouer, mode
  `?debug=1`. Une partie complète se joue de bout en bout.
- **Lot 2.5 — Refonte du cœur** ✅ Le playtest du Lot 2 a montré deux défauts structurels :
  la bande en slots de tir se remplissait puis bloquait, et l'envoi automatique au merge
  ne laissait aucune décision. Le lot refond le pont et le combat : **tap pour envoyer,
  glisser pour fusionner**, file de déploiement à cooldown de sortie, combat mutuel où les
  unités marchent, frappent et meurent. La fusion d'unités ★ est retirée de la V1.
- Lot 3 — Équilibrage & feel. Toutes les valeurs sont dans `balance.json` ; les questions
  ouvertes du playtest sont listées dans le README (Lot 2.5).
- Lot 4 — Assets IA, vignette, soumission Basic Launch.
