const { ArrayField, BooleanField, HTMLField, NumberField, SchemaField, SetField, StringField } = foundry.data.fields;

/**
 * Data model for the Job item type.
 *
 * Jobs are grid-socketed keystones that define an adventurer's class identity.
 * When socketed into the Mana Grid, they unlock branch skill sockets,
 * grant proficiencies, and determine HP/MP scaling (primary job only).
 * Jobs advance in rank (F→S) via XP siphon.
 */
export class JobData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    return {
      description: new HTMLField({ required: true, blank: true }),
      rank: new StringField({ required: true, initial: "F" }),
      category: new StringField({ required: true, initial: "basic", choices: ["basic", "advanced", "hybrid", "special"] }),

      // School / affinity — determines which Mana Grid branch sockets this job unlocks
      school: new StringField({ required: true, initial: "general" }),

      // Whether this job is currently socketed into a Mana Grid job socket
      socketed: new BooleanField({ initial: false }),

      // Cumulative XP absorbed from adventurer via siphon (for rank advancement)
      jobXp: new NumberField({ required: true, integer: true, min: 0, initial: 0 }),

      // Base resource values (system formula: baseHp + VIT*2, baseMp + SPI*2)
      baseHp: new NumberField({ required: true, integer: true, min: 0, initial: 10 }),
      baseMp: new NumberField({ required: true, integer: true, min: 0, initial: 5 }),

      // Proficiencies — sets of allowed weapon groups and armor categories
      weaponProficiencies: new SetField(new StringField()),
      armorProficiencies: new SetField(new StringField()),

      // Growth rate modifiers per stat (added to base growth rates)
      growthRateModifiers: new SchemaField({
        str: new NumberField({ required: true, integer: true, initial: 0 }),
        agi: new NumberField({ required: true, integer: true, initial: 0 }),
        vit: new NumberField({ required: true, integer: true, initial: 0 }),
        mag: new NumberField({ required: true, integer: true, initial: 0 }),
        spi: new NumberField({ required: true, integer: true, initial: 0 }),
        per: new NumberField({ required: true, integer: true, initial: 0 }),
        lck: new NumberField({ required: true, integer: true, initial: 0 }),
        chm: new NumberField({ required: true, integer: true, initial: 0 })
      }),

      // Prerequisites — requirements to socket this job (AND logic)
      prerequisites: new ArrayField(new SchemaField({
        skillName: new StringField({ required: true, blank: false }),
        minLevel: new NumberField({ required: true, integer: true, min: 1, max: 5, initial: 1 })
      })),

      // Limit Break (available from Rank D)
      limitBreak: new SchemaField({
        name: new StringField({ required: true, blank: true }),
        description: new HTMLField({ blank: true }),
        effect: new StringField({ blank: true })
      }),

      // Mastery Bonus (Rank S)
      masteryBonus: new SchemaField({
        description: new StringField({ blank: true }),
        growthRateIncrease: new SchemaField({
          str: new NumberField({ integer: true, initial: 0 }),
          agi: new NumberField({ integer: true, initial: 0 }),
          vit: new NumberField({ integer: true, initial: 0 }),
          mag: new NumberField({ integer: true, initial: 0 }),
          spi: new NumberField({ integer: true, initial: 0 }),
          per: new NumberField({ integer: true, initial: 0 }),
          lck: new NumberField({ integer: true, initial: 0 }),
          chm: new NumberField({ integer: true, initial: 0 })
        })
      })
    };
  }

  /** @override */
  static migrateData(source) {
    // Strip removed tree field from existing data
    if (source.tree != null) delete source.tree;
    return super.migrateData(source);
  }

  prepareDerivedData() {
    super.prepareDerivedData();

    // Job XP siphon progress
    const thresholds = CONFIG.SHARDS?.jobXpThresholds ?? {};
    const rankOrder = ["F", "E", "D", "C", "B", "A", "S"];
    const currentIdx = rankOrder.indexOf(this.rank);
    const nextRank = rankOrder[currentIdx + 1];
    const nextThreshold = thresholds[nextRank];
    const currentThreshold = currentIdx > 0 ? (thresholds[rankOrder[currentIdx]] ?? 0) : 0;

    if (nextThreshold == null || this.rank === "S") {
      this.xpToNextRank = 0;
      this.xpProgress = 100;
      this.isMaxRank = true;
    } else {
      const xpInBand = this.jobXp - currentThreshold;
      const bandSize = nextThreshold - currentThreshold;
      this.xpToNextRank = Math.max(0, nextThreshold - this.jobXp);
      this.xpProgress = bandSize > 0 ? Math.min(100, Math.floor((xpInBand / bandSize) * 100)) : 0;
      this.isMaxRank = false;
    }
  }
}
