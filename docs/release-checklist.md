# Checklist de release — V1, Basic Launch

État au **12 août 2026**, fin du Lot 5.

Trois marques, et elles ne veulent pas dire la même chose :

- **[x]** vérifié, avec la trace de la vérification ;
- **[ ]** à faire, et **par qui** — ce qui reste tient à des assets non encore livrés ou à un
  appareil réel ;
- **[~]** vérifié **partiellement**, avec la limite dite explicitement. Une case cochée à
  moitié est plus dangereuse qu'une case vide : elle est donc marquée à part.

> Le navigateur automatisé utilisé ici (Chromium sans GPU) rend en **rendu logiciel**.
> Il vaut pour « ça marche, ça n'a pas d'erreur, ça ne demande rien à l'extérieur ». Il ne
> vaut **rien** pour les images par seconde. Tout ce qui touche à la performance porte donc
> la marque `[ ]` et attend un vrai téléphone.

## 1. Le jeu tourne

- [x] **Démarrage sans erreur console**, mobile (390×780) et desktop (1280×800), en anglais
      comme en français. Vérifié sur le build de production servi par `npm run preview`.
- [x] **Deux gestes fonctionnels** : le tap envoie une unité en file, le glisser fusionne,
      déplace ou échange. Vérifié par 661 tests unitaires et par une passe au pointeur sur
      le build.
- [x] **Aide et crédits** : le « ? » ouvre l'aide par-dessus la partie gelée, le lien
      « Crédits » ouvre la page par-dessus l'aide, et la fermer revient **à l'aide** et non
      au jeu.
- [x] **Rejouer** repart d'un état neuf — aucun modificateur de draft, aucun écouteur ne
      survit (`GameSession.destroy()`, verrouillé par `tests/draftSession.test.js`).
- [ ] **Deux parties complètes jusqu'au game over, sur un vrai téléphone.** *(Nathan)* La
      seule chose que ni les tests ni le harness ne remplacent : le confort du doigt sur la
      grille, la lisibilité du bandeau en plein soleil, la tenue de la batterie.

## 2. Performance

- [ ] **60 fps en charge** (vague 10+, cap d'unités atteint, particules), sur un téléphone
      milieu de gamme. *(Nathan)* Non vérifiable ici : le rendu logiciel du navigateur
      automatisé plafonne à ~30 fps sur une scène vide, ce qui ne mesure rien.
      Le levier en cas de problème est `render.maxPixelRatio` dans `juice.json` — **jamais**
      une taille de police ou un rayon dans une scène (cf. `CLAUDE.md`).
- [x] **Aucune allocation dans la boucle** : pool de particules figé, HUD réécrit seulement
      sur changement de signature, tracés recyclés. Inchangé depuis le Lot 3.
- [x] **Chargement en deux passes** : l'index d'assets d'abord, les atlas ensuite. Un atlas
      manquant n'empêche pas le démarrage.

## 3. Poids

- [x] **Sous le budget.** Build actuel : **1,30 Mo** décompressé, **353 Ko** en archive.
      Cible 10 Mo, limite dure 20 Mo. Les assets pèsent aujourd'hui **0 o** : le poids est
      celui de Phaser (~1,35 Mo minifié, ~360 Ko gzip).
- [x] **Le CI échoue au-delà de 20 Mo** et avertit au-delà de 10 Mo, sur le poids réel de
      `dist/`. Un seul point d'application, sur ce qui est vraiment téléchargé.
- [ ] **Repeser après livraison des assets.** *(automatique)* Le rapport est en tête de la
      galerie et dans le résumé de chaque build.
- [ ] **Chargement < 3 s** sur réseau mobile réel. *(Nathan)*

## 4. Textes

- [x] **Anglais par défaut, français si le navigateur est en français.** `?lang=fr` et
      `?lang=en` forcent l'un ou l'autre.
- [x] **Aucun texte affiché en dur** : un test échoue si un identifiant de `balance.json`
      n'a pas son libellé dans les **deux** langues (`tests/i18n.test.js`), et un autre si la
      référence générée contient une clé brute.
- [x] **Les deux dictionnaires couvrent exactement les mêmes clés.**
- [~] **Relecture des textes EN et FR.** Écrits et cohérents, mais **non relus par un
      tiers** ; l'anglais n'est pas ma langue maternelle. *(Nathan : relire, notamment les
      descriptions de cartes de draft, qui sont ce qu'on lit pour décider.)*

## 5. Son

- [x] **Le jeu n'est jamais muet** : chaque son a sa version synthétisée, et un fichier livré
      la remplace sans toucher au code.
- [x] **Le toggle son persiste** en `localStorage`, et survit à « rejouer » comme au
      rechargement.
- [x] **La musique ne démarre pas avant un geste** — contrat du navigateur, et vérifié par
      `tests/audioBank.test.js`.
- [ ] **Écouter les 18 sons en contexte, au casque et au haut-parleur de téléphone.**
      *(Nathan, à la livraison des sons)* Le seul réglage à faire ensuite est
      `sound.categories.music`, le rapport musique/effets.

## 6. Assets

- [x] **Le pipeline tourne de bout en bout** : découpe, détourage, rognage, atlas WebP,
      index, galerie. Vérifié sur une planche de test (8 sprites, atlas 256×256, 4,3 Ko),
      retirée depuis.
- [x] **Idempotent** : deux exécutions consécutives ne produisent aucun diff.
- [x] **Le détourage ne troue pas les sprites** : un blanc enfermé dans le dessin survit
      (test dédié, et vérification sur pixels réels).
- [x] **La galerie annonce les manques** : 52 sprites attendus, 0 fournis à ce jour.
- [ ] **Déposer les planches, les sons, les polices.** *(Nathan)* Voir
      `assets-src/README.md`, `assets-src/manifest.md` et `docs/audio.md`.
- [ ] **Revoir chaque sprite dans la galerie** (détourage, cadrage, poids). *(Nathan)*

## 7. Confidentialité et conformité

- [x] **Aucune requête externe.** Vérifié au navigateur : toutes les requêtes visent le
      domaine du jeu. Les polices sont auto-hébergées, les sons sont synthétisés ou servis
      localement, aucune police Google, aucun CDN, aucune analytique.
- [x] **`localStorage` seulement** : record local et préférence de son. Aucune donnée
      personnelle, conforme au seed doc.
- [x] **Page de crédits en place**, avec la licence des icônes.
- [ ] **Lister les auteurs des icônes réellement utilisées** dans `src/config/credits.json`.
      *(Nathan)* **C'est une condition de la licence CC BY, pas une politesse** : une icône
      utilisée sans son auteur est une non-conformité.

## 8. Build et soumission

- [x] **Build de production testé** via `npm run preview` — c'est le build servi qui a été
      vérifié au navigateur, pas le serveur de développement.
- [x] **Zip de soumission produit**, `index.html` **à la racine** de l'archive (la faute
      classique qui fait refuser l'archive sans explication). Galerie et métadonnées
      internes exclues.
- [x] **Le CI dépose le zip en artefact** à chaque build : récupérable depuis un téléphone.
- [x] **Tests, harness et référence verts**, objectifs chiffrés inchangés.
- [ ] **Vignette, description EN et catégorie** sur le portail. *(Nathan)* Voir la section
      « Publication » du README.
- [ ] **Nom définitif.** *(Nathan)* Il n'est écrit **qu'à un seul endroit** :
      `src/i18n/en.json` → `game.title` (et son équivalent français). Le titre de l'onglet et
      l'écran de chargement le suivent automatiquement ; seul le favicon est à redessiner.

## 9. Objectifs chiffrés — inchangés

Mesurés par `npm run sim` (20 parties par politique, graine 1) sur le `balance.json` livré :

| objectif | seuil | mesuré | verdict |
| --- | --- | --- | --- |
| première défaite | vagues 8-12 | **9,45** | ✔ |
| durée de partie | 3:00-5:00 | **3:53** | ✔ |
| « merger bat spammer » | ≥ ×1,4 | **×1,45** | ✔ |
| « les pouvoirs se voient » | ≥ +0,5 vague | **+1,20** | ✔ |

Le Lot 5 n'a touché **aucune** valeur de gameplay, et ce n'est pas une affirmation mais une
conséquence vérifiable : `balance.json` est **numériquement identique** au Lot 4.5 une fois
les libellés retirés, et `juice.json` n'a fait que gagner des clés (quatre sons, deux volumes
de catégorie) sans qu'aucune valeur existante ne bouge.
