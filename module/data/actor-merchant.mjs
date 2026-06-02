const { ArrayField, HTMLField, NumberField, SchemaField, StringField } = foundry.data.fields;

/**
 * Data model for the Merchant actor type.
 * Shop-focused — no stats, no combat. Just a storefront with inventory.
 */
export class MerchantData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    return {
      // Size (token grid size)
      size: new NumberField({ required: true, min: 0.5, initial: 1 }),

      // Identity
      shopName: new StringField({ required: true, blank: true, initial: "" }),
      location: new StringField({ required: true, blank: true, initial: "" }),

      // Flavor text
      biography: new HTMLField({ required: true, blank: true }),

      // GM notes
      gmNotes: new StringField({ required: true, blank: true, initial: "" }),

      // Shop inventory entries
      inventory: new ArrayField(new SchemaField({
        itemId: new StringField({ required: true }),
        name: new StringField({ required: true, blank: true }),
        price: new NumberField({ required: true, integer: true, min: 0, initial: 0 }),
        stock: new NumberField({ required: true, integer: true, min: -1, initial: -1 }),
        available: new NumberField({ required: true, integer: true, min: 0, max: 1, initial: 1 })
      })),

      // Shop settings
      buyRate: new NumberField({ required: true, min: 0, max: 1, initial: 0.5 }),
      willBuy: new NumberField({ required: true, integer: true, min: 0, max: 1, initial: 1 }),
      restockInterval: new StringField({ required: true, initial: "none" })
    };
  }

  /** @override */
  prepareDerivedData() {
    super.prepareDerivedData();
    this.availableCount = this.inventory.filter(
      e => e.available === 1 && (e.stock === -1 || e.stock > 0)
    ).length;
  }

  /**
   * All currently purchasable inventory entries.
   * @type {object[]}
   */
  get availableInventory() {
    return this.inventory.filter(
      e => e.available === 1 && (e.stock === -1 || e.stock > 0)
    );
  }
}
