const { ArrayField, BooleanField, HTMLField, NumberField, SchemaField, StringField } = foundry.data.fields;

/**
 * Data model for the Party actor type.
 * Standalone (no BaseActorData) — no stats, no combat, no health/mana.
 * Manages party membership, shared treasury, and quest log.
 */
export class PartyData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    return {
      // Identity
      motto: new StringField({ required: true, blank: true, initial: "" }),
      biography: new HTMLField({ required: true, blank: true }),
      gmNotes: new StringField({ required: true, blank: true, initial: "" }),

      // Treasury
      gold: new NumberField({ required: true, integer: true, min: 0, initial: 0 }),

      // Members
      members: new ArrayField(new SchemaField({
        actorUuid: new StringField({ required: true }),
        img: new StringField({ required: false, blank: true, initial: "icons/svg/mystery-man.svg" }),
        name: new StringField({ required: true, blank: true, initial: "" }),
        role: new StringField({ required: false, blank: true, initial: "" }),
        joinDate: new StringField({ required: false, blank: true, initial: "" }),
        notes: new StringField({ required: false, blank: true, initial: "" })
      })),

      // Quest Log
      quests: new ArrayField(new SchemaField({
        id: new StringField({ required: true }),
        title: new StringField({ required: true, blank: true, initial: "New Quest" }),
        description: new StringField({ required: false, blank: true, initial: "" }),
        status: new StringField({ required: true, initial: "active" }),
        priority: new StringField({ required: true, initial: "normal" }),
        rewards: new StringField({ required: false, blank: true, initial: "" }),
        objectives: new ArrayField(new SchemaField({
          text: new StringField({ required: true, blank: true, initial: "" }),
          completed: new BooleanField({ initial: false })
        })),
        gmNotes: new StringField({ required: false, blank: true, initial: "" })
      }))
    };
  }

  /** @override */
  prepareDerivedData() {
    super.prepareDerivedData();
    this.questCounts = { active: 0, completed: 0, failed: 0 };
    for (const q of this.quests) {
      if (this.questCounts[q.status] !== undefined) this.questCounts[q.status]++;
    }
  }
}
