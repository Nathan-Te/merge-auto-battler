# `juice.json` — schéma & conventions

`juice.json` est **la seule source de vérité pour le feel**. Aucune intensité de feedback ne
doit être écrite en dur dans le code : durées de tween, squash, gerbes de particules,
secousses de caméra, sons. Si une valeur se règle à l'œil, elle est ici.

Lu et validé par `parseJuiceConfig()` (`src/systems/juice.js`), qui **refuse** une config
incomplète plutôt que d'inventer un défaut — même règle que `balance.json`. Une valeur
oubliée doit crier au chargement, pas produire un tween de `undefined` ms trois écrans plus
loin. La liste `REQUIRED_NUMBERS` de ce module fait foi : tout ce que le code lit y est
déclaré.

## Pourquoi un fichier séparé de `balance.json`

Ce sont deux métiers. `balance.json` porte ce qui **décide** d'une partie (PV, dégâts,
vagues) et se règle au harness de simulation (`npm run sim`, en secondes, sur des dizaines
de parties). `juice.json` porte ce qui la **fait sentir** et se règle au doigt sur un
téléphone. Les mélanger garantissait qu'on casserait un équilibrage en cherchant une
secousse plus douce.

Corollaire : **rien ici ne doit influencer une règle**. Si une valeur change qui gagne la
partie, elle est dans le mauvais fichier.

## `sound`

```jsonc
"sound": {
  "enabled": true,            // état par défaut ; le choix du joueur le remplace et persiste
  "masterVolume": 0.32        // gain du bus principal
}
```

Le choix du joueur est mémorisé en `localStorage` (`src/systems/settings.js`) : couper le
son ne doit pas se défaire au « rejouer » ni au rechargement.

## `render` — résolution de rendu

```jsonc
"render": {
  "maxPixelRatio": 2         // plafond du `devicePixelRatio` utilisé pour rendre
}
```

Le canvas est rendu à la **résolution physique** de l'écran (taille CSS × ratio), sinon le
navigateur étire une image basse définition sur un écran dense et tout paraît flou — le
texte le premier. Les coordonnées de jeu, elles, ne bougent pas : c'est le zoom des caméras
qui absorbe le facteur (`src/render/hiDpi.js`).

**Ce plafond est le seul curseur de netteté et de performance du rendu.** Le coût est
quadratique : à 2 il y a 4 fois plus de pixels à remplir, à 3 il y en a 9. Au-delà de 2 le
gain visuel est marginal alors que le budget de fill-rate d'un téléphone d'entrée de gamme
est bien réel. Si le jeu rame sur un appareil, c'est **ici** qu'on descend — jamais en
réduisant des tailles dans les scènes. `?dpr=N` force la valeur le temps d'une comparaison
sur un vrai téléphone.

## `particles`

```jsonc
"particles": {
  "poolSize": 200,            // particules simultanées **maximum** — pool figé
  "gravityPx": 260,           // accélération verticale, px/s²
  "dragPerSecond": 1.6        // frottement (1.6 = la vitesse fond vite)
}
```

`poolSize` est un **plafond, pas un objectif** : le pool est alloué une fois au démarrage et
`emit()` recycle la plus vieille particule quand il est plein (cf. `src/render/particles.js`).
Perdre une particule est invisible ; une pause du ramasse-miettes ne l'est pas. Monter cette
valeur augmente le coût de dessin par frame — mesuré à 184 particules en charge maximale.

## `grid` — la moitié gauche

```jsonc
"grid": {
  "spawnPopMs": 210,          // éclosion d'un item qui apparaît
  "moveMs": 130,              // glissement d'un item déplacé
  "returnMs": 175,            // retour d'un item lâché nulle part
  "sendMs": 130,              // aspiration de l'item tapé (il part au combat)
  "dragScale": 1.18,          // agrandissement de l'item tenu, pour rester visible sous le doigt
  "dragScaleMs": 110,
  "mergeAbsorbMs": 105,       // l'item traîné est avalé par sa cible
  "mergePopMs": 230,          // rebond final de l'item de tier supérieur
  "mergeSquash": {            // squash & stretch : ce qui donne son poids à la fusion
    "scaleX": 1.36, "scaleY": 0.66, "durationMs": 105
  },
  "mergeBurst": {             // gerbe à la couleur du tier **produit**
    "count": 12, "speedPx": 190, "lifeMs": 420, "sizePx": 5
  },
  "reject": {                 // secousse de l'item quand le tap est refusé (file pleine)
    "offsetPx": 9, "durationMs": 58, "repeat": 2
  }
}
```

La fusion est le geste principal du jeu : `mergeSquash` est le réglage à toucher en premier
si elle paraît molle.

## `flight` — les deux trajets

```jsonc
"flight": {
  "toSlotMs": 300,            // grille → slot de déploiement (au tap)
  "toFieldMs": 260,           // slot → entrée du couloir (à la sortie)
  "trail": { "everyMs": 28, "lifeMs": 260, "sizePx": 4 }
}
```

Ces deux trajets **sont la lisibilité du concept** : ils montrent en permanence ce que la
grille apporte au combat. Les raccourcir gagne du rythme mais coûte de la compréhension —
arbitrage à faire au playtest, pas au jugé.

## `combat` — la moitié droite

```jsonc
"combat": {
  "hitFlashMs": 95,           // éclair blanc sur un combattant touché (les deux camps)
  "tracerMs": 140,            // durée du trait de tir
  "recoilPx": 5,              // recul du corps du tireur / du frappé
  "recoilMs": 85,
  "unitPopMs": 200,           // éclosion d'une unité sur le champ
  "enemyPopMs": 165,          // éclosion d'un ennemi
  "deathMs": 200,             // durée de l'écrasement à la mort
  "deathSquash": { "scaleX": 1.3, "scaleY": 0.12 },  // le corps s'étale et s'aplatit au sol
  "deathBurst": { "count": 8, "speedPx": 145, "lifeMs": 340, "sizePx": 4 }
}
```

Le recul s'applique à la **forme dans son conteneur**, jamais au conteneur : la position de
celui-ci est réécrite à chaque frame depuis le modèle, un recul posé dessus serait effacé à
la frame suivante.

`deathSquash` a remplacé un basculement à 45° au passage en pixel art. Ce n'est pas un
changement de goût : **une rotation libre est interdite sur un sprite** (cf. `CLAUDE.md`) —
elle rééchantillonne le dessin à chaque frame et fabrique des pixels qui n'existent dans
aucune planche. L'écrasement raconte la même chose en ne touchant qu'aux deux axes d'échelle.
Monter `scaleY` pour une mort moins brutale, monter `scaleX` pour un corps qui s'étale
davantage.

## `base` — quand la base encaisse

```jsonc
"base": {
  "flashMs": 230,             // le bloc « base » vire au rouge
  "vignetteAlpha": 0.45,      // opacité du voile rouge sur les bords de l'écran
  "vignetteFadeMs": 420
}
```

## `shake` — secousses de caméra

```jsonc
"shake": {
  "minIntervalMs": 200,       // étranglement : deux événements rapprochés secouent une fois
  "baseDamage": { "intensity": 0.007, "durationMs": 230 },
  "tankDeath":  { "intensity": 0.0035, "durationMs": 150 },
  "gameOver":   { "intensity": 0.011, "durationMs": 430 }
}
```

`intensity` est une **fraction de la taille du viewport** (convention de Phaser), pas des
pixels : la secousse a donc le même poids sur téléphone et sur desktop.

**Parcimonie.** Le seed doc demande un screenshake « léger et parcimonieux ». Le garde-fou
n'est pas dans l'appelant — qui l'oublierait — mais dans `JuiceKit.shake()` : seuls trois
événements secouent, et `minIntervalMs` étrangle les rafales. La mort d'un **tank** secoue,
celle des autres ennemis non : si tout secouait, la secousse ne voudrait plus rien dire, et
la vague 10 serait illisible. Le game over est le seul autorisé à couper la file.

## `ui`

```jsonc
"ui": {
  "bannerInMs": 220,          // entrée du bandeau d'annonce
  "bannerOutMs": 260,         // sortie, au lancement de la vague
  "hintMs": 1100,             // « file pleine » sur un tap refusé
  "gaugePulseMs": 260,        // sursaut de la jauge de sortie
  "scoreCountMs": 900         // le score de game over compte de 0 à sa valeur
}
```

**Il n'y a pas de `bannerHoldMs`, et c'est volontaire** (playtest du Lot 3.5) : le bandeau
d'annonce n'est plus une notification qui passe, il **reste affiché pendant toute la
préparation** et ne s'efface qu'au lancement de la vague. Sa durée d'affichage est donc
`waves.interWavePauseMs` — une valeur de `balance.json`, parce qu'elle décide aussi de la
puissance du joueur. Ces deux durées-ci ne règlent que l'entrée et la sortie.

## `draft` — l'écran d'améliorations (Lot 3.5)

```jsonc
"draft": {
  "cardInMs": 260,            // entrée d'une carte
  "cardStaggerMs": 90,        // décalage entre deux cartes — voir plus bas
  "pickMs": 300,              // la carte choisie se gonfle et disparaît
  "dismissMs": 190,           // les deux autres s'effacent
  "chipPopMs": 220,           // sursaut des chips de la file de types après un « passer »
  "disabledAlpha": 0.45,      // opacité des cartes pendant le délai de grâce d'ouverture
  "armFadeMs": 180,           // fondu quand elles deviennent prenables
  "pickBurst": {              // gerbe à la couleur de la carte prise
    "count": 22, "speedPx": 230, "lifeMs": 520, "sizePx": 6
  }
}
```

**`cardStaggerMs` est la valeur qui décide si le draft est un plaisir ou un menu.** À 0, les
trois cartes apparaissent d'un bloc : un formulaire. À 90 ms, elles se posent l'une après
l'autre, et l'écran *propose* au lieu d'afficher. Au-delà de ~150 ms, l'attente devient
sensible et le draft ralentit la partie — c'est le premier réglage à revoir si les drafts
paraissent longs.

`pickBurst` est volontairement la plus grosse gerbe du jeu (22 particules contre 12 pour une
fusion) : c'est le seul moment de la partie où le joueur gagne quelque chose de permanent.

## `power` — les pouvoirs actifs (Lot 4)

```jsonc
"power": {
  "castMs": 240,              // trajet de l'item, de sa case vers la bataille
  "ringWidthPx": 3,           // épaisseur de l'anneau de zone
  "ringPulseMs": 220,         // réservé au feedback d'annonce
  "impactRingMs": 260,        // onde de choc, à l'inverse de la télégraphie
  "impactRingScale": 1.35,    // jusqu'où l'onde s'ouvre avant de s'effacer
  "castBurst": {              // éclat sur la case, au moment du tap
    "count": 14, "speedPx": 170, "lifeMs": 380, "sizePx": 5
  },
  "blastBurst": {             // impact de la météorite
    "count": 26, "speedPx": 260, "lifeMs": 520, "sizePx": 6
  },
  "healBurst": {              // une gerbe **par unité soignée**, donc volontairement petite
    "count": 6, "speedPx": 90, "lifeMs": 420, "sizePx": 4
  }
}
```

**La durée de la télégraphie n'est pas ici.** Elle vit dans `balance.json`
(`powers.<type>.telegraphMs`) parce qu'elle est du jeu : les ennemis avancent pendant
l'annonce. Ce fichier ne règle que l'apparence de l'anneau, qui se ferme **exactement** à
l'impact — sinon il mentirait sur ce qui va se passer.

`healBurst` est la plus petite gerbe du jeu à dessein : elle est émise **une fois par unité
soignée**, donc dix fois d'un coup en fin de partie. Une gerbe de taille normale y ferait
un mur blanc et viderait le pool de particules d'un seul soin.

Le trajet d'un pouvoir (`castMs`) est plus rapide et plus tendu que celui d'une unité
(`flight.toSlotMs`), et il ne passe pas par les slots : c'est la moitié visuelle de « les
deux taps ne se confondent pas ». L'autre moitié est sonore (`sfx.powerCast`).

## `sfx` — sons synthétisés

Les sons sont **générés à l'exécution** (façon jsfxr, `src/systems/sfx.js`), pas chargés :
zéro octet de téléchargement, réglables comme le reste du feel. Le Lot 5 les remplacera par
de vrais sons.

```jsonc
"sfx": {
  "merge": {
    "wave": "square",         // square | saw | triangle | sine | noise
    "freqStart": 380,         // fréquence au début, en Hz
    "freqEnd": 760,           // fréquence à la fin — le glissando fait le caractère
    "durationMs": 140,
    "attackMs": 5,            // montée linéaire ; la décroissance est exponentielle
    "volume": 0.55,
    "minIntervalMs": 40       // étranglement : au-delà, le son est ignoré (jamais mis en file)
  }
}
```

Sons obligatoires (`SFX_NAMES`, absence = erreur au chargement) : `merge`, `tap`, `reject`,
`deploy`, `shot`, `death`, `baseHit`, `wave`, `gameOver`, `powerCast`, `powerBlast`,
`powerHeal`.

Les trois sons de pouvoir doivent rester **franchement distincts de `tap`** : un joueur qui
dépense un pouvoir par erreur doit l'entendre avant même de regarder la bataille. C'est
pour ça que `powerCast` monte (240 → 1180 Hz) là où `tap` fait un clic bref, et que
`powerBlast` est le seul bruit blanc long du jeu.

`minIntervalMs` compte : vingt unités qui tirent produiraient trente sons par seconde et une
bouillie. Un son en retard est **ignoré**, jamais mis en file — un son décalé ment sur ce
qui se passe à l'écran. Le premier coup d'une salve s'entend, les suivants se devinent.
