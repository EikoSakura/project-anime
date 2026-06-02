/**
 * Custom Combatant document for Shards of Mana.
 * Tracks per-turn movement state via system flags.
 */
export class ShardsCombatant extends Combatant {

  /**
   * Reset movement tracking for a new turn.
   * Called at the start of each combatant's turn.
   */
  async resetMovement() {
    await this.setFlag("shards-of-mana", "hasMoved", false);
    await this.setFlag("shards-of-mana", "distanceMoved", 0);
  }

  /**
   * Record that this combatant has moved and track the distance.
   * @param {number} distance - Distance moved in grid squares
   */
  async markMoved(distance) {
    const previous = this.getFlag("shards-of-mana", "distanceMoved") ?? 0;
    await this.setFlag("shards-of-mana", "hasMoved", true);
    await this.setFlag("shards-of-mana", "distanceMoved", previous + distance);
  }

  /** @returns {boolean} Whether this combatant has moved this turn */
  get hasMoved() {
    return this.getFlag("shards-of-mana", "hasMoved") ?? false;
  }

  /** @returns {number} Total distance moved this turn in grid squares */
  get distanceMoved() {
    return this.getFlag("shards-of-mana", "distanceMoved") ?? 0;
  }
}
