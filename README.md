# Merge Battler

Mini-jeu web mobile-first où un merge en grille 5×5 alimente un auto-battler — Phaser 3 + Vite.

**Preview publique :** https://nathan-te.github.io/merge-auto-battler/

Périmètre et contraintes : [`docs/seed.md`](docs/seed.md). Règles de travail :
[`CLAUDE.md`](CLAUDE.md).

## Commandes

```bash
npm install
npm run dev      # serveur de dev, exposé sur le réseau local (test téléphone)
npm test         # vitest
npm run sim      # harness d'équilibrage headless (voir Lot 3)
npm run build    # build de production dans dist/
npm run preview  # sert le build de production en local
```

`npm run dev` affiche une URL réseau (`http://192.168.x.x:5173/`) : c'est celle à ouvrir sur
le téléphone quand il est sur le même Wi-Fi, sans passer par un déploiement.

## Déploiement

Chaque push sur `main` déclenche `.github/workflows/deploy.yml` : install → `npm test` →
`npm run build` → déploiement sur GitHub Pages. **Les tests sont bloquants** : s'ils
échouent, rien n'est ni construit ni déployé. Le poids total de `dist/` est affiché dans
les logs et dans le résumé du job, avec une alerte au-delà de 2 Mo (le budget du seed doc
est de 20 Mo de téléchargement initial pour le jeu complet).

Les pull requests passent les mêmes tests et le même build, sans déployer.

### Étape manuelle, une seule fois

Dans **Settings → Pages** du dépôt, régler **Source** sur **GitHub Actions**.
Sans ça le job de déploiement échoue, faute d'environnement Pages configuré.

## Choix technique : `Scale.RESIZE` plutôt que `Scale.FIT`

`FIT` conserve un rapport d'aspect fixe et ajoute des bandes noires dès que l'écran ne
correspond pas à la résolution de design. Or le parc de téléphones va du 4:3 au 21:9, et le
jeu doit tourner en portrait comme en paysage : avec `FIT`, un design portrait perd la
moitié de l'écran en paysage.

`RESIZE` donne au canvas exactement la taille du viewport : **jamais de bande noire, jamais
de déformation**, et une unité de monde = un pixel CSS quelle que soit la densité de
l'écran. La contrepartie est que chaque scène doit se relayouter elle-même : c'est le rôle
de `layout(width, height)`, appelé au `create()` et sur l'événement `resize` (voir
`src/scenes/GameScene.js`). C'est la règle posée dans `CLAUDE.md` pour les lots suivants.

Corollaire assumé : le canvas est rendu à 1 pixel CSS (pas de suréchantillonnage au device
pixel ratio). Sur un écran 3x le rendu est donc légèrement moins net qu'un rendu natif,
mais le fillrate est divisé par 9 — c'est le bon arbitrage pour un jeu de formes pleines
qui doit rester fluide sur téléphone d'entrée de gamme. Les textes compensent via
`setResolution()`. Surtout, cela garde les valeurs de `balance.json` (vitesses, portées,
tailles) **indépendantes de l'appareil** : une vitesse en pixels de monde signifie la même
chose sur tous les téléphones.

## Lot 0 — ce qui est livré

Aucun gameplay : un squelette qui build, se déploie et se teste au doigt.

- Projet Vite + Phaser 3 en JavaScript, `base: './'` pour que le même `dist/` fonctionne
  depuis un sous-chemin (GitHub Pages) comme depuis la racine (Crazy Games).
- Scène de validation : fond, titre, compteur FPS + taille et orientation de l'écran,
  émetteur de cercles colorés en physique arcade, attrapables et lançables **au doigt comme
  à la souris** (multi-touch : deux doigts, deux cercles), qui rebondissent au sol et se
  repoussent entre eux.
- `src/config/balance.json` vide, documenté par `src/config/balance.schema.md`.
- `src/systems/grid.js` + tests vitest (`npm test`).
- Workflow CI/CD GitHub Pages avec affichage du poids de `dist/`.

Poids du build : **~1,2 Mo** (~325 Ko gzip), dont l'essentiel est Phaser — sous le budget
de 2 Mo du squelette.

À vérifier sur téléphone une fois Pages activé : les cercles s'attrapent bien au doigt, le
FPS tient, et la rotation portrait ↔ paysage ne casse rien.

## Lot 1 — ce qui est livré

La moitié gauche du jeu : la grille de merge, jouable de bout en bout, en greybox. La scène
de validation du Lot 0 a rempli son rôle et cède la place à `GameScene`.

### Ce qui est testable

- **Grille 5×5** avec la place de la bande de combat déjà réservée (placeholder à droite en
  paysage, en bas en portrait) : le Lot 2 s'y installe sans rebouger l'écran.
- **Items de tier 1 à 11** en greybox : une forme *et* une couleur par tier, plus le numéro.
- **Apparition automatique** pilotée par `balance.json` (`itemSpawner`) : 3 items au
  démarrage, puis un item toutes les 2,4 s, cadence qui accélère jusqu'à un plancher de
  900 ms. Seuls les tiers 1 et 2 apparaissent naturellement ; le reste s'obtient par fusion.
- **Drag souris et tactile** : sur un item identique → fusion (tier+1 sur la case cible),
  sur une case vide → déplacement, ailleurs → retour animé à la case d'origine. L'item tenu
  passe au-dessus de tout et grossit pour rester visible sous le doigt.
- **Grille pleine** : le spawn se met en pause, la bordure de la grille pulse, et tout
  repart dès qu'une fusion libère une case.
- **Compteur de debug** en haut à droite : `Merges: N (dernier tier: T)`, alimenté par
  l'événement `merge` — le contrat que consommera la bande de combat au Lot 2.

### Décisions prises

- **`GridModel` pur, sans Phaser.** Toutes les règles (fusion, déplacement, spawn sur case
  libre, tier maximum, grille pleine) vivent dans `src/systems/` et sont testées sans
  canvas. La scène ne décide de rien : elle appelle `applyDrop(from, to)` et affiche ce que
  le modèle émet sur un petit bus d'événements. Détail dans `CLAUDE.md`, section
  Architecture.
- **`merge` porte le tier fusionné, pas le tier résultant.** Fusionner deux tiers 3 émet
  `{ tier: 3, resultTier: 4 }` : le seed doc veut qu'une fusion de tier N fasse apparaître
  une unité de tier N. Le Lot 2 lit `tier` directement.
- **Tolérance de drop pensée pour le doigt** : la cible est la case dont le centre est le
  plus proche du centre de l'item lâché (distance de Tchebychev, donc pas de coin mort
  entre quatre cases), avec une marge de 0,9 case autour de la grille. Un lâcher approximatif
  fonctionne ; un lâcher sur la bande de combat ne fait rien.
- **Zone de saisie = la case entière**, pas la forme : viser les pointes d'une étoile au
  doigt serait injouable. Attention, une zone de saisie de conteneur Phaser se décrit
  **depuis son coin haut-gauche** (Phaser ajoute `displayOrigin` avant le test) — une zone
  centrée sur (0, 0) ne couvre que le quart haut-gauche de l'item.
- **Layout calculé par une fonction pure** (`src/systems/layout.js`), rejouée à chaque
  `resize`, donc testable : grille carrée, zones qui ne se chevauchent jamais, bande de
  combat non vide, du 320×568 au desktop.
- **Un seul drag à la fois.** Un second doigt qui attrape un autre item est neutralisé et
  son item revient à sa case, plutôt que de gérer deux gestes concurrents. Un `dragend`
  perdu (doigt sorti de la page, onglet masqué) est rattrapé dans `update()` : l'item
  revient chez lui au lieu de rester collé au vide.
- **Plus de moteur physique** dans la config Phaser : la grille se joue entièrement aux
  tweens. Le Lot 2 le réintroduira s'il en a besoin.

### Vérifications

- `npm test` : **83 tests** verts (grille, modèle, spawner, bus, layout).
- Passe navigateur automatisée (Chromium, viewport téléphone, événements tactiles réels) :
  fusion au doigt et à la souris, déplacement, lâcher invalide, rotation d'écran **pendant**
  un drag, relâcher hors grille, grille pleine puis dégagée, spawn continu — aucune erreur
  console.
- Poids de `dist/` : **1,2 Mo** (~325 Ko gzip), inchangé par rapport au Lot 0 — le code du
  jeu est négligeable devant Phaser. Sous le budget de 2 Mo.

### Ce qui reste ouvert

- Le feel se valide au doigt sur l'URL publique : cadence d'apparition, taille des items,
  tolérance de drop. Tout se règle dans `balance.json` (sauf la tolérance, qui est du feel
  de rendu) — retours à traiter au Lot 3.
- Aucun juice au-delà d'un tween de scale : squash, particules et vol vers la bande sont
  explicitement au Lot 3.
- Les couleurs des tiers 4/5 (deux verts) se ressemblent de loin ; les formes les
  distinguent, mais c'est un candidat au réglage quand les assets arriveront au Lot 4.

## Lot 2 — ce qui est livré

La moitié droite du jeu et le pont entre les deux : **une partie complète se joue de bout
en bout en greybox**, de la première fusion au game over, puis à la partie suivante.

### Ce qui est testable

- **Bande de combat** à la place du placeholder du Lot 1 : les ennemis entrent à un bout
  du couloir et avancent vers la **base** (PV + jauge). 8 slots d'unités alignés le long
  du couloir — le slot k couvre le segment qu'il a en face de lui.
- **4 types d'unités** (mono-cible, zone, ralentisseur, soutien) et **3 types d'ennemis**
  (basique, rapide/fragile, tank), formes et couleurs distinctes, tier lisible au numéro
  et à la couleur du liseré. Les unités ne meurent pas, les ennemis ne les attaquent pas :
  toute la pression passe par les PV de la base.
- **Le pont** : chaque fusion de tier N fait **voler l'item de sa case vers un slot** et y
  fait naître une unité de tier N. Le type suit une file déterministe affichée dans le HUD
  (« → Zone ») : on peut planifier ses fusions sans que les items de la grille soient typés.
- **Fusion d'unités** au même geste : deux unités identiques **adjacentes** donnent une
  version renforcée ★. Un lâcher sur un slot libre déplace ; sur un slot occupé non
  fusionnable, il **échange** — sans ça, une bande pleine sans paire adjacente serait une
  impasse.
- **Bande pleine** : les unités en surplus rejoignent une file visible (3 places). File
  pleine, les fusions de grille sont **refusées** : les items se repoussent, le hint
  « Fusionne tes unités ! » s'affiche, la file clignote en rouge.
- **Vagues** : 7 vagues scriptées puis une formule infinie ; bandeau « Vague N » entre les
  vagues. **Game over** quand la base tombe : vagues survécues, record `localStorage`,
  bouton rejouer.
- **Mode debug** `?debug=1` : fps, merges, ticks logiques, ennemis, unités. Sans le
  paramètre, l'écran est celui d'un joueur.

### Décisions prises

- **Tick logique fixe à 10 Hz** (`battle.tickMs`), le rendu interpole. 100 ms est le plus
  gros pas qui reste invisible : à 55 unités de couloir par seconde, un ennemi avance de
  5,5 unités par tick (0,55 % du couloir), et l'interpolation entre `prevProgress` et
  `progress` lisse le reste à 60 fps. Plus fin ne changerait rien de visible et coûterait
  du CPU sur téléphone d'entrée de gamme ; plus gros ferait sauter les cadences de tir
  (quantisées au tick). Bénéfice principal : la simulation est **indépendante du
  framerate** et rejouable à l'identique dans les tests, sans horloge. Au-delà de
  `maxTicksPerFrame` (5 ticks), le retard est **jeté** : revenir sur un onglet masqué ne
  doit pas déclencher deux minutes de combat d'un coup.
- **Stats par tier calculées, pas tabulées** : `stat(tier) = stat(1) × facteur^(tier-1)`,
  un facteur par stat et par type. 4 types × 11 tiers feraient 44 lignes à maintenir à la
  main au Lot 3, pour une courbe que le seed doc veut régulière de toute façon. Chaque
  type garde donc **cinq nombres** à régler au lieu d'une table.
- **Vagues : scriptées puis formule.** Les 7 premières vagues ont leur composition exacte
  dans `balance.json` (c'est là que se joue l'introduction des types), au-delà la
  composition est générée depuis un modèle avec un multiplicateur de nombre. Les
  multiplicateurs de PV et de vitesse, eux, s'appliquent à **toutes** les vagues : la
  composition et la difficulté se règlent séparément.
- **Le modèle raisonne en « unités de couloir »**, pas en pixels : le couloir fait
  toujours 1000 unités, quelle que soit sa taille à l'écran. Une portée de 220 veut donc
  dire la même chose sur un téléphone et sur un desktop, et `balance.json` reste
  indépendant de l'appareil.
- **Tirs instantanés avec traceur**, pas de projectiles physiques. Un projectile en vol
  ajouterait de l'état à simuler (et à tester) pour un gain de lisibilité nul à cette
  échelle ; le traceur qui s'efface dit déjà « ça tire, ça touche ». À rediscuter au Lot 3
  si le feel manque de poids.
- **`GameSession` porte le pont**, pas la scène. La règle « bande pleine → fusion
  refusée » concerne les deux modèles : la mettre dans une scène l'aurait rendue
  intestable. Le refus est décidé **avant** la fusion — un item ne doit jamais disparaître
  pour produire une unité que la bande refuse.
- **Rejouer = session neuve.** `session.destroy()` retire tous les écouteurs, la scène est
  relancée par Phaser (`SHUTDOWN` → `teardown`). Rien ne survit d'une partie à l'autre, et
  un test enchaîne deux parties sur un bus partagé pour le prouver.
- **`?debug=1` plutôt qu'un affichage permanent** : le compteur de merges du Lot 1 est
  passé derrière le drapeau, avec le fps et l'état de la bande.
- **Tailles à l'écran hors de `balance.json`.** La taille d'un ennemi ou d'un slot
  n'influence aucun calcul (le modèle est en unités de couloir) : ce sont des choix de
  lisibilité, ils vivent dans `src/render/` et `src/systems/layout.js`.

### Vérifications

- `npm test` : **248 tests** verts (dont 12 fichiers : bande, config, vagues, file de
  types, pont, layout de la bande, record).
- **Passe navigateur** (Chromium, portrait 390×844 et paysage 844×390, événements tactiles
  réels) : fusion à la souris et au doigt, unité qui naît du bon tier, vagues qui
  démarrent, fusion d'unités ★ au doigt, fusion de grille refusée bande pleine, game over,
  rejouer, seconde partie jouable, rotation d'écran en cours de partie — aucune erreur
  console.
- **Cadence vérifiée** : après l'échauffement de Phaser, 60 ticks logiques pour 6,0 s de
  temps réel, soit exactement 10 Hz.
- **Durée de partie simulée** sur les modèles purs, trois profils de joueur : **4,4 à
  5,3 minutes**, défaite vague 12 à 14. C'est la cible du seed doc (session de 3-5 min) et
  la consigne du lot : jouable, non équilibré, et perdu.
- Poids de `dist/` : **1,25 Mo** (336 Ko gzip), contre 1,24 Mo au Lot 1 — soit ~11 Ko gzip
  pour toute la bande de combat. L'essentiel reste Phaser. Sous le budget de 2 Mo.

### Ce qui reste ouvert pour le Lot 3

- **La boucle de pression est le premier point à juger.** Dans les parties simulées, la
  bande est pleine après 8 fusions et le reste de la partie se joue à débloquer des slots :
  seulement ~12 fusions de grille en 5 minutes. C'est volontaire, mais c'est peut-être trop
  serré — la grille pourrait devenir un décor. Les leviers, tous dans `balance.json` :
  `slotCount`, `queueSize`, et la possibilité de fusionner des unités non adjacentes.
- **L'adjacence pour la fusion d'unités** est peut-être une friction de trop au doigt sur
  un slot de 42 px en portrait. L'échange de slots la rend toujours possible, mais coûte un
  geste. À trancher au playtest ; la règle est isolée dans `canMergeUnits()`.
- **Le renfort ★ est un seul niveau** (V1). Deux unités → une unité à ×1,8 : c'est
  légèrement perdant en dégâts bruts, gagnant en place. Le multiplicateur (`battle.unitBuff`)
  est le premier réglage à toucher si la fusion d'unités ne paraît pas gratifiante.
- **Le soutien est difficile à lire** : il ne tire pas et son effet ne se voit que sur les
  cadences voisines. Candidat à un liseré reliant les slots buffés, au Lot 3.
- **Juice** : squash à la fusion, particules, impacts, screenshake sont explicitement au
  Lot 3. Le Lot 2 ne pose que le vol grille → bande, les traceurs et les bandeaux.
- Slots à 42 px en portrait : la zone de saisie est élargie à l'écart entre deux slots,
  mais c'est à confirmer au doigt sur un vrai téléphone.

## Lot 2.5 — ce qui est livré

**Refonte du cœur.** Le playtest du Lot 2 a validé le concept mais montré deux défauts
structurels : la bande en slots de tir statiques se remplissait puis se bloquait, et
l'envoi automatique à chaque merge retirait toute décision au joueur. Ce lot refait le pont
grille → combat et le combat lui-même. Le périmètre V1 du seed doc est inchangé par
ailleurs.

### Ce qui est testable

- **Tap = envoyer, glisser = fusionner.** Taper un item le consomme et l'envoie en file de
  déploiement (vol grille → slot) ; glisser fusionne ou déplace comme au Lot 1. Le merge ne
  produit plus rien tout seul : **c'est le joueur qui décide quand et quoi envoyer**.
- **File de déploiement** (5 places) à la place du banc de tir : les unités sortent **une
  par une toutes les 3,5 s**, dans l'ordre FIFO, avec une jauge de cooldown sur le slot de
  tête. File vide, le cooldown reste prêt et la prochaine unité tapée part immédiatement.
- **Le type se fige au tap**, pris sur la file de types affichée dans le HUD (« Unité :
  Zone ») : l'unité en attente montre déjà son type et son tier, on voit exactement ce qui
  va partir.
- **File pleine** → le tap est refusé : l'item secoue, la jauge sursaute, l'item reste sur
  la grille et la file de types n'avance pas. **Jamais bloquant** : la file se vide d'elle-
  même, et merges et déplacements restent libres en permanence.
- **Combat mutuel** : les unités marchent vers les ennemis, les ennemis vers la base. Au
  contact, les deux camps se frappent — les unités ont des PV, des barres de vie fines, et
  **meurent**. Les unités à distance s'arrêtent à leur portée, le ralentisseur ralentit en
  zone, le soutien projette une aura de buff sur les alliés proches **en marchant**.
- **Une grosse unité vaut mieux qu'un tas de petites** : voir les chiffres de simulation
  plus bas.
- Retiré : la **fusion d'unités ★**. Elle appartenait au banc de tir statique — on ne
  manipule plus rien sur la bande. Candidate à revenir après la V1, probablement en
  fusionnant **dans les slots de déploiement**.

### Décisions prises

- **Seuils tap/drag retenus : 12 px et 600 ms**, dans `balance.json` (section `input`),
  logique dans `src/systems/tapGesture.js`. Le seuil de distance est **aussi** donné à
  Phaser (`input.dragDistanceThreshold`) : aucun `dragstart` n'est émis tant que le doigt
  n'a pas franchi les 12 px, donc les deux gestes ne peuvent structurellement pas se
  déclencher ensemble — ce n'est pas un arbitrage a posteriori. Vérifié au doigt et à la
  souris dans la passe navigateur : un glisser ne part jamais au combat, un tap ne fusionne
  jamais. Le seuil de durée a une conséquence assumée : un appui long immobile ne fait
  **rien** (ni tap, ni merge). À juger au playtest.
- **Scaling par tier : ×2,3 en PV et en dégâts** (×2,25 pour zone et ralentisseur). Un item
  de tier N+1 coûtant exactement deux items de tier N, un facteur de 2 rendrait la fusion
  neutre ; au-delà, préparer est **strictement** gagnant. Le spam est puni deux fois : la
  petite unité vaut moins, et elle a consommé le même créneau de sortie. Un test verrouille
  la règle sur les vraies valeurs.
- **Deux contrats de bus, deux modules.** `enqueueUnit` (émis au tap) est consommé par
  `DeployQueue` ; `deployUnit` (émis à la sortie) est consommé par `BattleModel`. Chacun
  s'abonne lui-même et se désabonne dans son `destroy()`. Une unité n'entre en jeu **que**
  par `deployUnit` : le rythme de sortie est impossible à contourner par erreur.
- **Le cap d'unités est un garde-fou, pas un levier.** `maxFieldUnits` (20) retient la
  sortie **sans consommer le cooldown** : dès qu'une place se libère, la file repart. Un
  cap qui mangerait le cooldown serait une punition invisible.
- **Les unités marchent depuis la base.** Elles entrent là où elles sortent des slots, ce
  qui rend le lien file → champ lisible sans rien afficher, et donne au joueur le temps de
  voir ce qu'il a envoyé traverser le couloir.
- **`damagePerWave` ajouté au scaling.** Sans lui, une unité de haut tier devenait
  invulnérable et le champ se figeait en mur imprenable — la partie ne finissait jamais.
  `damageToBase`, lui, reste constant : les deux pressions se règlent séparément.
- **La jauge de cooldown est dans le slot de tête**, pas sous lui : tout ce qui déborde
  d'un slot finit hors du panneau sur un écran de 320 px.

### Vérifications

- `npm test` : **284 tests** verts (14 fichiers). Nouveaux : `DeployQueue` (FIFO, sortie au
  cooldown, sortie immédiate file vide, refus file pleine, champ saturé), `tapGesture`
  (seuils de distance et de durée, cas limites), combat mutuel (dégâts croisés, morts des
  deux camps, arrêt à portée, aura du soutien, ralentissement de zone, cap d'unités), tap
  qui consomme l'item et respecte la file de types, enchaînement de deux parties.
- **Passe navigateur** (Chromium, portrait 390×844, paysage 844×390, étroit 320×568,
  événements tactiles réels) : tap au doigt **et** à la souris, glisser qui fusionne sans
  envoyer, file saturée puis tap refusé, sortie au cooldown, unités qui marchent et
  meurent, dégâts des deux côtés, rotation d'écran en cours de partie, game over, rejouer,
  seconde partie jouable — **aucune erreur console**.
- **Durée de partie simulée** sur les modèles purs, trois profils de joueur (3 graines
  chacun) :

  | profil                                  | durée         | vague de défaite | tier moyen envoyé |
  | --------------------------------------- | ------------- | ---------------- | ----------------- |
  | spam (n'fusionne jamais, envoie tout)   | 2,3–2,5 min   | 8                | 1,0               |
  | mixte (fusionne, envoie tout)           | 4,1–5,6 min   | 15               | 2,7               |
  | prépare (fusionne, n'envoie que du gros)| 3,3–6,8 min   | 13–21            | 4,1               |

  La cible du seed doc (session de 3-5 min) est tenue, et **le spam est puni sans
  ambiguïté** : deux fois moins de vagues, deux fois moins de temps de jeu.
- Poids de `dist/` : **1,26 Mo** (336 Ko gzip), contre 1,25 Mo au Lot 2 — la refonte est à
  peu près neutre en poids. L'essentiel reste Phaser. Sous le budget de 2 Mo.

### Ce qui reste ouvert pour le Lot 3

- **Le cooldown de sortie (3,5 s) est le premier réglage à juger au doigt.** C'est le
  métronome du jeu : trop lent, on attend ; trop rapide, la file ne sert plus à rien et le
  spam redevient viable. Il se règle seul, dans `battle.deployCooldownMs`.
- **Le seuil de durée du tap (600 ms)** : un appui long immobile ne fait rien aujourd'hui.
  Si ça surprend au doigt, deux options — allonger le seuil, ou traiter tout appui immobile
  comme un tap quelle que soit sa durée (une ligne dans `isTap`).
- **Hoarder n'est pas toujours gagnant.** Le profil « prépare » (n'envoie qu'à partir du
  tier 4) varie de 3,3 à 6,8 min selon la graine : trop attendre affame le champ et laisse
  passer une vague. La tension est saine, mais elle est peut-être trop punitive — à
  confirmer, leviers : `deployCooldownMs`, `firstWaveDelayMs`, courbe de `waves.scaling`.
- **Le soutien reste difficile à lire** : son aura ne se voit que sur les cadences des
  voisins. Candidat à un cercle d'aura discret au Lot 3 (il en a un maintenant :
  `auraRadius`, donc c'est affichable sans nouvelle donnée).
- **Les 5 slots sont peut-être trop peu ou trop.** 5 places à 3,5 s = 17,5 s de réserve. Le
  bon réglage dépend de la cadence d'apparition des items, qui se règle à part.
- **Juice** : squash à la fusion, particules, impacts, screenshake sont toujours au Lot 3.
  Le Lot 2.5 ne pose que le vol grille → slot, les traceurs, les flashs de touche et la
  jauge de sortie.

## Lot 3 — ce qui est livré

Le cœur validé au Lot 2.5 est amené à son feel final et posé sur un équilibrage mesuré.
Toujours en greybox : les assets arrivent au Lot 4.

### Outillage d'équilibrage

- **Harness de simulation headless — `npm run sim`.** Les modèles étant purs, une partie
  complète se joue sans canvas, sans horloge et sans joueur : trois politiques automatiques
  (`spam`, `mixed`, `prepare`) pilotent une vraie `GameSession`, et le harness sort un
  rapport reproductible (vague moyenne, écart-type, durée, occupation de la grille, part de
  dégâts par type). Un réglage de `balance.json` se valide **en une seconde** au lieu d'un
  playtest. Déterministe par graine (`makeRng`), et fidèle : il ne réimplémente aucune
  règle, il appelle `applyTap` / `applyDrop` / `update` comme la scène Phaser.
- `npm run sim -- --matchups` mesure en plus **quel type d'unité tient quelle texture de
  vague** — escouade figée, renforts au rythme réel du cooldown, base invulnérable.
- **Mode `?debug=1` enrichi** : vitesse ×1/×2/×4, saut de vague, base invincible, et un
  récap de fin de partie (dégâts par type, envois par tier, vague, durée, taps refusés).
  Le panneau réserve sa place dans le layout — il ne recouvre jamais une case de la grille.

### Résultats d'équilibrage

30 parties par politique, graines 1..30 (`npm run sim -- --games=30`) :

| politique      | vague moy. | σ    | durée moy. | grille pleine |
| -------------- | ---------- | ---- | ---------- | ------------- |
| Spam tier 1    | 5,90       | 0,30 | 2:27       | **79 %**      |
| Mixte tier 3   | **10,00**  | 0,00 | **3:37**   | 0 %           |
| Prépare tier 4 | 12,00      | 0,00 | 4:33       | 0 %           |

Les trois objectifs du lot sont atteints : partie moyenne **3:37** (cible 3-5 min),
première défaite **vague 10** (cible 8-12), et **« merger bat spammer » ×2,03** (seuil
×1,4). Cet invariant est verrouillé par un test automatisé qui joue de vraies parties
(`tests/balanceInvariant.test.js`) : **la CI échoue si un futur réglage l'inverse**.

Le raisonnement complet, les valeurs retenues et les mesures sont dans
[`docs/balance-notes.md`](docs/balance-notes.md). En résumé : le débit d'items est le levier
dominant (il se cale sur `4 items / deployCooldownMs`), `hpPerWave` décide seul de la vague
où l'on meurt sans toucher au début de partie, et chaque vague scriptée porte désormais sa
**propre cadence d'apparition** — c'est ce qui distingue un rush d'un mur à nombre d'ennemis
égal, et le bandeau annonce la texture (« Vague 4 / Rush »).

### Passe de juice

Toutes les intensités vivent dans **`src/config/juice.json`** (documenté par
`src/config/juice.schema.md`, validé par `parseJuiceConfig`) — aucune en dur dans le code.

- **Grille** : squash & stretch à la fusion, gerbe de particules à la couleur du tier
  produit, easing des retours, secousse nette sur un tap refusé.
- **Trajets** : grille → slot puis slot → couloir, tous deux avec easing et traînée. Ce sont
  eux qui rendent le concept lisible, ils sont traités comme tels.
- **Combat** : hit flash des deux côtés, recul du corps au tir et au corps-à-corps, gerbe de
  particules à la mort, traceurs.
- **Base** : flash du bloc, vignette rouge en bord d'écran, secousse.
- **UI** : jauge de cooldown qui sursaute à chaque sortie, bandeau de vague avec entrée et
  sortie propres, score de game over qui compte de 0 à sa valeur.
- **SFX placeholder jsfxr**, synthétisés à l'exécution (`src/systems/sfx.js`) : merge, tap,
  refus, sortie d'unité, tir, mort, dégâts base, vague, game over. **Zéro octet
  téléchargé** — ils seront remplacés au Lot 4. Toggle son dans l'en-tête, mémorisé.
- **Screenshake parcimonieux** : trois événements seulement (dégâts base, mort d'un **tank**,
  game over), et l'étranglement est dans `JuiceKit.shake()` lui-même, pas chez l'appelant.

### Performance

Pooling strict : le champ de particules alloue son pool au démarrage et **n'alloue plus
rien** ensuite (pool plein → la plus vieille est recyclée), avec un seul `Graphics`
redessiné par frame. Mesuré en charge maximale (cap de 20 unités atteint, grosse vague à
l'écran, 184 particules vivantes), le coût par frame de **tout** notre code — modèle, vues,
particules — est de **0,17 ms en moyenne, 1,1 ms au 95e centile**, sur un budget de 16,7 ms.
Le reste de la frame est au rendu.

Poids de `dist/` : **1,28 Mo** (342 Ko gzip), contre 1,26 Mo au Lot 2.5. Les systèmes de
particules, la boîte à juice et le synthétiseur de sons ajoutent **~14 Ko** : les sons étant
générés à l'exécution et la vignette dessinée dans un canvas, le lot n'ajoute aucun asset.
Très en dessous du budget.

### Ce qui est testable

- `npm test` : **363 tests**, dont l'invariant d'équilibrage sur parties simulées, le
  déterminisme du harness (même graine → partie identique au compteur près), le pool de
  particules (taille constante, recyclage, dessin borné), la validation de `juice.json`, le
  synthétiseur de sons et son étranglement, les outils de debug du modèle.
- `npm run sim` et `npm run sim -- --matchups` : rapports reproductibles.
- **Passe navigateur** (Chromium, portrait 390×844) : partie jouée au pointeur, boutons de
  debug (×4, saut de vague, base ∞), toggle son, game over avec récap, rejouer — **aucune
  erreur console**, et la préférence de son survit à la nouvelle partie.

### Les curseurs à ajuster en priorité après les premiers tests au doigt

1. **`itemSpawner.minIntervalMs`** (780 ms) — le débit d'items, de loin le levier le plus
   violent. Le repère : un envoi de tier 3 coûte 4 items, un envoi part toutes les 3,5 s,
   donc « suivre le rythme » demande un item toutes les 875 ms. Le plancher est réglé juste
   en dessous pour que le goulot reste le cooldown de sortie, pas la grille. Si la grille
   paraît vide ou famélique au doigt, c'est ici — mais tout bouge en même temps.
2. **`waves.scaling.hpPerWave`** (1,48) — la vague où l'on meurt, sans toucher aux vagues
   1-3. Si les premières parties tombent trop tôt (vague 6-7), descendre à 1,44.
3. **`waves.interWavePauseMs`** (4000 ms) — la respiration, et un cadeau de puissance
   contre-intuitif : une pause vaut un déploiement gratuit. Passer de 3200 à 4500 ms fait
   grimper la vague moyenne de 10,3 à 12,8. À manier avec précaution.

Côté feel, les deux réglages à juger en premier sont `grid.mergeSquash` (le geste principal
du jeu) et `flight.toSlotMs` / `toFieldMs` (la lisibilité du pont).

### Ce qui reste ouvert

- **Le soutien n'a toujours pas de retour visuel d'aura.** Sa valeur est réelle et mesurée
  (il gagne les scénarios de ligne tenue) mais invisible. Candidat n° 1 du prochain passage
  de lisibilité — la donnée existe déjà (`auraRadius`).
- **Le spammeur meurt vague 6**, ce qui est rude pour qui n'a pas compris la fusion. Si le
  message ne passe pas au playtest, c'est un problème de pédagogie, pas d'équilibrage.
- **Les 60 fps sur mobile réel restent à confirmer au doigt** : la mesure ci-dessus est
  celle du coût CPU de notre code, pas celle du GPU d'un téléphone d'entrée de gamme.
- **La fusion d'unités ★** reste hors V1 (retirée au Lot 2.5).

## Lot 3.5 — ce qui est livré

Le Lot 3 avait un feel et un équilibrage validés, mais le playtest a remonté deux défauts
liés : **le jeu n'avait qu'un régime** — une urgence de grille permanente, où l'on ne
regardait ni la bataille ni la file de types — et **rien ne motivait une seconde partie**.
Ce lot installe une respiration, des décisions, et un build à raconter. Toujours en
greybox : les assets arrivent au Lot 4.

### La boucle de décision

Trois éléments, dont aucun ne vaut sans les deux autres :

```
annonce de vague   ×   file de types   ×   draft
« ce qui arrive »     « ce que je peux »   « ce que je deviens »
```

- **Annonce de vague.** Chaque pause annonce la **composition** de la vague à venir
  (icônes greybox par type d'ennemi + quantités) et son compte à rebours de préparation.
  La composition est **calculée par le modèle** (`BattleModel.wavePreview`), donc la
  formule infinie l'annonce aussi : le bandeau ne s'éteint pas en vague 11, c'est-à-dire
  au moment où la difficulté décolle.
- **File de types active.** Trois types visibles (tête mise en évidence) et un bouton
  **« passer »** qui défausse la tête contre un cooldown de 10 s. Voir la file sans pouvoir
  agir dessus n'était pas une décision.
- **Les deux sont physiquement côte à côte** dans la barre de décision (`IntelBar`), au
  sommet de la bande de combat : c'est leur croisement qui fait le choix du jeu — « 20
  rapides arrivent, ma tête de file est un mono-cible : j'envoie, je prépare plus gros, ou
  je passe ? ». Les séparer reviendrait à retirer la décision.

### Draft roguelite

Toutes les **3 vagues**, la partie **gèle** et propose **3 améliorations** parmi 11 ; le
joueur en prend une, elle vaut pour le reste de la partie. Les cartes entrent en cascade,
la carte choisie éclate en particules — c'est un moment de plaisir, pas un menu.

| id           | carte             | effet par niveau                       | niveaux |
| ------------ | ----------------- | -------------------------------------- | ------- |
| `fireRate`   | Cadence           | délai de frappe ×0,88                  | 3       |
| `power`      | Puissance         | dégâts ×1,18                           | 3       |
| `reach`      | Portée            | portée ×1,14 (aura du soutien comprise) | 2      |
| `plating`    | Blindage          | PV des unités à venir ×1,22            | 2       |
| `deploy`     | Sortie rapide     | cooldown de sortie ×0,88               | 3       |
| `slot`       | File élargie      | +1 place dans la file                  | 2       |
| `fortify`    | Fortifications    | +22 PV de base, **et 22 PV rendus**    | 3       |
| `richVein`   | Gisement riche    | items d'un tier plus haut              | 2       |
| `extraction` | Extraction        | intervalle d'apparition ×0,86          | 3       |
| `banner`     | Étendard          | soutien : effet ×1,35, portée ×1,2     | 2       |
| `reflex`     | Réflexe           | cooldown de « passer » ×0,65           | 2       |

**Architecture — la règle du lot : ce sont des modificateurs, jamais des mutations.** Une
carte prise n'écrit rien dans `balance.json` ; elle accumule un facteur
(`src/systems/modifiers.js`) que les lecteurs — `unitStats`, `DeployQueue`, `ItemSpawner`,
`UnitQueue` — appliquent au moment de lire. `balance.json` est importé **une seule fois**
pour toute l'application : une mutation ferait survivre les améliorations d'une partie à la
suivante, exactement le bug que `GameSession.destroy()` rend impossible partout ailleurs.
Un test le verrouille en prenant les onze cartes puis en comparant le fichier octet à octet.

Le gel de la partie est **double, à dessein** : `GameSession.pendingDraft` arrête
`update()`, `BattleModel.paused` coupe le tick au milieu d'une frame (une frame couvre
jusqu'à 5 ticks, la vague suivante avancerait sinon pendant la lecture), et côté rendu
`DraftScene` est lancée par-dessus `GameScene` mise en pause. Un bug de rendu ne peut pas
laisser filer la simulation.

### Passe de tempo — avant / après

| valeur                        | Lot 3 | Lot 3.5   | pourquoi                                                |
| ----------------------------- | ----- | --------- | ------------------------------------------------------- |
| `enemies.basic.speed`         | 55    | **44**    | −20 % : le temps de regarder un combat se dérouler      |
| `enemies.fast.speed`          | 135   | **106**   | −21 % : un rush reste un rush, mais lisible             |
| `enemies.tank.speed`          | 32    | **26**    | −19 %, l'écart de texture entre types est préservé      |
| `waves.firstWaveDelayMs`      | 7000  | **9000**  | lire la première annonce avant le premier contact       |
| `waves.interWavePauseMs`      | 4000  | **7000**  | **le temps de merge légitime** — la respiration du lot  |
| `itemSpawner.intervalMs`      | 1200  | **1300**  | accordé au nouveau rythme                               |
| `itemSpawner.minIntervalMs`   | 780   | **860**   | le débit passe **à l'équilibre** au lieu de +12 %       |
| `waves.scaling.hpPerWave`     | 1,48  | **1,62**  | compense tout le reste : sinon la partie durait 5:20    |
| `units.aoe.splashRadius`      | 90    | **112**   | rend à la zone ce que le ralentissement des rapides lui a pris |
| `units.support.buff`          | 0,30 / 0,18 | **0,58 / 0,30** | le soutien avait perdu toute situation gagnante |
| `battle.skipCooldownMs`       | —     | **10000** | nouveau : ≈ 3 créneaux de déploiement                   |

**Le plancher d'items est le changement de régime.** À 780 ms, le joueur recevait 12 % plus
d'items qu'il ne pouvait en envoyer : la grille débordait en permanence, ce qui *était*
l'urgence permanente remontée au playtest. À 860 ms le débit est exactement à l'équilibre
(`4 items / 3,5 s = 875 ms`) : suivre le rythme reste possible, mais le surplus n'est plus
donné — il se **choisit** au draft.

### Résultats du harness — 30 parties par politique, graines 1..30

| politique      | vague moy. | σ    | méd. | durée moy. | drafts/partie | grille pleine |
| -------------- | ---------- | ---- | ---- | ---------- | ------------- | ------------- |
| Spam tier 1    | 5,80       | 0,40 | 6    | 2:50       | 1,8           | **80 %**      |
| Mixte tier 3   | **9,67**   | 1,01 | 9    | **3:47**   | 3,1           | 0 %           |
| Prépare tier 4 | 11,20      | 0,70 | 11   | 4:24       | 3,2           | 0 %           |

✔ fenêtre de vagues 8-12 · ✔ durée 3-5 min · ✔ **merge bat spam ×1,93** (seuil ×1,4)

**Les objectifs chiffrés sont inchangés** : le draft rallonge la partie, la difficulté a été
relevée en face plutôt que la cible déplacée. Les politiques du harness draftent maintenant
(tirage aléatoire seedé) — un test vérifie qu'elles prennent bien des cartes, sans quoi une
régression sur le draft passerait inaperçue derrière des chiffres d'apparence normale.

Les σ ne sont plus nulles comme au Lot 3 : le draft introduit une vraie variance de partie
en partie. C'est le but du lot.

**Chaque type d'unité a de nouveau sa situation** (`npm run sim -- --matchups --tier=3`), et
c'est même une amélioration sur le Lot 3 où la **zone** ne gagnait jamais une colonne à elle
seule :

| escouade (tier 3)         | mur de tanks | marée mixte | rush blindé | mur épais | tout à la fois |
| ------------------------- | ------------ | ----------- | ----------- | --------- | -------------- |
| 4× mono-cible             | 0 ★          | 18          | 131         | 178       | 272            |
| 2× mono + 2× zone         | 0 ★          | **0 ★**     | 140         | 184       | 272            |
| 2× mono + 2× ralentisseur | 0 ★          | 0 ★         | 106         | **164 ★** | **267 ★**      |
| 3× mono + 1× soutien      | 0 ★          | 0 ★         | **101 ★**   | 178       | **267 ★**      |

### Écran de fin enrichi

Le récap n'est plus un outil de réglage caché derrière `?debug=1` : il s'adresse au joueur
et raconte **le build joué** — améliorations prises avec leur niveau, type d'unité qui a
porté les dégâts, envois, fusions, meilleur tier atteint. C'est ce qui répond à « rien ne
motive une seconde partie » : on sort de l'écran avec une idée à essayer, pas seulement un
score. La ligne de diagnostic d'équilibrage (fuites, taps refusés, durée) reste, elle,
derrière `?debug=1`.

### Poids et performance

Poids de `dist/` : **1,30 Mo** (349 Ko gzip), contre 1,28 Mo au Lot 3 — **+2 Ko**. Le lot
n'ajoute aucun asset : les icônes de cartes sont des formes vectorielles greybox
(`src/render/draftIcons.js`) et l'écran de draft réutilise la boîte à juice de la scène de
jeu plutôt que d'allouer un second pool de particules et un second contexte audio. Très en
dessous du budget de 5 Mo, et de celui de 20 Mo du seed doc.

### Ce qui est testable

- `npm test` : **438 tests** (363 au Lot 3), dont le `DraftSystem` (tirage seedé sans
  doublon, pool qui s'épuise proprement, cumul multiplicatif des niveaux, **non-mutation de
  `balance.json`**), le gel et la reprise propres du tick, le bouton « passer » et son
  cooldown, l'annonce de vague issue de la formule infinie, l'enchaînement de deux parties
  avec drafts, la barre de décision dans le layout de tous les écrans du parc, et
  l'invariant « merge bat spam » toujours vert.
- `npm run sim` : le rapport affiche désormais une ligne `draft` par politique (nombre de
  cartes par partie et fréquence de chacune), ce qui vérifie qu'aucune amélioration n'est
  injouable.
- **Passe navigateur** (Chromium, portrait 390×780 et paysage 900×520) : partie complète
  jouée au pointeur jusqu'au game over avec drafts pris à l'écran et huit « passer »,
  ouverture et fermeture du draft, rejouer — **aucune erreur console**, et la seconde partie
  repart sans une seule amélioration de la première (vérifié sur l'état réel de la session).

### À juger en premier au doigt

1. **`waves.interWavePauseMs`** (7000 ms) — la respiration. C'est la valeur qui décide si on
   a « le temps de regarder la bataille ». Trop longue, elle casse le rythme ; la raccourcir
   se paie sur `hpPerWave`.
2. **`battle.skipCooldownMs`** (10 s) — **la seule valeur du lot qui ne repose pas sur une
   mesure** : les politiques du harness ne se servent pas du bouton « passer ». Trop court,
   il annule la contrainte de la file ; trop long, le bouton est décoratif.
3. **`draft.everyWaves`** (3) — la fréquence des respirations. À 2, la partie devient une
   suite de menus ; à 4, un joueur qui meurt vague 8 n'a vu que deux drafts.
4. **`juice.draft.cardStaggerMs`** (90 ms) — l'entrée en cascade des cartes. C'est elle qui
   fait la différence entre « un menu s'ouvre » et « on me propose quelque chose ».

### Ce qui reste ouvert

- **Le soutien n'a toujours pas de retour visuel d'aura**, et son buff est maintenant deux
  fois plus fort qu'au Lot 3 : l'invisibilité de sa valeur devient franchement gênante.
  Candidat n° 1 du prochain passage de lisibilité.
- **Le spammeur meurt toujours vague 6.** Le draft creuse même l'écart (1,8 carte par partie
  contre 3,1 pour le joueur médian). Toujours un sujet de pédagogie, pas d'équilibrage.
- **Les 60 fps sur mobile réel restent à confirmer au doigt.**
- **La fusion d'unités ★** reste hors V1 (retirée au Lot 2.5).
