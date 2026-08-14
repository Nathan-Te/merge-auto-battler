import Phaser from 'phaser';

import { loadAtlases } from '../render/skin.js';
import { FONTS, installFonts, pixelFontSize } from '../render/fonts.js';
import { t } from '../i18n/index.js';

/**
 * Scène d'amorçage — elle charge les assets **générés**, puis passe la main au jeu.
 *
 * Elle existe pour une raison, et une seule : `public/assets/index.json` n'est connu qu'à
 * l'exécution. Le pipeline le réécrit à chaque planche livrée, et le jeu ne peut pas
 * l'importer à la compilation sans figer la liste des atlas dans le bundle — ce qui
 * obligerait à rebuilder le code pour ajouter un sprite, et casserait la promesse « une
 * planche déposée arrive en jeu en une commande ».
 *
 * ## Trois façons d'échouer, trois fois sans conséquence
 *
 * Le jeu doit démarrer même si **rien** n'est livré, et c'est ce qui permet de recevoir les
 * assets par vagues :
 *
 *   - `index.json` absent (aucune planche encore déposée) → on démarre en greybox ;
 *   - un atlas annoncé mais introuvable → il est ignoré, `Skin.has()` s'en aperçoit et le
 *     greybox reprend la main pour ces sprites-là seulement ;
 *   - un son introuvable → `AudioBank` retombe sur la synthèse du Lot 3.
 *
 * Aucun de ces cas n'affiche d'erreur au joueur : ce sont des états normaux de la
 * production, pas des pannes.
 *
 * ## Pourquoi si peu d'écran de chargement
 *
 * Le seed doc impose un **démarrage direct** et un chargement sous 3 s. Un logo animé de
 * deux secondes coûterait exactement ce qu'on cherche à économiser. Il n'y a donc qu'un
 * titre et une barre, et sur une connexion correcte personne ne les verra.
 */

const COLORS = {
  background: 0x12141c,
  bar: 0x4d96ff,
  barTrack: 0x2c3350,
  text: '#eef1f8',
};

/** Où le pipeline publie ses sorties, relativement à la page. */
const ASSET_BASE = 'assets/';

export default class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  preload() {
    this.buildSplash();

    // Les erreurs de chargement sont **avalées** : un fichier manquant fait retomber le jeu
    // sur son greybox, il ne l'empêche pas de démarrer (cf. l'en-tête).
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file) => {
      console.warn(`Asset introuvable, greybox conservé : ${file.key}`);
    });
    this.load.on(Phaser.Loader.Events.PROGRESS, (value) => this.setProgress(value));

    this.load.json('asset-index', `${ASSET_BASE}index.json`);
  }

  create() {
    const index = this.cache.json.get('asset-index') ?? null;
    // L'index est partagé par le registre : toutes les scènes construisent leur `Skin`
    // dessus, sans le recharger ni se le passer de main en main.
    this.registry.set('assetIndex', index);

    installFonts(index, ASSET_BASE);

    const atlasCount = index?.atlases?.length ?? 0;
    const audioCount = index?.audio?.length ?? 0;
    if (atlasCount === 0 && audioCount === 0) {
      this.startGame();
      return;
    }

    // Seconde passe : on ne pouvait pas la déclarer avant d'avoir lu l'index.
    loadAtlases(this, index, ASSET_BASE);
    for (const file of index?.audio ?? []) {
      // **Binaire et non `load.audio`** : `AudioBank` décode les échantillons dans le
      // contexte que possède déjà le synthétiseur, pour n'avoir qu'un seul `AudioContext`,
      // un seul gain maître et un seul étranglement (cf. `src/systems/audio.js`).
      // La clé est le nom du fichier sans extension : pas de table de correspondance à
      // entretenir, donc rien qui puisse dériver.
      this.load.binary(file.replace(/\.[^.]+$/, ''), `${ASSET_BASE}audio/${file}`);
    }

    this.load.once(Phaser.Loader.Events.COMPLETE, () => this.startGame());
    this.load.start();
  }

  startGame() {
    this.scene.start('GameScene');
  }

  buildSplash() {
    const { width, height } = this.scale.gameSize;
    this.cameras.main.setBackgroundColor(COLORS.background);

    this.titleText = this.add
      .text(width / 2, height / 2 - 24, t('game.title'), {
        fontFamily: FONTS.display,
        fontStyle: 'bold',
        color: COLORS.text,
        fontSize: `${pixelFontSize(Phaser.Math.Clamp(Math.round(Math.min(width, height) * 0.06), 16, 34))}px`,
      })
      .setOrigin(0.5, 0.5);

    const barWidth = Math.min(width * 0.6, 280);
    this.track = this.add
      .rectangle(width / 2, height / 2 + 18, barWidth, 4, COLORS.barTrack)
      .setOrigin(0.5, 0.5);
    this.bar = this.add
      .rectangle(width / 2 - barWidth / 2, height / 2 + 18, 1, 4, COLORS.bar)
      .setOrigin(0, 0.5);
    this.barWidth = barWidth;
  }

  setProgress(value) {
    if (this.bar?.active) this.bar.width = Math.max(1, this.barWidth * value);
  }
}
