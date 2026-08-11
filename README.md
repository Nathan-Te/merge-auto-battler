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
