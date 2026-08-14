# Seed Doc — Labo Crazy Games, Jeu 01 : « Merge Battler » (titre de travail)

> Source de vérité du périmètre. Tout arbitrage de scope se tranche ici.

## Contexte & objectif

Premier jeu du laboratoire Crazy Games : un tout petit jeu bien fini, développé avec
assistance IA maximale, publié en Basic Launch sur Crazy Games (SDK non requis à ce stade).
Timebox ferme : 2 semaines / ~22-24 h, publication à la fin quoi qu'il arrive.
Le produit du labo est autant l'apprentissage (métriques, pipeline) que le jeu lui-même.

## Concept

Un merge en grille alimente un auto-battler sur une bande de combat.

- **Grille de merge (5×5)** : des items apparaissent à intervalle régulier sur les cases
  libres. Le joueur fusionne deux items identiques par glisser (souris ou tactile) →
  item de tier supérieur.
- **Bande de combat** : des ennemis avancent par vagues vers la base du joueur. Les unités
  du joueur tirent automatiquement. La base a des PV ; game over quand elle tombe.
- **Le pont entre les deux** : fusionner deux items de tier N sur la grille fait apparaître
  une unité de tier N sur la bande. L'item fusionné vole visuellement de la grille vers la
  bande — ce lien doit être lisible en permanence.
- **Buff (mécanique unique)** : deux unités identiques adjacentes sur la bande peuvent être
  fusionnées en version renforcée (même geste de merge — on recycle la mécanique, on n'en
  crée pas une nouvelle).
- **Score** : nombre de vagues survécues. Record local.

## Contenu V1 (périmètre fermé)

- **4 types d'unités** : dégât mono-cible, dégât de zone, ralentisseur, soutien (buff les
  voisines).
- **3 types d'ennemis** : basique, rapide/fragile, tank — + scaling numérique par vague
  (PV / vitesse / nombre).
- **11 tiers d'items max** sur la grille (réutilise la même courbe de valeur pour les unités).
- **Écrans** : jeu (démarrage direct, pas de menu), game over (score + record + rejouer),
  toggle son.
- **Session cible** : 3-5 minutes.

- **2 pouvoirs actifs** (*ajout Lot 4*) : une seconde famille d'items sur la grille, qui se
  fusionne entre elle et se consomme d'un tap — potion de soin, météorite.

**HORS PÉRIMÈTRE V1** : méta-progression, boutique, thèmes multiples, leaderboard en ligne.
(Candidats pour le jeu 02 si les métriques sont bonnes.)

> **Amendement du Lot 4.** Les pouvoirs actifs étaient hors périmètre dans la version
> initiale de ce document. Ils y sont entrés sur décision explicite, comme **dernière**
> mécanique de la V1 : les playtests des Lots 3 et 3.5 avaient laissé le jeu sans moment
> fort — rien qui permette au joueur de renverser une vague par une décision ponctuelle. Le
> périmètre gameplay est **clos** avec ce lot ; toute idée ultérieure va dans
> `docs/v1-1-ideas.md`, et le Lot 5 ne contient qu'assets et publication.

## Direction & feel

- **Greybox** (formes colorées) jusqu'à validation du fun — les assets IA arrivent au Lot 3
  seulement.
- **Le juice porte le jeu** : squash/particules à la fusion, vol de l'item vers la bande,
  impacts de tir, jauge de vague, screenshake léger et parcimonieux.
- **Lisibilité avant richesse** : à tout instant, comprendre en un regard ce que la grille
  apporte au combat.

## Contraintes techniques (Crazy Games)

- **Stack** : Phaser 3 + Vite (physique/tweens Phaser, pas de moteur lourd). Pas d'Unity.
- **Poids** : téléchargement initial visé ≤ 20 Mo (éligibilité homepage mobile ; limite
  dure : 50 Mo). Chargement < 3 s.
- **Inputs** : souris ET tactile, dès le début. Le jeu se teste sur téléphone via l'URL de
  preview.
- **Équilibrage data-driven** : toutes les stats (unités, ennemis, courbes de vagues,
  cadence de spawn des items) dans `src/config/balance.json` — jamais de valeurs en dur.
  L'équilibrage se fait par micro-itérations sur ce fichier.
- **Pas de SDK Crazy Games en V1** (Basic Launch). L'intégration SDK est un mini-lot
  ultérieur si passage en Full Launch.
- **Aucune donnée personnelle collectée** ; record en `localStorage` uniquement.

## Méthode de travail

- Développement par lots via sessions cloud Claude Code sur ce dépôt GitHub (pilotage PC ou
  téléphone). Chaque lot = une branche + une PR + un README de livraison court.
- **Déploiement continu** : chaque merge sur `main` est build et déployé automatiquement
  (GitHub Pages). Nathan teste sur téléphone via l'URL publique et renvoie ses retours de
  feel dans le lot suivant.
- Chaque prompt de lot indique les modifications à apporter à `CLAUDE.md` ; le lot les
  applique lui-même à la livraison.
- **Tests** : les règles de merge, le spawn d'items et la logique de vagues ont des tests
  unitaires (vitest). Le feel se valide à la main.

## Plan de lots

- **Lot 0 — Squelette** : Vite + Phaser, scène de validation, pipeline de déploiement,
  `CLAUDE.md`, `README`.
- **Lot 1** — Grille de merge complète (greybox).
- **Lot 2** — Bande de combat + pont grille → bande + game over (greybox). Lot critique :
  si le cœur n'est pas fun en greybox à la fin de ce lot, on n'ajoute pas de contenu pour
  le sauver.
- **Lot 3** — Équilibrage & feel (passes sur `balance.json` + juice).
- **Lot 3.5** — Rythme, décisions & rejouabilité (annonce de vague, file de types active,
  draft roguelite).
- **Lot 4** — Pouvoirs actifs. **Dernier lot de gameplay** : après lui, plus aucune
  mécanique n'entre en V1.
- **Lot 5** — Assets IA (sprites, sons, musique), vignette, soumission Basic Launch.
- **J+14 après publication** — Relevé des métriques (plays, playtime moyen, conversion,
  rétention) dans le journal du labo, décision : SDK/Full Launch, jeu 02, ou pivot.
