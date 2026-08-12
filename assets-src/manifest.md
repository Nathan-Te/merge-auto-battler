# Le manifest de découpe, expliqué

`manifest.json` dit au pipeline **comment couper les planches** déposées dans ce dossier.
C'est le seul fichier à toucher quand un sprite sort mal : il se corrige depuis l'éditeur
web de GitHub, sur un téléphone, sans rien connaître du pipeline.

> JSON n'accepte pas les commentaires : c'est pour ça que les explications sont ici et non
> dans le fichier. Même règle que `src/config/balance.schema.md`.

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
| `sizes.<catégorie>` | côté visé d'un sprite, en pixels | un sprite pixelisé en jeu (monter) ou un atlas trop lourd (descendre) |
| `atlas.quality` | qualité WebP, 1-100 | descendre pour tenir le budget de poids |
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
