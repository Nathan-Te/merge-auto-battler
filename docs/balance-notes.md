# Notes d'équilibrage — Lots 3 et 3.5

> Document de travail des itérations de réglage. Les valeurs vivent dans
> `src/config/balance.json` (règles) et `src/config/juice.json` (feel) ; **ce fichier
> explique pourquoi elles valent ça**, et donne les mesures qui le prouvent.
>
> Toutes les mesures se rejouent à l'identique :
> `npm run sim -- --games=30` et `npm run sim -- --matchups --tier=3`.
>
> **Les sections 1 à 5 décrivent l'état du Lot 3**, conservées pour le raisonnement qui a
> mené à ces valeurs. **La section 7 donne l'état courant (Lot 3.5)** : c'est elle qui fait
> foi pour les chiffres.

## 1. L'outil : `npm run sim`

Les modèles sont purs (aucune dépendance à Phaser), donc une partie complète se joue sans
canvas, sans horloge et sans joueur. Le harness (`src/sim/`) pilote une vraie `GameSession`
avec une **politique** automatique et sort un rapport. Un réglage se valide en une seconde
au lieu d'un playtest.

```bash
npm run sim                          # 20 parties par politique, graine 1
npm run sim -- --games=50 --seed=7   # échantillon plus large
npm run sim -- --matchups --tier=3   # « quel type d'unité contre quelle vague »
npm run sim -- --json                # sortie machine, pour comparer deux réglages
```

Deux garanties, sans lesquelles il ne servirait à rien :

- **déterminisme** — le tirage vient de `makeRng(seed)`, les politiques ne tirent rien.
  Même graine + même `balance.json` = mêmes chiffres, à la milliseconde ;
- **fidélité** — le harness ne réimplémente **aucune** règle : il appelle `session.update()`,
  `applyTap()` et `applyDrop()`, exactement comme la scène Phaser. L'horloge d'apparition
  des items a d'ailleurs été déplacée de la scène vers `GameSession` pour ça.

### Les trois politiques

| id        | comportement                                                    | ce qu'elle représente          |
| --------- | --------------------------------------------------------------- | ------------------------------ |
| `spam`    | envoie chaque item dès qu'il apparaît, **ne fusionne jamais**    | l'anti-modèle, borne basse     |
| `mixed`   | fusionne jusqu'au tier 3 puis envoie                            | **le joueur de référence**     |
| `prepare` | ne lâche rien avant le tier 4                                   | le joueur optimisé, borne haute |

Chacune agit **au plus une fois toutes les 300 ms** : un humain ne joue pas 60 coups par
seconde, et une politique instantanée mesurerait un jeu qui n'existe pas.

### Ce que le harness ne mesure pas

Le feel, la lisibilité, la précision du doigt, et le fait qu'un joueur réel hésite. Les
chiffres sont une **borne haute** : un joueur découvrant le jeu se situe entre `spam` et
`mixed`, plus près de `mixed` dès la deuxième partie. À confronter au playtest.

## 2. Objectifs et résultats

Objectifs (`src/sim/targets.js`, repris du prompt du lot et de `docs/seed.md`) :

- partie moyenne d'un joueur découvrant le jeu : **3 à 5 minutes** ;
- première défaite vers les **vagues 8-12** ;
- **« merger bat spammer »**, nettement (seuil retenu : ×1,4 en vagues survécues).

Résultats, 30 parties par politique, graines 1..30 :

| politique      | vague moy. | σ    | min | max | durée moy. | grille (items / % pleine) |
| -------------- | ---------- | ---- | --- | --- | ---------- | ------------------------- |
| Spam tier 1    | 5,90       | 0,30 | 5   | 6   | 2:27       | 22,9 / **79 %**           |
| Mixte tier 3   | **10,00**  | 0,00 | 10  | 10  | **3:37**   | 2,0 / 0 %                 |
| Prépare tier 4 | 12,00      | 0,00 | 12  | 12  | 4:33       | 2,1 / 0 %                 |

✔ fenêtre de vagues · ✔ durée · ✔ **merge bat spam ×2,03**

Un test automatisé verrouille les trois (`tests/balanceInvariant.test.js`) : **la CI échoue
si un futur réglage inverse l'invariant**. Il vérifie aussi que `prepare.min > spam.max`,
pour que l'écart ne puisse pas tenir à une partie chanceuse.

Les σ nulles ne sont pas un bug : les politiques sont déterministes, seule l'apparition des
items varie d'une graine à l'autre, et la mort tombe sur la même vague. Le bruit d'un vrai
joueur est bien plus large — considérer la fenêtre 8-12, pas la valeur 10,00.

## 3. Le raisonnement, valeur par valeur

### L'économie d'items est le vrai levier

La découverte du lot. Le débit d'items décide de tout le reste, bien plus que les stats
d'unités :

| réglage testé (`intervalMs` → `minIntervalMs`) | vague moy. (mixte) |
| ---------------------------------------------- | ------------------ |
| 2400 → 900 (Lot 2.5)                           | 12,5               |
| 1500 → 650                                     | 29,5               |
| 1600 → 880                                     | 22,9               |
| **1200 → 780 (retenu)**                        | 10,0 (à difficulté relevée) |

Le calcul qui cadre le réglage : un envoi de tier 3 coûte **4 items**, et le cooldown de
sortie est de **3,5 s**. Suivre le rythme demande donc `4 / 3,5 = 1,14 item/s`, soit un
item toutes les **875 ms**.

- `minIntervalMs: 780` place le débit **juste au-dessus** (1,28 item/s, +12 %). C'est
  volontaire : le goulot d'étranglement doit être `deployCooldownMs` — le métronome du jeu —
  et non la grille. Le surplus de 12 % est ce qui permet de monter occasionnellement plus
  haut que le tier 3.
- Un envoi de tier 4 coûte 8 items, soit 2,3 items/s : **hors d'atteinte durablement**.
  C'est ce qui fait du tier 3-4 la bande soutenable, et des tiers supérieurs des
  récompenses ponctuelles. Le rapport le confirme : `prepare` n'envoie que du tier 4, jamais
  au-delà.
- `intervalMs: 1200` (contre 2400) supprime la famine du début de partie, qui empêchait
  d'atteindre le tier 3 avant la vague 4.
- `startingItems: 8` donne de quoi faire une première fusion **avant** la vague 1.

**Lecture de la colonne « grille »** : le spammeur vit à 79 % de temps grille pleine — sa
punition est visible à l'écran (la bordure pulse, le spawn se met en pause). Le joueur qui
fusionne garde une grille respirable. Deux tests verrouillent cet écart.

### Courbe de difficulté

`hpPerWave: 1.48` est **la** valeur de cadrage — elle décide seule de la vague où l'on
meurt, sans toucher aux premières vagues (1,48² = 2,2× en vague 3, mais 1,48⁹ = 39× en
vague 10). C'est ce qui satisfait à la fois « vagues 1-3 faciles » et « pas de palier mou ».

| `hpPerWave` | vague moy. (mixte) | durée |
| ----------- | ------------------ | ----- |
| 1,42        | 10,7               | 3:30  |
| **1,48**    | **10,0**           | 3:37  |
| 1,54        | 9,0                | 2:35  |

`interWavePauseMs: 4000` est le second levier de cadrage, et il est **contre-intuitif** :
allonger la pause rend le joueur nettement plus fort (une pause = un déploiement gratuit).
Passer de 3200 à 4500 ms fait grimper la vague moyenne de 10,3 à 12,8. C'est le curseur à
manier avec le plus de précaution.

### Textures de vagues

Nouveauté du lot : une vague scriptée peut porter un **libellé** et sa **propre cadence
d'apparition** (`spawnGapMs`). C'est ce qui fait la différence entre un rush et un mur —
à nombre d'ennemis égal, ce ne sont pas les mêmes vagues du tout. Le libellé est annoncé
dans le bandeau (« Vague 4 / Rush »), ce qui laisse une chance de préparer le bon type.

| vague | texture           | cadence  | contenu                    |
| ----- | ----------------- | -------- | -------------------------- |
| 1-2   | Découverte        | 900/820  | 3 puis 5 basiques          |
| 3     | Premiers rapides  | 760      | 5 basiques + 4 rapides     |
| 4     | **Rush**          | **220**  | 14 rapides                 |
| 5     | **Mur de tanks**  | **1100** | 4 tanks + 6 basiques       |
| 6     | Marée mixte       | 520      | 12 basiques + 9 rapides    |
| 7     | **Rush blindé**   | **200**  | 20 rapides + 5 tanks       |
| 8     | Marée             | 480      | 16 basiques + 12 rapides   |
| 9     | **Mur épais**     | **1000** | 8 tanks + 12 basiques      |
| 10    | Tout à la fois    | 200      | 26 rapides + 12 basiques + 5 tanks |
| 11+   | formule infinie   | formule  | 12/14/6 × 1,24^(n-10)      |

Le modèle `infinite` (12 basiques, 14 rapides, 6 tanks) **reprend l'intensité de la vague
10** au lieu de repartir plus bas : c'est ce qui supprime le palier mou qui existait au
Lot 2.5, où la vague 8 générée était plus douce que la vague 7 scriptée.

### Rôle de chaque type d'unité

Mesuré, pas affirmé : `npm run sim -- --matchups --tier=3` oppose une escouade de 4 unités
à chaque texture de vague, base invulnérable, **avec des renforts au rythme réel du
cooldown**. La case donne les PV de base laissés passer — plus bas, mieux c'est.

| escouade (tier 3)         | mur de tanks | marée mixte | rush blindé | mur épais | tout à la fois |
| ------------------------- | ------------ | ----------- | ----------- | --------- | -------------- |
| 4× mono-cible             | 0 ★          | 0 ★         | 111         | 164       | 267            |
| 2× mono + 2× zone         | 0 ★          | 0 ★         | 101         | 178       | 267            |
| 2× mono + 2× ralentisseur | 0 ★          | 0 ★         | 81          | **128 ★** | **257 ★**      |
| 3× mono + 1× soutien      | 0 ★          | 0 ★         | **76 ★**    | 164       | 262            |

Les situations, telles qu'elles ressortent de la mesure :

- **Mono-cible** — le généraliste. Jamais le meilleur choix, jamais le mauvais : il tient
  tout ce qui n'est ni une marée ni un mur. C'est le type le plus fréquent de la file, et
  le seul dont la valeur est purement des dégâts.
- **Zone** — les paquets serrés. Sa valeur monte avec la densité : elle est nulle en vague 1
  (les ennemis arrivent un par un) et forte dès qu'une vague resserre sa cadence. C'est le
  type qui répond aux textures « marée » et « rush ».
- **Ralentisseur** — la **durée**. Il gagne les scénarios longs (mur épais, tout à la fois)
  parce que ce qu'il achète n'est pas des dégâts mais du **temps**, et que le temps fait
  arriver l'unité suivante. Point de méthode important : avec une escouade figée (sans
  renforts), il paraissait inutile — le banc d'essai a dû être corrigé pour le mesurer
  honnêtement, pas le ralentisseur pour paraître meilleur.
- **Soutien** — les combats de front tenus. Il n'inflige **aucun** dégât (0 % dans toutes
  les colonnes du rapport, c'est normal et non un bug) : sa valeur est un multiplicateur sur
  ce que font les autres. Il gagne quand une ligne tient (rush blindé), il ne sert à rien
  quand elle casse.

Réglages faits pour créer ces situations : le ralentisseur est passé de `damage 3 → 6`,
`range 200 → 250`, `slowRadius 90 → 140`, `slowFactor 0,55 → 0,38` — il n'avait **aucune**
situation gagnante avant. Les rapides sont passés de 115 à 135 de vitesse, sans quoi un
« rush » n'était qu'une vague ordinaire arrivée plus vite.

La file de types (`unitTypePattern`) est passée de 5/2/2/1 à **4 mono, 3 zone, 2 ralenti,
1 soutien**, ce qui a rééquilibré la part de dégâts de 65/26/8 à **51/39/10** — plus proche
d'un jeu où chaque type compte.

## 4. Les curseurs, par ordre d'effet

À manier dans cet ordre lors des prochaines itérations :

1. **`itemSpawner.minIntervalMs`** (780) — le débit d'items. Le levier le plus violent :
   ±100 ms déplace la vague moyenne de plusieurs unités. Le repère à garder en tête :
   `4 items / deployCooldownMs`.
2. **`waves.scaling.hpPerWave`** (1,48) — la vague où l'on meurt, sans toucher au début de
   partie.
3. **`waves.interWavePauseMs`** (4000) — la respiration, et un cadeau de puissance
   sous-estimé.
4. `battle.deployCooldownMs` (3500) — le métronome. Le changer oblige à recalculer le
   débit d'items en conséquence : les deux vont ensemble, toujours.

## 5. Feel — `juice.json`

Les intensités de feedback vivent dans `src/config/juice.json`, séparé de `balance.json` :
ce sont deux métiers, l'un se règle au harness, l'autre au doigt sur un téléphone, et les
mélanger garantissait de casser un équilibrage en cherchant une secousse plus douce.

Choix notables :

- **Parcimonie du screenshake** — le garde-fou n'est pas dans l'appelant (qui oublierait)
  mais dans `JuiceKit.shake()` : `shake.minIntervalMs` (200 ms) étrangle les secousses
  rapprochées. Seuls trois événements secouent : dégâts à la base, **mort d'un tank**
  (jamais des autres ennemis), et game over — le seul autorisé à couper la file.
- **Étranglement des sons** — chaque son porte son `minIntervalMs`. Vingt unités qui tirent
  produiraient trente sons par seconde ; le premier coup d'une salve s'entend, les suivants
  se devinent. Un son en retard est **ignoré**, jamais mis en file : un son décalé ment sur
  ce qui se passe.
- **Recul des corps-à-corps** appliqué à la forme **dans** son conteneur, jamais au
  conteneur : la position de celui-ci est réécrite à chaque frame depuis le modèle, un recul
  posé dessus serait effacé à la frame suivante.
- **Sons synthétisés à l'exécution** (façon jsfxr, `src/systems/sfx.js`) : zéro octet
  téléchargé, réglables comme le reste du feel, remplacés au Lot 4.

## 6. Ce qui restait ouvert à la fin du Lot 3

- **La fenêtre de défaite d'un vrai joueur** est à confirmer au doigt. Si les premières
  parties tombent trop tôt (vague 6-7), le premier curseur est `hpPerWave` → 1,44.
- **Le spammeur meurt vague 6**, ce qui est brutal pour qui n'a pas compris la fusion. À
  surveiller : si le message « il faut fusionner » ne passe pas, ce n'est pas un problème
  d'équilibrage mais de pédagogie (un tutoriel n'est pas au périmètre V1).
- **La grille du joueur efficace tourne à 2 items de moyenne** au harness. Les politiques
  consomment parfaitement ; un humain laisse traîner davantage. À vérifier au playtest : si
  la grille paraît vide, monter `startingItems` avant de toucher aux intervalles.
- **Le soutien n'a pas de retour visuel d'aura.** Sa valeur est réelle mais invisible :
  candidat n° 1 du prochain passage de lisibilité.

---

## 7. Lot 3.5 — rythme, décisions, rejouabilité

Le playtest du Lot 3 a remonté deux défauts liés : **le jeu n'avait qu'un régime** (une
urgence de grille permanente — on ne regardait ni la bataille ni la file de types, et
l'information affichée ne nourrissait aucun choix) et **rien ne motivait une seconde
partie**. Ce lot installe une respiration, des décisions, et un build à raconter.

### 7.1 La passe de tempo, valeur par valeur

| valeur                        | Lot 3 | Lot 3.5 | pourquoi                                                     |
| ----------------------------- | ----- | ------- | ------------------------------------------------------------ |
| `enemies.basic.speed`         | 55    | **44**  | −20 % : le temps de regarder un combat se dérouler           |
| `enemies.fast.speed`          | 135   | **106** | −21 % : un rush restait un rush, mais lisible                |
| `enemies.tank.speed`          | 32    | **26**  | −19 %, pour garder l'écart de texture entre les trois types  |
| `waves.firstWaveDelayMs`      | 7000  | **9000**| le temps de lire la première annonce avant le premier contact |
| `waves.interWavePauseMs`      | 4000  | **7000**| **le temps de merge légitime** — c'est ici que vit la respiration |
| `itemSpawner.intervalMs`      | 1200  | **1300**| accordé au nouveau rythme                                    |
| `itemSpawner.minIntervalMs`   | 780   | **860** | le débit passe **à l'équilibre** au lieu de +12 % (voir plus bas) |
| `waves.scaling.hpPerWave`     | 1,48  | **1,62**| compense tout ce qui précède : sans ça, la partie durait 6 min |
| `units.aoe.splashRadius`      | 90    | **112** | +24 %, exactement ce que la vitesse des rapides a perdu      |
| `units.support.auraRadius`    | 220   | **250** | le soutien devait retrouver une situation gagnante           |
| `units.support.buff`          | 0,30 / 0,18 | **0,58 / 0,30** | idem — mesuré, pas supposé (voir 7.4)              |

**Le plancher d'items est le changement de régime.** À 780 ms le joueur recevait 12 % de
plus d'items qu'il ne pouvait en envoyer : la grille débordait en permanence, ce qui *était*
l'urgence permanente remontée au playtest. À 860 ms, le débit est exactement à l'équilibre
(`4 items / 3,5 s = 875 ms`) : suivre le rythme reste possible, mais le surplus n'est plus
donné — il se **choisit** au draft (« Extraction », « Gisement riche »).

**Les vitesses d'ennemis et `hpPerWave` vont ensemble.** Ralentir les ennemis de 20 % rend
le joueur nettement plus fort (plus de temps de tir avant le contact), et allonger les pauses
de 3 s par vague lui offre presque un déploiement gratuit à chaque fois. Les deux réunis
faisaient passer la partie moyenne de 3:37 à 5:20. `hpPerWave` de 1,48 à 1,62 est la
contrepartie — et comme au Lot 3, c'est **la** valeur qui décide seule de la vague où l'on
meurt sans toucher aux premières vagues.

### 7.2 Résultats — 30 parties par politique, graines 1..30

| politique      | vague moy. | σ    | méd. | min | max | durée moy. | drafts/partie | grille (items / % pleine) |
| -------------- | ---------- | ---- | ---- | --- | --- | ---------- | ------------- | ------------------------- |
| Spam tier 1    | 5,80       | 0,40 | 6    | 5   | 6   | 2:50       | 1,8           | 22,9 / **80 %**           |
| Mixte tier 3   | **9,67**   | 1,01 | 9    | 9   | 13  | **3:47**   | 3,1           | 2,2 / 0 %                 |
| Prépare tier 4 | 11,20      | 0,70 | 11   | 10  | 13  | 4:24       | 3,2           | 2,2 / 0 %                 |

✔ fenêtre de vagues 8-12 · ✔ durée 3-5 min · ✔ **merge bat spam ×1,93**

Les objectifs chiffrés sont **inchangés** (`src/sim/targets.js`) : le draft rallonge la
partie, la difficulté a été relevée en face, et la fenêtre 3-5 minutes tient. Le joueur de
référence est à 3:47 et le joueur optimisé à 4:24 — les deux dans la fenêtre, ce qui laisse
de la marge pour un joueur réel, plus lent que n'importe quelle politique.

Les σ ne sont plus nulles comme au Lot 3 : le draft introduit une vraie variance de partie
en partie (les politiques choisissent leurs cartes **au hasard, de façon seedée**). C'est
une bonne nouvelle — deux parties ne se ressemblent plus, ce qui était l'objectif du lot.

### 7.3 Le pool d'améliorations

Onze cartes, trois proposées, `everyWaves: 3`. Le dosage retenu est « +12 à +22 % par
niveau, 2 ou 3 niveaux » : assez pour se sentir, trop peu pour retourner la partie à elle
seule.

| id           | carte             | effet par niveau                  | niveaux |
| ------------ | ----------------- | --------------------------------- | ------- |
| `fireRate`   | Cadence           | `unitFireRate ×0,88`              | 3       |
| `power`      | Puissance         | `unitDamage ×1,18`                | 3       |
| `reach`      | Portée            | `unitRange ×1,14`                 | 2       |
| `plating`    | Blindage          | `unitHp ×1,22`                    | 2       |
| `deploy`     | Sortie rapide     | `deployCooldown ×0,88`            | 3       |
| `slot`       | File élargie      | `slotBonus +1`                    | 2       |
| `fortify`    | Fortifications    | `baseHpBonus +22` (rendus aussi)  | 3       |
| `richVein`   | Gisement riche    | `spawnTierBonus +1`               | 2       |
| `extraction` | Extraction        | `spawnInterval ×0,86`             | 3       |
| `banner`     | Étendard          | soutien : `effect ×1,35`, `range ×1,2` | 2  |
| `reflex`     | Réflexe           | `skipCooldown ×0,65`              | 2       |

**Le pool est équilibré par construction, pas par réglage** : le rapport du harness le
confirme (colonne `draft`), les onze cartes sortent à des fréquences comparables sur
30 parties, aucune n'est ni évitée ni systématique. Ce n'est pas un mérite — les politiques
tirent au hasard — mais ça vérifie qu'aucune carte n'est **injouable** (pool épuisé, effet
inerte, plafond atteint trop tôt).

Deux cartes méritent une note :

- **Extraction** rend le surplus d'items que le plancher à 860 ms a retiré. C'est
  volontairement la carte qui « répare » le régime de base : la prendre, c'est choisir de
  rejouer au rythme du Lot 3.
- **Fortifications** est la seule à valeur absolue (+22 PV sur 100). Un multiplicateur y
  aurait été faible quand on le prend — c'est-à-dire quand la base est déjà basse, donc
  précisément au moment où on le choisit.

### 7.4 Chaque type d'unité a de nouveau sa situation

`npm run sim -- --matchups --tier=3` — PV de base laissés passer, plus bas = mieux :

| escouade (tier 3)         | mur de tanks | marée mixte | rush blindé | mur épais | tout à la fois |
| ------------------------- | ------------ | ----------- | ----------- | --------- | -------------- |
| 4× mono-cible             | 0 ★          | 18          | 131         | 178       | 272            |
| 2× mono + 2× zone         | 0 ★          | **0 ★**     | 140         | 184       | 272            |
| 2× mono + 2× ralentisseur | 0 ★          | 0 ★         | 106         | **164 ★** | **267 ★**      |
| 3× mono + 1× soutien      | 0 ★          | 0 ★         | **101 ★**   | 178       | **267 ★**      |

C'est une **amélioration sur le Lot 3**, où la zone n'avait jamais de colonne à elle : elle
gagne maintenant la « marée mixte », la seule texture où le mono-cible laisse passer quelque
chose. La passe de tempo l'y avait d'abord perdue (les rapides ralentis de 21 % arrivent
moins serrés, donc la zone touche moins de monde à la fois) ; `splashRadius` 90 → 112 rend
exactement ce que la vitesse a retiré.

Le soutien, lui, avait purement et simplement disparu du tableau après la passe de tempo. Il
a fallu monter son buff de 0,30/0,18 à **0,58/0,30** pour qu'il retrouve « rush blindé ».
C'est beaucoup, et c'est mesuré : entre 0,36 et 0,46 le tableau ne bougeait pas d'un point,
puis la colonne basculait d'un coup. Un multiplicateur sur des alliés a un seuil — en
dessous, il ne change pas l'issue d'un seul échange ; au-dessus, il en change plusieurs.

### 7.5 Les curseurs, par ordre d'effet (mis à jour)

1. **`itemSpawner.minIntervalMs`** (860) — le débit d'items, et depuis ce lot **le régime du
   jeu**. Repère : `4 items / deployCooldownMs` = 875 ms. Au-dessus, la grille respire ;
   nettement en dessous, elle déborde et le jeu redevient une urgence permanente.
2. **`waves.scaling.hpPerWave`** (1,62) — la vague où l'on meurt, sans toucher au début de
   partie.
3. **`waves.interWavePauseMs`** (7000) — la respiration **et** un cadeau de puissance. Tout
   changement ici se paie sur `hpPerWave`.
4. **vitesses d'ennemis** — le confort de lecture du couloir. Les baisser rend le joueur
   plus fort ; les remonter rend les textures moins lisibles.
5. **`draft.everyWaves`** (3) — la fréquence des respirations. À 2, la partie devient une
   suite de menus ; à 4, un joueur qui meurt vague 8 ne voit que deux drafts et n'a pas de
   build à raconter.
6. `battle.deployCooldownMs` (3500) — le métronome, inchangé. Le changer oblige à recalculer
   le débit d'items : les deux vont ensemble, toujours.

### 7.6 Ce qui reste ouvert

- **La fenêtre de défaite d'un vrai joueur**, toujours à confirmer au doigt. Le curseur reste
  `hpPerWave` ; il y a maintenant de la marge des deux côtés (3:47 dans une fenêtre 3-5 min).
- **Le spammeur meurt toujours vague 6.** Inchangé, et toujours un sujet de pédagogie plutôt
  que d'équilibrage. Le draft n'y change rien : il en prend 1,8 par partie contre 3,1 pour le
  joueur médian, ce qui creuse plutôt l'écart.
- **Le bouton « passer » n'est pas mesuré par le harness** : les politiques ne s'en servent
  pas. Son cooldown (10 s) est réglé au raisonnement — trois créneaux de déploiement — et
  attend un playtest. C'est la seule valeur du lot qui ne repose pas sur une mesure.
- **Le soutien n'a toujours pas de retour visuel d'aura**, et son buff est maintenant deux
  fois plus fort qu'au Lot 3 : l'invisibilité de sa valeur devient franchement gênante.
  Candidat n° 1 du prochain passage de lisibilité.
