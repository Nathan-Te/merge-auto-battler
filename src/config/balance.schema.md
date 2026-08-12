# `balance.json` — schéma & conventions

`balance.json` est **la seule source de vérité pour l'équilibrage**. Aucune stat de
gameplay ne doit être écrite en dur dans le code (cf. `docs/seed.md`, section
« Contraintes techniques »). JSON ne supportant pas les commentaires, ce fichier tient
lieu de documentation du format.

Toutes les sections sont actives : `itemSpawner` est lue par `parseSpawnerConfig()`
(`src/systems/itemSpawner.js`), `battle` / `units` / `enemies` / `waves` par
`parseBattleConfig()` (`src/systems/battleConfig.js`), `input` par `parseInputConfig()`
(`src/systems/tapGesture.js`). Toutes refusent une config incomplète plutôt que d'inventer
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
- **Ce qui est purement visuel n'est pas ici** : taille des formes à l'écran, couleurs,
  durées de tween. Ces valeurs n'influencent aucune règle et vivent dans `src/render/`.

## `input` — seuils de geste (Lot 2.5)

Un tap envoie une unité, un glisser fusionne : les deux gestes se distinguent par ces deux
seuils, et **rien d'autre**. Ils sont ici pour être réglés au playtest sans toucher au code
(cf. `src/systems/tapGesture.js`).

```jsonc
"input": {
  "tapMaxDistancePx": 12,     // au-delà, le doigt a traîné : c'est un glisser
  "tapMaxDurationMs": 600     // au-delà, c'est un appui long : ni tap ni glisser
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

## `units` — unités du joueur

Quatre types au périmètre V1. Chaque type déclare ses stats **au tier 1** et sa courbe de
progression ; les tiers 2 à 11 sont **calculés par formule**, pas listés (4 types × 11 tiers
= 44 lignes à maintenir à la main sinon).

```jsonc
"units": {
  "single": {                 // id du type — référencé par `battle.unitTypePattern`
    "label": "Mono-cible",    // libellé affiché dans le HUD (« prochaine unité »)
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
  "firstWaveDelayMs": 6000,   // temps laissé au joueur avant la vague 1 (≈ 2 sorties d'unité)
  "interWavePauseMs": 2200,   // pause entre deux vagues (bandeau « Vague N »)
  "spawnGapMs": 700,          // délai entre deux ennemis d'une même vague, vague 1
  "scripted": [               // scripted[0] = vague 1, scripted[1] = vague 2…
    [{ "type": "basic", "count": 3 }],
    [{ "type": "basic", "count": 3 }, { "type": "fast", "count": 2 }]
  ],
  "infinite": [               // modèle des vagues au-delà de `scripted`
    { "type": "basic", "count": 6 },
    { "type": "fast", "count": 4 },
    { "type": "tank", "count": 2 }
  ],
  "scaling": {
    "hpPerWave": 1.21,        // hp(vague) = hp × hpPerWave^(vague - 1)
    "speedPerWave": 1.02,
    "damagePerWave": 1.2,     // dégâts aux unités ; `damageToBase`, lui, ne scale pas
    "countPerWave": 1.18,     // ne s'applique qu'aux vagues générées (au-delà de `scripted`)
    "spawnGapPerWave": 0.98,  // les ennemis d'une vague arrivent de plus en plus serrés
    "minSpawnGapMs": 320,     // plancher de `spawnGapMs`
    "maxCountPerEntry": 24    // garde-fou : nombre max d'ennemis par entrée de composition
  }
}
```

`firstWaveDelayMs` se lit en nombre de sorties : à 3,5 s de cooldown, 6 s laissent au
joueur le temps de poser deux unités avant le premier contact. C'est le premier réglage à
revoir si le début de partie paraît brutal.

**Composition d'une vague** : `scripted[n-1]` si elle existe, sinon `infinite` dont chaque
`count` est multiplié par `countPerWave^(n - scripted.length)` puis arrondi et plafonné.
L'ordre d'apparition suit l'ordre des entrées de la composition.

**Stats d'une vague** : les multiplicateurs `hpPerWave` / `speedPerWave` s'appliquent à
**toutes** les vagues, scriptées comprises (`^(n - 1)`). Les vagues scriptées pilotent donc
la composition, le scaling pilote la difficulté.

Une vague est terminée quand tous ses ennemis sont apparus **et** que plus aucun n'est en
vie — un ennemi qui atteint la base compte comme retiré, la partie ne peut donc pas se
bloquer sur un tank increvable.

## `itemSpawner` — apparition des items sur la grille

```jsonc
"itemSpawner": {
  "maxTier": 11,              // tier maximum atteignable (cf. seed doc : 11 tiers)
  "startingItems": 4,         // items posés sur la grille au démarrage
  "firstSpawnDelayMs": 500,   // délai avant la première apparition automatique
  "intervalMs": 2400,         // intervalle d'apparition initial
  "minIntervalMs": 900,       // plancher : l'accélération ne descend jamais en dessous
  "intervalDecay": 0.985,     // facteur appliqué à l'intervalle après chaque apparition
  "gridFullRetryMs": 400,     // grille pleine : fréquence de re-vérification (spawn en pause)
  "spawnTierWeights": {       // poids relatifs du tier tiré à l'apparition
    "1": 85,                  // seuls les tiers listés apparaissent naturellement ;
    "2": 15                   // les tiers supérieurs ne s'obtiennent que par fusion
  }
}
```

**Courbe d'accélération** : le délai avant la n-ième apparition vaut
`max(minIntervalMs, intervalMs × intervalDecay^n)`. Avec les valeurs ci-dessus, le rythme
passe de 2,4 s à 900 ms en une soixantaine d'items — soit environ deux minutes de jeu.
Baisser `intervalDecay` accélère la montée en pression ; le régler à `1` la supprime.

**Grille pleine** : ce n'est pas un game over — le spawn se met simplement en pause
(feedback : bordure de grille qui pulse) et reprend dès qu'une case se libère.
`gridFullRetryMs` n'est donc qu'une cadence de re-vérification, pas un délai de grâce.

Depuis le Lot 2.5 la grille se vide aussi **par le tap** (un envoi consomme un item) : le
rythme d'apparition et `battle.deployCooldownMs` se règlent donc ensemble. Si les items
s'accumulent trop, c'est que la sortie est trop lente ou l'apparition trop rapide.
