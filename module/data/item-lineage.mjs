const { ArrayField, BooleanField, HTMLField, NumberField, SchemaField, StringField } = foundry.data.fields;

/**
 * Data model for the Lineage item type.
 *
 * A Lineage defines what kind of body a character has — size, how it moves,
 * and one to three innate physical capabilities. Each trait can carry Active
 * Effects that provide mechanical backing (e.g. darkvision, natural armor).
 *
 * Power, resistances, and growth come from the Mana Grid, equipment, and jobs.
 * Lineage is your starting shape, not your stat block.
 */
export class LineageData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    return {
      description: new HTMLField({ required: true, blank: true }),

      // Base size for this lineage
      size: new NumberField({ required: true, min: 0.5, initial: 1 }),

      // Movement modes this lineage innately grants (physical body capabilities only)
      movementModes: new SchemaField({
        walk: new BooleanField({ initial: false }),
        fly: new BooleanField({ initial: false }),
        swim: new BooleanField({ initial: false }),
        climb: new BooleanField({ initial: false }),
        burrow: new BooleanField({ initial: false })
      }),

      // Innate traits — 1-3 descriptive physical capabilities of this body.
      // Each trait has a stable ID so Active Effects can link to it.
      innateTraits: new ArrayField(new SchemaField({
        id: new StringField({ required: true, blank: false }),
        name: new StringField({ required: true, blank: false }),
        description: new StringField({ required: true, blank: true, initial: "" })
      }), { initial: [] })
    };
  }

  /**
   * Get the number of innate traits.
   * @type {number}
   */
  get traitCount() {
    return this.innateTraits.length;
  }

  /** @override */
  static migrateData(source) {
    // Strip removed fields silently
    if (source.tree) delete source.tree;
    if (source.elementResistances) delete source.elementResistances;
    if (source.conditionResistances) delete source.conditionResistances;
    // Strip teleport from movement modes (no longer a lineage trait)
    if (source.movementModes?.teleport !== undefined) {
      delete source.movementModes.teleport;
    }
    // Backfill stable IDs on traits that predate this field
    if (Array.isArray(source.innateTraits)) {
      for (const trait of source.innateTraits) {
        if (!trait.id) trait.id = foundry.utils.randomID();
      }
    }
    return super.migrateData(source);
  }

  prepareDerivedData() {
    super.prepareDerivedData();
  }
}
