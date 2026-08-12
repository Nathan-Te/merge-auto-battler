import Phaser from 'phaser';

import { DEPTH } from '../render/depths.js';
import { DEBUG_SPEEDS } from '../systems/debug.js';
import { sceneTextResolution } from '../render/hiDpi.js';

/**
 * Panneau d'outils d'équilibrage — **visible uniquement sous `?debug=1`**.
 *
 * Trois boutons, pensés pour le réglage au doigt sur téléphone (c'est là qu'on règle) :
 *
 *   - **vitesse ×1 / ×2 / ×4** : voir une vague 12 en trente secondes ;
 *   - **vague suivante** : sauter une vague déjà comprise pour atteindre celle qu'on règle ;
 *   - **base invincible** : observer une vague de bout en bout sans mourir au milieu.
 *
 * Le panneau ne décide de rien : il appelle les rappels que lui donne `GameScene`, qui les
 * transmet au modèle. Comme partout, les boutons passent par les événements de pointeur —
 * ils fonctionnent au doigt comme à la souris.
 */

const COLORS = {
  button: 0x232a3d,
  buttonActive: 0x4d96ff,
  stroke: 0x3d4666,
  text: '#eef1f8',
  textActive: '#12141c',
};

const FONT = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

export class DebugPanel {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} handlers
   * @param {(speed: number) => void} handlers.onSpeed
   * @param {() => void} handlers.onSkipWave
   * @param {() => boolean} handlers.onToggleInvincible Rend le nouvel état
   */
  constructor(scene, { onSpeed, onSkipWave, onToggleInvincible }) {
    this.scene = scene;
    this.speed = DEBUG_SPEEDS[0];
    this.invincible = false;

    this.buttons = [
      ...DEBUG_SPEEDS.map((speed) =>
        this.makeButton(`×${speed}`, () => {
          this.speed = speed;
          onSpeed(speed);
          this.refresh();
        })
      ),
      this.makeButton('vague +', () => onSkipWave()),
      this.makeButton('base ∞', () => {
        this.invincible = onToggleInvincible();
        this.refresh();
      }),
    ];

    this.refresh();
  }

  makeButton(label, onPress) {
    const scene = this.scene;
    const box = scene.add
      .rectangle(0, 0, 10, 10, COLORS.button, 1)
      .setStrokeStyle(1, COLORS.stroke, 1)
      .setDepth(DEPTH.hud)
      .setInteractive({ useHandCursor: true });
    const text = scene.add
      .text(0, 0, label, { fontFamily: FONT, color: COLORS.text })
      .setOrigin(0.5, 0.5)
      .setDepth(DEPTH.hud + 1)
      .setResolution(sceneTextResolution(this));

    box.on('pointerup', onPress);
    return { box, text, label };
  }

  /**
   * Range les boutons dans la bande que `computeLayout` **réserve** au debug, juste sous
   * l'en-tête. La grille descend d'autant : le panneau ne recouvre jamais une case, ce
   * qui rendrait la première rangée intappable au doigt.
   */
  layout(layoutData) {
    const row = layoutData.debugRow;
    const count = this.buttons.length;
    const gap = Math.max(3, Math.round(row.height * 0.16));
    const buttonWidth = Math.floor((row.width - gap * (count - 1)) / count);
    const buttonHeight = Math.max(16, Math.round(row.height * 0.78));
    const fontSize = Phaser.Math.Clamp(Math.round(buttonHeight * 0.46), 8, 13);

    const top = row.y;

    this.buttons.forEach((button, index) => {
      const cx = row.x + buttonWidth / 2 + index * (buttonWidth + gap);
      const cy = top + buttonHeight / 2;
      button.box.setPosition(cx, cy).setSize(buttonWidth, buttonHeight);
      button.box.input?.hitArea?.setTo(0, 0, buttonWidth, buttonHeight);
      button.text.setFontSize(fontSize).setPosition(cx, cy);
    });
  }

  /** Met en évidence la vitesse courante et l'état d'invincibilité. */
  refresh() {
    this.buttons.forEach((button) => {
      const isSpeed = button.label.startsWith('×');
      const active = isSpeed
        ? button.label === `×${this.speed}`
        : button.label === 'base ∞' && this.invincible;
      button.box.setFillStyle(active ? COLORS.buttonActive : COLORS.button, 1);
      button.text.setColor(active ? COLORS.textActive : COLORS.text);
    });
  }

  destroy() {
    for (const button of this.buttons) {
      button.box.removeAllListeners();
      button.box.destroy();
      button.text.destroy();
    }
    this.buttons = [];
  }
}

export default DebugPanel;
