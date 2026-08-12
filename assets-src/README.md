# `assets-src/` — la seule porte d'entrée des assets

Tout ce que le jeu affiche ou joue entre **ici**, sous sa forme brute : planches générées
par IA, sons, musique, polices. Le pipeline (`npm run assets`) découpe, détoure, normalise,
encode et publie dans `public/assets/`.

**Rien ne se dépose à la main dans `public/assets/`.** Ce dossier est entièrement généré :
le pipeline y écrit, y supprime ce qui n'a plus de source, et le CI recommit le résultat. Un
fichier posé directement là disparaîtrait au prochain passage, sans prévenir — et personne
ne saurait d'où il venait.

## Contenu

```
assets-src/
  manifest.json      comment découper chaque planche  ← le seul fichier à éditer
  manifest.md        son mode d'emploi (lis-le avant d'y toucher)
  *.png              les planches, telles que générées
  audio/             sons et musique, déjà au bon format
  fonts/             polices auto-hébergées (.woff2)
```

## La boucle, 100 % au téléphone

1. **Upload** d'une planche via l'interface web de GitHub (bouton *Add file*).
2. **Décrire** la planche dans `manifest.json` (voir `manifest.md`).
3. Le **CI** découpe et publie tout seul.
4. **Revoir** le résultat sur `/gallery/` du site déployé — fond en damier, dimensions,
   poids, et la liste de ce qui manque encore.

Relancer le pipeline sans changement ne produit **aucun diff** : les sorties ne sont
réencodées que si une source a bougé.

## Formats attendus

| famille | format | note |
| --- | --- | --- |
| planches | PNG, fond blanc uni | le blanc devient transparent, par propagation depuis les bords |
| sons | `.webm` (Opus) de préférence, sinon `.mp3` | noms attendus dans `docs/audio.md` |
| musique | `.webm` (Opus), boucle propre | comptée dans le budget, viser < 1,5 Mo |
| polices | `.woff2` | auto-hébergées : le jeu ne fait **aucune requête externe** |

## Budget

Le seed doc impose **≤ 20 Mo** de téléchargement initial, cible **< 10 Mo**. Le poids est
affiché par `npm run assets`, en tête de la galerie et dans le résumé de chaque build du CI.
Les leviers, dans l'ordre : `atlas.quality`, puis `sizes.<catégorie>`, puis la longueur de la
musique.
