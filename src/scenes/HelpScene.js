import Phaser from 'phaser';

import juiceConfig from '../config/juice.json';
import { parseJuiceConfig } from '../systems/juice.js';
import { OverlayGuard } from '../systems/overlayGuard.js';
import { createVisual, repaintVisual } from '../render/visuals.js';
import { Skin } from '../render/skin.js';
import { FONTS, pixelFontSize } from '../render/fonts.js';
import { DEPTH } from '../render/depths.js';
import { sceneTextResolution } from '../render/hiDpi.js';
import { t } from '../i18n/index.js';

/**
 * Panneau d'aide — le « ? » de l'en-tête. Lancé par-dessus `GameScene` **mise en pause**,
 * comme `DraftScene` et `GameOverScene`.
 *
 * Constat du playtest : aucune interface ne disait ce que font les quatre types d'unités,
 * ni à quel rythme revient le draft. Le joueur découvrait les règles en perdant. Trois
 * blocs, aucun de plus — un panneau d'aide qu'on ferme sans avoir fini de lire n'aide
 * personne :
 *
 *   1. les **deux gestes** (taper / glisser), qui sont tout le jeu ;
 *   2. les **quatre types d'unités**, forme greybox et rôle en une ligne ;
 *   3. les **pouvoirs** — la règle « rond = pouvoir, tap pour utiliser », puis une ligne par
 *      pouvoir (Lot 4). Sans elle, un joueur découvre la seconde famille en la dépensant
 *      par accident, exactement ce que la silhouette ronde cherche à éviter ;
 *   4. le **rythme** : file de types, bouton « passer », draft toutes les N vagues.
 *
 * Les libellés et les nombres viennent de la session (donc de `balance.json`) : le panneau
 * ne peut pas annoncer un draft toutes les 3 vagues si le fichier en dit 4.
 *
 * Il réutilise `OverlayGuard` : un panneau d'aide ne prend rien au joueur, mais son bouton
 * « fermer » tombe sous le doigt au même endroit que la grille, et la même protection
 * évite de le refermer par le geste qui l'a ouvert.
 */

const COLORS = {
  veil: 0x0a0c12,
  panel: 0x191d2a,
  panelStroke: 0x4d96ff,
  button: 0x4d96ff,
  buttonHover: 0x6aa8ff,
  text: '#eef1f8',
  textDim: '#8f97b0',
  accent: '#ffd93d',
};

export default class HelpScene extends Phaser.Scene {
  constructor() {
    super('HelpScene');
  }

  /**
   * @param {{units: string[], powers: string[], draftEveryWaves: number,
   *          skipCooldownMs: number, graceMs: number, onClose: () => void,
   *          juice: import('../render/juiceKit.js').JuiceKit}} data
   */
  init(data) {
    this.units = data?.units ?? [];
    this.powers = data?.powers ?? [];
    this.draftEveryWaves = data?.draftEveryWaves ?? 0;
    this.skipSeconds = Math.round((data?.skipCooldownMs ?? 0) / 1000);
    this.onClose = data?.onClose ?? (() => {});
    this.juice = data?.juice ?? null;
    this.juiceConfig = parseJuiceConfig(juiceConfig);
    this.graceMs = data?.graceMs ?? 0;
    this.guard = new OverlayGuard({ graceMs: this.graceMs });
    this.closing = false;
  }

  /** Même horloge que `DraftScene` : celle de la boucle, pas celle de la scène. */
  now() {
    return this.game.loop.time;
  }

  textResolution() {
    return sceneTextResolution(this);
  }

  create() {
    this.guard.open(this.now());
    // Le panneau est une scène à part : il construit son propre `Skin` sur le même index.
    // Les textures, elles, sont globales — rien n'est chargé deux fois.
    this.skin = new Skin(this, this.registry.get('assetIndex'));

    this.veil = this.add
      .rectangle(0, 0, 10, 10, COLORS.veil, 0.94)
      .setOrigin(0, 0)
      .setDepth(DEPTH.banner)
      .setInteractive();

    this.panel = this.add
      .rectangle(0, 0, 10, 10, COLORS.panel, 1)
      .setStrokeStyle(2, COLORS.panelStroke, 0.9)
      .setDepth(DEPTH.banner + 1);

    // Tous les blocs sont ancrés **en haut à gauche** : le panneau se compose de haut en
    // bas et sa hauteur se déduit de son contenu. Ancrer au milieu ferait déborder les
    // textes multi-lignes par-dessus le bloc précédent — ce qui est exactement ce qui
    // arrivait avant.
    this.titleText = this.label(t('help.title'), {
      fontStyle: 'bold',
      color: COLORS.accent,
    }).setOrigin(0.5, 0);

    this.gestureText = this.label(t('help.gestures'), {
      color: COLORS.text,
      align: 'left',
    }).setOrigin(0, 0);

    this.unitsTitle = this.label(t('help.unitsTitle'), {
      fontStyle: 'bold',
      color: COLORS.accent,
    }).setOrigin(0, 0);

    /** Une ligne par type : forme à gauche, rôle à droite. Le panneau reçoit des
     * identifiants de type et va chercher lui-même son texte : c'est la règle du Lot 5. */
    this.unitRows = this.units.map((type) => ({
      unit: { type },
      shape: createVisual(this, this.skin, { kind: 'unit', type, tier: 1 }, 24).setDepth(
        DEPTH.banner + 2
      ),
      text: this.label(
        t('help.row', { label: t(`units.${type}.label`), role: t(`units.${type}.blurb`) }),
        { color: COLORS.text, align: 'left' }
      ).setOrigin(0, 0),
    }));

    this.powersTitle = this.label(t('help.powersTitle'), {
      fontStyle: 'bold',
      color: COLORS.accent,
    }).setOrigin(0, 0);

    // La règle avant les pouvoirs eux-mêmes : c'est la silhouette qui doit rester en tête,
    // pas la liste. Un joueur qui retient « rond = pouvoir » n'en dépensera pas un par
    // erreur, même s'il a oublié lequel fait quoi.
    this.powersRule = this.label(t('help.powersRule'), {
      color: COLORS.text,
      align: 'left',
    }).setOrigin(0, 0);

    /** Une ligne par pouvoir, même grammaire que les unités : forme puis rôle. */
    this.powerRows = this.powers.map((type) => ({
      power: { type },
      shape: createVisual(this, this.skin, { kind: 'power', type, tier: 1 }, 24).setDepth(
        DEPTH.banner + 2
      ),
      text: this.label(
        t('help.row', { label: t(`powers.${type}.label`), role: t(`powers.${type}.blurb`) }),
        { color: COLORS.text, align: 'left' }
      ).setOrigin(0, 0),
    }));

    this.rhythmText = this.label(
      t('help.rhythm', { seconds: this.skipSeconds, waves: this.draftEveryWaves }),
      { color: COLORS.textDim, align: 'left' }
    ).setOrigin(0, 0);

    this.button = this.add
      .rectangle(0, 0, 10, 10, COLORS.button, 1)
      .setDepth(DEPTH.banner + 2)
      .setInteractive({ useHandCursor: true });
    this.buttonText = this.label(t('help.close'), { fontStyle: 'bold', color: '#12141c' });
    this.buttonText.setDepth(DEPTH.banner + 3);

    // Les crédits sont **obligatoires** (icônes en CC BY, fiche du portail) : ils doivent
    // être atteignables sans menu, et l'aide est le seul écran que le joueur ouvre de son
    // plein gré. Discret à côté de « reprendre », pour ne pas concurrencer la sortie.
    this.creditsText = this.label(t('help.credits'), { color: COLORS.textDim })
      .setOrigin(0.5, 0.5)
      .setInteractive({ useHandCursor: true });
    this.creditsText.on('pointerdown', (pointer) =>
      this.guard.press(pointer.id, this.creditsText, this.now())
    );
    this.creditsText.on('pointerup', (pointer) => {
      if (this.guard.release(pointer.id, this.creditsText)) this.openCredits();
    });

    this.button.on('pointerover', () => this.button.setFillStyle(COLORS.buttonHover, 1));
    this.button.on('pointerout', (pointer) => {
      this.button.setFillStyle(COLORS.button, 1);
      this.guard.cancel(pointer.id);
    });
    this.button.on('pointerdown', (pointer) => this.guard.press(pointer.id, this.button, this.now()));
    this.button.on('pointerup', (pointer) => {
      if (this.guard.release(pointer.id, this.button)) this.close();
    });
    // Fermer en tapant à côté aussi : sur téléphone, viser un bouton pour sortir d'une aide
    // qu'on a ouverte par curiosité est une friction inutile.
    this.veil.on('pointerdown', (pointer) => this.guard.press(pointer.id, this.veil, this.now()));
    this.veil.on('pointerup', (pointer) => {
      if (this.guard.release(pointer.id, this.veil)) this.close();
    });

    this.scale.on('resize', this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.handleResize, this);
    });

    const { width, height } = this.scale.gameSize;
    this.layout(width, height);

    this.panel.setScale(0.9);
    this.tweens.add({
      targets: this.panel,
      scale: 1,
      duration: this.juiceConfig.draft.cardInMs,
      ease: 'Back.easeOut',
    });
  }

  label(content, style) {
    return this.add
      .text(0, 0, content, { fontFamily: FONTS.body, align: 'center', ...style })
      .setOrigin(0.5, 0.5)
      .setDepth(DEPTH.banner + 2)
      .setResolution(this.textResolution());
  }

  /**
   * Ouvre les crédits **par-dessus l'aide**, et met l'aide en pause.
   *
   * On empile plutôt qu'on ne remplace : fermer les crédits doit ramener au panneau d'aide,
   * pas au jeu. Un joueur venu lire les crédits n'a pas demandé à reprendre la partie.
   */
  openCredits() {
    this.juice?.play('button');
    this.scene.launch('CreditsScene', {
      graceMs: this.graceMs,
      returnTo: 'HelpScene',
      juice: this.juice,
    });
    this.scene.pause();
  }

  close() {
    if (this.closing) return;
    this.closing = true;
    this.guard.close();
    this.juice?.play('button');
    this.onClose();
    this.scene.resume('GameScene');
    this.scene.stop();
  }

  handleResize(gameSize) {
    this.layout(gameSize.width, gameSize.height);
  }

  /**
   * Applique une taille de corps à tous les blocs et rend les hauteurs qui en découlent.
   *
   * Écrire dans les objets de texte pour **mesurer** est assumé : la hauteur d'un texte
   * enroulé n'est connue de Phaser qu'une fois la police et la largeur posées. La passe de
   * placement réutilise ensuite ces valeurs, sans les recalculer.
   */
  measure(body, innerWidth) {
    const heading = Math.round(body * 1.42);
    const gap = Math.round(body * 0.9);
    // Les formes sont dessinées au tier 1 : le panneau parle des **types**, et un liseré de
    // tier élevé y ajouterait une information dont il n'est pas question ici.
    const iconSize = Math.round(body * 1.8);
    const textLeftOffset = iconSize * 1.5;

    this.titleText.setFontSize(pixelFontSize(heading));
    this.gestureText.setFontSize(pixelFontSize(body)).setWordWrapWidth(innerWidth);
    this.unitsTitle.setFontSize(pixelFontSize(Math.round(heading * 0.78)));
    this.powersTitle.setFontSize(pixelFontSize(Math.round(heading * 0.78)));
    for (const row of [...this.unitRows, ...this.powerRows]) {
      row.text.setFontSize(pixelFontSize(body)).setWordWrapWidth(innerWidth - textLeftOffset);
    }
    this.powersRule.setFontSize(pixelFontSize(body)).setWordWrapWidth(innerWidth);
    this.rhythmText.setFontSize(pixelFontSize(Math.round(body * 0.95))).setWordWrapWidth(innerWidth);

    const rowHeights = this.unitRows.map((row) => Math.max(iconSize, row.text.height));
    const powerRowHeights = this.powerRows.map((row) => Math.max(iconSize, row.text.height));
    const buttonHeight = Math.max(34, Math.round(body * 2.8));
    // Le lien des crédits vit **dans** le panneau, sous le bouton : sa hauteur entre donc
    // dans le calcul, sinon il déborderait par le bas sur un écran court.
    const creditsHeight = Math.round(body * 1.9);
    const contentHeight =
      this.titleText.height +
      gap +
      this.gestureText.height +
      gap * 1.4 +
      this.unitsTitle.height +
      gap * 0.8 +
      rowHeights.reduce((sum, value) => sum + value + gap * 0.7, 0) +
      gap * 0.8 +
      this.powersTitle.height +
      gap * 0.6 +
      this.powersRule.height +
      gap * 0.6 +
      powerRowHeights.reduce((sum, value) => sum + value + gap * 0.7, 0) +
      gap * 0.8 +
      this.rhythmText.height +
      gap * 1.2 +
      buttonHeight +
      creditsHeight;

    return {
      body,
      heading,
      gap,
      iconSize,
      textLeftOffset,
      rowHeights,
      powerRowHeights,
      buttonHeight,
      creditsHeight,
      contentHeight,
    };
  }

  /**
   * Compose le panneau de haut en bas, **en deux passes** : on fixe d'abord les polices et
   * les largeurs de retour à la ligne, ce qui donne la hauteur réelle de chaque bloc ; on
   * en déduit la hauteur du panneau, puis on place tout.
   *
   * Une seule passe ne suffit pas : la hauteur d'un texte dépend de son enroulement, donc
   * de sa police, et le panneau doit contenir exactement ce qu'il contient — sur un écran
   * de 320 px comme sur une tablette.
   */
  layout(width, height) {
    if (!(width > 0) || !(height > 0)) return;
    this.veil.setSize(width, height);
    this.veil.input?.hitArea?.setTo(0, 0, width, height);

    const panelWidth = Phaser.Math.Clamp(Math.min(width * 0.92, 460), 200, 460);
    const pad = Math.round(panelWidth * 0.06);
    const innerWidth = panelWidth - pad * 2;

    // --- passe 1 : mesurer, en resserrant tant que ça ne tient pas en hauteur.
    //
    // En paysage sur un téléphone, la hauteur disponible est bien plus petite que la
    // largeur : à taille de police confortable le panneau déborde, et un panneau d'aide
    // tronqué est pire que pas d'aide du tout. On resserre plutôt que de couper.
    const maxHeight = height * 0.94 - pad * 2;
    let body = Phaser.Math.Clamp(Math.round(panelWidth * 0.037), 9, 15);
    let metrics = this.measure(body, innerWidth);

    for (let attempt = 0; attempt < 3 && metrics.contentHeight > maxHeight && body > 8; attempt += 1) {
      const shrunk = Math.floor(body * Math.max(0.75, maxHeight / metrics.contentHeight));
      body = Math.max(8, Math.min(body - 1, shrunk));
      metrics = this.measure(body, innerWidth);
    }

    const {
      heading,
      gap,
      iconSize,
      textLeftOffset,
      rowHeights,
      powerRowHeights,
      buttonHeight,
      creditsHeight,
      contentHeight,
    } = metrics;
    const panelHeight = Math.min(height * 0.94, contentHeight + pad * 2);
    const cx = width / 2;
    const cy = height / 2;
    this.panel.setPosition(cx, cy).setSize(panelWidth, panelHeight);

    // --- passe 2 : placement, dans l'ordre de lecture.
    const left = cx - panelWidth / 2 + pad;
    let y = cy - panelHeight / 2 + pad;

    this.titleText.setPosition(cx, y);
    y += this.titleText.height + gap;

    this.gestureText.setPosition(left, y);
    y += this.gestureText.height + gap * 1.4;

    this.unitsTitle.setPosition(left, y);
    y += this.unitsTitle.height + gap * 0.8;

    this.unitRows.forEach((row, index) => {
      repaintVisual(row.shape, this.skin, { kind: 'unit', type: row.unit.type, tier: 1 }, iconSize);
      // La forme s'aligne sur la **première ligne** du texte, pas sur son milieu : sur une
      // description de trois lignes, une icône centrée paraîtrait décrocher.
      row.shape.setPosition(left + iconSize / 2, y + body * 0.6);
      row.text.setPosition(left + textLeftOffset, y);
      y += rowHeights[index] + gap * 0.7;
    });

    y += gap * 0.1;
    this.powersTitle.setPosition(left, y);
    y += this.powersTitle.height + gap * 0.6;

    this.powersRule.setPosition(left, y);
    y += this.powersRule.height + gap * 0.6;

    this.powerRows.forEach((row, index) => {
      // Le tier 1 comme pour les unités : le panneau parle des **types**, pas des tiers.
      repaintVisual(row.shape, this.skin, { kind: 'power', type: row.power.type, tier: 1 }, iconSize);
      row.shape.setPosition(left + iconSize / 2, y + body * 0.6);
      row.text.setPosition(left + textLeftOffset, y);
      y += powerRowHeights[index] + gap * 0.7;
    });

    y += gap * 0.1;
    this.rhythmText.setPosition(left, y);

    const buttonWidth = panelWidth * 0.5;
    const buttonY = cy + panelHeight / 2 - buttonHeight / 2 - pad * 0.5 - creditsHeight;
    this.button.setPosition(cx, buttonY).setSize(buttonWidth, buttonHeight);
    this.button.input?.hitArea?.setTo(0, 0, buttonWidth, buttonHeight);
    this.buttonText.setFontSize(pixelFontSize(Math.round(buttonHeight * 0.4))).setPosition(cx, buttonY);

    // Le lien des crédits se range **dans** le panneau, sous le bouton : posé dessous, il
    // tomberait hors du panneau sur un écran court, là où le panneau occupe déjà 94 % de la
    // hauteur.
    this.creditsText
      .setFontSize(pixelFontSize(Math.max(9, Math.round(body * 0.85))))
      .setPosition(cx, cy + panelHeight / 2 - pad * 0.5 - creditsHeight / 2);
    this.creditsText.input?.hitArea?.setTo(
      0,
      0,
      this.creditsText.width,
      this.creditsText.height
    );
  }
}
