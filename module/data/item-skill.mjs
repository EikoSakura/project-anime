const { ArrayField, BooleanField, HTMLField, NumberField, SchemaField, SetField, StringField } = foundry.data.fields;

/**
 * Data model for the Skill item type.
 *
 * Skills are ability reference items used by both adventurers and monsters.
 * They define what an ability does mechanically (targeting, damage, conditions,
 * etc.) and are granted by socketing Manacite into the Mana Grid.
 *
 * Skill types: active (combat/spells/utility), passive, reaction, limitBreak.
 * Skills have Skill Level (SL) 1-5 progression. Manacite gains XP via siphon
 * to advance the SL of socketed skills. Formulas (damageFormula, pipCost,
 * mpCost) can reference "SL" to scale with level.
 *
 * Power Tiers (weak/standard/strong/devastating) can auto-generate damage
 * formulas from selected scaling stats, reducing manual formula writing.
 */
export class SkillData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    return {
      // ---- DESCRIPTION (GM flavor text, shown below auto-card) ----
      description: new HTMLField({ required: true, blank: true }),

      // ---- IDENTITY / META ----
      // Skill types: active, passive, reaction, limitBreak
      skillType: new StringField({ required: true, initial: "active" }),
      tags: new SetField(new StringField()),

      // Tier — indicates the power level of this skill (for reference / sorting)
      tier: new NumberField({ required: true, integer: true, min: 1, max: 5, initial: 1 }),

      // Power tier — determines auto-generated damage formula scaling
      powerTier: new StringField({ required: true, initial: "standard" }),

      // Auto-formula — when true, damageFormula is auto-generated from powerTier + skillStats
      autoFormula: new BooleanField({ initial: true }),

      // ---- USAGE ----
      timing: new StringField({ required: true, initial: "action" }),
      pipCost: new StringField({ required: true, blank: true, initial: "1" }),
      mpCost: new StringField({ required: true, blank: true, initial: "0" }),
      target: new StringField({ required: true, initial: "single" }),
      areaShape: new StringField({ required: true, blank: true, initial: "" }),
      areaSize: new NumberField({ required: true, integer: true, min: 0, initial: 0 }),
      aoeFilter: new StringField({ required: true, initial: "all" }),
      range: new StringField({ required: true, blank: true, initial: "0" }),

      // ---- COMBAT ----
      baseAccuracy: new NumberField({ required: true, integer: true, min: 0, max: 99, initial: 50, nullable: true }),
      skillBase: new NumberField({ required: true, integer: true, min: 0, initial: 0 }),
      skillStats: new ArrayField(new StringField()),
      defenseType: new StringField({ required: true, initial: "none" }),
      damageType: new StringField({ required: true, blank: true, initial: "" }),
      damageFormula: new StringField({ required: true, blank: true, initial: "" }),
      // Buff duration — formula for rounds when applying embedded AEs (e.g. "SL", "SL * 2", "5")
      buffDuration: new StringField({ required: true, blank: true, initial: "" }),
      pierce: new BooleanField({ initial: false }),
      conditionApplied: new StringField({ required: true, blank: true, initial: "" }),
      conditionChance: new StringField({ required: true, blank: true, initial: "0" }),

      // Stacking — when true, multiple copies of this skill can coexist on an actor
      // and their Active Effects stack additively (e.g. Fire Resistance I ×2 = double effect)
      stackable: new BooleanField({ initial: false }),

      // ---- PROGRESSION ----
      skillLevel: new NumberField({ required: true, integer: true, min: 1, max: 5, initial: 1 }),
      source: new StringField({ required: false, blank: true, initial: "" }),
      originNote: new StringField({ required: false, blank: true, initial: "" })
    };
  }

  /** @override */
  prepareDerivedData() {
    super.prepareDerivedData();
    this.isPassive = this.timing === "passive";

    // Auto-formula generation: compute effectiveFormula from powerTier + skillStats
    if (this.autoFormula && this.skillStats?.length > 0) {
      const tiers = CONFIG.SHARDS?.powerTiers;
      const tier = tiers?.[this.powerTier] ?? tiers?.standard ?? { statMultiplier: 1, slMultiplier: 3 };
      const stats = this.skillStats.map(s => s.toUpperCase());
      const statExpr = stats.length === 1
        ? stats[0]
        : `(${stats.join(" + ")}) / ${stats.length}`;
      const statPart = tier.statMultiplier === 1
        ? statExpr
        : `${statExpr} * ${tier.statMultiplier}`;
      this.effectiveFormula = `${statPart} + SL * ${tier.slMultiplier}`;
    } else if (this.autoFormula && (!this.skillStats || this.skillStats.length === 0)) {
      // No stats selected — SL-only formula
      const tiers = CONFIG.SHARDS?.powerTiers;
      const tier = tiers?.[this.powerTier] ?? tiers?.standard ?? { slMultiplier: 3 };
      this.effectiveFormula = `SL * ${tier.slMultiplier}`;
    } else {
      // Manual formula — use damageFormula as-is
      this.effectiveFormula = this.damageFormula;
    }

    // Skill level progression — all skills level independently
    const maxSL = CONFIG.SHARDS?.skillLevelMax ?? 5;
    this.isMaxLevel = this.skillLevel >= maxSL;
    const costs = CONFIG.SHARDS?.skillLevelCosts ?? [0, 1, 2, 3, 4];
    this.spToNext = this.isMaxLevel ? 0 : (costs[this.skillLevel] ?? this.skillLevel);
  }

  /** @override */
  static migrateData(source) {
    // Strip removed evolution/synthesis fields
    if (source.evolved != null) delete source.evolved;
    if (source.evolvedFrom != null) delete source.evolvedFrom;
    if (source.evolutionOptions != null) delete source.evolutionOptions;
    if (source.combinationEvolutions != null) delete source.combinationEvolutions;
    // Clamp skillLevel to new max of 5
    if (source.skillLevel > 5) source.skillLevel = 5;
    // Migrate cone → burst (cone area shape removed)
    if (source.areaShape === "cone") source.areaShape = "burst";
    // Default aoeFilter for existing area skills
    if (source.aoeFilter == null && source.target === "area") source.aoeFilter = "all";
    return super.migrateData(source);
  }
}
