# CLAUDE.md — Merge Battler

## Le projet en trois lignes

Merge Battler est un mini-jeu web mobile-first : un **merge en grille 5×5** alimente un
**auto-battler** sur une bande de combat — le joueur **tape** un item de tier N pour
l'envoyer au combat en unité de tier N, **tape** un item de pouvoir pour le dépenser
sur-le-champ, et **glisse** pour fusionner et préparer plus gros.
Stack Phaser 3 + Vite, JavaScript, timebox ferme de deux semaines, publication en Basic
Launch sur Crazy Games.
**`docs/seed.md` est la source de vérité du périmètre** : tout arbitrage de scope se
tranche là-bas, et rien hors de ce document n'entre en V1.

## Règles de travail

- **Équilibrage exclusivement via `src/config/balance.json`.** Aucune stat de gameplay en
  dur dans le code : PV, dégâts, vitesses, cadences, courbes de vagues, tiers. Si une
  valeur influence le jeu, elle vit dans `balance.json` et est documentée dans
  `src/config/balance.schema.md` (JSON ne supportant pas les commentaires). Le réglage se
  fait par micro-itérations sur ce seul fichier.
- **Feel exclusivement via `src/config/juice.json`.** Même règle, autre métier : toute
  intensité de feedback — durée de tween, squash, nombre de particules, secousse de caméra,
  paramètre de son — vit là et **jamais en dur** dans une scène. Documenté dans
  `src/config/juice.schema.md`, validé par `parseJuiceConfig()` qui refuse une valeur
  manquante. La frontière est nette : si une valeur change **qui gagne la partie**, elle est
  dans `balance.json` ; si elle change ce que le joueur **ressent**, elle est dans
  `juice.json`. On règle l'un au harness, l'autre au doigt sur un téléphone.
- **`npm run sim` avant toute retouche d'équilibrage.** Le harness headless
  (`src/sim/`, cf. `docs/balance-notes.md`) joue des dizaines de parties automatiques et
  sort un rapport reproductible : cinq politiques (`spam` — envoie tout dès que ça
  apparaît ; `mixed` — fusionne jusqu'au tier 3, **le joueur de référence** ; `prepare` —
  ne lâche rien avant le tier 4 ; `noPowers` — le jumeau de `mixed` qui n'utilise jamais un
  pouvoir ; `slowHands` — le jumeau de `mixed` qui joue à vitesse humaine), vague moyenne,
  écart-type, durée, occupation de la grille, pouvoirs dépensés.
  `--matchups` mesure en plus quel type d'unité tient quelle texture de vague. Un réglage se
  valide en secondes, pas en playtests.
- **Invariant intouchable : « merger bat spammer ».** Préparer un gros item doit rester
  strictement plus payant que spammer des petits — tout le jeu repose là-dessus, sans quoi
  la grille ne sert plus à rien. Cela vaut pour les **deux familles d'items** : la courbe des
  pouvoirs est encore plus raide que celle des unités, pour qu'un pouvoir brûlé au tier 1 ne
  vaille presque rien. `tests/balanceInvariant.test.js` le vérifie sur de vraies parties
  simulées et **échoue** si un réglage l'inverse. Ne jamais le contourner : si le test tombe,
  c'est le réglage qui est faux.
- **Second invariant, depuis le Lot 4 : « les pouvoirs se voient ».** `mixed` doit survivre
  au moins **+0,5 vague** de plus que `noPowers`, son jumeau exact aux pouvoirs près. Une
  mécanique qui n'apporte rien de mesurable n'occupe que des cases de grille, et il vaudrait
  mieux la retirer que la publier. Attention en la réglant : la difficulté monte de ×1,66 par
  vague, donc le nombre de vagues est une mesure **logarithmique** de la puissance — 15 % de
  dégâts en plus déplacent la fenêtre de 0,3 vague, c'est-à-dire de rien du tout.
- **Objectifs chiffrés de référence** (`src/sim/targets.js`, vérifiés par le harness et par
  les tests) : partie moyenne de **3 à 5 minutes**, première défaite vers les **vagues
  8-12**, `prepare` au moins **×1,4** devant `spam` en vagues survécues. Toute itération de
  réglage se juge à ces trois nombres. Ils sont **inchangés depuis le Lot 3** : le draft puis
  les pouvoirs ont ajouté de la puissance, et à chaque fois la difficulté a été relevée en
  face plutôt que la cible déplacée (mesures dans `docs/balance-notes.md`, sections 7 et 8).
- **La pression de grille se règle par la courbe de remplissage, jamais par un intervalle
  fixe.** Depuis le Lot 4.5, le spawner est **asservi** au taux d'occupation
  (`itemSpawner.fillPressure`) : cadence nominale tant que la grille respire, freinage
  progressif au-delà de `startFill`, quasi-arrêt à `stopFill`. Si un playtest dit « il y a
  trop d'items », le réflexe est de descendre `startFill` ou de durcir la courbe — **pas** de
  ralentir `intervalMs`. La raison est structurelle et mesurée : un ralentissement global
  pénalise d'abord celui qui **prépare** (limité par les items, il lui en faut 4 à 8 par
  envoi) et n'atteint pas le spammeur (limité, lui, par `deployCooldownMs`). Il retourne donc
  l'invariant central pendant qu'il soigne le symptôme. La courbe, elle, ne coûte **rien** à
  qui entretient sa grille : au harness, `mixed`, `prepare` et `noPowers` rendent des chiffres
  identiques avec et sans elle. Mesures : `docs/balance-notes.md`, section 9.
- **Une politique du harness mesure la main, pas la stratégie.** `slowHands` joue exactement
  le jeu de `mixed` à un geste toutes les 1,1 s au lieu de 0,3. Les autres politiques
  entretiennent une grille impeccable et ne voient donc **jamais** la saturation dont se
  plaignent les playtests : c'est celle-ci, et elle seule, qui mesure le confort de grille.
  Tout réglage qui prétend soigner « trop d'items » se juge sur sa ligne.
- **Les améliorations de draft sont des modificateurs, jamais des mutations.** Une carte
  prise n'écrit **rien** dans `balance.json` : elle accumule un facteur
  (`src/systems/modifiers.js`), et ce sont les lecteurs — `unitStats`, `DeployQueue`,
  `ItemSpawner`, `UnitQueue` — qui l'appliquent au moment de lire. `balance.json` est importé
  une seule fois pour toute l'application : une mutation ferait survivre les améliorations
  d'une partie à la suivante, exactement le bug que `GameSession.destroy()` rend impossible
  partout ailleurs. Un test le verrouille (`tests/draftSystem.test.js`).
- **Toute livraison qui modifie `balance.json` régénère `docs/reference.md`** avec
  `npm run docs`. Ce fichier est **généré, jamais édité à la main** : il liste les stats de
  chaque type d'unité par tier, les pouvoirs, les ennemis, les vagues et le pool
  d'améliorations, calculés par les **formules du jeu** (`unitStats`, `powerStats`,
  `enemyStats`, `waveComposition`). C'est ce qui
  l'empêche de mentir — une référence tenue à la main dérive dès la première retouche de
  réglage, et sans prévenir. Un test échoue si le fichier commité est périmé
  (`tests/reference.test.js`), et `npm run docs -- --check` répond à la même question en CI.
- **Le périmètre gameplay de la V1 est clos depuis le Lot 4.** Les pouvoirs actifs sont la
  dernière mécanique ; le Lot 5 ne contient qu'assets et publication. Toute idée ultérieure
  — la tienne, celle d'un playtest, celle d'un joueur — s'écrit dans `docs/v1-1-ideas.md` et
  ne s'implémente pas. La timebox est ferme : une idée notée ne coûte rien, une idée ajoutée
  se paie sur le fini du jeu.
- **La direction artistique est le pixel art, et elle tient sur deux règles d'or.** Décision
  actée après le Lot 5, pour pouvoir mélanger de vrais packs pixel art et de la génération IA
  sans que l'écran devienne un patchwork. Le thème fantasy classique ne change pas ; le rendu
  et le pipeline, si.
  **(1) Une seule résolution native** — `pixel.nativeSize` = **16**, mesurée sur le pack de
  référence (cellules de 16 px, marge 1 px, gouttière 2 px, planche livrée en ×4). Un
  personnage fait 16 pixels de dessin, un décor en fait plus mais du même calibre. **Aucun
  asset d'une autre résolution native n'entre en jeu.**
  **(2) Une seule palette partagée** — `assets-src/palette.json`, **119 couleurs** extraites
  du pack de référence par `npm run palette`, committée. Toute source qui n'est pas déjà du
  pixel art y est quantifiée.
  Ce ne sont pas des réglages qu'on ajuste au playtest : ce sont elles qui font que deux
  sprites voisins appartiennent au même dessin, et ça ne se rattrape pas après coup. Le pack
  de référence **est** la planche de style ; l'IA comble les manques et passe par la
  pixelisation. Corollaire d'unité qui se lit dans le manifest : `sizes.<catégorie>` est en
  **pixels d'art**, plus en pixels d'écran — une valeur à 192 est le symptôme d'un manifest
  écrit avant la bascule, et le pipeline la refuse.
- **La pixelisation est une étape du pipeline, dans un ordre qui n'est pas cosmétique.**
  Toute source **non native** (génération IA, image haute résolution) traverse
  `réduction → seuillage alpha → quantification` (`src/tools/assets/pixelOps.js`), et jamais
  dans un autre ordre : un pixel de bord à 40 % d'opacité porte une couleur à moitié mélangée
  au fond, donc le quantifier avant de le seuiller ferait entrer dans la palette une teinte
  qui n'est celle de personne — puis on l'effacerait. Le **seuillage alpha** (opaque ou
  transparent, jamais entre les deux) est celui qui se voit le plus : un bord adouci sur un
  sprite affiché en ×4 ne produit pas un dégradé mais un gros carré translucide, quatre fois
  plus visible que le pixel qu'il devait adoucir. La réduction se fait par **moyenne de
  surface** et non au plus-proche-voisin, parce qu'un pixel d'art recouvre un bloc de 20×20
  pixels de source et que le plus-proche-voisin en tire un seul au hasard du cadrage ; comme
  le seuillage et la quantification passent après, elle ne laisse derrière elle ni
  demi-transparence ni couleur hors palette. `"resample": "nearest"` reste disponible par
  planche pour une source déjà pixelisée mal agrandie. Une source **native** (un pack) ne
  subit **rien** — seulement une réduction à ×1 si elle est livrée agrandie, d'un facteur
  **mesuré sur les pixels** et non lu dans le nom du fichier (les deux planches de référence
  s'appellent « 3x » et « 4x » et sont toutes les deux en ×4). Ses couleurs hors palette sont
  **signalées** dans la galerie, jamais corrigées : un pack ne se retouche pas, il fait
  référence. Dernière conséquence, et elle est facile à oublier : l'atlas WebP est encodé
  **sans perte**. Compresser avec perte réinventerait des milliers de teintes intermédiaires
  et adoucirait chaque bord, à la toute dernière étape et sans que rien ne le signale.
- **Mise à l'échelle entière, partout, sans exception.** Un sprite s'affiche à un **multiple
  entier** de sa taille native (`src/systems/pixelScale.js`, appliqué dans `Skin.resize()` —
  le seul endroit du rendu qui pose un sprite, donc aucune vue ne peut l'oublier). Un facteur
  de 3,4 répartit les pixels d'art sur 3 ou 4 pixels d'écran selon leur position : le sprite
  n'est pas « un peu flou », il est **irrégulier**, et c'est ça qui distingue un jeu pixel art
  d'une image de pixel art redimensionnée. On perd quelques pixels de remplissage quand une
  case n'est pas un multiple de 16 ; on garde une grille intacte sur tous les écrans. Même
  raison côté DPR : `effectivePixelRatio()` **tronque à l'entier** depuis la bascule — le zoom
  des caméras *est* ce ratio, et un 2,625 casserait la chaîne juste après que le sprite l'ait
  respectée. Le prix (une demi-résolution de texte perdue sur les écrans en 1,5) est payé les
  yeux ouverts : la netteté du pixel art prime, `render.maxPixelRatio` reste le seul curseur.
  `pixelArt: true` + `roundPixels: true` dans `src/main.js` ferment la chaîne côté GPU.
- **Frames des packs pour la locomotion, procédural pour les impacts, jamais de rotation.**
  C'est la règle d'animation du projet, amendée après la première passe d'habillage : les
  planches de personnages **contiennent** leurs cycles de marche, et s'en priver pour tout
  animer à la main donnait des personnages qui glissent. Le partage est donc fonctionnel et
  non stylistique — **locomotion et arrêt viennent des frames du pack** (`walk` pendant le
  déplacement, `idle` à l'arrêt : une unité qui tire, une vignette qui attend dans un slot),
  **impacts, morts, éclosions, reculs et flashs restent procéduraux**. Aucun pack ne garantit
  une animation d'attaque, et le mélange frames + procédural est le standard du genre : un
  recul se règle au millième dans `juice.json`, un cycle de marche ne se dessine pas au
  tween. Les frames se déclarent dans `assets-src/manifest.json` (`animations`, en décalages
  de cellule depuis l'ancre), la **cadence** dans `juice.json` (`sprite.fps.*`) et se tient
  volontairement entre 4 et 8 images par seconde — au-delà, une marche de pixel art ne
  devient pas plus fluide, elle devient nerveuse. La lecture vit dans
  `src/render/spriteAnim.js` : un compteur de temps, et non le gestionnaire d'animations de
  Phaser, qui est global au jeu et survivrait à la partie — exactement ce que
  `GameSession.destroy()` rend impossible partout ailleurs. Le sens de marche se donne au
  **flip horizontal**, et les items de la grille restent **statiques**.
- **Aucune rotation continue sur un sprite.** Une rotation libre détruit la grille de pixels :
  elle rééchantillonne le dessin à chaque frame et fabrique des pixels qui n'existent dans
  aucune planche. Les effets de juice se font à l'**échelle entière**, en flips, en frames et
  en décalages — jamais en `setAngle`/`setRotation` animés, ni en `angle`/`rotation` dans un
  tween. Le jeu en contenait **une** au moment de la bascule, la mort d'un combattant qui
  basculait à 45° en rétrécissant : elle est devenue un **écrasement au sol**
  (`combat.deathSquash`), qui raconte la même chose en ne touchant qu'aux deux axes d'échelle.
  La règle vaut pour les sprites, pas pour un `Graphics` vectoriel du greybox.
  Corollaire pour les particules : elles sont des **carrés sur la trame**, dont la taille est
  un multiple entier du pixel d'art et la position alignée dessus au dessin — simulées en
  flottant, affichées sur la grille (`src/render/particles.js`). `juice.json` continue de
  régler des intensités en unités de jeu : un réglage de feel n'a pas à connaître la
  résolution native, sinon il faudrait le refaire à chaque écran.
- **Les polices sont bitmap, et rendues à taille entière.** Une police vectorielle posée sur
  du pixel art de 16 px jure autant qu'un cercle parfaitement lisse, et pour la même raison :
  ses bords sont gris là où le reste de l'écran n'a que des pixels pleins. Toutes les tailles
  passent par `pixelFontSize()` (`src/render/fonts.js`), qui les contraint aux multiples de la
  taille de dessin de la police — **et qui reste inerte tant qu'aucune police pixel n'est
  livrée**, parce que contraindre un repli vectoriel ferait sauter tous les textes du jeu de
  trois tailles d'un coup sans gagner la moindre netteté. Fichiers attendus et convention de
  nom : `docs/fonts.md`.
- **Tout asset entre par `assets-src/`, jamais directement dans `public/assets/`.** Le
  pipeline (`npm run assets`, cf. `src/tools/assets/`) découpe les planches déposées dans
  `assets-src/` selon `assets-src/manifest.json`, détoure le fond blanc **par propagation
  depuis les bords** (un blanc enfermé dans le dessin survit — un seuil global troue le
  sprite), rogne, normalise par catégorie, range en atlas WebP et publie dans
  `public/assets/`. Ce dossier est **entièrement généré** : le pipeline y écrit, y supprime ce
  qui n'a plus de source, et le CI recommitte le résultat. Un fichier posé là à la main
  disparaîtrait au prochain passage, sans prévenir, et personne ne saurait d'où il venait.
  Les sons (`assets-src/audio/`) et les polices (`assets-src/fonts/`) passent par la même
  porte : ils sont recopiés tels quels, mais **comptés dans le budget de poids**. Les
  **paliers visuels** (`tierBands`) sont réglés là aussi, et il y en a **trois tables
  distinctes** — `orb`, `unit`, `power` : un orbe est une icône qui se décline onze fois sans
  effort, une unité est un personnage. Les faire partager une table imposerait de choisir
  entre onze orbes et trois personnages, ce qui n'est pas un choix.
  L'idempotence tient à une **empreinte des entrées** et non au déterminisme de l'encodeur
  WebP, qui dépend de la version de libvips installée : à `assets-src/` inchangé, rien n'est
  réencodé, donc le CI ne boucle pas sur son propre commit. `PIPELINE_VERSION` est à
  incrémenter dès qu'un changement de code modifie les pixels produits.
- **Tout problème d'asset se diagnostique dans la galerie avant de toucher au code.**
  `npm run assets` génère `public/gallery/index.html`, déployée sur `/gallery/` hors de la
  navigation du jeu : chaque sprite y est sur fond en **damier** (le seul moyen de voir un
  halo blanc ou un bord mangé) et **deux fois — à ×1 et agrandi ×4 au plus-proche-voisin**,
  avec ses dimensions en pixels d'art, son poids et le budget en tête de page. Les deux vues
  ne se remplacent pas : à ×1 un sprite de 16 px est trop petit pour qu'on voie quoi que ce
  soit, et c'est pourtant à cette taille qu'on juge sa lisibilité ; c'est au zoom que se
  voient les pixels sales — un bord resté en demi-transparence, une teinte qui a échappé à la
  palette, une diagonale en escalier irrégulier. La page affiche aussi la **palette partagée**
  en toutes lettres, parce qu'une palette qu'on ne regarde jamais dérive sans qu'on s'en
  aperçoive. Elle annonce aussi les **manques** (ce que le jeu attend et qui n'existe pas) et les
  **orphelins** (ce qui existe sans que le jeu le demande — presque toujours une faute de
  frappe dans `names`). La boucle visée est opérable à 100 % au téléphone : upload d'une
  planche via l'interface web de GitHub → CI → galerie à jour → correction du manifest. Un
  sprite qui sort mal se corrige dans `assets-src/manifest.json`, pas dans une scène.
- **Le décor se pose par-dessus le greybox, jamais à sa place.** Les cinq fonds du jeu
  (`decor.sky`, `decor.table`, `decor.field`, `decor.castle`, `decor.portal`) se déclarent en
  une ligne de manifest — `{ "file": …, "category": "decor", "sprite": "decor.field" }`, le
  raccourci « un fichier = un sprite » — et se posent **au-dessus** du rectangle de couleur qui
  tenait la place, lequel reste en place et continue de porter la couleur de la zone. Rien à
  désactiver, aucune scène à modifier, et les cinq sont indépendants : on les livre un par un.
  `DECOR_SLOTS` (`src/render/skinNames.js`) dit lequel se **répète** et lequel se **pose**, et
  ce n'est pas un réglage — un ciel, un plateau et un sol couvrent une surface dont personne ne
  connaît la taille à l'avance, un château et un portail sont des objets. Un fond répété **doit
  faire une puissance de deux** : le `TileSprite` de Phaser redessine toute autre taille
  **étirée** vers la supérieure avant de la répéter, ce qui produit exactement le flou que
  toute la chaîne pixel art vient d'éviter — le pipeline le signale, et `trim` vaut `false` par
  défaut pour un décor, un rognage cassant la puissance de deux en silence. Les deux décors
  posés se dimensionnent en **multiples d'un combattant** (`juice.json`,
  `field.decor.endSize`) et non en épaisseur de couloir : c'est la seule échelle que l'œil
  compare, et la seule qui tienne du téléphone au grand écran.
- **Un asset absent ne casse jamais rien.** `src/render/visuals.js` est le **seul** endroit
  qui tranche entre un sprite et une forme greybox ; toute vue s'y demande sous forme de
  description (`{ kind: 'unit', type, tier }`). Le repli n'est pas une précaution mais le mode
  de fonctionnement normal pendant toute la production : les assets arrivent par vagues, et
  sans repli la première livraison rendrait le jeu injouable jusqu'à la dernière. Ne jamais
  écrire un `if (le sprite existe)` dans une scène — les six écrans se désynchroniseraient à
  la première planche livrée à moitié.
- **Le champ de bataille se répartit en hauteur, et ça ne coûte rien au modèle.** Chaque
  combattant reçoit à son apparition un décalage **perpendiculaire** à sa marche, stable pour
  toute sa vie, et les entités plus basses se dessinent devant (`fighterDepth()`, une seule
  bande de profondeur partagée par les deux camps — deux bandes séparées feraient passer un
  ennemi placé plus haut devant l'unité qui le mord). `BattleModel` reste strictement **à une
  dimension** : portées, ciblage, contacts et harness ne connaissent que `progress`. Le
  décalage est donc **dérivé de l'identifiant** de l'entité (`src/systems/laneSpread.js`),
  jamais tiré — un tirage consommerait le générateur seedé de la partie et déplacerait la
  composition des vagues, le draft et les items de la grille, pour cause de décor. Ce n'est
  pas un hachage mais une **permutation** : les identifiants d'une vague sont consécutifs,
  donc `spread.steps` entités successives occupent autant de rangs **différents**, là où un
  hachage laisserait deux squelettes exactement superposés — le défaut qu'on vient corriger.
  Corollaire à ne pas oublier en ajoutant un effet : projectiles, impacts et gerbes visent la
  position **visuelle** de leur cible, décalage compris, et non l'axe du couloir.
- **Aucun texte affiché en dur, nulle part** — ni dans une scène, ni dans `balance.json`.
  Tout passe par une clé de `src/i18n/` (`t('hud.baseHp', { current, max })`). Le jeu sort
  **en anglais**, en français si le navigateur l'est, `?lang=` force l'un ou l'autre.
  `balance.json` ne garde que ce qui décide qui gagne la partie, plus des **identifiants** :
  `labelId` pour une vague scriptée, `id` pour une carte de draft. Corollaire structurel à ne
  pas défaire : `waves.waveLabel()` rend un **descripteur** (`{ kind: 'tide', enemy }`) et non
  une phrase, et `BattleModel` n'émet aucune chaîne destinée à l'écran — mettre une
  composition en mots demande de connaître la langue, ce qui n'est pas le métier d'un modèle
  pur. La mécanique vit dans `i18n/format.js`, **sans dictionnaire**, pour que `npm run docs`
  l'utilise depuis Node et que la référence ne puisse pas diverger de l'interface. Deux tests
  verrouillent l'ensemble : les deux dictionnaires couvrent exactement les mêmes clés, et
  chaque identifiant de `balance.json` a son libellé dans les deux langues. Seule exception,
  assumée : la ligne de diagnostic de `?debug=1`, un vidage d'identifiants lu par une seule
  personne.
- **Le greybox n'a pas disparu au Lot 5 : il est devenu le repli.** Les formes colorées des
  Lots 1 à 4 sont toujours là, et c'est elles qu'on voit tant qu'un sprite n'est pas livré.
  Elles restent donc à entretenir : un nouveau type d'unité ou de pouvoir se dessine
  **d'abord** en greybox (`src/render/`), et son sprite vient après. C'est ce qui a permis de
  valider tout le fun du jeu sans une seule image, et ce qui permet aujourd'hui de recevoir
  les planches une par une. Depuis la bascule en pixel art, ses cercles et ses hexagones font
  un escalier — `pixelArt: true` coupe le lissage géométrique en même temps que le filtrage
  des textures. C'est assumé : un escalier de pixels sur un écran de pixel art est bien moins
  étranger qu'un cercle parfaitement lisse posé à côté d'un personnage de 16 px, et la place
  du greybox est de toute façon de disparaître planche après planche.
- **Rond = pouvoir, et sans exception — y compris en sprites.** Les items de pouvoir sont les
  **seules** formes rondes du jeu : les items d'unité sont des polygones puis des étoiles
  (`src/render/tierShapes.js`), et même le mono-cible du champ de bataille est un carré
  depuis le Lot 4. C'est cette silhouette, pas la couleur ni le numéro, qui empêche de
  confondre « j'envoie une unité » et « je dépense un pouvoir » au doigt. Une exception
  suffirait à casser la règle : ne pas en introduire. **L'habillage du Lot 5 ne l'assouplit
  pas** — une fiole et un orbe de météore restent des silhouettes rondes, un orbe
  d'invocation ne l'est jamais, et c'est le premier point à regarder dans la galerie quand
  une planche de pouvoirs arrive.
- **Souris + tactile obligatoires sur toute interaction.** Chaque geste doit fonctionner au
  doigt comme à la souris, dès son écriture. On passe par les événements de pointeur
  Phaser (`pointerdown` / `drag` / `pointerup`), jamais par des événements souris ou
  clavier spécifiques. Le jeu se teste sur téléphone via l'URL publique.
- **Tap = envoyer, glisser = fusionner. Rien ne part automatiquement.** Taper un item
  **d'unité** de la grille le consomme et met une unité de son tier en file de déploiement,
  du type dicté par la file de types (visible dans le HUD, fixée **au moment du tap**).
  Taper un item **de pouvoir** le dépense immédiatement (ni file, ni cooldown). Glisser
  fusionne, déplace ou **échange** — un lâcher n'est jamais perdu — et le merge ne déclenche
  **rien** côté combat. La file se vide toute seule au
  rythme de `battle.deployCooldownMs` : c'est le métronome du jeu, et c'est ce qui rend le
  spam de petites unités perdant. Décision actée au Lot 2.5 — les deux gestes ne doivent
  jamais se confondre, seuils dans `balance.json` (`input`), logique dans `tapGesture.js`.
- **La boucle de décision est l'intention de design de référence** (Lot 3.5). Elle a trois
  temps, et aucun ne vaut sans les deux autres :

  ```
  annonce de vague  ×  file de types  ×  draft
  « ce qui arrive »   « ce que je peux »  « ce que je deviens »
  ```

  Chaque pause annonce la **composition** de la vague à venir ; la file affiche les **trois
  prochains types**, et le bouton « passer » permet d'en défausser un contre un cooldown ;
  toutes les `draft.everyWaves` vagues, la partie gèle et propose trois améliorations. La
  décision du jeu naît du **croisement** des deux premières informations — « 20 rapides
  arrivent, ma tête de file est un mono-cible : j'envoie, je prépare plus gros, ou je
  passe ? ». C'est pour ça qu'elles sont physiquement **côte à côte** dans `IntelBar` : les
  séparer, c'est retirer la décision. Toute évolution d'interface doit préserver ce
  voisinage. Le troisième temps, le draft, est ce qui rend une seconde partie différente de
  la première.
- **Une pause est du temps de jeu, pas du temps mort.** `waves.interWavePauseMs` est le
  moment où l'on regarde la bataille, où l'on lit l'annonce et où l'on fusionne sans urgence
  — le playtest du Lot 3 a montré qu'un jeu à un seul régime (l'urgence permanente) fatigue
  et n'offre aucun choix. Le raccourcir revient à supprimer la respiration installée par ce
  lot ; c'est aussi un levier de puissance, donc tout changement se paie sur `hpPerWave`.
- **Poids surveillé à chaque lot.** Le seed doc impose ≤ 20 Mo de téléchargement initial
  (limite dure 50 Mo) et un chargement < 3 s. Le workflow CI affiche le poids de `dist/` à
  chaque build : le regarder, et justifier toute hausse notable dans la PR.
- **Chaque lot livre une PR + un README de livraison court** (ce qui a été fait, ce qui est
  testable, ce qui reste ouvert). Une branche par lot.
- **Tests unitaires sur la logique**, pas sur le feel : règles de merge, spawn d'items,
  logique de vagues sont couverts par vitest. Le feel se valide à la main sur téléphone.
- **Le jeu rend à la résolution physique de l'écran, et le plafond est le seul curseur.**
  `src/render/hiDpi.js` porte la mémoire de rendu du canvas à `taille CSS × devicePixelRatio`
  et laisse le style CSS à la taille logique ; les coordonnées de jeu ne bougent pas, c'est
  le **zoom des caméras** qui absorbe le facteur. Aucune scène n'a à savoir que le ratio
  existe. Le plafond vit dans `juice.json` (`render.maxPixelRatio`, 2 par défaut) parce que
  le coût est **quadratique** — ×2 = 4 fois plus de pixels à remplir. **Tout ajustement de
  netteté ou de performance passe par ce plafond**, jamais par des tailles en dur dans une
  scène : baisser une police ou un rayon pour gagner des images par seconde casserait la
  lisibilité au doigt sans rien régler du vrai coût, qui est du remplissage. `?dpr=N` force
  la valeur pour comparer sur un téléphone sans reconstruire. **Depuis la bascule en pixel
  art, le ratio effectif est tronqué à l'entier** : le zoom des caméras *est* ce ratio, donc
  un 2,625 casserait la grille de pixels juste après que le sprite l'ait respectée (détail et
  contrepartie dans la règle « mise à l'échelle entière », plus haut).
- **Le layout est responsive par construction.** Le canvas est en `Scale.RESIZE` : chaque
  scène se relayoute dans un `layout(width, height)` appelé au `create` et sur l'événement
  `resize`. Pas de positions absolues calculées une seule fois au démarrage.
- **Toute nouvelle logique de gameplay naît dans un module pur et testable**
  (`src/systems/`), jamais dans une scène. Le rendu Phaser ne contient aucune règle : il
  affiche un modèle, lui transmet les gestes, et réagit à ses événements. Si une règle est
  écrite dans une scène, elle est au mauvais endroit — voir la section Architecture.
- **Chaque prompt de lot indique les modifications à apporter à ce fichier** ; le lot les
  applique lui-même à la livraison.

## Architecture

```
input (pointeur)  ->  scène Phaser  ->  modèle pur  ->  bus d'événements  ->  scène (rendu)
```

- **`src/systems/` — logique pure, sans Phaser.** `GridModel` détient l'état de la grille
  et toutes ses règles (placement, **familles d'items**, validité d'une fusion, déplacement,
  spawn sur case libre, grille pleine, tier maximum) ; `DeployQueue` la file de déploiement
  (slots, FIFO, cooldown de sortie) ; `BattleModel` le champ de bataille (unités, ennemis,
  marche, combat mutuel, vagues, PV de la base, **annonce de la vague à venir**) ;
  `PowerSystem` les pouvoirs actifs (ciblage, montants, télégraphie) ; `DraftSystem` le
  pool d'améliorations et son tirage seedé, `modifiers` leur accumulation ; `GameSession`
  possède le tout et porte le pont ; `tapGesture` distingue tap et glisser ; `unitQueue`
  la file de types et son bouton « passer » ; `itemSpawner` détient la cadence et le tirage
  des tiers ; `battleConfig` / `waves` valident `balance.json` et portent **toutes** les
  formules ; `layout` calcule les rectangles de l'écran. Ces modules tournent dans vitest
  sans canvas ni DOM, et c'est là que se trouvent les tests.
- **`src/scenes/` — rendu et orchestration.** `GameScene` crée la session, lui envoie les
  gestes du joueur (`session.applyTap`, `session.applyDrop`), et met en images ce qu'elle
  émet ; `BattleView` fait de même pour la moitié droite ; `IntelBar` porte la barre de
  décision (annonce de vague × file de types × bouton « passer ») ; `DraftScene`, `HelpScene`
  (le « ? » de l'en-tête) et `GameOverScene` sont lancées par-dessus la scène de jeu mise en
  pause. Une scène ne décide jamais si une fusion est légale, si un envoi est possible, si un
  pouvoir a une cible ni si une amélioration s'applique : elle demande.
- **`src/render/` — greybox.** Formes et couleurs par tier (items d'unité), par type de
  pouvoir (`powerShapes.js`) et par type de combattant (unités, ennemis) ; profondeurs
  d'affichage. Aucune règle, aucun état. Les tailles à l'écran
  vivent ici et non dans `balance.json` : elles n'influencent aucun calcul.
- **Bus d'événements** (`src/systems/eventBus.js`) : seul canal entre les systèmes, et
  seul canal modèle → rendu. Un modèle n'appelle jamais la scène, ni un autre modèle.

### Le pont grille → champ de bataille

Depuis le Lot 2.5, **le merge ne déclenche plus rien côté combat**. Le pont est une chaîne
de deux événements, chacun consommé par le module dont c'est le métier :

```js
// 1. le tap, émis par GameSession — le type vient de `UnitQueue`, fixé à cet instant
events.emit('enqueueUnit', { tier, type, origin: { kind: 'tap', gridIndex } });

// 2. la sortie, émise par DeployQueue quand son cooldown expire — FIFO
events.emit('deployUnit', { tier, type, unit, origin });
```

`DeployQueue` s'abonne au premier, `BattleModel` au second ; chacun se désabonne dans son
`destroy()`. Une unité n'entre donc en jeu **que** par `deployUnit` — il n'existe aucun
autre chemin, ce qui rend le rythme de sortie impossible à contourner par erreur.

### Les deux familles d'items et les pouvoirs actifs

Depuis le Lot 4, la grille produit **deux familles d'items** — et c'est tout ce que
`GridModel` en sait :

```js
{ id, tier, family: 'unit',  power: null }      // part en file de déploiement au tap
{ id, tier, family: 'power', power: 'meteor' }  // se dépense immédiatement au tap
```

La règle de fusion est **une seule règle, avec une identité élargie** : deux items
fusionnent s'ils ont le même tier **et la même sorte** (même famille, et même type de
pouvoir). Il n'y a donc aucun merge croisé — ni entre familles, ni entre deux pouvoirs
différents. Les pouvoirs ont leur propre plafond (`powers.maxTier`, plus bas que celui des items d'unité) parce qu'ils sont
plus rares : un plafond commun serait hors d'atteinte, et deux pouvoirs plafonnés resteraient
collés sur la grille.

Le second chemin du pont tient dans un événement, et c'est **le contrat du lot** :

```js
// émis par GameSession au tap sur un item de pouvoir ; consommé par PowerSystem
events.emit('usePower', { type, tier, origin: { kind: 'tap', gridIndex } });
```

**`PowerSystem`** (`src/systems/PowerSystem.js`) possède la résolution et rien d'autre :
le **ciblage** (le groupe qui compte le plus d'ennemis dans le rayon, et à nombre égal le
plus avancé), les **montants** par tier, et la **temporisation**. Il ne retire jamais un PV
lui-même — il appelle `BattleModel.blast()` ou `BattleModel.healUnits()`, seules portes par
lesquelles un pouvoir touche le champ de bataille, pour que le modèle reste propriétaire de
ses unités et de ses ennemis. `GameSession.update()` l'avance, donc un draft ouvert gèle une
météorite en vol comme il gèle tout le reste, et `destroy()` l'emporte avec la partie.

Trois règles qu'il ne faut pas défaire :

- **La télégraphie est du jeu, pas du décor.** `powers.<type>.telegraphMs` vit dans
  `balance.json` parce que les ennemis avancent pendant l'annonce : la zone est figée au tap,
  et ce qu'elle attrape dépend de leur vitesse. `juice.json` ne règle que l'apparence de
  l'anneau (`power.*`), qui se ferme **exactement** à l'impact — sinon il ment.
- **Un pouvoir sans la moindre cible est refusé**, l'item reste sur la grille
  (`SESSION_TAP.BLOCKED`, raison `aucuneCible`). C'est le pendant de « pas de cooldown » :
  le coût d'un pouvoir est sa rareté, et le perdre sur un mistap pendant une pause serait
  une punition que rien n'annonce. Soigner une armée intacte, en revanche, reste **permis** —
  c'est un jugement du joueur, pas une impossibilité.
- **Le tap sur un pouvoir se teste avant celui de la file.** Une file de déploiement pleine
  n'a jamais à empêcher un soin.

**`GameSession`** (`src/systems/GameSession.js`) est le propriétaire d'une partie : elle
possède `GridModel`, `DeployQueue`, `BattleModel`, le spawner et la file de types, et porte
les règles qui appartiennent à plusieurs moitiés à la fois. `GridModel` n'a été modifié ni
par le Lot 2 ni par le Lot 2.5. Deux règles vivent dans la session :

- **tap** : `session.applyTap(index)` consomme l'item, prend le type courant de `UnitQueue`
  et émet `enqueueUnit`. Le tier de l'unité est celui de l'item tapé.
- **file pleine** : le refus se décide **avant** de retirer l'item — `applyTap` renvoie
  `SESSION_TAP.BLOCKED` et émet `tapRejected`, l'item reste sur la grille et la file de
  types n'avance pas. Ce n'est jamais un blocage durable (la file se vide au cooldown), et
  **les merges et déplacements restent libres en permanence**.

Rejouer = `session.destroy()` puis une session neuve. Aucun état, aucun écouteur ne
survit à une partie — c'est ce qui rend le bug classique du « rejouer » impossible par
construction, et testable sans Phaser (`tests/gameSession.test.js`). Les améliorations de
draft obéissent à la même règle **parce qu'elles ne sont que des modificateurs portés par
la session** : une seconde partie repart sans une seule d'entre elles
(`tests/draftSession.test.js`).

### Le draft

`DraftSystem` (`src/systems/DraftSystem.js`) détient le pool de `balance.json`, les niveaux
pris et les modificateurs cumulés. `GameSession` s'abonne à `waveCleared` : toutes les
`draft.everyWaves` vagues, elle tire une offre, **gèle la partie** et émet `draftOffer` ;
`chooseDraft(id)` applique la carte et relance.

Le gel est **double, à dessein** : `GameSession.pendingDraft` arrête `update()` et
`BattleModel.paused` coupe le tick au milieu d'une frame (une frame couvre jusqu'à
`maxTicksPerFrame` ticks, et la vague suivante avancerait sinon d'un demi-pas pendant que le
joueur lit) ; côté rendu, `DraftScene` est lancée par-dessus `GameScene` **mise en pause**.
Un bug de rendu ne peut donc pas laisser filer la simulation.

Tous les systèmes lisent les modificateurs par un accès injecté (`getModifiers`), jamais par
une copie : une place gagnée au draft s'ouvre au tick suivant sans que personne n'ait à
propager quoi que ce soit, et la file en cours n'est pas perdue.

### Protection d'inputs des overlays — patron à réutiliser

Le draft s'ouvre pile quand le joueur fusionne, doigt posé sur l'écran. Le playtest du
Lot 3.5 a montré ce que ça donne : le doigt se relève une fraction de seconde plus tard, sur
une carte, et l'amélioration est prise **sans avoir été lue** — pour toute la partie.

`OverlayGuard` (`src/systems/overlayGuard.js`) est la réponse, et **tout écran qui s'ouvre
par-dessus le jeu doit l'utiliser** (`DraftScene`, `HelpScene`, et les suivants) :

1. **Un appui postérieur à l'ouverture est exigé.** Un doigt déjà enfoncé n'a jamais émis de
   `pointerdown` sur le bouton : son `pointerup` ne trouve rien et n'active rien. Ce verrou
   est absolu, aucun réglage ne le contourne.
2. **Un délai de grâce** (`input.overlayGraceMs`, 400 ms) pendant lequel aucun appui n'est
   enregistré, avec un état visuel « pas encore prêt » qui s'estompe. Il couvre ce que le
   premier laisse passer : un **nouveau** doigt posé 30 ms après l'ouverture est un appui
   parfaitement postérieur, et pourtant pas une décision.

Deux détails qui ont coûté un aller-retour et qu'il ne faut pas refaire : la garde s'ouvre
sur `this.game.loop.time` et **jamais** sur `this.time.now`, qui vaut 0 pendant tout le
`create()` d'une scène neuve (le délai serait déjà écoulé) ; et `GameScene` repose l'item en
main **avant** de se mettre en pause, sinon il reste figé au milieu de l'écran.

### La file de déploiement

`DeployQueue` (`src/systems/DeployQueue.js`) est la **file d'attente visible** entre la
grille et le combat : `battle.slotCount` places, ordre FIFO, et une sortie chaque fois que
`battle.deployCooldownMs` s'écoule. Si la file est vide le cooldown reste prêt, donc la
prochaine unité tapée part immédiatement — on ne punit pas le joueur qui a laissé sa file
se vider. Si le champ de bataille est saturé (`battle.maxFieldUnits`), la sortie est
retenue **sans** consommer le cooldown, via le prédicat `canDeploy` injecté par la session.

### Le champ de bataille

`BattleModel` (`src/systems/BattleModel.js`) détient les unités, les ennemis, les PV de la
base et les vagues. Comme `GridModel` : aucune dépendance à Phaser, tout passe par le bus
(`enemySpawn`, `enemyDeath`, `enemyLeak`, `enemyAttack`, `unitSpawn`, `unitAttack`,
`unitDeath`, `baseDamage`, `waveStart`, `waveCleared`, `gameOver`… — liste complète en tête
du fichier).

- **Combat mutuel, plus de banc de tir.** Les unités entrent au bout « base » du couloir
  (progression `laneLength`) et **marchent** vers les ennemis, qui entrent à 0 et marchent
  vers la base. Chaque camp s'arrête quand un adversaire est à portée et frappe : les
  unités ont des PV et **meurent**. Une ligne d'unités retient donc une vague, et c'est en
  la brisant que les ennemis atteignent la base. Le `support` ne frappe jamais mais garde
  sa distance et projette son aura sur les alliés à `auraRadius` ; le `slow` ralentit en
  zone autour de sa cible.
- **Tick logique fixe.** `update(dtMs)` accumule le temps réel et exécute des pas de
  `battle.tickMs` (100 ms = 10 Hz). La simulation ne dépend donc pas du framerate et se
  rejoue à l'identique dans vitest. Le rendu **interpole** entre `prevProgress` et
  `progress` avec `model.alpha`, pour les deux camps. Au-delà de `maxTicksPerFrame`, le
  retard est jeté plutôt que rattrapé (onglet masqué).
- **Unités de couloir.** Le modèle ignore les pixels : tout le monde vit sur un axe de
  `battle.laneLength` unités. C'est `computeBattleZone()` / `lanePoint()`
  (`src/systems/layout.js`) qui convertit en pixels. Une portée dans `balance.json` veut
  donc dire la même chose sur tous les écrans.
- **File de types** (`src/systems/unitQueue.js`) : le type de la prochaine unité suit un
  motif déterministe de `balance.json`, affiché dans le HUD, et se fige **au tap**. Les
  items de la grille ne sont pas typés — c'est la file qui rend l'envoi planifiable. Depuis
  le Lot 3.5 elle montre **trois** types et se défausse d'un cran par le bouton « passer »
  (cooldown `battle.skipCooldownMs`) : voir puis ne rien pouvoir en faire n'était pas une
  décision.
- **Annonce de vague** : `BattleModel.wavePreview(wave)` rend la composition, la texture et
  la cadence de n'importe quelle vague, **formule infinie comprise** — l'annonce ne doit pas
  s'éteindre à la vague 11, c'est-à-dire au moment où la difficulté décolle. Elle est émise
  dans `waveCountdown` et lue en continu par `hud().countdown`.
- **Fusion d'unités ★ : retirée de la V1.** Elle appartenait au banc de tir statique, qui
  n'existe plus (on ne manipule plus rien sur la bande). Candidate à revenir après la V1,
  probablement en fusionnant **dans les slots de déploiement** plutôt que sur le champ.

### Mode debug

`?debug=1` dans l'URL allume tout l'outillage de réglage. Sans ce paramètre, l'écran est
celui que verra un joueur de Crazy Games. Le drapeau est lu par `isDebugEnabled()`
(`src/systems/debug.js`) ; tout nouvel affichage ou outil de debug passe derrière.

- **Ligne de diagnostic** : fps, merges, envois, pouvoirs dépensés, ticks logiques, ennemis,
  unités en place, file de déploiement, items sur la grille.
- **Panneau de boutons** (`src/scenes/DebugPanel.js`), tactile comme le reste :
  **vitesse ×1/×2/×4** (le temps du jeu est multiplié, la simulation reste à tick fixe),
  **vague +** (`BattleModel.skipWave()`), **base ∞** (`BattleModel.invincible`).
- **Ligne de diagnostic de fin de partie** sur l'écran de game over : durée, fuites, unités
  perdues, taps refusés (`GameSession.recap()`). Le **récap de build**, lui, est montré à
  tout le monde depuis le Lot 3.5 — améliorations prises, type d'unité qui a porté les
  dégâts, meilleur tier envoyé : c'est ce qui donne l'idée de build de la partie suivante,
  donc ce n'est pas un outil de réglage.

Le panneau **réserve sa place dans le layout** (`computeLayout({ debugRowPx })`) au lieu de
se poser par-dessus : en mode debug la grille descend d'une bande, et aucun bouton ne
recouvre jamais une case.

## Juice

Le feedback passe par une boîte à outils unique, `JuiceKit` (`src/render/juiceKit.js`),
possédée par `GameScene` et prêtée à `BattleView` : particules poolées, secousses de
caméra, vignette de dégâts, sons. Un seul exemplaire par partie — deux pools de particules
ou deux contextes audio mangeraient le budget de performance en doublons.

- **Particules** (`src/render/particles.js`) : pool **figé**, alloué au démarrage, un seul
  `Graphics` redessiné par frame. Rien n'est alloué pendant le jeu ; pool plein, la plus
  vieille particule est recyclée. C'est la règle de perf du Lot 3 — **aucune allocation
  dans la boucle de tick ni dans la boucle de rendu**.
- **Secousses** : `JuiceKit.shake()` étrangle lui-même les rafales (`shake.minIntervalMs`).
  Trois événements seulement secouent l'écran — dégâts à la base, mort d'un **tank**, game
  over. Si tout secouait, la secousse ne voudrait plus rien dire.
- **Sons** : synthétisés à l'exécution façon jsfxr (`src/systems/sfx.js`), zéro octet
  téléchargé, remplacés au Lot 5. Déverrouillés au premier `pointerdown` (politique des
  navigateurs), étranglés par son (`sfx.<nom>.minIntervalMs`), et le toggle du joueur
  persiste en `localStorage`.

## Commandes utiles

```bash
npm run dev      # serveur de dev Vite (exposé sur le réseau local pour le test téléphone)
npm test         # vitest, une passe
npm run sim      # harness d'équilibrage headless — rapport par politique
npm run assets   # découpe assets-src/ → public/assets/ + galerie (obligatoire après un asset)
npm run palette  # ré-extrait la palette partagée du pack de référence (à la main, jamais en CI)
npm run docs     # régénère les deux références depuis balance.json (obligatoire après réglage)
npm run build    # build de production dans dist/
npm run preview  # sert le build de production en local
npm run package  # zip de soumission Crazy Games (index.html à la racine), dans release/
```

```bash
npm run assets -- --check   # échoue si les sorties sont périmées (utilisé par le CI)
npm run assets -- --force   # réencode tout, même à empreinte inchangée
npm run docs -- --check     # même question pour docs/reference.md et docs/reference.en.md
```

```bash
npm run sim                          # 20 parties par politique, graine 1
npm run sim -- --games=50 --seed=7   # échantillon plus large, autre graine
npm run sim -- --policies=spam,prepare
npm run sim -- --matchups --tier=3   # quel type d'unité contre quelle texture de vague
npm run sim -- --json                # sortie machine, pour comparer deux réglages
```

Le rapport est **reproductible** : mêmes graines + même `balance.json` = mêmes chiffres.

## Structure

```
src/scenes/       scènes Phaser + vues (jeu, champ de bataille, barre de décision, draft,
                  aide, game over, panneau debug)
src/systems/      logique pure et testable (grille, file de déploiement, combat, session,
                  pouvoirs actifs, draft et modificateurs, gestes, vagues, spawner, layout,
                  répartition sur le champ, juice, sons, rng, préférences)
src/render/       greybox : formes d'items et de pouvoirs, couleurs, profondeurs,
                  particules, icônes de draft, boîte à juice, skin, décor de fond et lecture
                  des frames d'animation livrées par les packs
src/sim/          harness d'équilibrage headless (`npm run sim`) — politiques, bancs
                  d'essai, rapport, objectifs chiffrés
src/i18n/         dictionnaires EN/FR + moteur de traduction (`format.js`, sans dictionnaire)
src/tools/        générateur des références (`npm run docs`), pipeline d'assets
                  (`npm run assets`), zip de soumission (`npm run package`)
src/config/       balance.json + juice.json + credits.json, chacun avec son schéma documenté
assets-src/       **entrée unique des assets** : planches, audio, polices + manifest de découpe
                  + palette.json, la palette partagée **générée** par `npm run palette`
public/           fichiers copiés tels quels dans dist/ — dont `assets/` et `gallery/`,
                  **entièrement générés** par le pipeline
tests/            tests vitest
docs/seed.md      périmètre — source de vérité
docs/balance-notes.md  valeurs retenues, raisonnement, résultats du harness
docs/reference.md      référence **générée** (unités, pouvoirs, ennemis, vagues, améliorations)
docs/v1-1-ideas.md     salle d'attente : ce qui n'entre pas en V1
docs/audio.md          les 18 sons attendus, leurs noms de fichiers et leur format
docs/fonts.md          les 2 polices pixel attendues, leur convention de nom et leur licence
docs/release-checklist.md  checklist de release, exécutée et cochée
```

Règle de découpage : tout ce qui peut être testé sans Phaser vit dans `src/systems/` en
fonctions pures ; les scènes orchestrent et affichent.

## État des lots

- **Lot 0 — Squelette** ✅ Vite + Phaser, scène de validation, CI/CD GitHub Pages, tests.
- **Lot 1 — Grille de merge** ✅ `GridModel` pur + bus d'événements, spawner piloté par
  `balance.json`, drag souris/tactile (fusion, déplacement, retour animé), 11 tiers en
  greybox, place de la bande de combat réservée, compteur de merges de debug.
- **Lot 2 — Bande de combat** ✅ `BattleModel` pur à tick fixe 10 Hz (4 types d'unités,
  3 types d'ennemis, vagues scriptées puis formule infinie), pont `merge` → unité avec vol
  grille → bande, file de types visible, game over + record local + rejouer, mode
  `?debug=1`. Une partie complète se joue de bout en bout.
- **Lot 2.5 — Refonte du cœur** ✅ Le playtest du Lot 2 a montré deux défauts structurels :
  la bande en slots de tir se remplissait puis bloquait, et l'envoi automatique au merge
  ne laissait aucune décision. Le lot refond le pont et le combat : **tap pour envoyer,
  glisser pour fusionner**, file de déploiement à cooldown de sortie, combat mutuel où les
  unités marchent, frappent et meurent. La fusion d'unités ★ est retirée de la V1.
- **Lot 3 — Équilibrage & feel** ✅ Harness de simulation headless (`npm run sim`) et
  invariant « merger bat spammer » verrouillé par un test ; passe d'équilibrage complète
  (partie moyenne 3:37, première défaite vague 10, textures de vagues avec cadence propre) ;
  passe de juice intégrale pilotée par `juice.json` (squash de fusion, particules poolées,
  trajets grille → slot → couloir avec traînée, hit flash, recul, vignette, screenshake
  parcimonieux, SFX jsfxr synthétisés, toggle son) ; outils de debug (vitesse ×1/×2/×4,
  saut de vague, base invincible, récap de fin de partie). Valeurs et raisonnement :
  `docs/balance-notes.md`.
- **Lot 3.5 — Rythme, décisions & rejouabilité** ✅ Le playtest du Lot 3 a montré un jeu à
  **un seul régime** (urgence de grille permanente, information affichée mais inutilisable)
  et **rien qui motive une seconde partie**. Le lot installe une respiration et des choix :
  annonce de la composition de chaque vague (formule infinie comprise) avec compte à rebours
  de préparation ; file de types active — trois types visibles et un bouton « passer » ;
  **draft roguelite** toutes les 3 vagues, 11 améliorations en modificateurs par-dessus
  `balance.json` ; passe de tempo complète (ennemis −20 % de vitesse, pauses 4 s → 7 s,
  débit d'items ramené à l'équilibre) ; écran de fin qui raconte le build joué. Objectifs
  chiffrés re-validés sans les déplacer (3:47 de partie moyenne, défaite vague 9,7, merge
  bat spam ×1,93). Mesures : `docs/balance-notes.md`, section 7.
- **Lot 4 — Pouvoirs actifs** ✅ Dernière mécanique de la V1. Une **seconde famille d'items**
  sur la grille (silhouette ronde, couleur par type), qui se fusionne comme la première mais
  **jamais avec elle**, et se dépense d'un tap pour un effet immédiat : potion de soin (toutes
  les unités vivantes) et météorite (zone sur le groupe le plus menaçant, ciblage automatique
  télégraphié). `PowerSystem` pur et testé, contrat `usePower` ; deux cartes de draft
  (puissance et fréquence des pouvoirs) ; passe d'équilibrage complète — pouvoirs à 43 % des
  dégâts du joueur médian, `hpPerWave` relevé de 1,62 à 1,66 en face, objectifs chiffrés
  re-validés sans les déplacer (9,63 vagues, 4:06, merge bat spam ×1,47, pouvoirs +1,33
  vague). Mesures : `docs/balance-notes.md`, section 8.
- **Lot 5 — Habillage & publication** ✅ Dernier lot de la V1, construit **avant** l'arrivée
  des assets : pipeline `npm run assets` (découpe manifestée, détourage par propagation depuis
  les bords, atlas WebP, galerie de revue au damier, idempotence par empreinte des entrées) ;
  boucle CI opérable à 100 % depuis un téléphone (upload d'une planche → découpe → recommit →
  galerie) ; couche de skin où **un asset absent ne casse rien**, ce qui permet de livrer les
  planches par vagues ; localisation EN par défaut / FR au navigateur, tous les libellés
  sortis de `balance.json` ; banque audio à repli par son et musique respectant l'autoplay ;
  polices auto-hébergées ; page de crédits (CC BY des icônes) ; mode capture `?screenshot=1`
  avec gel de la scène ; zip de soumission produit et déposé en artefact de CI. Aucune valeur
  de gameplay touchée — les quatre objectifs chiffrés sont identiques au centième.
- **Lot 5.5 — Pivot pixel art** ✅ **Dernière décision de direction artistique du projet.** Le
  jeu passe en pixel art pour pouvoir mélanger de vrais packs et de la génération IA sans que
  l'écran devienne un patchwork. Thème fantasy et contenu du Lot 5 inchangés (i18n, audio,
  méta, soumission) ; seuls le rendu et le pipeline évoluent. Deux règles d'or actées comme
  contraintes permanentes — **résolution native unique de 16 px** (mesurée sur le pack de
  référence, pas lue dans le nom du fichier) et **palette partagée de 119 couleurs** extraite
  du même pack par `npm run palette` et committée. Le pipeline gagne une étape de
  **pixelisation** (réduction par moyenne de surface → seuillage alpha → quantification), les
  sources natives passent sans transformation et voient leurs teintes hors palette signalées,
  et l'atlas est encodé **sans perte** — sans quoi l'encodeur défaisait toute la chaîne à la
  dernière étape. Côté rendu : `pixelArt` + `roundPixels`, **mise à l'échelle entière** des
  sprites, ratio de rendu tronqué à l'entier, particules carrées sur la trame, polices bitmap
  à taille entière, interdiction des rotations continues sur sprite. La galerie montre chaque
  sprite à ×1 **et** ×4, plus la palette. Toute planche de pack exige sa ligne de crédit, qui
  remonte seule à l'écran de crédits. Aucune valeur de `balance.json` touchée : le jeu se joue
  exactement pareil, il ne se regarde plus pareil.

## Après la V1

**La V1 est close et part en Basic Launch.** Le périmètre gameplay l'était depuis le Lot 4 ;
depuis le Lot 5, le périmètre tout court l'est aussi — le pivot pixel art du Lot 5.5 est une
décision de **direction artistique**, pas un élargissement de périmètre : il ne change ni une
règle ni une valeur d'équilibrage. Il ne reste que des assets à déposer, un nom à écrire à un
seul endroit (`src/i18n/en.json` → `game.title`) et un clic sur le portail.

Toute idée ultérieure — la tienne, celle d'un playtest, celle d'un joueur — s'écrit dans
`docs/v1-1-ideas.md` et **attend les métriques**. C'est le point important : la V1 n'a encore
été jouée par personne d'autre que nous, et les chiffres du portail (taux de reprise, durée de
session, vague médiane) diront ce qui manque bien mieux qu'une intuition d'avant sortie.
Implémenter maintenant, c'est parier ; attendre trois semaines de données, c'est choisir.
