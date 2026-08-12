import Phaser from 'phaser';

import juiceConfig from '../config/juice.json';
import creditsConfig from '../config/credits.json';
import { parseJuiceConfig } from '../systems/juice.js';
import { OverlayGuard } from '../systems/overlayGuard.js';
import { DEPTH } from '../render/depths.js';
import { sceneTextResolution } from '../render/hiDpi.js';
import { t } from '../i18n/index.js';

/**
 * Page **Crédits** — atteinte depuis le panneau d'aide, lancée par-dessus lui.
 *
 * Ce n'est pas une politesse : les icônes de game-icons.net sont sous **CC BY 3.0**, dont
 * l'attribution est la condition d'usage, et la fiche de soumission Crazy Games demande de
 * déclarer l'origine des assets. Une page de crédits absente est une non-conformité, pas un
 * détail de finition — d'où sa place dans le Lot 5 au même titre que le poids du build.
 *
 * Le contenu vient de `src/config/credits.json` : ce sont des **noms propres**, ils ne se
 * traduisent pas et n'ont donc rien à faire dans `src/i18n/`. Seuls les intitulés de section
 * sont traduits. Une liste vide fait disparaître sa section, pour que la page ne promette
 * jamais des crédits qui n'existent pas encore.
 *
 * Comme tout écran qui s'ouvre par-dessus le jeu, elle utilise `OverlayGuard` : le patron
 * est décrit dans `CLAUDE.md`, et il n'a pas d'exception.
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

const FONT = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

export default class CreditsScene extends Phaser.Scene {
  constructor() {
    super('CreditsScene');
  }

  /**
   * @param {{graceMs: number, returnTo: string,
   *          juice: import('../render/juiceKit.js').JuiceKit}} data
   */
  init(data) {
    this.graceMs = data?.graceMs ?? 0;
    /** Scène à réveiller en fermant : l'aide, d'où l'on vient. */
    this.returnTo = data?.returnTo ?? 'HelpScene';
    this.juice = data?.juice ?? null;
    this.juiceConfig = parseJuiceConfig(juiceConfig);
    this.guard = new OverlayGuard({ graceMs: this.graceMs });
    this.closing = false;
  }

  /** Même horloge que les autres overlays : celle de la boucle, jamais `this.time.now`. */
  now() {
    return this.game.loop.time;
  }

  textResolution() {
    return sceneTextResolution(this);
  }

  /**
   * Les blocs de la page, dans l'ordre. Une section sans contenu est **omise** plutôt que
   * rendue vide : tant qu'aucun son n'est livré, la page ne parle pas de crédits audio.
   */
  buildSections() {
    const sections = [];
    const list = (entries) =>
      entries
        .map((entry) =>
          [entry.name, entry.license, entry.url].filter(Boolean).join(' · ')
        )
        .join('\n');

    const icons = creditsConfig.icons ?? {};
    if (icons.source) {
      const authors = icons.authors ?? [];
      sections.push({
        title: t('credits.iconsTitle'),
        body: [
          t('credits.icons'),
          [icons.source, icons.license, icons.url].filter(Boolean).join(' · '),
          // Le cœur de l'obligation CC BY : les noms, pas seulement le site.
          authors.length > 0 ? authors.join(', ') : t('credits.noneYet'),
        ].join('\n'),
      });
    }

    if ((creditsConfig.art ?? []).length > 0) {
      sections.push({ title: t('credits.artTitle'), body: list(creditsConfig.art) });
    }
    if ((creditsConfig.audio ?? []).length > 0) {
      sections.push({ title: t('credits.audioTitle'), body: list(creditsConfig.audio) });
    }
    if ((creditsConfig.fonts ?? []).length > 0) {
      sections.push({ title: t('credits.fontsTitle'), body: list(creditsConfig.fonts) });
    }

    sections.push({
      title: t('credits.made'),
      body: creditsConfig.engine ?? '',
      plain: true,
    });
    return sections;
  }

  create() {
    this.guard.open(this.now());

    this.veil = this.add
      .rectangle(0, 0, 10, 10, COLORS.veil, 0.96)
      .setOrigin(0, 0)
      .setDepth(DEPTH.banner)
      .setInteractive();

    this.panel = this.add
      .rectangle(0, 0, 10, 10, COLORS.panel, 1)
      .setStrokeStyle(2, COLORS.panelStroke, 0.9)
      .setDepth(DEPTH.banner + 1);

    this.titleText = this.label(t('credits.title'), {
      fontStyle: 'bold',
      color: COLORS.accent,
    }).setOrigin(0.5, 0);

    this.rows = this.buildSections().map((section) => ({
      title: section.plain
        ? null
        : this.label(section.title, { fontStyle: 'bold', color: COLORS.accent }).setOrigin(0, 0),
      body: this.label(section.plain ? `${section.title} ${section.body}` : section.body, {
        color: COLORS.textDim,
        align: 'left',
      }).setOrigin(0, 0),
    }));

    this.button = this.add
      .rectangle(0, 0, 10, 10, COLORS.button, 1)
      .setDepth(DEPTH.banner + 2)
      .setInteractive({ useHandCursor: true });
    this.buttonText = this.label(t('credits.close'), { fontStyle: 'bold', color: '#12141c' });
    this.buttonText.setDepth(DEPTH.banner + 3);

    this.button.on('pointerover', () => this.button.setFillStyle(COLORS.buttonHover, 1));
    this.button.on('pointerout', (pointer) => {
      this.button.setFillStyle(COLORS.button, 1);
      this.guard.cancel(pointer.id);
    });
    this.button.on('pointerdown', (pointer) => this.guard.press(pointer.id, this.button, this.now()));
    this.button.on('pointerup', (pointer) => {
      if (this.guard.release(pointer.id, this.button)) this.close();
    });
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

    this.panel.setScale(0.92);
    this.tweens.add({
      targets: this.panel,
      scale: 1,
      duration: this.juiceConfig.draft.cardInMs,
      ease: 'Back.easeOut',
    });
  }

  label(content, style) {
    return this.add
      .text(0, 0, content, { fontFamily: FONT, align: 'center', ...style })
      .setOrigin(0.5, 0.5)
      .setDepth(DEPTH.banner + 2)
      .setResolution(this.textResolution());
  }

  close() {
    if (this.closing) return;
    this.closing = true;
    this.guard.close();
    this.juice?.play('tap');
    // On revient à l'aide, pas au jeu : elle est en pause derrière, et c'est de là qu'on
    // est venu. Sauter directement au jeu laisserait le panneau d'aide figé pour toujours.
    this.scene.resume(this.returnTo);
    this.scene.stop();
  }

  handleResize(gameSize) {
    this.layout(gameSize.width, gameSize.height);
  }

  /**
   * Compose la page de haut en bas, en deux passes — même raison que `HelpScene` : la
   * hauteur d'un texte enroulé n'est connue qu'une fois sa police et sa largeur posées.
   */
  layout(width, height) {
    if (!(width > 0) || !(height > 0)) return;
    this.veil.setSize(width, height);
    this.veil.input?.hitArea?.setTo(0, 0, width, height);

    const panelWidth = Phaser.Math.Clamp(Math.min(width * 0.92, 460), 200, 460);
    const pad = Math.round(panelWidth * 0.06);
    const innerWidth = panelWidth - pad * 2;
    const maxHeight = height * 0.94 - pad * 2;

    let body = Phaser.Math.Clamp(Math.round(panelWidth * 0.036), 9, 15);
    let metrics = this.measure(body, innerWidth);
    for (let attempt = 0; attempt < 3 && metrics.contentHeight > maxHeight && body > 8; attempt += 1) {
      const shrunk = Math.floor(body * Math.max(0.75, maxHeight / metrics.contentHeight));
      body = Math.max(8, Math.min(body - 1, shrunk));
      metrics = this.measure(body, innerWidth);
    }

    const { gap, buttonHeight, contentHeight } = metrics;
    const panelHeight = Math.min(height * 0.94, contentHeight + pad * 2);
    const cx = width / 2;
    const cy = height / 2;
    this.panel.setPosition(cx, cy).setSize(panelWidth, panelHeight);

    const left = cx - panelWidth / 2 + pad;
    let y = cy - panelHeight / 2 + pad;

    this.titleText.setPosition(cx, y);
    y += this.titleText.height + gap;

    for (const row of this.rows) {
      if (row.title) {
        row.title.setPosition(left, y);
        y += row.title.height + gap * 0.4;
      }
      row.body.setPosition(left, y);
      y += row.body.height + gap;
    }

    const buttonWidth = panelWidth * 0.5;
    const buttonY = cy + panelHeight / 2 - buttonHeight / 2 - pad * 0.5;
    this.button.setPosition(cx, buttonY).setSize(buttonWidth, buttonHeight);
    this.button.input?.hitArea?.setTo(0, 0, buttonWidth, buttonHeight);
    this.buttonText.setFontSize(Math.round(buttonHeight * 0.4)).setPosition(cx, buttonY);
  }

  /** Passe de mesure : pose les polices et les largeurs, rend les hauteurs qui en découlent. */
  measure(body, innerWidth) {
    const heading = Math.round(body * 1.4);
    const gap = Math.round(body * 0.85);

    this.titleText.setFontSize(heading);
    let contentHeight = this.titleText.height + gap;

    for (const row of this.rows) {
      if (row.title) {
        row.title.setFontSize(Math.round(heading * 0.78));
        contentHeight += row.title.height + gap * 0.4;
      }
      row.body.setFontSize(body).setWordWrapWidth(innerWidth);
      contentHeight += row.body.height + gap;
    }

    const buttonHeight = Math.max(34, Math.round(body * 2.8));
    return { body, heading, gap, buttonHeight, contentHeight: contentHeight + buttonHeight + gap };
  }
}
