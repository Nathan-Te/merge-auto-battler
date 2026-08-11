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
`src/scenes/ValidationScene.js`). C'est la règle posée dans `CLAUDE.md` pour les lots
suivants.

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
