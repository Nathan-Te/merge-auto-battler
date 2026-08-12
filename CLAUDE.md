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
- **Feel exclusivement via `src/config/juice.json`.** Même règle, autre métier : toute
  intensité de feedback — durée de tween, squash, nombre de particules, secousse de caméra,
  paramètre de son — vit là et **jamais en dur** dans une scène. Documenté dans
  `src/config/juice.schema.md`, validé par `parseJuiceConfig()` qui refuse une valeur
  manquante. La frontière est nette : si une valeur change **qui gagne la partie**, elle est
  dans `balance.json` ; si elle change ce que le joueur **ressent**, elle est dans
  `juice.json`. On règle l'un au harness, l'autre au doigt sur un téléphone.
- **`npm run sim` avant toute retouche d'équilibrage.** Le harness headless
  (`src/sim/`, cf. `docs/balance-notes.md`) joue des dizaines de parties automatiques et
  sort un rapport reproductible : trois politiques (`spam` — envoie tout dès que ça
  apparaît ; `mixed` — fusionne jusqu'au tier 3, **le joueur de référence** ; `prepare` —
  ne lâche rien avant le tier 4), vague moyenne, écart-type, durée, occupation de la
  grille. `--matchups` mesure en plus quel type d'unité tient quelle texture de vague. Un
  réglage se valide en secondes, pas en playtests.
- **Invariant intouchable : « merger bat spammer ».** Préparer un gros item doit rester
  strictement plus payant que spammer des petits — tout le jeu repose là-dessus, sans quoi
  la grille ne sert plus à rien. `tests/balanceInvariant.test.js` le vérifie sur de vraies
  parties simulées et **échoue** si un réglage l'inverse. Ne jamais le contourner : si le
  test tombe, c'est le réglage qui est faux.
- **Objectifs chiffrés de référence** (`src/sim/targets.js`, vérifiés par le harness et par
  les tests) : partie moyenne de **3 à 5 minutes**, première défaite vers les **vagues
  8-12**, `prepare` au moins **×1,4** devant `spam` en vagues survécues. Toute itération de
  réglage se juge à ces trois nombres. Ils sont **inchangés depuis le Lot 3.5** : le draft
  rallonge la partie, la difficulté a été relevée en face plutôt que la cible déplacée
  (mesures dans `docs/balance-notes.md`, section 7).
- **Les améliorations de draft sont des modificateurs, jamais des mutations.** Une carte
  prise n'écrit **rien** dans `balance.json` : elle accumule un facteur
  (`src/systems/modifiers.js`), et ce sont les lecteurs — `unitStats`, `DeployQueue`,
  `ItemSpawner`, `UnitQueue` — qui l'appliquent au moment de lire. `balance.json` est importé
  une seule fois pour toute l'application : une mutation ferait survivre les améliorations
  d'une partie à la suivante, exactement le bug que `GameSession.destroy()` rend impossible
  partout ailleurs. Un test le verrouille (`tests/draftSystem.test.js`).
- **Toute livraison qui modifie `balance.json` régénère `docs/reference.md`** avec
  `npm run docs`. Ce fichier est **généré, jamais édité à la main** : il liste les stats de
  chaque type d'unité par tier, les ennemis, les vagues et le pool d'améliorations, calculés
  par les **formules du jeu** (`unitStats`, `enemyStats`, `waveComposition`). C'est ce qui
  l'empêche de mentir — une référence tenue à la main dérive dès la première retouche de
  réglage, et sans prévenir. Un test échoue si le fichier commité est périmé
  (`tests/reference.test.js`), et `npm run docs -- --check` répond à la même question en CI.
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
- **La boucle de décision est l'intention de design de référence** (Lot 3.5). Elle a trois
  temps, et aucun ne vaut sans les deux autres :

  ```
  annonce de vague  ×  file de types  ×  draft
  « ce qui arrive »   « ce que je peux »  « ce que je deviens »
  ```

  Chaque pause annonce la **composition** de la vague à venir ; la file affiche les **trois
  prochains types**, et le bouton « passer » permet d'en défausser un contre un cooldown ;
  toutes les `draft.everyWaves` vagues, la partie gèle et propose trois améliorations. La
  décision du jeu naît du **croisement** des deux premières informations — « 20 rapides
  arrivent, ma tête de file est un mono-cible : j'envoie, je prépare plus gros, ou je
  passe ? ». C'est pour ça qu'elles sont physiquement **côte à côte** dans `IntelBar` : les
  séparer, c'est retirer la décision. Toute évolution d'interface doit préserver ce
  voisinage. Le troisième temps, le draft, est ce qui rend une seconde partie différente de
  la première.
- **Une pause est du temps de jeu, pas du temps mort.** `waves.interWavePauseMs` est le
  moment où l'on regarde la bataille, où l'on lit l'annonce et où l'on fusionne sans urgence
  — le playtest du Lot 3 a montré qu'un jeu à un seul régime (l'urgence permanente) fatigue
  et n'offre aucun choix. Le raccourcir revient à supprimer la respiration installée par ce
  lot ; c'est aussi un levier de puissance, donc tout changement se paie sur `hpPerWave`.
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
  combat mutuel, vagues, PV de la base, **annonce de la vague à venir**) ; `DraftSystem` le
  pool d'améliorations et son tirage seedé, `modifiers` leur accumulation ; `GameSession`
  possède le tout et porte le pont ; `tapGesture` distingue tap et glisser ; `unitQueue`
  la file de types et son bouton « passer » ; `itemSpawner` détient la cadence et le tirage
  des tiers ; `battleConfig` / `waves` valident `balance.json` et portent **toutes** les
  formules ; `layout` calcule les rectangles de l'écran. Ces modules tournent dans vitest
  sans canvas ni DOM, et c'est là que se trouvent les tests.
- **`src/scenes/` — rendu et orchestration.** `GameScene` crée la session, lui envoie les
  gestes du joueur (`session.applyTap`, `session.applyDrop`), et met en images ce qu'elle
  émet ; `BattleView` fait de même pour la moitié droite ; `IntelBar` porte la barre de
  décision (annonce de vague × file de types × bouton « passer ») ; `DraftScene`, `HelpScene`
  (le « ? » de l'en-tête) et `GameOverScene` sont lancées par-dessus la scène de jeu mise en
  pause. Une scène ne décide
  jamais si une fusion est légale, si un envoi est possible ni si une amélioration
  s'applique : elle demande.
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
construction, et testable sans Phaser (`tests/gameSession.test.js`). Les améliorations de
draft obéissent à la même règle **parce qu'elles ne sont que des modificateurs portés par
la session** : une seconde partie repart sans une seule d'entre elles
(`tests/draftSession.test.js`).

### Le draft

`DraftSystem` (`src/systems/DraftSystem.js`) détient le pool de `balance.json`, les niveaux
pris et les modificateurs cumulés. `GameSession` s'abonne à `waveCleared` : toutes les
`draft.everyWaves` vagues, elle tire une offre, **gèle la partie** et émet `draftOffer` ;
`chooseDraft(id)` applique la carte et relance.

Le gel est **double, à dessein** : `GameSession.pendingDraft` arrête `update()` et
`BattleModel.paused` coupe le tick au milieu d'une frame (une frame couvre jusqu'à
`maxTicksPerFrame` ticks, et la vague suivante avancerait sinon d'un demi-pas pendant que le
joueur lit) ; côté rendu, `DraftScene` est lancée par-dessus `GameScene` **mise en pause**.
Un bug de rendu ne peut donc pas laisser filer la simulation.

Tous les systèmes lisent les modificateurs par un accès injecté (`getModifiers`), jamais par
une copie : une place gagnée au draft s'ouvre au tick suivant sans que personne n'ait à
propager quoi que ce soit, et la file en cours n'est pas perdue.

### Protection d'inputs des overlays — patron à réutiliser

Le draft s'ouvre pile quand le joueur fusionne, doigt posé sur l'écran. Le playtest du
Lot 3.5 a montré ce que ça donne : le doigt se relève une fraction de seconde plus tard, sur
une carte, et l'amélioration est prise **sans avoir été lue** — pour toute la partie.

`OverlayGuard` (`src/systems/overlayGuard.js`) est la réponse, et **tout écran qui s'ouvre
par-dessus le jeu doit l'utiliser** (`DraftScene`, `HelpScene`, et les suivants) :

1. **Un appui postérieur à l'ouverture est exigé.** Un doigt déjà enfoncé n'a jamais émis de
   `pointerdown` sur le bouton : son `pointerup` ne trouve rien et n'active rien. Ce verrou
   est absolu, aucun réglage ne le contourne.
2. **Un délai de grâce** (`input.overlayGraceMs`, 400 ms) pendant lequel aucun appui n'est
   enregistré, avec un état visuel « pas encore prêt » qui s'estompe. Il couvre ce que le
   premier laisse passer : un **nouveau** doigt posé 30 ms après l'ouverture est un appui
   parfaitement postérieur, et pourtant pas une décision.

Deux détails qui ont coûté un aller-retour et qu'il ne faut pas refaire : la garde s'ouvre
sur `this.game.loop.time` et **jamais** sur `this.time.now`, qui vaut 0 pendant tout le
`create()` d'une scène neuve (le délai serait déjà écoulé) ; et `GameScene` repose l'item en
main **avant** de se mettre en pause, sinon il reste figé au milieu de l'écran.

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
  items de la grille ne sont pas typés — c'est la file qui rend l'envoi planifiable. Depuis
  le Lot 3.5 elle montre **trois** types et se défausse d'un cran par le bouton « passer »
  (cooldown `battle.skipCooldownMs`) : voir puis ne rien pouvoir en faire n'était pas une
  décision.
- **Annonce de vague** : `BattleModel.wavePreview(wave)` rend la composition, la texture et
  la cadence de n'importe quelle vague, **formule infinie comprise** — l'annonce ne doit pas
  s'éteindre à la vague 11, c'est-à-dire au moment où la difficulté décolle. Elle est émise
  dans `waveCountdown` et lue en continu par `hud().countdown`.
- **Fusion d'unités ★ : retirée de la V1.** Elle appartenait au banc de tir statique, qui
  n'existe plus (on ne manipule plus rien sur la bande). Candidate à revenir après la V1,
  probablement en fusionnant **dans les slots de déploiement** plutôt que sur le champ.

### Mode debug

`?debug=1` dans l'URL allume tout l'outillage de réglage. Sans ce paramètre, l'écran est
celui que verra un joueur de Crazy Games. Le drapeau est lu par `isDebugEnabled()`
(`src/systems/debug.js`) ; tout nouvel affichage ou outil de debug passe derrière.

- **Ligne de diagnostic** : fps, merges, envois, ticks logiques, ennemis, unités en place,
  file de déploiement, items sur la grille.
- **Panneau de boutons** (`src/scenes/DebugPanel.js`), tactile comme le reste :
  **vitesse ×1/×2/×4** (le temps du jeu est multiplié, la simulation reste à tick fixe),
  **vague +** (`BattleModel.skipWave()`), **base ∞** (`BattleModel.invincible`).
- **Ligne de diagnostic de fin de partie** sur l'écran de game over : durée, fuites, unités
  perdues, taps refusés (`GameSession.recap()`). Le **récap de build**, lui, est montré à
  tout le monde depuis le Lot 3.5 — améliorations prises, type d'unité qui a porté les
  dégâts, meilleur tier envoyé : c'est ce qui donne l'idée de build de la partie suivante,
  donc ce n'est pas un outil de réglage.

Le panneau **réserve sa place dans le layout** (`computeLayout({ debugRowPx })`) au lieu de
se poser par-dessus : en mode debug la grille descend d'une bande, et aucun bouton ne
recouvre jamais une case.

## Juice

Le feedback passe par une boîte à outils unique, `JuiceKit` (`src/render/juiceKit.js`),
possédée par `GameScene` et prêtée à `BattleView` : particules poolées, secousses de
caméra, vignette de dégâts, sons. Un seul exemplaire par partie — deux pools de particules
ou deux contextes audio mangeraient le budget de performance en doublons.

- **Particules** (`src/render/particles.js`) : pool **figé**, alloué au démarrage, un seul
  `Graphics` redessiné par frame. Rien n'est alloué pendant le jeu ; pool plein, la plus
  vieille particule est recyclée. C'est la règle de perf du Lot 3 — **aucune allocation
  dans la boucle de tick ni dans la boucle de rendu**.
- **Secousses** : `JuiceKit.shake()` étrangle lui-même les rafales (`shake.minIntervalMs`).
  Trois événements seulement secouent l'écran — dégâts à la base, mort d'un **tank**, game
  over. Si tout secouait, la secousse ne voudrait plus rien dire.
- **Sons** : synthétisés à l'exécution façon jsfxr (`src/systems/sfx.js`), zéro octet
  téléchargé, remplacés au Lot 4. Déverrouillés au premier `pointerdown` (politique des
  navigateurs), étranglés par son (`sfx.<nom>.minIntervalMs`), et le toggle du joueur
  persiste en `localStorage`.

## Commandes utiles

```bash
npm run dev      # serveur de dev Vite (exposé sur le réseau local pour le test téléphone)
npm test         # vitest, une passe
npm run sim      # harness d'équilibrage headless — rapport par politique
npm run docs     # régénère docs/reference.md depuis balance.json (obligatoire après réglage)
npm run build    # build de production dans dist/
npm run preview  # sert le build de production en local
```

```bash
npm run sim                          # 20 parties par politique, graine 1
npm run sim -- --games=50 --seed=7   # échantillon plus large, autre graine
npm run sim -- --policies=spam,prepare
npm run sim -- --matchups --tier=3   # quel type d'unité contre quelle texture de vague
npm run sim -- --json                # sortie machine, pour comparer deux réglages
```

Le rapport est **reproductible** : mêmes graines + même `balance.json` = mêmes chiffres.

## Structure

```
src/scenes/       scènes Phaser + vues (jeu, champ de bataille, barre de décision, draft,
                  aide, game over, panneau debug)
src/systems/      logique pure et testable (grille, file de déploiement, combat, session,
                  draft et modificateurs, gestes, vagues, spawner, layout, juice, sons,
                  rng, préférences)
src/render/       greybox : formes, couleurs, profondeurs, particules, icônes de draft,
                  boîte à juice
src/sim/          harness d'équilibrage headless (`npm run sim`) — politiques, bancs
                  d'essai, rapport, objectifs chiffrés
src/tools/        générateur de `docs/reference.md` (`npm run docs`)
src/config/       balance.json + juice.json, chacun avec son schéma documenté
public/           fichiers copiés tels quels dans dist/
tests/            tests vitest
docs/seed.md      périmètre — source de vérité
docs/balance-notes.md  valeurs retenues, raisonnement, résultats du harness
docs/reference.md      référence **générée** (unités, ennemis, vagues, améliorations)
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
- **Lot 3 — Équilibrage & feel** ✅ Harness de simulation headless (`npm run sim`) et
  invariant « merger bat spammer » verrouillé par un test ; passe d'équilibrage complète
  (partie moyenne 3:37, première défaite vague 10, textures de vagues avec cadence propre) ;
  passe de juice intégrale pilotée par `juice.json` (squash de fusion, particules poolées,
  trajets grille → slot → couloir avec traînée, hit flash, recul, vignette, screenshake
  parcimonieux, SFX jsfxr synthétisés, toggle son) ; outils de debug (vitesse ×1/×2/×4,
  saut de vague, base invincible, récap de fin de partie). Valeurs et raisonnement :
  `docs/balance-notes.md`.
- **Lot 3.5 — Rythme, décisions & rejouabilité** ✅ Le playtest du Lot 3 a montré un jeu à
  **un seul régime** (urgence de grille permanente, information affichée mais inutilisable)
  et **rien qui motive une seconde partie**. Le lot installe une respiration et des choix :
  annonce de la composition de chaque vague (formule infinie comprise) avec compte à rebours
  de préparation ; file de types active — trois types visibles et un bouton « passer » ;
  **draft roguelite** toutes les 3 vagues, 11 améliorations en modificateurs par-dessus
  `balance.json` ; passe de tempo complète (ennemis −20 % de vitesse, pauses 4 s → 7 s,
  débit d'items ramené à l'équilibre) ; écran de fin qui raconte le build joué. Objectifs
  chiffrés re-validés sans les déplacer (3:47 de partie moyenne, défaite vague 9,7, merge
  bat spam ×1,93). Mesures : `docs/balance-notes.md`, section 7.
- Lot 4 — Assets IA, vignette, soumission Basic Launch.
