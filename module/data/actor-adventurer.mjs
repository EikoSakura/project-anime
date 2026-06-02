import { BaseActorData } from "./base-actor.mjs";
import { createGridField } from "./grid-schema.mjs";

const { ArrayField, BooleanField, HTMLField, NumberField, SchemaField, StringField } = foundry.data.fields;

/**
 * Data model for the Adventurer actor type.
 */
export class AdventurerData extends BaseActorData {

  static defineSchema() {
    return {
      ...super.defineSchema(),

      // Identity
      lineage: new StringField({ required: true, blank: true, initial: "" }),
      chosenSize: new NumberField({ required: false, nullable: true, min: 0.5, initial: null }),
      adventurerRank: new StringField({ required: true, initial: "F" }),
      level: new NumberField({ required: true, integer: true, min: 1, initial: 1 }),
      xp: new SchemaField({
        current: new NumberField({ required: true, integer: true, min: 0, initial: 0 }),
        total: new NumberField({ required: true, integer: true, min: 0, initial: 0 })
      }),
      gold: new NumberField({ required: true, integer: true, min: 0, initial: 250 }),

      // Growth Rates (percentage, max 200)
      growthRates: new SchemaField({
        str: new NumberField({ required: true, integer: true, min: 0, max: 200, initial: 30 }),
        agi: new NumberField({ required: true, integer: true, min: 0, max: 200, initial: 30 }),
        vit: new NumberField({ required: true, integer: true, min: 0, max: 200, initial: 30 }),
        mag: new NumberField({ required: true, integer: true, min: 0, max: 200, initial: 30 }),
        spi: new NumberField({ required: true, integer: true, min: 0, max: 200, initial: 30 }),
        per: new NumberField({ required: true, integer: true, min: 0, max: 200, initial: 30 }),
        lck: new NumberField({ required: true, integer: true, min: 0, max: 200, initial: 30 }),
        chm: new NumberField({ required: true, integer: true, min: 0, max: 200, initial: 30 })
      }),

      // Combat
      limitBreak: new SchemaField({
        value: new NumberField({ required: true, integer: true, min: 0, max: 100, initial: 0 }),
        max: new NumberField({ required: true, integer: true, initial: 100 })
      }),
      deathCounts: new SchemaField({
        value: new NumberField({ required: true, integer: true, min: 0, initial: 3 }),
        max: new NumberField({ required: true, integer: true, min: 0, initial: 3 })
      }),

      // Movement modes
      movementModes: new SchemaField({
        walk: new NumberField({ required: true, integer: true, min: 0, initial: 1 }),
        fly: new NumberField({ required: true, integer: true, min: 0, initial: 0 }),
        swim: new NumberField({ required: true, integer: true, min: 0, initial: 0 }),
        climb: new NumberField({ required: true, integer: true, min: 0, initial: 0 }),
        burrow: new NumberField({ required: true, integer: true, min: 0, initial: 0 }),
        teleport: new NumberField({ required: true, integer: true, min: 0, initial: 0 })
      }),

      // Active Job reference (Item ID)
      activeJobId: new StringField({ required: true, blank: true, initial: "" }),

      // Job history: array of objects tracking rank/mastery per job
      jobHistory: new ArrayField(new SchemaField({
        jobId: new StringField({ required: true }),
        name: new StringField({ required: true }),
        rank: new StringField({ required: true, initial: "F" }),
        mastered: new NumberField({ required: true, integer: true, min: 0, initial: 0 })
      })),

      // Bonds
      bonds: new ArrayField(new SchemaField({
        actorUuid: new StringField({ required: false, blank: true, initial: "" }),
        img: new StringField({ required: false, blank: true, initial: "icons/svg/mystery-man.svg" }),
        characterName: new StringField({ required: true, blank: true, initial: "" }),
        archetype: new StringField({ required: true, blank: false, initial: "rival" }),
        heartRank: new NumberField({ required: true, integer: true, min: 0, max: 5, initial: 0 }),
        bondBroken: new BooleanField({ required: true, initial: false }),
        notes: new StringField({ required: false, blank: true, initial: "" }),
        rankNotes: new ArrayField(
          new SchemaField({
            condition: new StringField({ required: false, blank: true, initial: "" }),
            unlock: new StringField({ required: false, blank: true, initial: "" })
          }),
          { initial: [
            { condition: "", unlock: "" },
            { condition: "", unlock: "" },
            { condition: "", unlock: "" },
            { condition: "", unlock: "" },
            { condition: "", unlock: "" }
          ]}
        )
      })),

      // XP log
      xpLog: new ArrayField(new SchemaField({
        date: new StringField({ required: true }),
        source: new StringField({ required: true }),
        amount: new NumberField({ required: true, integer: true }),
        note: new StringField({ blank: true })
      })),

      // Level-up history: records growth rolls and stat gains per level
      levelHistory: new ArrayField(new SchemaField({
        level: new NumberField({ required: true, integer: true, min: 2 }),
        gains: new SchemaField({
          str: new BooleanField({ initial: false }),
          agi: new BooleanField({ initial: false }),
          vit: new BooleanField({ initial: false }),
          mag: new BooleanField({ initial: false }),
          spi: new BooleanField({ initial: false }),
          per: new BooleanField({ initial: false }),
          lck: new BooleanField({ initial: false }),
          chm: new BooleanField({ initial: false })
        }),
        rolls: new SchemaField({
          str: new NumberField({ integer: true, initial: 0 }),
          agi: new NumberField({ integer: true, initial: 0 }),
          vit: new NumberField({ integer: true, initial: 0 }),
          mag: new NumberField({ integer: true, initial: 0 }),
          spi: new NumberField({ integer: true, initial: 0 }),
          per: new NumberField({ integer: true, initial: 0 }),
          lck: new NumberField({ integer: true, initial: 0 }),
          chm: new NumberField({ integer: true, initial: 0 })
        }),
        timestamp: new NumberField({ integer: true, initial: 0 })
      })),

      // Personal details (all StringField for flexibility — "5'10\"", "~130 lbs", etc.)
      personalDetails: new SchemaField({
        age: new StringField({ required: true, blank: true, initial: "" }),
        height: new StringField({ required: true, blank: true, initial: "" }),
        weight: new StringField({ required: true, blank: true, initial: "" }),
        pronouns: new StringField({ required: true, blank: true, initial: "" }),
        gender: new StringField({ required: true, blank: true, initial: "" }),
        hairColor: new StringField({ required: true, blank: true, initial: "" }),
        eyeColor: new StringField({ required: true, blank: true, initial: "" }),
        skinTone: new StringField({ required: true, blank: true, initial: "" }),
        build: new StringField({ required: true, blank: true, initial: "" }),
        distinguishingFeatures: new StringField({ required: true, blank: true, initial: "" })
      }),

      // Rich text biography sections
      appearance: new HTMLField({ required: true, blank: true }),
      personality: new HTMLField({ required: true, blank: true }),

      // GM-only notes (plain text, matches NPC/Merchant pattern)
      gmNotes: new StringField({ required: true, blank: true, initial: "" }),

      // Mana Grid — socket board for Jobs and Manacite
      grid: createGridField()
    };
  }

  /**
   * Maximum level achievable from total XP earned.
   * Formula: 1 + floor(xp.total / xpPerLevel). No level cap.
   * @type {number}
   */
  get maxLevelFromXp() {
    const xpPerLevel = CONFIG.SHARDS.xpPerLevel ?? 500;
    return 1 + Math.floor(this.xp.total / xpPerLevel);
  }

  /**
   * Remaining XP needed to reach the next level threshold.
   * @type {number}
   */
  get xpToNext() {
    const xpPerLevel = CONFIG.SHARDS.xpPerLevel ?? 500;
    return Math.max(0, (this.level * xpPerLevel) - this.xp.total);
  }

  /**
   * XP progress toward next level as a percentage (0-100).
   * Shows progress within the current level's XP bracket.
   * @type {number}
   */
  get xpProgress() {
    const xpPerLevel = CONFIG.SHARDS.xpPerLevel ?? 500;
    const prevThreshold = (this.level - 1) * xpPerLevel;
    const progress = this.xp.total - prevThreshold;
    return Math.clamp(Math.floor((progress / xpPerLevel) * 100), 0, 100);
  }

  /**
   * Sum of all growth rates.
   * @type {number}
   */
  get growthRateTotal() {
    return Object.values(this.growthRates).reduce((sum, v) => sum + v, 0);
  }

  /**
   * Whether the adventurer can level up (has enough total XP for a higher level).
   * @type {boolean}
   */
  get canLevelUp() {
    return this.maxLevelFromXp > this.level;
  }

  /** @override */
  prepareDerivedData() {
    super.prepareDerivedData();

    // Clamp limit break and death counts
    this.limitBreak.value = Math.clamp(this.limitBreak.value, 0, this.limitBreak.max);
    this.deathCounts.value = Math.clamp(this.deathCounts.value, 0, this.deathCounts.max);
  }

  /**
   * Derive HP/MP max from active job base values + actor stats.
   * System formula: HP Max = baseHp + VIT * 2, MP Max = baseMp + SPI * 2
   * Called from ShardsActor.prepareDerivedData() where items are guaranteed available.
   * @param {Item} activeJob - The active job item
   */
  deriveHpMp(activeJob) {
    if (!activeJob?.system) return;
    const vit = this.stats.vit.total ?? this.statTotal("vit");
    const spi = this.stats.spi.total ?? this.statTotal("spi");
    this.health.max = (activeJob.system.baseHp ?? 0) + (vit * 2);
    this.mana.max = (activeJob.system.baseMp ?? 0) + (spi * 2);
    // Re-clamp current values against the new max
    this.health.value = Math.clamp(this.health.value, 0, this.health.max);
    this.mana.value = Math.clamp(this.mana.value, 0, this.mana.max);
  }
}
