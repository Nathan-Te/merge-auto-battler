# `balance.json` — schéma & conventions

`balance.json` est **la seule source de vérité pour l'équilibrage**. Aucune stat de
gameplay ne doit être écrite en dur dans le code (cf. `docs/seed.md`, section
« Contraintes techniques »). JSON ne supportant pas les commentaires, ce fichier tient
lieu de documentation du format.

Au Lot 0 les quatre sections sont **vides** : la scène de validation ne contient aucun
gameplay, donc aucune stat à équilibrer. Elles se remplissent au fil des lots.

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

```jsonc
"itemSpawner": {
  "intervalMs": 1500,         // cadence d'apparition sur une case libre
  "startingItems": 3,         // items présents au démarrage
  "maxTier": 11,              // cf. seed doc : 11 tiers max
  "spawnTierWeights": {       // probabilités relatives du tier à l'apparition
    "1": 85,
    "2": 15
  },
  "gridFullGraceMs": 2000     // délai avant game over / blocage si la grille sature
}
```
