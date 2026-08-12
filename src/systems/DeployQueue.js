/**
 * `DeployQueue` — la file de déploiement entre la grille et le champ de bataille.
 * **Aucune dépendance à Phaser.**
 *
 * C'est le cœur du rythme posé au Lot 2.5 : un tap sur un item de la grille met une unité
 * **en file** (elle ne part pas tout de suite), et la file se vide **au rythme d'un
 * cooldown** — une unité en sort, entre sur le champ de bataille, et le timer repart.
 *
 * ```
 * tap ──emit `enqueueUnit`──▶ DeployQueue ──emit `deployUnit`──▶ BattleModel
 *                              (FIFO, cooldown de sortie)
 * ```
 *
 * Règles, toutes testables sans horloge (`update(dtMs)` prend le temps écoulé) :
 *
 *   - **FIFO** : la tête de file est la prochaine à partir, jamais une autre.
 *   - **Cooldown prêt sur file vide** : si rien n'attend, le compteur reste à zéro et la
 *     prochaine unité mise en file part immédiatement, puis le timer repart. Le joueur
 *     n'est jamais puni d'avoir laissé sa file se vider.
 *   - **File pleine** : la mise en file est refusée (`queueRejected`). Ce n'est jamais un
 *     blocage durable — la file se vide d'elle-même au cooldown suivant.
 *   - **Champ saturé** : `canDeploy()` (injecté, branché sur `BattleModel.canAcceptUnit`)
 *     retient la sortie sans consommer le cooldown, qui reste prêt.
 *
 * ## Événement consommé
 *   - `enqueueUnit` { tier, type, origin }
 *
 * ## Événements émis
 *   - `unitQueued`    { unit, position, origin }  l'unité prend sa place dans la file
 *   - `queueRejected` { reason, tier, type }      file pleine
 *   - `deployUnit`    { tier, type, unit, origin } la tête de file part au combat
 */

import { EventBus } from './eventBus.js';

export class DeployQueue {
  /**
   * @param {object} options
   * @param {object} options.config Config normalisée (`parseBattleConfig`) — y lit
   *   `slotCount` et `deployCooldownMs`
   * @param {EventBus} [options.bus] Bus partagé ; sinon la file en crée un
   * @param {() => boolean} [options.canDeploy] Feu vert du champ de bataille
   */
  constructor({ config, bus, canDeploy = () => true } = {}) {
    if (!config) throw new Error('DeployQueue attend une config');
    this.config = config;
    this.events = bus ?? new EventBus();
    this.canDeploy = canDeploy;
    this.reset();

    this.unsubscribe = this.events.on('enqueueUnit', ({ tier, type, origin }) =>
      this.enqueue(tier, type, origin)
    );
  }

  reset() {
    /** @type {{id: number, tier: number, type: string}[]} Slots occupés, tête en premier. */
    this.slots = [];
    /** Temps restant avant la prochaine sortie ; 0 = prêt. */
    this.cooldownMs = 0;
    this.nextId = 1;
  }

  /** Retire l'abonnement au bus. Appelé par `GameSession.destroy()`. */
  destroy() {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  // ------------------------------------------------------------------ lecture

  /** Nombre de places libres. */
  freeSlots() {
    return this.config.slotCount - this.slots.length;
  }

  /** Vrai si une unité de plus peut prendre place dans la file. */
  canAccept() {
    return this.slots.length < this.config.slotCount;
  }

  /** Unité en tête de file (la prochaine à partir), ou null. */
  head() {
    return this.slots[0] ?? null;
  }

  /**
   * Avancement de la jauge de sortie, de 0 (vient de partir) à 1 (prêt).
   * C'est ce que la vue affiche sur le slot de tête.
   */
  cooldownRatio() {
    const total = this.config.deployCooldownMs;
    if (total <= 0) return 1;
    return Math.min(1, Math.max(0, 1 - this.cooldownMs / total));
  }

  // ------------------------------------------------------------------ mutation

  /**
   * Met une unité en file. C'est le point d'entrée du tap, via `enqueueUnit`.
   *
   * @returns {object|null} L'unité mise en file, ou null si la file est pleine
   */
  enqueue(tier, type, origin = null) {
    if (!this.canAccept()) {
      this.events.emit('queueRejected', { reason: 'fileDeploiementPleine', tier, type });
      return null;
    }

    const unit = { id: this.nextId++, tier, type };
    this.slots.push(unit);
    this.events.emit('unitQueued', { unit, position: this.slots.length - 1, origin });

    // Cooldown prêt et file jusque-là vide : l'unité part sans attendre une frame.
    this.tryDeploy();
    return unit;
  }

  /**
   * Fait avancer le cooldown de sortie.
   *
   * @param {number} dtMs Temps réel écoulé
   * @returns {object|null} L'unité sortie pendant cet appel, ou null
   */
  update(dtMs) {
    if (!Number.isFinite(dtMs) || dtMs <= 0) return this.tryDeploy();
    if (this.cooldownMs > 0) this.cooldownMs = Math.max(0, this.cooldownMs - dtMs);
    return this.tryDeploy();
  }

  /**
   * Sort la tête de file si tout est réuni : cooldown prêt, file non vide, champ de
   * bataille disposé à l'accueillir.
   *
   * @returns {object|null} L'unité sortie, ou null
   */
  tryDeploy() {
    if (this.cooldownMs > 0 || this.slots.length === 0) return null;
    // Champ saturé : on **ne consomme pas** le cooldown, la sortie reprend dès qu'une
    // place se libère. Sans ça, le cap de sécurité deviendrait une punition invisible.
    if (!this.canDeploy()) return null;

    const unit = this.slots.shift();
    this.cooldownMs = this.config.deployCooldownMs;
    this.events.emit('deployUnit', {
      tier: unit.tier,
      type: unit.type,
      unit,
      origin: { kind: 'deploy' },
    });
    return unit;
  }
}

export default DeployQueue;
