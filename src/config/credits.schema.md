# `credits.json` — qui a fait quoi

Ce fichier alimente la page **Crédits**, accessible depuis le panneau d'aide (le « ? » de
l'en-tête). Il porte des **noms propres** : ils ne se traduisent pas, et ne vivent donc pas
dans `src/i18n/`. Seuls les intitulés de section sont traduits (`credits.*` dans les
dictionnaires).

> JSON n'accepte pas les commentaires : mêmes raisons et même forme que
> `balance.schema.md` et `juice.schema.md`.

## Pourquoi c'est obligatoire, et pas cosmétique

Les icônes de game-icons.net sont sous **CC BY 3.0** : leur utilisation impose de créditer
l'auteur de chaque icône. Ce n'est pas une politesse, c'est la condition de la licence — et
la fiche de soumission Crazy Games demande de déclarer l'origine des assets. Une icône
utilisée sans son auteur dans cette liste est une non-conformité, pas un oubli de finition.

## Clés

| clé | contenu |
| --- | --- |
| `engine` | moteur et outils, affichés tels quels |
| `icons.source` | le site d'origine (`game-icons.net`) |
| `icons.license` | la licence, telle qu'elle doit être citée (`CC BY 3.0`) |
| `icons.url` | l'adresse affichée à côté de la licence |
| `icons.authors` | **un nom par auteur d'icône utilisée** |
| `fonts` | une entrée par police, `{ "name": …, "license": … }` |
| `audio` | une entrée par pack ou auteur, `{ "name": …, "license": …, "url": … }` |
| `art` | une entrée par source d'illustration, même forme |

Une liste vide fait disparaître sa section : tant qu'aucun son n'est livré, la page ne
promet pas de crédits audio.

## Exemple rempli

```json
{
  "engine": "Phaser 3 · Vite",
  "icons": {
    "source": "game-icons.net",
    "license": "CC BY 3.0",
    "url": "https://game-icons.net",
    "authors": ["Lorc", "Delapouite", "Skoll"]
  },
  "fonts": [
    { "name": "Cinzel", "license": "SIL OFL 1.1" },
    { "name": "Inter", "license": "SIL OFL 1.1" }
  ],
  "audio": [
    { "name": "Kenney — Impact Sounds", "license": "CC0 1.0", "url": "https://kenney.nl" }
  ],
  "art": [{ "name": "Planches générées par IA, retouchées et découpées par le pipeline" }]
}
```

## Où trouver les auteurs d'icônes

Chaque page d'icône de game-icons.net nomme son auteur sous le dessin. Les trois plus
courants sont **Lorc**, **Delapouite** et **Skoll** ; il suffit de lister ceux dont une icône
a réellement été retenue, pas le site entier.
