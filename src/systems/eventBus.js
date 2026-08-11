/**
 * Bus d'événements minimal, sans dépendance à Phaser.
 *
 * C'est le seul canal entre la logique pure (`GridModel`, spawner) et le rendu :
 * le modèle n'appelle jamais la scène, il émet. Le Lot 2 (bande de combat) se
 * branchera dessus sans toucher au modèle — voir le contrat `merge` documenté
 * dans `CLAUDE.md`.
 *
 * Volontairement plus petit que l'émetteur de Phaser : il doit tourner dans
 * vitest, sans canvas ni DOM.
 */
export class EventBus {
  constructor() {
    /** @type {Map<string, Function[]>} */
    this.listeners = new Map();
  }

  /**
   * Abonne un écouteur.
   *
   * @param {string} type Nom de l'événement
   * @param {Function} fn Écouteur, appelé avec la charge utile
   * @returns {() => void} Fonction de désabonnement (pratique au `shutdown` d'une scène)
   */
  on(type, fn) {
    if (typeof fn !== 'function') throw new TypeError('EventBus.on attend une fonction');
    const list = this.listeners.get(type);
    if (list) list.push(fn);
    else this.listeners.set(type, [fn]);
    return () => this.off(type, fn);
  }

  /** Abonne un écouteur qui se retire après son premier appel. */
  once(type, fn) {
    const wrapper = (payload) => {
      this.off(type, wrapper);
      fn(payload);
    };
    return this.on(type, wrapper);
  }

  /** Retire un écouteur. Sans effet s'il n'était pas abonné. */
  off(type, fn) {
    const list = this.listeners.get(type);
    if (!list) return;
    const index = list.indexOf(fn);
    if (index !== -1) list.splice(index, 1);
    if (list.length === 0) this.listeners.delete(type);
  }

  /**
   * Émet un événement. La liste est copiée avant parcours : un écouteur peut se
   * désabonner (ou en abonner un autre) pendant l'émission sans casser la boucle.
   */
  emit(type, payload) {
    const list = this.listeners.get(type);
    if (!list || list.length === 0) return;
    for (const fn of [...list]) fn(payload);
  }

  /** Retire tout, un type donné ou l'intégralité du bus. */
  clear(type) {
    if (type === undefined) this.listeners.clear();
    else this.listeners.delete(type);
  }

  /** Nombre d'écouteurs abonnés à un type (utilisé par les tests). */
  listenerCount(type) {
    return this.listeners.get(type)?.length ?? 0;
  }
}

export default EventBus;
