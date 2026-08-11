# `balance.json` — schéma & conventions

`balance.json` est **la seule source de vérité pour l'équilibrage**. Aucune stat de
gameplay ne doit être écrite en dur dans le code (cf. `docs/seed.md`, section
« Contraintes techniques »). JSON ne supportant pas les commentaires, ce fichier tient
lieu de documentation du format.

Les sections se remplissent au fil des lots : `itemSpawner` est renseignée depuis le Lot 1
(grille de merge), `units` / `enemies` / `waves` le seront au Lot 2 (bande de combat).

## Règles générales

- Toutes les durées sont en **millisecondes**, toutes les distances en **pixels de monde**.
- Les identifiants (clés d'objet) sont en `camelCase` et stables : le code les référence.
- `version` s'incrémente à chaque changement de **forme** du fichier (pas à chaque
  retouche de valeur), pour repérer un `balance.json` périmé.
- Une valeur absente est une erreur, pas un défaut implicite : le chargement doit crier
  plutôt que d'inventer.

## `units` — unités du joueur (Lot 2)

Quatre types au périmètre V1 : dégât mono-cible, dégât de zone, ralentisseur, soutien.

```jsonc
"units": {
  "single": {                 // id du type d'unité
    "label": "Mono-cible",    // libellé debug/UI
    "role": "damage",         // damage | aoe | slow | support
    "baseDamage": 10,         // dégâts au tier 1
    "fireRateMs": 800,        // délai entre deux tirs
    "range": 220,             // portée en pixels de monde
    "projectileSpeed": 600,
    "tierScaling": 1.6        // multiplicateur de stats par tier (voir `tiers`)
  }
}
```

## `enemies` — ennemis (Lot 2)

Trois types au périmètre V1 : basique, rapide/fragile, tank.

```jsonc
"enemies": {
  "basic": {
    "label": "Basique",
    "hp": 30,
    "speed": 40,              // pixels/seconde vers la base
    "damageToBase": 5,        // PV retirés à la base à l'impact
    "radius": 16
  }
}
```

## `waves` — courbe de vagues (Lot 2)

Le scaling est numérique (PV / vitesse / nombre), pas de nouveaux types par vague.

```jsonc
"waves": {
  "firstWaveDelayMs": 3000,
  "intervalMs": 12000,        // délai entre deux vagues
  "spawnGapMs": 600,          // délai entre deux ennemis d'une même vague
  "baseHp": 100,
  "composition": [            // composition de la vague 1, réutilisée puis scalée
    { "type": "basic", "count": 4 }
  ],
  "scaling": {
    "hpPerWave": 1.15,        // multiplicateurs cumulés par vague
    "speedPerWave": 1.03,
    "countPerWave": 1.10
  }
}
```

## `itemSpawner` — apparition des items sur la grille (Lot 1)

Section **active** : lue et validée par `parseSpawnerConfig()` (`src/systems/itemSpawner.js`),
qui lève une erreur explicite sur toute clé manquante ou hors bornes.

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

**Grille pleine** : ce n'est pas un game over au Lot 1 — le spawn se met simplement en
pause (feedback : bordure de grille qui pulse) et reprend dès qu'une case se libère.
`gridFullRetryMs` n'est donc qu'une cadence de re-vérification, pas un délai de grâce.
