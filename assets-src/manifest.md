# Le manifest de découpe, expliqué

`manifest.json` dit au pipeline **comment couper les planches** déposées dans ce dossier.
C'est le seul fichier à toucher quand un sprite sort mal : il se corrige depuis l'éditeur
web de GitHub, sur un téléphone, sans rien connaître du pipeline.

> JSON n'accepte pas les commentaires : c'est pour ça que les explications sont ici et non
> dans le fichier. Même règle que `src/config/balance.schema.md`.

## D'abord : le jeu est en pixel art

Deux règles d'or gouvernent tout ce fichier, et elles ne se négocient pas.

**1. Une seule résolution native.** Tous les sprites du jeu sont dessinés sur la même grille
de pixels : `pixel.nativeSize` vaut **16**, la taille mesurée sur le pack de référence
(cellules de 16 px, marge 1 px, gouttière 2 px, planche livrée en ×4). Un personnage fait
16 pixels de dessin, un décor en fait plus mais **du même calibre**. C'est ce qui fait que
deux sprites voisins ont des pixels de la même taille — et ça ne se rattrape pas après coup.

**2. Une seule palette partagée.** `assets-src/palette.json`, extraite du pack de référence
par `npm run palette`, committée. Toute source qui n'est pas déjà du pixel art y est
**quantifiée**. Sans elle, chaque planche garderait ses propres teintes et l'écran serait un
patchwork.

Conséquence directe sur les tailles : **`sizes` est en pixels d'art, pas en pixels d'écran.**
Avant la bascule, `sizes.orbs` valait 192 et voulait dire « 192 pixels à l'écran » ; il vaut
maintenant 16 et veut dire « 16 pixels de dessin ». C'est le **rendu** qui choisit ensuite par
quel entier multiplier, écran par écran. Le pipeline refuse une valeur trop grande plutôt que
de la découvrir dans la galerie.

### Deux sortes de sources

| | planche de **pack** | planche **générée** (IA) |
| --- | --- | --- |
| dans le manifest | `"native": true` | rien à écrire, c'est le défaut |
| ce qu'elle subit | rien — réduite à ×1 si elle est livrée agrandie | pixelisation complète |
| détourage du blanc | non (elle arrive sur du transparent) | oui |
| quantification | **non** — un pack ne se retouche pas, il fait référence | oui |
| hors palette | **signalé** dans la galerie, sprite par sprite | impossible par construction |
| crédit | **obligatoire** (voir plus bas) | sans objet |

La pixelisation d'une source générée fait trois choses, dans cet ordre :

```
réduction à la résolution native  →  seuillage alpha  →  quantification
     (moyenne de surface)            (opaque ou rien)     (palette partagée)
```

Le **seuillage alpha** est celui qui se voit le plus : le pixel art n'a pas de
demi-transparence. Un bord adouci sur un sprite affiché en ×4 ne produit pas un dégradé mais
un gros carré translucide, quatre fois plus visible que le pixel qu'il devait adoucir. C'est
le défaut n° 1 d'une génération pixelisée, et il saute aux yeux au zoom ×4 de la galerie.

### Le facteur d'agrandissement n'est jamais demandé

Il est **mesuré sur les pixels**. Les deux planches de référence du projet s'appellent
« Basic Holy 3x » et « Basic Undead 4x » et sont toutes les deux en ×4 : le nom du fichier
ment, les pixels non. On ne le force avec `scale` que pour une raison précise, et le pipeline
prévient quand la valeur forcée contredit la mesure.

## La boucle, en quatre gestes

1. Dépose une planche dans `assets-src/` (bouton **Add file** de GitHub, depuis le téléphone).
2. Décris-la dans `sheets` (voir ci-dessous), et commit.
3. Le CI découpe, encode et publie — **rien à lancer**.
4. Ouvre `/gallery/` sur le site déployé : chaque sprite y est sur fond en damier, avec ses
   dimensions et son poids. Si quelque chose cloche, retour au point 2.

**Tout problème d'asset se diagnostique dans la galerie avant de toucher au code.** Un halo
blanc, un cadrage de travers, un sprite manquant : les trois se voient sur cette page, et
les trois se corrigent ici.

## Décrire une planche

Une planche est une image découpée en **grille régulière**. Le minimum vital tient en
quatre clés :

```json
{
  "file": "orbes.png",
  "category": "orbs",
  "cols": 4,
  "rows": 3,
  "names": [
    "orb.1", "orb.2", "orb.3", null,
    null, null, null, null,
    null, null, null, null
  ]
}
```

- **`file`** — le nom exact du fichier déposé dans `assets-src/`.
- **`category`** — où ranger le sprite. Au choix : `orbs`, `powers`, `units`, `enemies`,
  `projectiles`, `decor`, `ui`. La catégorie décide de l'atlas et de la taille normalisée.
- **`cols` / `rows`** — le nombre de colonnes et de lignes de la planche.
- **`names`** — **un nom par case**, ligne par ligne, de gauche à droite. Il en faut
  exactement `cols × rows`. Une case vide, ratée ou en réserve prend `null` (ou `"-"`) : elle
  est ignorée.

Les noms attendus par le jeu sont listés dans la galerie, section « manquants ». Un nom que
le jeu n'utilise pas y apparaît aussi, en « orphelin » — c'est presque toujours une faute de
frappe.

## Animer un personnage — `animations`

Les packs de personnages sont tous bâtis pareil : un **bloc de cellules par personnage**, les
frames de marche côte à côte sur une ligne, les directions les unes sous les autres. Dans
`names`, on ne nomme qu'**une** cellule par personnage — celle où il est à l'arrêt, l'**ancre**.
Les autres frames se décrivent alors comme des **décalages de cellule** par rapport à elle :

```json
{
  "file": "monstres.png",
  "category": "enemies",
  "native": true,
  "cols": 3, "rows": 4,
  "animations": {
    "idle": { "frames": [[0, 0]] },
    "walk": { "frames": [[-1, 0], [0, 0], [1, 0], [0, 0]] }
  },
  "names": [null, null, null,
            null, "enemy.basic", null,
            null, null, null,
            null, null, null]
}
```

Un décalage vaut `[colonne, ligne]`, compté **en cases** de la grille de découpe. L'exemple
ci-dessus dit : « la marche, ce sont la case de gauche, l'ancre, la case de droite, puis
l'ancre » — un aller-retour, qui est le cycle de marche à trois images le plus courant.
`[0, 0]` désigne l'ancre elle-même, et le pipeline **réutilise** alors son sprite plutôt que
d'empiler une copie dans l'atlas.

**Pourquoi des décalages et pas des numéros de case.** Parce qu'ils restent justes quand on
ajoute un personnage : on déplace son nom dans `names`, et toutes ses frames suivent. Des
indices absolus se réécriraient à la main, case par case, depuis un téléphone.

Trois choses à savoir :

- **Le jeu ne demande jamais ces frames par leur nom.** Il demande l'ancre (`enemy.basic`) et
  suit ses animations. Elles apparaissent malgré tout dans la galerie, marquées « frame » et
  **collées à leur ancre** (le tri par nom s'en charge) : c'est là qu'on voit qu'une frame a
  été prise dans la mauvaise direction, ou qu'elle décale le personnage d'un pixel.
- **Tout le groupe est rogné sur un cadre commun.** Rogner chaque frame sur ses propres pixels
  recadrerait le personnage à chaque image — une frame où le bras est tendu est plus large,
  donc recentrée — et le personnage entier tremblerait à six images par seconde.
- **La cadence n'est pas ici.** Elle vit dans `src/config/juice.json` (`sprite.fps.walk`,
  `sprite.fps.idle`), avec le reste de ce qui se règle à l'œil. Une planche au rythme
  inhabituel peut ajouter `"fps": 10` à son animation, mais c'est une dérogation.

Le jeu joue `walk` pendant le déplacement et `idle` à l'arrêt (une unité qui tire, une
vignette qui attend dans un slot). Une planche qui ne déclare rien reste **statique**, comme
avant, et rien ne casse — les orbes de la grille sont dans ce cas et doivent y rester.

## Régler le détourage

Le fond blanc des planches est retiré **par propagation depuis les bords** : ce qui est
enfermé dans le dessin est conservé, même s'il est blanc lui aussi (une armure éclairée, le
blanc d'un œil). Deux boutons, globaux ou planche par planche :

```json
"keying": { "color": [255, 255, 255], "tolerance": 24, "softness": 16 }
```

- **`tolerance`** — jusqu'où un pixel compte comme du fond. **Monter** si un halo blanc
  subsiste autour du sprite ; **descendre** si le détourage mange les parties claires.
- **`softness`** — l'épaisseur du dégradé au bord. **Monter** si le contour fait un escalier
  visible ; descendre s'il paraît flou.
- **`color`** — la couleur du fond, si une planche n'est pas sur blanc.

## Les autres réglages

| clé | rôle | quand y toucher |
| --- | --- | --- |
| `pixel.nativeSize` | **la** résolution native du projet, en pixels d'art | jamais — c'est une constante de direction artistique |
| `pixel.alphaThreshold` | au-dessus, le pixel est opaque ; en dessous, il n'existe pas | les bords des sprites pixelisés bavent (monter) ou sont rongés (descendre) |
| `pixel.resample` | réduction par défaut : `area` ou `nearest` | une source déjà pixelisée mais agrandie d'un facteur non entier (`nearest`) |
| `palette.sources` | les planches de **pack** dont on extrait la palette | un nouveau pack de référence arrive — puis relancer `npm run palette` |
| `palette.quantize` | quantifier ou non | pour regarder une planche non quantifiée en galerie, le temps de juger si la palette est trop pauvre. Jamais pour publier |
| `native` (par planche) | la planche est déjà du pixel art | toute planche de pack |
| `credit` (par planche) | auteur, pack, licence, lien | **obligatoire** dès que `native` est vrai |
| `scale` (par planche) | forcer le facteur d'agrandissement de la source | quasi jamais : il est mesuré |
| `keyOut` (par planche) | détourer le fond ou non | par défaut : oui pour une génération, non pour un pack |
| `sizes.<catégorie>` | côté visé d'un sprite, en **pixels d'art** | un sprite trop petit ou trop grand par rapport aux autres |
| `atlas.lossless` | encodage WebP sans perte | **jamais le passer à false** pour autre chose que comparer un poids : la compression avec perte réinvente des couleurs hors palette et adoucit les bords, à la toute dernière étape |
| `atlas.quality` | qualité WebP, 1-100 — sans effet en sans perte | descendre pour tenir le budget de poids, si un jour `lossless` est coupé |
| `atlas.maxSize` | côté maximum d'un atlas | le pipeline dit qu'une catégorie ne tient pas |
| `atlas.padding` | gouttière entre sprites | des bribes du sprite voisin apparaissent en jeu (monter) |
| `budgetKb` | cible et limite dure, en Ko | jamais sans raison : la limite vient du seed doc |
| `tierBands` | quel tier porte quel palier visuel | la marche entre deux paliers tombe au mauvais endroit |
| `margin` / `spacing` | marge extérieure et gouttière **de la planche** | les découpes sont décalées |
| `trim` | rogner les bords transparents (`true` par défaut) | un décor plein cadre qu'il ne faut pas recadrer |
| `size` | déroge à `sizes.<catégorie>` pour cette planche | une seule planche a besoin de plus de détail |

## Paliers visuels

Le jeu a 11 tiers d'items et 6 tiers de pouvoir. Les planches n'en dessinent pas forcément
autant : `tierBands` dit **quel tier porte quel dessin**.

Il y a **trois tables séparées**, et c'est le point important :

```json
"tierBands": {
  "orb":   [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6],
            [7, 7], [8, 8], [9, 9], [10, 10], [11, 11]],
  "unit":  [[1, 4], [5, 8], [9, 11]],
  "power": [[1, 2], [3, 4], [5, 6]]
}
```

| table | ce qu'elle habille | combien de dessins |
| --- | --- | --- |
| `orb` | les items de la **grille** | autant qu'on veut, jusqu'à 11 |
| `unit` | les **combattants** sur le champ de bataille | 3 par type, en général |
| `power` | les fioles et orbes de météore | 3 par pouvoir, en général |

**Pourquoi trois et pas une** : un orbe est une icône, qui se décline onze fois sans y passer
la semaine ; une unité est un personnage. Une table commune imposerait de choisir entre
« onze orbes, donc onze personnages par type » et « trois personnages, donc trois orbes » —
un faux choix. Avec la table ci-dessus, un item de tier 7 affiche `orb.7` pendant qu'une
unité de tier 7 affiche `unit.single.2`.

Si `orb` n'est pas donné, il **hérite** de `unit` : un manifest écrit avant cette séparation
se comporte exactement comme avant.

**Aucune valeur de jeu n'en dépend** : changer les plages change ce qu'on voit, jamais qui
gagne la partie.

### Comment savoir laquelle ajuster

La galerie le dit. Si elle annonce des **orphelins** nommés `orb.4`, `orb.5`… c'est que tu as
dessiné plus d'orbes que la table `orb` n'en réclame : allonge-la, une plage par tier. Si
elle annonce des **manques** `unit.single.3`, c'est l'inverse — il manque un dessin, ou la
table `unit` en demande plus que la planche n'en fournit.

## Crédits et licences des packs

**Aucun asset de pack n'entre sans sa ligne de crédit.** Une planche déclarée `"native": true`
sans `credit` fait **échouer** le pipeline, avec un message qui dit quoi écrire :

```json
{
  "file": "mon-pack.png",
  "category": "units",
  "native": true,
  "credit": {
    "author": "Nom de l'auteur",
    "pack": "Nom du pack",
    "license": "CC BY 4.0",
    "url": "https://…"
  },
  "cols": 5, "rows": 3,
  "names": ["unit.single.1", "…"]
}
```

`author` et `license` sont obligatoires ; `pack` et `url` sont recommandés (certaines licences
imposent le lien). La ligne remonte toute seule dans l'écran de crédits du jeu, sans passer
par `src/config/credits.json` : c'est le seul chemin qui ne peut pas mentir, puisque le
pipeline refuse la planche sans elle.

C'est volontairement raide. Un sprite de pack sans auteur ni licence ne se détecte plus une
fois qu'il est dans l'atlas, mélangé à cinquante autres — le refuser à l'entrée est la seule
barrière qui tienne, et elle est facile à franchir quand on a l'information sous la main.

## Audio et polices

Deux dossiers passent **sans transformation**, mais sont comptés dans le budget de poids :

- `assets-src/audio/` → `public/assets/audio/` (`.webm`, `.ogg`, `.mp3`, `.m4a`, `.wav`) ;
- `assets-src/fonts/` → `public/assets/fonts/` (`.woff2`, `.woff`, `.ttf`, `.otf`).

Les noms de fichiers attendus pour les sons sont listés dans
[`docs/audio.md`](../docs/audio.md). Un son absent retombe sur le son de synthèse du Lot 3 :
le jeu n'est jamais muet, et on peut livrer les sons un par un.

## Quand ça ne marche pas

Le pipeline refuse de tourner plutôt que de produire des sprites faux, et ses messages
citent la planche et la clé fautives. Les trois cas courants :

- **« 12 cases découpées mais 10 noms donnés »** — `cols × rows` ne correspond pas à la
  longueur de `names`. Compte les cases de la planche, ou complète `names` avec des `null`.
- **« le nom X est utilisé deux fois »** — deux cases portent le même nom ; la seconde
  écraserait la première en silence.
- **« entièrement transparente après détourage »** — la case est vide, ou `tolerance` est
  trop haut et a effacé le dessin.
