# Référence — Merge Battler

> **Fichier généré. Ne pas l’éditer à la main.**
> Il est produit par `npm run docs` à partir de `src/config/balance.json`, en passant par
> les **formules du jeu** (`unitStats`, `enemyStats`, `waveComposition`) — il ne
> réimplémente rien et ne peut donc pas diverger de ce que le jeu fait vraiment.
>
> Toute livraison qui touche `balance.json` le régénère (cf. `CLAUDE.md`).

Version de `balance.json` : **9**.

## En deux gestes

- **Taper** un item d’unité (silhouette anguleuse) le consomme et met une unité de son tier
  en file de déploiement. Le type vient de la file des types, fixé **au moment du tap**.
- **Taper** un item de pouvoir (silhouette **ronde**) le dépense tout de suite : ni file, ni
  cooldown.
- **Glisser** un item sur un autre de la même sorte et du même tier les fusionne en un tier
  supérieur ; sur une case vide, il se déplace ; sur n’importe quel autre item, les deux
  **échangent leur place**. Un merge ne déclenche **rien** côté combat.

La file se vide toute seule au rythme du cooldown de sortie : c’est le métronome du jeu, et
c’est ce qui rend le spam de petites unités perdant.

## Unités

Quatre types au périmètre V1. Les stats listées sont **calculées par les formules du
jeu** (`unitStats`) : `stat(tier) = stat(1) × facteur^(tier-1)`.

### Archer — `single`

Hits one target at a time. The all-rounder: never the best, never bad.

Rôle `damage` · vitesse de marche 70 unités de couloir/s (elle ne dépend pas du tier).

| tier | PV | dégâts | cadence (ms) | portée |
| --- | --- | --- | --- | --- |
| 1 | 30 | 9 | 700 | 180 |
| 2 | 69 | 20.7 | 679 | 187 |
| 3 | 158.7 | 47.6 | 659 | 195 |
| 4 | 365 | 109.5 | 639 | 202 |
| 5 | 839.5 | 251.9 | 620 | 211 |
| 6 | 1930.9 | 579.3 | 601 | 219 |
| 8 | 10214.5 | 3064.3 | 566 | 237 |
| 11 | 124279.5 | 37283.9 | 516 | 266 |

### Pyromancer — `aoe`

Also hits enemies around its target. Devastating against tight packs.

Rôle `aoe` · vitesse de marche 64 unités de couloir/s (elle ne dépend pas du tier).

| tier | PV | dégâts | cadence (ms) | portée | rayon de zone |
| --- | --- | --- | --- | --- | --- |
| 1 | 26 | 6 | 1100 | 160 | 112 |
| 2 | 58.5 | 13.5 | 1078 | 166 | 123 |
| 3 | 131.6 | 30.4 | 1056 | 173 | 136 |
| 4 | 296.2 | 68.3 | 1035 | 180 | 149 |
| 5 | 666.4 | 153.8 | 1015 | 187 | 164 |
| 6 | 1499.3 | 346 | 994 | 195 | 180 |
| 8 | 7590.2 | 1751.6 | 955 | 211 | 218 |
| 11 | 86456.7 | 19951.5 | 899 | 237 | 290 |

### Frost mage — `slow`

Hits one target and chills the whole area around it. It buys you time.

Rôle `slow` · vitesse de marche 64 unités de couloir/s (elle ne dépend pas du tier).

| tier | PV | dégâts | cadence (ms) | portée | rayon de ralenti | durée (ms) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 34 | 6 | 900 | 250 | 140 | 1600 |
| 2 | 76.5 | 12.6 | 873 | 260 | 160 | 1824 |
| 3 | 172.1 | 26.5 | 847 | 270 | 182 | 2079 |
| 4 | 387.3 | 55.6 | 821 | 281 | 207 | 2370 |
| 5 | 871.4 | 116.7 | 797 | 292 | 236 | 2702 |
| 6 | 1960.6 | 245 | 773 | 304 | 270 | 3081 |
| 8 | 9925.6 | 1080.7 | 727 | 329 | 350 | 4004 |
| 11 | 113058.7 | 10007.9 | 664 | 370 | 519 | 5932 |

Le facteur de ralentissement vaut **0.38** à tous les tiers : c'est la durée et le rayon qui montent, sinon un ralentisseur de haut tier immobiliserait la vague.

### Bannerman — `support`

Never strikes: he raises the damage and rate of fire of nearby allies.

Rôle `support` · vitesse de marche 76 unités de couloir/s (elle ne dépend pas du tier).

| tier | PV | dégâts | cadence (ms) | portée | rayon d’aura | bonus dégâts | bonus cadence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 42 | 0 | — | 130 | 250 | +58 % | −30 % |
| 2 | 96.6 | 0 | — | 134 | 258 | +73 % | −38 % |
| 3 | 222.2 | 0 | — | 138 | 265 | +91 % | −47 % |
| 4 | 511 | 0 | — | 142 | 273 | +113 % | −59 % |
| 5 | 1175.3 | 0 | — | 146 | 281 | +142 % | −73 % |
| 6 | 2703.3 | 0 | — | 151 | 290 | +177 % | −92 % |
| 8 | 14300.3 | 0 | — | 160 | 307 | +277 % | −143 % |
| 11 | 173991.3 | 0 | — | 175 | 336 | +540 % | −279 % |

Le cumul des bonus de cadence de plusieurs soutiens est plafonné à **60 %**.

### File des types

Le type de la prochaine unité suit un motif déterministe, parcouru en boucle, et se fige
**au tap**. Le bouton « passer » en défausse un contre un cooldown de
**10 s**.

```
single → aoe → single → slow → single → support → aoe → single → slow → aoe → …
```

## Pouvoirs actifs

La grille produit **deux familles d’items**. Un item d’unité part en file de déploiement
quand on le tape ; un item de **pouvoir** est consommé sur-le-champ, sans file ni
cooldown. Les deux se fusionnent de la même façon, mais **jamais entre eux** : deux items
ne fusionnent que s’ils ont le même tier **et** la même sorte (même famille, et même type
de pouvoir).

Un item qui apparaît est un pouvoir avec une probabilité de **20 %**,
réparti selon les poids ci-dessous. Les pouvoirs plafonnent au **tier 6**, plus bas que
les items d’unité : au-delà, le dernier tier serait hors d’atteinte et deux pouvoirs
plafonnés resteraient collés sur la grille sans pouvoir fusionner.

### Healing potion — `heal`

Heals every living unit. Save it for the moment the line bends.

Effet `heal` · poids d’apparition 50 sur 100 · effet **immédiat**

| tier | PV rendus par unité |
| --- | --- |
| 1 | 80 |
| 2 | 248 |
| 3 | 769 |
| 4 | 2383 |
| 5 | 7388 |
| 6 | 22903 |

### Meteor — `meteor`

Strikes the most threatening pack of enemies. Rushes do not get through.

Effet `blast` · poids d’apparition 50 sur 100 · télégraphie **0.4 s** avant l’impact

| tier | dégâts | rayon |
| --- | --- | --- |
| 1 | 260 | 120 |
| 2 | 910 | 131 |
| 3 | 3185 | 143 |
| 4 | 11148 | 155 |
| 5 | 39016 | 169 |
| 6 | 136557 | 185 |

Le **ciblage est automatique** — pas de visée manuelle en V1, le glisser reste réservé à
la fusion. La zone se pose sur le groupe qui compte le plus d’ennemis dans le rayon du
pouvoir, et à nombre égal sur le plus avancé, donc le plus près de la base.

Un pouvoir sans la moindre cible (une météorite sans un ennemi sur le couloir, un soin
sans une unité sur le champ) est **refusé** : l’item reste sur la grille. Soigner une
armée intacte, en revanche, reste permis — c’est un jugement du joueur.

## Ennemis

Trois types. Les stats listées sont celles de la **vague 1** ; le scaling par vague
est appliqué par-dessus (voir plus bas).

| type | PV | vitesse | dégâts base | dégâts unités | cadence (ms) | portée |
| --- | --- | --- | --- | --- | --- | --- |
| **Goblin** (`basic`) | 24 | 44 | 6 | 18 | 800 | 40 |
| **Wolf** (`fast`) | 13 | 106 | 5 | 10 | 500 | 34 |
| **Ogre** (`tank`) | 95 | 26 | 14 | 42 | 1200 | 50 |

### Montée en puissance par vague

PV ×**1.66**, vitesse ×**1.02**, dégâts aux unités
×**1.28**, le tout à la puissance (vague − 1). Les dégâts à la base,
eux, **ne montent pas** : la pression vient des PV, de la vitesse et du nombre.

| vague | PV goblin | PV wolf | PV ogre |
| --- | --- | --- | --- |
| 1 | 24 | 13 | 95 |
| 3 | 66 | 36 | 262 |
| 5 | 182 | 99 | 721 |
| 8 | 834 | 452 | 3300 |
| 10 | 2297 | 1244 | 9093 |
| 12 | 6330 | 3429 | 25056 |
| 15 | 28955 | 15684 | 114614 |

## Vagues

Les **10 premières vagues** sont scriptées ; au-delà, la composition est générée
sans limite. La cadence propre à chaque vague est ce qui lui donne sa texture : à nombre
d'ennemis égal, un rush et un mur ne sont pas la même vague.

| vague | texture | cadence | composition |
| --- | --- | --- | --- |
| 1 | First contact | 900 ms | 3× Goblin |
| 2 | First contact | 820 ms | 5× Goblin |
| 3 | First runners | 760 ms | 5× Goblin, 4× Wolf |
| 4 | Rush | 220 ms | 14× Wolf |
| 5 | Wall of ogres | 1100 ms | 4× Ogre, 6× Goblin |
| 6 | Mixed tide | 520 ms | 12× Goblin, 9× Wolf |
| 7 | Armoured rush | 200 ms | 20× Wolf, 5× Ogre |
| 8 | Tide | 480 ms | 16× Goblin, 12× Wolf |
| 9 | Thick wall | 1000 ms | 8× Ogre, 12× Goblin |
| 10 | All at once | 200 ms | 26× Wolf, 12× Goblin, 5× Ogre |
| 11 *(générée)* | Mixed wave | 670 ms | 12× Goblin, 14× Wolf, 6× Ogre |
| 12 *(générée)* | Mixed wave | 657 ms | 15× Goblin, 17× Wolf, 7× Ogre |
| 13 *(générée)* | Mixed wave | 643 ms | 18× Goblin, 22× Wolf, 9× Ogre |
| 14 *(générée)* | Mixed wave | 631 ms | 23× Goblin, 24× Wolf, 11× Ogre |

Préparation avant la vague 1 : **9 s**.
Pause entre deux vagues : **7 s** — c'est le
temps de merge légitime, pas du temps mort.

## Améliorations (draft)

Toutes les **3 vagues**, la partie se met en pause et propose
**3 améliorations** distinctes parmi 13. Une carte
prise vaut pour le reste de la partie et **ne modifie jamais `balance.json`** : elle
accumule un modificateur appliqué au moment de lire une stat.

| carte | niveaux | effet par niveau | description |
| --- | --- | --- | --- |
| **Rate of fire** (`fireRate`) | 3 | `unitFireRate` ×0.88 (−12 %) | Every unit strikes 12% faster. |
| **Might** (`power`) | 3 | `unitDamage` ×1.18 (+18 %) | +18% damage for every unit. |
| **Reach** (`reach`) | 2 | `unitRange` ×1.14 (+14 %) | +14% range: your units engage sooner. |
| **Plating** (`plating`) | 2 | `unitHp` ×1.22 (+22 %) | +22% HP for units yet to come. |
| **Swift muster** (`deploy`) | 3 | `deployCooldown` ×0.88 (−12 %) | −12% on the summoning cooldown. |
| **Wider circle** (`slot`) | 2 | `slotBonus` +1 | +1 slot in the summoning queue. |
| **Fortifications** (`fortify`) | 3 | `baseHpBonus` +22 | +22 castle HP, and as much healed right away. |
| **Rich vein** (`richVein`) | 2 | `spawnTierBonus` +1 | Orbs appear one tier higher. |
| **Extraction** (`extraction`) | 3 | `spawnInterval` ×0.86 (−14 %) | −14% on the orb spawn interval. |
| **Banner** (`banner`) | 2 | `support` : effect ×1.35, range ×1.2 | Bannerman aura and bonus +35%. |
| **Reflex** (`reflex`) | 2 | `skipCooldown` ×0.65 (−35 %) | −35% on the skip button cooldown. |
| **Arcane charge** (`arcane`) | 3 | `powerAmount` ×1.3 (+30 %) | +30% power strength (healing and damage). |
| **Resonance** (`resonance`) | 2 | `powerChance` ×1.45 (+45 %) | +45% chance an orb is a power. |

Les facteurs se composent **par produit** à chaque niveau (deux fois « +18 % » vaut ×1,39,
pas ×1,36) ; les quantités entières (places, PV, tiers) s’additionnent.

## Économie de la grille

| réglage | valeur | ce que ça décide |
| --- | --- | --- |
| tiers maximum | 11 | plafond de fusion |
| items au départ | 8 | de quoi fusionner avant la vague 1 |
| intervalle initial | 1900 ms | le rythme des premières vagues — la grille doit respirer |
| plancher | 880 ms | le rythme de fin de partie, quand la pression doit monter |
| décroissance | 0.99 | la vitesse à laquelle on passe de l’un à l’autre |
| régulation de remplissage | 36 % → 80 %, jusqu’à ×14 | **le curseur de la pression de grille** : la cadence s’étire quand la grille se remplit |
| tiers à l’apparition | 1 (×85), 2 (×15) | les tiers supérieurs ne s’obtiennent que par fusion |
| cooldown de sortie | 3500 ms | **le métronome** : le débit d’unités, quoi que fasse le joueur |
| places dans la file | 5 | combien d’unités peuvent attendre |
| PV de la base | 100 | la marge d’erreur totale |

**Le repère qui cadre tout** : un envoi de tier 3 coûte 4 items et un envoi part
toutes les 3500 ms, donc suivre le rythme demande un item toutes les
**875 ms**. Le plancher est réglé autour de cette valeur pour que le goulot
reste le cooldown de sortie et non la grille.

Gestes : un tap de moins de 12 px et 600 ms
envoie l’item au combat, tout le reste est un glisser (fusion ou déplacement). Un écran
qui s’ouvre par-dessus le jeu ignore les appuis pendant 400 ms.
