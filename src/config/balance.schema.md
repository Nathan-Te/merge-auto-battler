# `balance.json` — schéma & conventions

`balance.json` est **la seule source de vérité pour l'équilibrage**. Aucune stat de
gameplay ne doit être écrite en dur dans le code (cf. `docs/seed.md`, section
« Contraintes techniques »). JSON ne supportant pas les commentaires, ce fichier tient
lieu de documentation du format.

Toutes les sections sont actives depuis le Lot 2 : `itemSpawner` est lue par
`parseSpawnerConfig()` (`src/systems/itemSpawner.js`), `battle` / `units` / `enemies` /
`waves` par `parseBattleConfig()` (`src/systems/battleConfig.js`). Les deux refusent une
config incomplète plutôt que d'inventer un défaut.

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

## `battle` — cadre de la bande de combat (Lot 2)

```jsonc
"battle": {
  "tickMs": 100,              // période du tick logique (100 ms = 10 Hz), voir README
  "maxTicksPerFrame": 5,      // rattrapage maximal après un gel (anti « spirale de la mort »)
  "laneLength": 1000,         // longueur du couloir en unités de couloir
  "slotCount": 8,             // nombre de slots d'unités sur la bande
  "queueSize": 3,             // file d'attente quand tous les slots sont pris
  "baseHp": 100,              // PV de la base
  "unitTypePattern": [        // file déterministe des types produits par les fusions,
    "single", "aoe", "slow"   // parcourue en boucle. Le HUD en affiche le prochain élément.
  ],
  "unitBuff": {               // renfort obtenu en fusionnant deux unités identiques (★)
    "damage": 1.8,            // multiplicateurs appliqués aux stats de l'unité
    "fireRateMs": 0.85,       // < 1 = tire plus vite
    "range": 1.1,
    "effect": 1.3             // rayon de zone, durée de ralentissement, force du soutien
  },
  "maxSupportFireRateBonus": 0.6  // plafond du cumul des bonus de cadence des soutiens
}
```

Le **slot k** est planté à la position de couloir `laneLength × (k + 0.5) / slotCount` :
le slot 0 est le plus loin de la base (premier contact), le dernier slot la défend de près.
L'adjacence pour la fusion d'unités est l'adjacence des index de slots.

## `units` — unités du joueur (Lot 2)

Quatre types au périmètre V1. Chaque type déclare ses stats **au tier 1** et sa courbe de
progression ; les tiers 2 à 11 sont **calculés par formule**, pas listés (4 types × 11 tiers
= 44 lignes à maintenir à la main sinon).

```jsonc
"units": {
  "single": {                 // id du type — référencé par `battle.unitTypePattern`
    "label": "Mono-cible",    // libellé affiché dans le HUD (« prochaine unité »)
    "role": "damage",         // damage | aoe | slow | support — pilote le comportement
    "damage": 8,              // dégâts par tir au tier 1
    "fireRateMs": 700,        // délai entre deux tirs au tier 1
    "range": 220,             // portée au tier 1, en unités de couloir
    "tierScaling": {          // stat(tier) = stat(1) × facteur^(tier - 1)
      "damage": 1.55,
      "fireRateMs": 0.97,     // < 1 = accélère avec le tier
      "range": 1.05,
      "effect": 1.12          // s'applique à splashRadius, slowDurationMs et buff
    }
  }
}
```

Clés supplémentaires selon le `role` :

| `role`    | clés en plus                      | comportement                                            |
| --------- | --------------------------------- | ------------------------------------------------------- |
| `damage`  | —                                 | tire sur une cible                                       |
| `aoe`     | `splashRadius`                    | touche aussi les ennemis à ± `splashRadius` de la cible  |
| `slow`    | `slowFactor`, `slowDurationMs`    | multiplie la vitesse de la cible par `slowFactor`        |
| `support` | `buff: { damage, fireRate }`      | ne tire pas ; buffe les **slots voisins** (k-1 et k+1)   |

Le soutien exprime ses bonus en **fractions** : `damage: 0.3` = +30 % de dégâts,
`fireRate: 0.18` = −18 % de délai entre deux tirs. Les bonus de plusieurs soutiens
s'additionnent, le cumul de cadence étant plafonné par `battle.maxSupportFireRateBonus`.
`slowFactor` ne dépend pas du tier (c'est la durée qui monte) : un ralentisseur de tier 9
immobiliserait la vague sinon.

**Ciblage** : l'ennemi **le plus avancé** dont la distance de couloir à l'unité est
inférieure ou égale à sa portée — y compris derrière elle, une unité peut donc achever un
fuyard.

## `enemies` — ennemis (Lot 2)

Trois types au périmètre V1. Les stats listées sont celles de la **vague 1** ; le scaling
par vague est appliqué par-dessus (section `waves`).

```jsonc
"enemies": {
  "basic": {
    "label": "Basique",
    "hp": 24,
    "speed": 55,              // unités de couloir par seconde
    "damageToBase": 6         // PV retirés à la base quand l'ennemi l'atteint
  }
}
```

Les ennemis n'attaquent **pas** les unités et les unités ne meurent pas : toute la pression
passe par les PV de la base (règle de périmètre du Lot 2). `damageToBase` ne scale pas avec
la vague — la montée en pression vient des PV, de la vitesse et du nombre.

## `waves` — courbe de vagues (Lot 2)

Les premières vagues sont **scriptées** (composition exacte, pour maîtriser l'introduction
des types), les suivantes sont **générées** à partir d'un modèle et d'une formule de
scaling, sans limite.

```jsonc
"waves": {
  "firstWaveDelayMs": 4000,   // temps laissé au joueur avant la vague 1
  "interWavePauseMs": 2600,   // pause entre deux vagues (bandeau « Vague N »)
  "spawnGapMs": 900,          // délai entre deux ennemis d'une même vague, vague 1
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
    "hpPerWave": 1.16,        // hp(vague) = hp × hpPerWave^(vague - 1)
    "speedPerWave": 1.02,
    "countPerWave": 1.12,     // ne s'applique qu'aux vagues générées (au-delà de `scripted`)
    "spawnGapPerWave": 0.98,  // les ennemis d'une vague arrivent de plus en plus serrés
    "minSpawnGapMs": 320,     // plancher de `spawnGapMs`
    "maxCountPerEntry": 24    // garde-fou : nombre max d'ennemis par entrée de composition
  }
}
```

**Composition d'une vague** : `scripted[n-1]` si elle existe, sinon `infinite` dont chaque
`count` est multiplié par `countPerWave^(n - scripted.length)` puis arrondi et plafonné.
L'ordre d'apparition suit l'ordre des entrées de la composition.

**Stats d'une vague** : les multiplicateurs `hpPerWave` / `speedPerWave` s'appliquent à
**toutes** les vagues, scriptées comprises (`^(n - 1)`). Les vagues scriptées pilotent donc
la composition, le scaling pilote la difficulté.

Une vague est terminée quand tous ses ennemis sont apparus **et** que plus aucun n'est en
vie — un ennemi qui atteint la base compte comme retiré, la partie ne peut donc pas se
bloquer sur un tank increvable.

## `itemSpawner` — apparition des items sur la grille (Lot 1)

```jsonc
"itemSpawner": {
  "maxTier": 11,              // tier maximum atteignable (cf. seed doc : 11 tiers)
  "startingItems": 3,         // items posés sur la grille au démarrage
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
