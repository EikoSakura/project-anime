import { BaseActorData } from "./base-actor.mjs";

const { ArrayField, BooleanField, NumberField, SchemaField, StringField } = foundry.data.fields;

/**
 * Data model for the Monster actor type.
 * Monsters own skill items (same as adventurers) — no inline actions array.
 */
export class MonsterData extends BaseActorData {

  static defineSchema() {
    return {
      ...super.defineSchema(),

      // Identity
      rank: new StringField({ required: true, initial: "F" }),
      speciesTags: new ArrayField(new StringField()),

      // Movement modes
      movementModes: new SchemaField({
        walk: new NumberField({ required: true, integer: true, min: 0, initial: 1 }),
        fly: new NumberField({ required: true, integer: true, min: 0, initial: 0 }),
        swim: new NumberField({ required: true, integer: true, min: 0, initial: 0 }),
        climb: new NumberField({ required: true, integer: true, min: 0, initial: 0 }),
        burrow: new NumberField({ required: true, integer: true, min: 0, initial: 0 }),
        teleport: new NumberField({ required: true, integer: true, min: 0, initial: 0 })
      }),

      // Gold drops (range)
      goldMin: new NumberField({ required: true, integer: true, min: 0, initial: 0 }),
      goldMax: new NumberField({ required: true, integer: true, min: 0, initial: 0 }),

      // Drop table
      dropTable: new ArrayField(new SchemaField({
        manaciteName: new StringField({ required: true }),
        manaciteRank: new StringField({ required: true, initial: "" }), // "" = use monster rank
        dropChance: new NumberField({ required: true, min: 0, max: 100, initial: 10 }),
        quantity: new NumberField({ required: true, integer: true, min: 1, initial: 1 })
      })),

      // Whether drops have already been rolled for this monster (prevents double-rolling)
      dropsRolled: new BooleanField({ initial: false }),

      // Behavior priority (ordered list of AI behaviors)
      behaviorPriority: new ArrayField(new StringField()),

      // Note: element resistances (percentage-based) are inherited from BaseActorData.elementResistances
      // Monsters may also have plant/poison resistances via that shared schema
    };
  }

  /** @override */
  prepareDerivedData() {
    super.prepareDerivedData();
    this.health.value = Math.clamp(this.health.value, 0, this.health.max);
    this.mana.value = Math.clamp(this.mana.value, 0, this.mana.max);
  }
}
