import { BaseActorData } from "./base-actor.mjs";

const { NumberField, SchemaField, StringField } = foundry.data.fields;

/**
 * Data model for the NPC actor type.
 * Simplified humanoid — full stat block but no advancement (XP, growth, jobs).
 */
export class NpcData extends BaseActorData {

  static defineSchema() {
    return {
      ...super.defineSchema(),

      // Identity
      lineage: new StringField({ required: true, blank: true, initial: "" }),
      occupation: new StringField({ required: true, blank: true, initial: "" }),
      rank: new StringField({ required: true, initial: "F" }),

      // Disposition toward the party
      disposition: new StringField({ required: true, initial: "neutral" }),

      // GM-facing notes
      gmNotes: new StringField({ required: true, blank: true, initial: "" }),

      // Movement modes
      movementModes: new SchemaField({
        walk: new NumberField({ required: true, integer: true, min: 0, initial: 1 }),
        fly: new NumberField({ required: true, integer: true, min: 0, initial: 0 }),
        swim: new NumberField({ required: true, integer: true, min: 0, initial: 0 }),
        climb: new NumberField({ required: true, integer: true, min: 0, initial: 0 }),
        burrow: new NumberField({ required: true, integer: true, min: 0, initial: 0 }),
        teleport: new NumberField({ required: true, integer: true, min: 0, initial: 0 })
      })
    };
  }

  /** @override */
  prepareDerivedData() {
    super.prepareDerivedData();
    this.health.value = Math.clamp(this.health.value, 0, this.health.max);
    this.mana.value = Math.clamp(this.mana.value, 0, this.mana.max);
  }
}
