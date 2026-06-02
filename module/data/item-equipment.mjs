const { ArrayField, BooleanField, HTMLField, NumberField, SchemaField, StringField } = foundry.data.fields;

/**
 * Data model for the Equipment item type.
 */
export class EquipmentData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    return {
      description: new HTMLField({ required: true, blank: true }),
      slot: new StringField({ required: true, initial: "weapon" }),
      weaponGroup: new StringField({ required: true, blank: true }),
      armorCategory: new StringField({ required: true, blank: true }),
      rank: new StringField({ required: true, initial: "F" }),

      // Handedness: one-handed (default), two-handed, oversized
      handedness: new StringField({ required: true, initial: "one-handed" }),

      // STR requirement for oversized weapons (0 = no requirement)
      strRequirement: new NumberField({ required: true, integer: true, initial: 0 }),

      // Custom penalties applied when wielding an oversized weapon without meeting STR requirement
      oversizedPenalties: new SchemaField({
        acc: new NumberField({ required: true, integer: true, initial: 0 }),
        eva: new NumberField({ required: true, integer: true, initial: 0 })
      }),

      // Base accuracy (d100 hit chance before stat differential) — weapons/offhand only
      baseAccuracy: new NumberField({ required: true, integer: true, min: 0, max: 99, initial: 50 }),

      // Flat damage bonuses added at roll time (not baked into derived stats)
      pDmg: new NumberField({ required: true, integer: true, initial: 0 }),
      mDmg: new NumberField({ required: true, integer: true, initial: 0 }),

      // Stat bonuses from this equipment
      statBonuses: new SchemaField({
        str: new NumberField({ required: true, integer: true, initial: 0 }),
        agi: new NumberField({ required: true, integer: true, initial: 0 }),
        vit: new NumberField({ required: true, integer: true, initial: 0 }),
        mag: new NumberField({ required: true, integer: true, initial: 0 }),
        spi: new NumberField({ required: true, integer: true, initial: 0 }),
        per: new NumberField({ required: true, integer: true, initial: 0 }),
        lck: new NumberField({ required: true, integer: true, initial: 0 }),
        chm: new NumberField({ required: true, integer: true, initial: 0 })
      }),

      // Gold value (price for character creation shopping)
      goldValue: new NumberField({ required: true, integer: true, min: 0, initial: 0 }),

      // Properties (e.g. "Reach", "Elemental", etc.)
      properties: new ArrayField(new StringField()),

      // Whether this equipment is currently equipped
      equipped: new BooleanField({ initial: false })
    };
  }

  /**
   * Whether this is a weapon.
   * @type {boolean}
   */
  get isWeapon() {
    return this.slot === "weapon";
  }

  /**
   * Whether this is armor (armor or helm).
   * @type {boolean}
   */
  get isArmor() {
    return this.slot === "armor" || this.slot === "helm";
  }

  /**
   * Whether this weapon requires two hands (two-handed or oversized).
   * @type {boolean}
   */
  get isTwoHanded() {
    return this.handedness === "two-handed" || this.handedness === "oversized";
  }

  prepareDerivedData() {
    super.prepareDerivedData();
  }
}
