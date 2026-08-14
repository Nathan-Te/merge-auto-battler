# Idées pour après la V1

> **Ce fichier est une salle d'attente, pas un plan.** Le périmètre gameplay de la V1 est
> **clos depuis le Lot 4** : plus aucune mécanique n'entre avant la publication. Toute idée
> qui arrive maintenant — la nôtre, celle d'un playtest, celle d'un joueur de Crazy Games —
> s'écrit ici et n'est pas discutée davantage tant que le jeu n'est pas publié.
>
> La raison est la timebox : deux semaines fermes, publication à la fin quoi qu'il arrive
> (`docs/seed.md`). Une idée notée ne coûte rien ; une idée implémentée en coûte toujours
> plus que prévu, et c'est le fini du jeu qui paie.
>
> Rien de ce qui suit n'est engagé. L'ordre n'est pas une priorité.

## Candidats déjà connus

### Fusion ★ d'unités

Deux unités identiques adjacentes fusionnent en une version renforcée. C'était la
« mécanique unique » du seed doc, retirée au **Lot 2.5** avec le banc de tir statique : on
ne manipule plus rien sur la bande, tout se joue sur la grille, et un geste de fusion sur le
champ de bataille n'a plus où se poser.

Si elle revient, ce sera probablement **dans les slots de déploiement** plutôt que sur le
champ : c'est le seul endroit où des unités sont immobiles, visibles et alignées. Cela
donnerait un troisième usage à la file — aujourd'hui elle ne fait qu'attendre.

À vérifier avant : est-ce que ça n'écrase pas le tap ? Le jeu a déjà deux gestes bien
séparés, et en ajouter un troisième sur une zone de 5 cases au doigt est un vrai risque
d'ergonomie.

### Visée manuelle des pouvoirs

Le Lot 4 vise automatiquement (le groupe le plus menaçant). C'est volontaire : le glisser est
réservé à la fusion, et une visée manuelle demanderait un troisième geste ou un mode.

Deux pistes si l'envie revient :

- **glisser un pouvoir vers la bande** — le lâcher désigne la zone. Cohérent avec le geste
  existant, mais il faut distinguer « glisser vers la bande » de « glisser vers une case »,
  et le seuil sera délicat au doigt ;
- **tap puis tap** — le premier arme le pouvoir, le second choisit la zone. Sans ambiguïté,
  mais c'est un mode, et un mode se ferme mal quand on change d'avis.

À mesurer d'abord : est-ce que le ciblage automatique se trompe souvent ? Si le joueur est
d'accord avec la zone neuf fois sur dix, la visée manuelle n'achète que de la friction.

### Un troisième type de pouvoir

Deux suffisaient pour la V1 : un pouvoir qui **répare** et un pouvoir qui **détruit**. Le
troisième devrait faire quelque chose qu'aucun des deux ne fait — un pouvoir qui **achète du
temps** (gel de zone, mur temporaire) plutôt qu'un troisième dosage de dégâts.

Attention à l'économie de la grille : à trois types, une fusion de pouvoirs demande de
rassembler trois fois moins souvent le bon type, et le tier 4 devient hors d'atteinte. Un
troisième pouvoir se paie en `powers.spawnChance`, donc en items d'unité.

## Idées venues des playtests

*(à remplir au fil des retours — laisser la source et la date)*
