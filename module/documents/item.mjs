/**
 * Custom Item document class for Shards of Mana.
 */
export class ShardsItem extends Item {

  /** @override */
  prepareData() {
    super.prepareData();
  }

  /** @override */
  prepareDerivedData() {
    super.prepareDerivedData();
  }

  /**
   * Roll this item (if it has a damage formula or relevant roll).
   * @returns {Promise<Roll|null>}
   */
  async roll() {
    const formula = this.system.damageFormula || this.system.damage?.formula;
    if (!formula) {
      // No rollable formula — just post the item to chat
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        flavor: this.name,
        content: this.system.description || this.system.effect || ""
      });
      return null;
    }

    const roll = new Roll(formula);
    await roll.evaluate();
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      flavor: this.name
    });
    return roll;
  }
}
