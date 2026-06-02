const { BooleanField, HTMLField, NumberField, SchemaField, StringField } = foundry.data.fields;

/**
 * Shared schema fields for all Actor types.
 */
export class BaseActorData extends foundry.abstract.TypeDataModel {

  /**
   * Common schema shared by Adventurer and Monster.
   */
  static defineSchema() {
    return {
      health: new SchemaField({
        value: new NumberField({ required: true, integer: true, min: 0, initial: 10 }),
        max: new NumberField({ required: true, integer: true, min: 0, initial: 10 })
      }),
      mana: new SchemaField({
        value: new NumberField({ required: true, integer: true, min: 0, initial: 5 }),
        max: new NumberField({ required: true, integer: true, min: 0, initial: 5 })
      }),
      stats: new SchemaField({
        str: new SchemaField({
          base: new NumberField({ required: true, integer: true, min: 0, initial: 10 }),
          bonus: new NumberField({ required: true, integer: true, initial: 0 })
        }),
        agi: new SchemaField({
          base: new NumberField({ required: true, integer: true, min: 0, initial: 10 }),
          bonus: new NumberField({ required: true, integer: true, initial: 0 })
        }),
        vit: new SchemaField({
          base: new NumberField({ required: true, integer: true, min: 0, initial: 10 }),
          bonus: new NumberField({ required: true, integer: true, initial: 0 })
        }),
        mag: new SchemaField({
          base: new NumberField({ required: true, integer: true, min: 0, initial: 10 }),
          bonus: new NumberField({ required: true, integer: true, initial: 0 })
        }),
        spi: new SchemaField({
          base: new NumberField({ required: true, integer: true, min: 0, initial: 10 }),
          bonus: new NumberField({ required: true, integer: true, initial: 0 })
        }),
        per: new SchemaField({
          base: new NumberField({ required: true, integer: true, min: 0, initial: 10 }),
          bonus: new NumberField({ required: true, integer: true, initial: 0 })
        }),
        lck: new SchemaField({
          base: new NumberField({ required: true, integer: true, min: 0, initial: 10 }),
          bonus: new NumberField({ required: true, integer: true, initial: 0 })
        }),
        chm: new SchemaField({
          base: new NumberField({ required: true, integer: true, min: 0, initial: 10 }),
          bonus: new NumberField({ required: true, integer: true, initial: 0 })
        })
      }),
      derived: new SchemaField({
        acc: new NumberField({ required: true, integer: true, initial: 0 }),
        eva: new NumberField({ required: true, integer: true, initial: 0 }),
        pDef: new NumberField({ required: true, integer: true, initial: 0 }),
        mDef: new NumberField({ required: true, integer: true, initial: 0 }),
        crit: new NumberField({ required: true, integer: true, initial: 0 })
      }),
      pips: new SchemaField({
        value: new NumberField({ required: true, integer: true, min: 0, initial: 2 }),
        max: new NumberField({ required: true, integer: true, min: 0, initial: 2 })
      }),
      mov: new NumberField({ required: true, integer: true, min: 0, initial: 4 }),
      conditions: new SchemaField({
        // Negative conditions (9)
        poison: new NumberField({ required: true, integer: true, min: 0, initial: 0 }),
        burn: new NumberField({ required: true, integer: true, min: 0, initial: 0 }),
        stun: new NumberField({ required: true, integer: true, min: 0, initial: 0 }),
        blind: new NumberField({ required: true, integer: true, min: 0, initial: 0 }),
        silence: new NumberField({ required: true, integer: true, min: 0, initial: 0 }),
        slow: new NumberField({ required: true, integer: true, min: 0, initial: 0 }),
        root: new NumberField({ required: true, integer: true, min: 0, initial: 0 }),
        weaken: new NumberField({ required: true, integer: true, min: 0, initial: 0 }),
        downed: new NumberField({ required: true, integer: true, min: 0, initial: 0 }),
        // Positive conditions (7)
        regen: new NumberField({ required: true, integer: true, min: 0, initial: 0 }),
        refresh: new NumberField({ required: true, integer: true, min: 0, initial: 0 }),
        haste: new NumberField({ required: true, integer: true, min: 0, initial: 0 }),
        guard: new NumberField({ required: true, integer: true, min: 0, initial: 0 }),
        reflect: new NumberField({ required: true, integer: true, min: 0, initial: 0 }),
        undying: new NumberField({ required: true, integer: true, min: 0, initial: 0 }),
        berserk: new NumberField({ required: true, integer: true, min: 0, initial: 0 })
      }),
      // Element resistances — tiered:
      // -1 = weak, 0 = normal, 1 = resist, 2 = immune, 3 = absorb
      elementResistances: new SchemaField({
        physical:  new NumberField({ required: true, integer: true, min: -1, max: 3, initial: 0 }),
        magical:   new NumberField({ required: true, integer: true, min: -1, max: 3, initial: 0 }),
        fire:      new NumberField({ required: true, integer: true, min: -1, max: 3, initial: 0 }),
        ice:       new NumberField({ required: true, integer: true, min: -1, max: 3, initial: 0 }),
        lightning: new NumberField({ required: true, integer: true, min: -1, max: 3, initial: 0 }),
        wind:      new NumberField({ required: true, integer: true, min: -1, max: 3, initial: 0 }),
        earth:     new NumberField({ required: true, integer: true, min: -1, max: 3, initial: 0 }),
        water:     new NumberField({ required: true, integer: true, min: -1, max: 3, initial: 0 }),
        light:     new NumberField({ required: true, integer: true, min: -1, max: 3, initial: 0 }),
        dark:      new NumberField({ required: true, integer: true, min: -1, max: 3, initial: 0 }),
        plant:     new NumberField({ required: true, integer: true, min: -1, max: 3, initial: 0 }),
        poison:    new NumberField({ required: true, integer: true, min: -1, max: 3, initial: 0 })
      }),
      // Condition resistances — boolean immunity per negative condition
      conditionResistances: new SchemaField({
        poison:  new BooleanField({ initial: false }),
        burn:    new BooleanField({ initial: false }),
        stun:    new BooleanField({ initial: false }),
        blind:   new BooleanField({ initial: false }),
        silence: new BooleanField({ initial: false }),
        slow:    new BooleanField({ initial: false }),
        root:    new BooleanField({ initial: false }),
        weaken:  new BooleanField({ initial: false }),
        downed:  new BooleanField({ initial: false })
      }),
      size: new NumberField({ required: true, min: 0.5, initial: 1 }),
      biography: new HTMLField({ required: true, blank: true }),

      // System flags toggled by Active Effects
      flags: new SchemaField({
        mightyGrip: new BooleanField({ initial: false }),
        undead: new BooleanField({ initial: false })
      })
    };
  }

  /**
   * Calculate the total for a given stat (base + bonus).
   * @param {string} key - The stat key (str, agi, etc.)
   * @returns {number}
   */
  statTotal(key) {
    const stat = this.stats[key];
    return (stat?.base ?? 0) + (stat?.bonus ?? 0);
  }

  /** @override */
  prepareBaseData() {
    super.prepareBaseData();
    // Reset bonus fields to 0 so Active Effects ADD to a clean slate each cycle
    for (const key of Object.keys(this.stats)) {
      this.stats[key].bonus = 0;
    }
    // Reset derived stats (recomputed in prepareDerivedData)
    for (const key of Object.keys(this.derived)) {
      this.derived[key] = 0;
    }
    // Reset system flags so AEs apply to a clean slate
    this.flags.mightyGrip = false;
    this.flags.undead = false;
    // Reset element resistances (tiered: -1=weak, 0=normal, 1=resist, 2=immune, 3=absorb)
    for (const key of Object.keys(this.elementResistances)) {
      this.elementResistances[key] = 0;
    }
    // Reset condition immunities
    for (const key of Object.keys(this.conditionResistances)) {
      this.conditionResistances[key] = false;
    }
  }

  /** @override */
  prepareDerivedData() {
    super.prepareDerivedData();

    // Compute stat totals as virtual properties
    for (const key of Object.keys(this.stats)) {
      this.stats[key].total = this.statTotal(key);
    }

    // Derived stat formulas (simplified: 5 stats)
    const agi = this.statTotal("agi");
    const vit = this.statTotal("vit");
    const spi = this.statTotal("spi");
    const per = this.statTotal("per");
    const lck = this.statTotal("lck");

    this.derived.acc = per;
    this.derived.eva = agi + Math.floor(lck / 4);
    this.derived.pDef = vit;
    this.derived.mDef = spi;
    this.derived.crit = Math.floor(lck / 2) + Math.floor(per / 4);
  }
}
