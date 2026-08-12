# Audio — ce qu'il faut livrer, et sous quel nom

Les sons entrent par `assets-src/audio/`, comme tout le reste (cf. `assets-src/README.md`).
Le pipeline les recopie tels quels dans `public/assets/audio/` et les compte dans le budget
de poids ; `BootScene` les charge, `AudioBank` les décode.

**Le nom du fichier est le contrat.** Un fichier nommé `merge.webm` remplace le son de fusion,
sans toucher à une ligne de code. Un nom inconnu est chargé mais jamais joué — il ne casse
rien, il pèse pour rien.

## Repli, et ce qu'il permet

Chaque son a une version **synthétisée** depuis le Lot 3 (`src/systems/sfx.js`). Tant qu'un
fichier n'est pas livré, c'est elle qui joue. Conséquence pratique : les sons peuvent arriver
**un par un**, et chacun se juge en contexte dès qu'il est déposé, sans attendre les autres.
Le jeu n'est jamais muet, et il n'y a jamais de « moment de bascule » à orchestrer.

## Les dix-huit noms

| fichier | quand il joue |
| --- | --- |
| `merge` | deux orbes fusionnent — le geste principal du jeu |
| `tap` | un orbe part en invocation |
| `reject` | tap refusé : file pleine, ou pouvoir sans cible |
| `deploy` | une unité sort de la file et entre au combat |
| `shot` | une unité tire |
| `slow` | le mage de givre gèle une zone |
| `death` | une unité ou un ennemi meurt |
| `baseHit` | le château encaisse |
| `wave` | une vague se lance |
| `powerCast` | un pouvoir est dépensé (le tap) |
| `powerBlast` | la météorite touche |
| `powerHeal` | la potion soigne |
| `draftOpen` | l'écran de draft s'ouvre |
| `draftPick` | une carte est prise |
| `button` | un bouton d'interface (son, aide, crédits, rejouer) |
| `gameOver` | fin de partie, si aucun `defeat` n'est livré |
| `music` | **boucle** musicale de fond |
| `defeat` | sting de défaite ; il remplace `gameOver` et coupe la musique |

## Format

- **`.webm` (Opus)** de préférence — c'est le meilleur rapport poids/qualité et il est lu
  partout sauf sur de très vieux Safari. `.mp3` en repli si besoin.
- **Mono** pour les effets : le jeu ne spatialise rien, et la stéréo double le poids pour
  rien.
- **Coupés au plus près.** Un effet de jeu utile dure 80 à 300 ms ; une queue de réverbération
  de deux secondes se paie en poids et se fait couper à l'oreille par le son suivant.
- **Musique** : boucle propre (le raccord ne doit pas s'entendre), viser **< 1,5 Mo**. C'est
  de loin le plus gros fichier du jeu, donc le premier levier si le budget se tend.
- Normaliser autour de **−14 LUFS** : les volumes fins se règlent ensuite dans `juice.json`,
  pas dans le fichier.

## Volumes

Deux réglages dans `juice.json`, comme tout le feel :

```json
"sound": {
  "enabled": true,
  "masterVolume": 0.32,
  "categories": { "sfx": 1.0, "music": 0.45 }
}
```

`categories.music` est le rapport musique/effets, et c'est **le seul chiffre à régler au
casque** : la musique doit rester sous les effets sans disparaître. Le volume propre à chaque
effet reste dans son entrée `sfx.<nom>.volume`, et son étranglement dans `minIntervalMs` —
un son livré hérite des deux, exactement comme sa version synthétisée.

## Autoplay

La musique ne démarre **jamais** au chargement : les navigateurs l'interdisent, et le premier
`pointerdown` du joueur la déclenche. Ce n'est pas contournable, et ça ne se teste pas en
console — il faut toucher l'écran.

Le bouton son du HUD coupe tout, musique comprise, et son état survit au rechargement
(`localStorage`).
