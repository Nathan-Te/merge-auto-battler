# Les polices attendues

Deux fichiers, déposés dans `assets-src/fonts/`. Le pipeline les recopie tels quels dans
`public/assets/fonts/` et les compte dans le budget de poids ; `src/render/fonts.js` les
déclare à l'exécution, sans que le code change.

**Tant qu'ils ne sont pas là, le jeu tourne** en pile monospace du système. C'est la même
promesse que pour les sprites et pour les sons : un asset absent ne casse jamais rien.

## Convention de nom

```
<rôle>-<nom de la police>-<taille de dessin>.woff2
```

| morceau | rôle | exemple |
| --- | --- | --- |
| `<rôle>` | `display` (titres) ou `body` (tout le reste) | `body` |
| `<nom>` | libre, en minuscules | `pixellari` |
| `<taille>` | hauteur de dessin de la police, en pixels | `8` |

```
assets-src/fonts/
  display-nom-8.woff2
  body-nom-8.woff2
```

Un fichier qui ne commence ni par `display` ni par `body` est **ignoré** — c'est le seul
garde-fou possible sur un dossier où l'on dépose des fichiers depuis un téléphone.

## Pourquoi la taille est dans le nom

Une police bitmap n'a **qu'une** taille juste : celle à laquelle elle a été dessinée, et ses
multiples entiers. Rendue à 13 px alors qu'elle est dessinée à 8, elle est interpolée — une
ligne de pixels sur trois devient plus épaisse, exactement l'irrégularité qu'on chasse
partout ailleurs depuis la bascule en pixel art.

`pixelFontSize()` (`src/render/fonts.js`) contraint donc toutes les tailles du jeu à des
multiples de cette valeur. Le pipeline ne rouvre pas les fichiers de police : la seule façon
de connaître leur taille de dessin est qu'elle soit écrite dans leur nom. Absente, on
suppose 8, qui est la taille de dessin usuelle du genre.

C'est la police **`body`** qui fixe la contrainte, pas la `display` : elle est de loin la
plus utilisée, et c'est elle qu'on lit à petite taille — donc celle dont l'interpolation se
voit. Une display à 24 px supporte un pixel de travers ; une description de carte de draft à
8 px, non.

## Choisir les deux polices

| | display | body |
| --- | --- | --- |
| où | titre du jeu, titres de panneau, bandeau de vague, écran de fin | HUD, cartes de draft, aide, crédits, boutons |
| ce qui compte | du caractère | **la lisibilité, et rien d'autre** |
| taille à l'écran | 16 à 32 px | 8 à 16 px |

Le playtest du Lot 3.5 a montré que la description d'une carte de draft est **le** texte qu'il
faut lire pour décider. Une police pixel trop stylisée ne se lit pas à 8 px sur un téléphone :
viser une hauteur de capitale de 5 à 7 px, des chiffres qui ne se confondent pas entre eux,
et un `1` distinct du `l`. Le HUD affiche « HP 100/100 » et « Queue 3/5 » en permanence.

## Licence

Une police entre dans le jeu **avec sa licence**, comme un pack de sprites. La ligne se
déclare dans `src/config/credits.json`, clé `fonts` :

```json
"fonts": [
  { "name": "Nom de la police", "license": "SIL OFL 1.1", "url": "https://…" }
]
```

L'écran de crédits omet la section tant que la liste est vide : elle apparaît le jour où la
première police est livrée.

## Format

`.woff2` uniquement, **auto-hébergé**. La checklist de release interdit toute requête
externe : pas de `<link>` vers Google Fonts, ni au chargement ni ailleurs. Les `.woff`,
`.ttf` et `.otf` sont acceptés par le pipeline mais pèsent deux à quatre fois plus pour le
même dessin — convertir avant de déposer.
