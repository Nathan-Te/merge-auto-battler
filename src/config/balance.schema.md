# `balance.json` — schéma & conventions

`balance.json` est **la seule source de vérité pour l'équilibrage**. Aucune stat de
gameplay ne doit être écrite en dur dans le code (cf. `docs/seed.md`, section
« Contraintes techniques »). JSON ne supportant pas les commentaires, ce fichier tient
lieu de documentation du format.

Toutes les sections sont actives : `itemSpawner` est lue par `parseSpawnerConfig()`
(`src/systems/itemSpawner.js`), `battle` / `units` / `enemies` / `waves` par
`parseBattleConfig()` (`src/systems/battleConfig.js`), `input` par `parseInputConfig()`
(`src/systems/tapGesture.js`), `draft` par `parseDraftConfig()`
(`src/systems/DraftSystem.js`), `powers` par `parsePowersConfig()`
(`src/systems/PowerSystem.js`). Toutes refusent une config incomplète plutôt que d'inventer
un défaut.

## Règles générales

- Toutes les durées sont en **millisecondes**.
- Les distances de la bande de combat sont en **unités de couloir** (« lane units ») : le
  couloir mesure `battle.laneLength` unités du point d'apparition des ennemis jusqu'à la
  base, quelle que soit sa taille à l'écran. Une portée de 220 signifie donc la même chose
  sur téléphone et sur desktop — le rendu convertit en pixels au moment d'afficher.
- Les identifiants (clés d'objet) sont en `camelCase` et stables : le code les référence.
- `version` s'incrémente à chaque changement de **forme** du fichier (pas à chaque
  retouche de valeur), pour repérer un `balance.json` périmé.
- Une valeur absente est une erreur, pas un défaut implicite : le chargement doit crier
  plutôt que d'inventer.
- **Ce qui est purement visuel n'est pas ici** : taille des formes à l'écran et couleurs
  vivent dans `src/render/` ; **les intensités de feedback** (durées de tween, particules,
  secousses, sons) vivent dans `src/config/juice.json`, documenté par
  `src/config/juice.schema.md`. Deux fichiers parce que ce sont deux métiers : `balance.json`
  se règle au harness de simulation (`npm run sim`), `juice.json` se règle au doigt sur un
  téléphone. Les mélanger, c'est casser un équilibrage en cherchant une secousse plus douce.
- **Toute retouche de ce fichier se valide au harness** : `npm run sim` joue des dizaines de
  parties automatiques et vérifie les objectifs chiffrés du Lot 3 — dont l'invariant
  intouchable « merger bat spammer » (cf. `docs/balance-notes.md`).

## `input` — seuils de geste (Lot 2.5)

Un tap envoie une unité, un glisser fusionne : les deux gestes se distinguent par ces deux
seuils, et **rien d'autre**. Ils sont ici pour être réglés au playtest sans toucher au code
(cf. `src/systems/tapGesture.js`).

```jsonc
"input": {
  "tapMaxDistancePx": 12,     // au-delà, le doigt a traîné : c'est un glisser
  "tapMaxDurationMs": 600,    // au-delà, c'est un appui long : ni tap ni glisser
  "overlayGraceMs": 400       // délai avant qu'un écran ouvert par-dessus le jeu réponde
}
```

Exception assumée à la règle « pas de pixels ici » : le canvas est en `Scale.RESIZE` sans
suréchantillonnage (cf. README), donc un pixel de monde est un pixel CSS sur tous les
écrans — le seuil signifie la même chose partout. `tapMaxDistancePx` est aussi donné à
Phaser (`input.dragDistanceThreshold`) : aucun drag ne démarre tant que le tap est encore
possible.

## `battle` — cadre du champ de bataille

```jsonc
"battle": {
  "tickMs": 100,              // période du tick logique (100 ms = 10 Hz), voir README
  "maxTicksPerFrame": 5,      // rattrapage maximal après un gel (anti « spirale de la mort »)
  "laneLength": 1000,         // longueur du couloir en unités de couloir
  "slotCount": 5,             // places de la file de déploiement
  "deployCooldownMs": 3500,   // rythme de sortie : une unité quitte la file tous les N ms
  "skipCooldownMs": 10000,    // recharge du bouton « passer » de la file de types
  "maxFieldUnits": 20,        // garde-fou de perf : unités simultanées sur le champ
  "baseHp": 100,              // PV de la base
  "unitTypePattern": [        // file déterministe des types, parcourue en boucle. Le type
    "single", "aoe", "slow"   // de l'unité est fixé **au tap**. Le HUD affiche le prochain.
  ],
  "maxSupportFireRateBonus": 0.6  // plafond du cumul des bonus de cadence des soutiens
}
```

Les **progressions** vont de 0 (entrée des ennemis) à `laneLength` (la base). Les unités
entrent à `laneLength` et marchent vers 0 ; les ennemis font l'inverse.

`deployCooldownMs` est le métronome du jeu : il borne le débit d'unités du joueur quoi
qu'il fasse, et c'est ce qui rend le spam de petites unités perdant. `maxFieldUnits` n'est
**pas** un levier d'équilibrage mais un garde-fou de performance : il doit rester large
devant `slotCount`, sinon il bloquerait la file au lieu de la protéger.

`skipCooldownMs` (Lot 3.5) est le prix du bouton **passer**, qui défausse le type en tête de
la file de types. Trop court, il annule la contrainte de la file — le joueur choisit
librement son type et l'annonce de vague n'impose plus rien ; trop long, le bouton n'est
qu'une décoration. À 10 s pour un cooldown de sortie de 3,5 s, passer coûte environ **trois
créneaux de déploiement** : assez pour que ce soit une décision.

## `units` — unités du joueur

Quatre types au périmètre V1. Chaque type déclare ses stats **au tier 1** et sa courbe de
progression ; les tiers 2 à 11 sont **calculés par formule**, pas listés (4 types × 11 tiers
= 44 lignes à maintenir à la main sinon).

```jsonc
"units": {
  "single": {                 // id du type — référencé par `battle.unitTypePattern`
    "label": "Mono-cible",    // libellé affiché dans le HUD (« prochaine unité »)
    "blurb": "Frappe une cible à la fois. …",  // une ligne, montrée au joueur (panneau « ? »)
    "role": "damage",         // damage | aoe | slow | support — pilote le comportement
    "hp": 30,                 // PV au tier 1 : les unités meurent (Lot 2.5)
    "speed": 70,              // vitesse de marche, en unités de couloir par seconde
    "damage": 9,              // dégâts par frappe au tier 1
    "fireRateMs": 700,        // délai entre deux frappes au tier 1
    "range": 180,             // portée au tier 1, et distance d'arrêt face aux ennemis
    "tierScaling": {          // stat(tier) = stat(1) × facteur^(tier - 1)
      "hp": 2.3,              // > 2 : un tier N+1 vaut plus que deux tiers N (cf. plus bas)
      "damage": 2.3,          // > 2, même raison
      "fireRateMs": 0.97,     // < 1 = frappe plus vite avec le tier
      "range": 1.04,
      "effect": 1.12          // s'applique à splashRadius, slowDurationMs, slowRadius, buff
    }
  }
}
```

`blurb` est du **contenu**, pas de l'équilibrage : c'est la ligne que lit le joueur dans le
panneau d'aide et dans `docs/reference.md`. Elle vit ici pour la même raison que les
descriptions des cartes de draft — une scène n'a pas à connaître le texte du jeu, et une
seule source évite que l'aide et la référence se contredisent.

**`speed` ne dépend pas du tier** : une unité de tier 11 qui sprinterait casserait la
lecture du couloir, et la vitesse n'est pas ce qu'on achète en fusionnant.

**Facteurs > 2, à dessein.** C'est la règle de dosage du Lot 2.5 : puisqu'un item de tier
N+1 coûte exactement deux items de tier N, un facteur de 2 rendrait la fusion neutre. Au
delà de 2, préparer avant d'envoyer est **strictement** gagnant — et comme le débit de
sortie est fixe (`deployCooldownMs`), spammer des petites unités est puni deux fois : elles
valent moins, et elles occupent le même créneau. Un test le verrouille sur les vraies
valeurs (`tests/battleConfig.test.js`).

Clés supplémentaires selon le `role` :

| `role`    | clés en plus                                  | comportement                                                  |
| --------- | --------------------------------------------- | ------------------------------------------------------------- |
| `damage`  | —                                             | s'arrête à `range` et frappe une cible                         |
| `aoe`     | `splashRadius`                                | touche aussi les ennemis à ± `splashRadius` de la cible        |
| `slow`    | `slowFactor`, `slowDurationMs`, `slowRadius`  | frappe une cible et **ralentit en zone** (± `slowRadius`)      |
| `support` | `auraRadius`, `buff: { damage, fireRate }`    | ne frappe jamais ; buffe les alliés à ± `auraRadius`           |

Le soutien exprime ses bonus en **fractions** : `damage: 0.3` = +30 % de dégâts,
`fireRate: 0.18` = −18 % de délai entre deux frappes. Les bonus de plusieurs soutiens
s'additionnent, le cumul de cadence étant plafonné par `battle.maxSupportFireRateBonus`.
Sa `range` est sa **distance de sécurité** : il ne frappe pas, mais il s'arrête à cette
distance des ennemis au lieu de leur marcher dessus. `slowFactor` ne dépend pas du tier
(c'est la durée et le rayon qui montent) : un ralentisseur de tier 9 immobiliserait la
vague sinon.

**Ciblage** : l'ennemi **le plus proche** dont la distance de couloir à l'unité est
inférieure ou égale à sa portée — y compris derrière elle, une unité peut donc achever un
fuyard. À égale distance, c'est le plus avancé (le plus menaçant) qui est visé.

## `enemies` — ennemis

Trois types au périmètre V1. Les stats listées sont celles de la **vague 1** ; le scaling
par vague est appliqué par-dessus (section `waves`).

```jsonc
"enemies": {
  "basic": {
    "label": "Basique",
    "hp": 24,
    "speed": 55,              // unités de couloir par seconde
    "damageToBase": 6,        // PV retirés à la base quand l'ennemi l'atteint
    "damage": 18,             // dégâts infligés **aux unités** au contact (Lot 2.5)
    "attackRateMs": 800,      // délai entre deux coups
    "attackRange": 40         // distance à laquelle il s'arrête pour frapper
  }
}
```

Depuis le Lot 2.5 le combat est **mutuel** : un ennemi qui trouve une unité à
`attackRange` s'arrête et la frappe au lieu de continuer vers la base. Une ligne d'unités
retient donc une vague — et c'est en la brisant que les ennemis passent.

`damageToBase` ne scale pas avec la vague (la pression sur la base vient des PV, de la
vitesse et du nombre), mais `damage` **si** : sans cela, une unité de haut tier deviendrait
invulnérable et le champ de bataille se figerait en mur imprenable.

## `waves` — courbe de vagues

Les premières vagues sont **scriptées** (composition exacte, pour maîtriser l'introduction
des types), les suivantes sont **générées** à partir d'un modèle et d'une formule de
scaling, sans limite.

```jsonc
"waves": {
  "firstWaveDelayMs": 9000,   // temps laissé au joueur avant la vague 1 (≈ 2,5 sorties d'unité)
  "interWavePauseMs": 7000,   // pause entre deux vagues : c'est le **temps de merge légitime**
  "spawnGapMs": 820,          // cadence par défaut des vagues **générées**
  "scripted": [               // scripted[0] = vague 1, scripted[1] = vague 2…
    {
      "label": "Rush",        // texture, annoncée dans le bandeau (facultatif)
      "spawnGapMs": 220,      // cadence propre à cette vague (facultatif)
      "composition": [{ "type": "fast", "count": 14 }]
    },
    [{ "type": "basic", "count": 3 }]   // forme courte : composition seule
  ],
  "infinite": [               // modèle des vagues au-delà de `scripted`
    { "type": "basic", "count": 12 },
    { "type": "fast", "count": 14 },
    { "type": "tank", "count": 6 }
  ],
  "scaling": {
    "hpPerWave": 1.54,        // hp(vague) = hp × hpPerWave^(vague - 1)
    "speedPerWave": 1.02,
    "damagePerWave": 1.28,    // dégâts aux unités ; `damageToBase`, lui, ne scale pas
    "countPerWave": 1.24,     // ne s'applique qu'aux vagues générées (au-delà de `scripted`)
    "spawnGapPerWave": 0.98,  // les vagues générées arrivent de plus en plus serrées
    "minSpawnGapMs": 320,     // plancher de `spawnGapMs`
    "maxCountPerEntry": 24    // garde-fou : nombre max d'ennemis par entrée de composition
  }
}
```

`firstWaveDelayMs` se lit en nombre de sorties : à 3,5 s de cooldown, 9 s laissent au
joueur le temps de poser deux unités et de lire l'annonce avant le premier contact. C'est le
premier réglage à revoir si le début de partie paraît brutal.

**`interWavePauseMs` est le curseur de respiration du Lot 3.5.** C'est le temps pendant
lequel il ne se passe rien sur le couloir : celui où l'on regarde la bataille, où l'on lit
l'annonce de la vague à venir, et où l'on fusionne sans urgence. C'est aussi un levier de
puissance sous-estimé — une pause vaut un déploiement gratuit — donc l'allonger oblige à
relever la difficulté en face (cf. `docs/balance-notes.md`). Il est passé de 4 000 à 7 000 ms
au Lot 3.5, contre `hpPerWave` 1,48 → 1,54.

**Textures de vagues (Lot 3).** Une vague scriptée s'écrit sous deux formes :

- **liste** — la composition seule, cadence par défaut et pas de libellé ;
- **objet** `{ label, spawnGapMs, composition }` — la forme complète. C'est `spawnGapMs`
  qui donne sa **texture** à une vague : à nombre d'ennemis égal, 14 rapides à 220 ms
  (« Rush ») et 14 rapides à 900 ms ne sont pas la même vague du tout. Le `label` est
  annoncé dans le bandeau (« Vague 4 / Rush »), ce qui laisse au joueur une chance de
  préparer le bon type d'unité.

L'override de cadence est **littéral** : il ne subit pas `spawnGapPerWave`, sinon une
texture réglée à la main dériverait avec le numéro de vague. Les vagues générées, elles,
suivent la formule.

**Composition d'une vague** : `scripted[n-1].composition` si elle existe, sinon `infinite`
dont chaque `count` est multiplié par `countPerWave^(n - scripted.length)` puis arrondi et
plafonné. L'ordre d'apparition suit l'ordre des entrées de la composition.

Le modèle `infinite` doit **reprendre l'intensité de la dernière vague scriptée**, pas
repartir plus bas : sans ça, la première vague générée est plus douce que la précédente et
la courbe fait un palier mou au pire moment.

**Stats d'une vague** : les multiplicateurs `hpPerWave` / `speedPerWave` s'appliquent à
**toutes** les vagues, scriptées comprises (`^(n - 1)`). Les vagues scriptées pilotent donc
la composition, le scaling pilote la difficulté.

Une vague est terminée quand tous ses ennemis sont apparus **et** que plus aucun n'est en
vie — un ennemi qui atteint la base compte comme retiré, la partie ne peut donc pas se
bloquer sur un tank increvable.

## `draft` — améliorations roguelite (Lot 3.5)

Toutes les `everyWaves` vagues, la partie **gèle** et propose `cardsPerOffer` améliorations
distinctes ; le joueur en prend une, elle vaut pour le reste de la partie.

```jsonc
"draft": {
  "everyWaves": 3,            // un draft toutes les N vagues tenues
  "cardsPerOffer": 3,         // cartes proposées (doit tenir dans le pool)
  "upgrades": [
    {
      "id": "power",          // identifiant stable — le code et le récap le référencent
      "label": "Puissance",   // titre de la carte
      "description": "+18 % de dégâts pour toutes les unités.",
      "icon": "damage",       // clé de forme greybox (`src/render/draftIcons.js`)
      "maxLevel": 3,          // prises possibles ; au-delà, la carte sort du pool
      "effect": { "unitDamage": 1.18 }   // voir la table ci-dessous
    }
  ]
}
```

**Une amélioration est un modificateur, jamais une valeur réécrite.** `balance.json` est
importé une seule fois pour toute l'application : muter une de ses valeurs ferait survivre
les améliorations d'une partie à la suivante. Les effets sont donc **accumulés**
(`src/systems/modifiers.js`) et appliqués au moment de **lire** une stat — ils meurent avec
la session, comme tout le reste (cf. `CLAUDE.md`).

Clés d'effet reconnues. Toute autre clé est une **erreur au chargement**, pas une carte
sans effet :

| clé               | type          | neutre | effet                                                     |
| ----------------- | ------------- | ------ | --------------------------------------------------------- |
| `unitDamage`      | multiplicatif | 1      | dégâts de toutes les unités                               |
| `unitFireRate`    | multiplicatif | 1      | délai entre deux frappes — **< 1 = plus rapide**          |
| `unitRange`       | multiplicatif | 1      | portée, **et rayon d'aura du soutien** (c'est une distance) |
| `unitHp`          | multiplicatif | 1      | PV des unités **à leur entrée** (pas de soin rétroactif)  |
| `unitEffect`      | multiplicatif | 1      | rayons et durées d'effet (zone, ralentissement, buff)     |
| `deployCooldown`  | multiplicatif | 1      | cooldown de sortie de la file de déploiement              |
| `spawnInterval`   | multiplicatif | 1      | intervalle d'apparition des items, **plancher compris**   |
| `skipCooldown`    | multiplicatif | 1      | cooldown du bouton « passer »                             |
| `powerAmount`     | multiplicatif | 1      | puissance des pouvoirs : PV rendus et dégâts de zone, **jamais le rayon** |
| `powerChance`     | multiplicatif | 1      | probabilité qu'un item qui apparaît soit un pouvoir (borné à 0,9) |
| `slotBonus`       | additif       | 0      | places en plus dans la file de déploiement                |
| `baseHpBonus`     | additif       | 0      | PV de base gagnés **et rendus** à la prise                |
| `spawnTierBonus`  | additif       | 0      | décalage du tier des items qui apparaissent               |
| `byType`          | objet         | —      | les mêmes facteurs (`damage`, `fireRate`, `range`, `hp`, `effect`) pour **un seul type d'unité** |

Les multiplicatifs se composent **par produit** à chaque niveau (deux fois « +18 % » vaut
×1,39, pas ×1,36), les additifs par somme. Un `byType` se cumule **par-dessus** le bonus
global : `unitRange: 1.14` puis `byType.support.range: 1.2` donnent ×1,368 au soutien et
×1,14 aux autres.

**Doser une carte** : elle doit se sentir sans retourner la partie. Le repère du lot est
« +12 à +22 % par niveau, 2 ou 3 niveaux » — au-delà, un joueur qui empile la même carte
sort de la fenêtre de vagues visée, ce que le harness voit tout de suite
(`npm run sim`, colonne `draft`). `baseHpBonus` est l'exception assumée : c'est une valeur
absolue, et 22 PV sur 100 se lisent comme une bouée, pas comme un multiplicateur.

## `powers` — pouvoirs actifs (Lot 4)

La grille produit **deux familles d'items**. Un item d'unité part en file de déploiement
quand on le tape ; un item de **pouvoir** est consommé sur-le-champ pour un effet immédiat
— ni file, ni cooldown. Lu par `parsePowersConfig()` (`src/systems/PowerSystem.js`).

```jsonc
"powers": {
  "maxTier": 6,               // plafond de fusion des pouvoirs, **plus bas** que celui des items
  "spawnChance": 0.2,         // probabilité qu'un item qui apparaît soit un pouvoir
  "types": {
    "meteor": {
      "label": "Météorite",   // titre montré au joueur
      "blurb": "Frappe le groupe d'ennemis le plus menaçant. Les rushs ne passent pas.",
      "kind": "blast",        // `blast` (dégâts de zone) ou `heal` (soigne les unités)
      "weight": 50,           // poids relatif du tirage entre pouvoirs
      "amount": 260,          // dégâts (blast) ou PV rendus par unité (heal), **au tier 1**
      "radius": 120,          // rayon de la zone, en unités de couloir (0 si l'effet ne vise pas)
      "telegraphMs": 400,     // délai entre l'annonce de la zone et l'impact (0 = immédiat)
      "tierScaling": { "amount": 3.5, "radius": 1.09 }
    }
  }
}
```

Comme pour les unités : `stat(tier) = stat(1) × facteur^(tier-1)`.

**`maxTier` est plus bas que celui de la grille, et ce n'est pas un détail.** Un pouvoir
demande 2^(tier-1) items **de son propre type** ; à 20 % d'apparition partagés entre deux
types, le tier 5 est déjà le plafond réel d'une partie. Un `maxTier` très haut ne rendrait
donc pas les pouvoirs plus forts : il laisserait seulement deux pouvoirs plafonnés
fusionnables en théorie et jamais en pratique. Le spawner **écrête** au passage le tier
tiré, pour que « gisement riche » ne fasse pas naître un pouvoir au-dessus de son maximum.

**`telegraphMs` est ici et non dans `juice.json`** parce que c'est du jeu, pas du décor :
les ennemis continuent d'avancer pendant l'annonce, donc la zone figée au tap n'attrape pas
exactement les mêmes ennemis selon leur vitesse. `juice.json` ne règle que l'**apparence**
de l'anneau (`power.*`) ; sa durée vient d'ici, et l'anneau se ferme exactement à l'impact.

**Doser un pouvoir** : la courbe est volontairement plus raide que celle des unités
(×3,5 par tier contre ×2,3). C'est ce qui fait qu'un pouvoir dépensé au tier 1 ne vaut
presque rien alors qu'un tier 3-4 renverse une vague — donc ce qui empêche le spam de
pouvoirs de concurrencer la préparation, exactement comme pour les items d'unité. Deux
mesures du harness encadrent le réglage : la part de dégâts venue des pouvoirs (visée
30-50 % pour le joueur médian) et l'écart entre `mixed` et `noPowers`, qui doit rester
franc (cf. `src/sim/targets.js`).

## `itemSpawner` — apparition des items sur la grille

```jsonc
"itemSpawner": {
  "maxTier": 11,              // tier maximum atteignable (cf. seed doc : 11 tiers)
  "startingItems": 8,         // items posés sur la grille au démarrage
  "firstSpawnDelayMs": 500,   // délai avant la première apparition automatique
  "intervalMs": 1900,         // intervalle d'apparition initial
  "minIntervalMs": 880,       // plancher : l'accélération ne descend jamais en dessous
  "intervalDecay": 0.99,      // facteur appliqué à l'intervalle après chaque apparition
  "gridFullRetryMs": 400,     // grille pleine : fréquence de re-vérification (spawn en pause)
  "spawnTierWeights": {       // poids relatifs du tier tiré à l'apparition
    "1": 85,                  // seuls les tiers listés apparaissent naturellement ;
    "2": 15                   // les tiers supérieurs ne s'obtiennent que par fusion
  }
}
```

**Courbe d'accélération** : le délai avant la n-ième apparition vaut
`max(minIntervalMs, intervalMs × intervalDecay^n)`, le tout multiplié par le modificateur
`spawnInterval` du draft. Avec les valeurs ci-dessus, le rythme passe de 1,9 s à 880 ms en
77 items — soit environ **102 secondes de jeu**, c'est-à-dire vers la vague 5. Baisser
`intervalDecay` accélère la montée en pression ; le régler à `1` la supprime.

**La mesure qui compte pour le confort** (playtest du Lot 3.5) : le temps que met la grille à
se remplir **si le joueur ne fait rien**, soit la somme des 17 intervalles au-dessus des
`startingItems`. À 30 s, la grille n'est sous pression qu'en fin de partie ; à 20 s, le jeu
n'a plus qu'un régime — celui de l'urgence permanente, précisément le défaut que le Lot 3.5
corrige. Le harness ne voit pas cette valeur (ses politiques consomment parfaitement), elle
se calcule à la main depuis ce fichier.

**`minIntervalMs` est le levier le plus violent de tout le fichier** (Lot 3). Le repère qui
le cadre : un envoi de tier 3 coûte **4 items**, un envoi part toutes les
`battle.deployCooldownMs`, donc suivre le rythme demande `4 / deployCooldownMs` items par
seconde — soit un item toutes les **875 ms** aux valeurs actuelles.

Le Lot 3.5 a déplacé ce plancher de 780 à **860 ms**, c'est-à-dire **à l'équilibre** au lieu
de 12 % au-dessus. C'est un choix de régime, pas un rééquilibrage : à 780 ms la grille
débordait en permanence et le jeu n'avait qu'une urgence, celle de la grille. À l'équilibre,
suivre le rythme reste possible mais le surplus n'est plus donné — il se **choisit** au
draft (« Extraction », « Gisement riche »). Descendre nettement plus bas reste dangereux :
mesuré à 650 ms au Lot 3, la partie moyenne passait de 10 à 29 vagues. Ces deux valeurs se
règlent **ensemble**.

**Grille pleine** : ce n'est pas un game over — le spawn se met simplement en pause
(feedback : bordure de grille qui pulse) et reprend dès qu'une case se libère.
`gridFullRetryMs` n'est donc qu'une cadence de re-vérification, pas un délai de grâce.

Depuis le Lot 2.5 la grille se vide aussi **par le tap** (un envoi consomme un item) : le
rythme d'apparition et `battle.deployCooldownMs` se règlent donc ensemble. Si les items
s'accumulent trop, c'est que la sortie est trop lente ou l'apparition trop rapide.
