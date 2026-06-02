const { HTMLField } = foundry.data.fields;

/**
 * Data model for the Effect item type.
 *
 * Effect items are containers for Active Effects. When dragged onto an actor,
 * the item's embedded AEs are transferred directly to the actor — the item
 * itself is NOT added to the actor's inventory.
 *
 * This lets GMs author reusable conditions, buffs, and debuffs as items
 * in compendiums and drag them onto tokens/actors.
 */
export class EffectItemData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    return {
      description: new HTMLField({ required: true, blank: true })
    };
  }
}
