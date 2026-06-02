const { BooleanField, HTMLField, NumberField, StringField } = foundry.data.fields;

/**
 * Data model for the Manacite item type.
 *
 * Manacite are crystallized Mana that hold skills. They are socketed into the
 * Mana Grid to grant abilities. Socketed manacite absorb XP through siphon,
 * advancing their Skill Level (SL) from 1 to 5.
 */
export class ManaciteData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    return {
      description: new HTMLField({ required: true, blank: true }),
      rank: new StringField({ required: true, initial: "F" }),
      manaciteType: new StringField({ required: true, initial: "standard" }),

      // School / affinity — must match parent job socket's school on the Mana Grid (or "general" for any)
      school: new StringField({ required: true, initial: "general" }),

      // Source monster name (for monster manacite)
      source: new StringField({ required: true, blank: true }),

      // Skill this manacite grants when socketed
      skillGranted: new StringField({ required: true, blank: true }),

      // Gold value for trading
      goldValue: new NumberField({ required: true, integer: true, min: 0, initial: 0 }),

      // Whether this manacite is currently socketed into a grid socket
      socketed: new BooleanField({ initial: false }),

      // Grid socket ID this manacite is socketed into (if any)
      socketId: new StringField({ required: true, blank: true, initial: "" }),

      // --- Progression (XP Siphon) ---
      // Skill Level (1-5) — advances via XP siphon when socketed
      skillLevel: new NumberField({ required: true, integer: true, min: 1, max: 5, initial: 1 }),

      // Cumulative XP absorbed from adventurer via siphon
      manaciteXp: new NumberField({ required: true, integer: true, min: 0, initial: 0 })
    };
  }

  /** @override */
  prepareDerivedData() {
    super.prepareDerivedData();

    const maxSL = CONFIG.SHARDS?.skillLevelMax ?? 5;
    this.isMaxLevel = this.skillLevel >= maxSL;

    // XP progress toward next skill level
    const thresholds = CONFIG.SHARDS?.manaciteXpThresholds ?? [0, 0, 50, 150, 350, 750];
    const currentThreshold = thresholds[this.skillLevel] ?? 0;
    const nextThreshold = thresholds[this.skillLevel + 1];

    if (this.isMaxLevel || nextThreshold == null) {
      this.xpToNext = 0;
      this.xpProgress = 100;
    } else {
      const xpInBand = this.manaciteXp - currentThreshold;
      const bandSize = nextThreshold - currentThreshold;
      this.xpToNext = Math.max(0, nextThreshold - this.manaciteXp);
      this.xpProgress = bandSize > 0 ? Math.min(100, Math.floor((xpInBand / bandSize) * 100)) : 0;
    }
  }

  /** @override */
  static migrateData(source) {
    // Migrate old tree socket fields to grid socket field
    if (source.socketNodeId != null && !source.socketId) {
      source.socketId = "";
    }
    if (source.socketNodeId != null) delete source.socketNodeId;
    if (source.socketTreeItemId != null) delete source.socketTreeItemId;
    return super.migrateData(source);
  }
}
