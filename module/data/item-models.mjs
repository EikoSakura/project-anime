import { PROJECTANIME } from "../helpers/config.mjs";

const fields = foundry.data.fields;
const requiredInteger = { required: true, nullable: false, integer: true };

/* -------------------------------------------- */
/*  Small field factories                       */
/* -------------------------------------------- */

const sizeField = (initial = 1) => new fields.NumberField({ ...requiredInteger, initial, min: 0 });
const costField = () => new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });
const equippedField = () => new fields.BooleanField({ initial: false });
/** Id of the container (bag) this item is filed under; "" = the backpack. */
const containerField = () => new fields.StringField({ required: false, blank: true, initial: "" });
const attrChoice = (initial) =>
  new fields.StringField({ required: true, blank: false, initial, choices: PROJECTANIME.attributes });

/** Accuracy block — the two attributes rolled, plus a flat modifier. */
const accuracyField = (a = "might", b = "agility") =>
  new fields.SchemaField({
    attrA: attrChoice(a),
    attrB: attrChoice(b),
    mod: new fields.NumberField({ ...requiredInteger, initial: 0 })
  });

/** Damage block — flat modifier and damage type. */
const damageField = () =>
  new fields.SchemaField({
    mod: new fields.NumberField({ ...requiredInteger, initial: 0 }),
    // No fixed `choices` — damage types are GM-configurable via the Elements
    // setting; the sheet dropdown is populated from the active element list.
    type: new fields.StringField({ required: true, blank: false, initial: "physical" })
  });

/** Physical range block — melee/ranged and a tile count. */
const physicalRangeField = (type = "melee", tiles = 1) =>
  new fields.SchemaField({
    type: new fields.StringField({ required: true, blank: false, initial: type, choices: PROJECTANIME.rangeTypes }),
    tiles: new fields.NumberField({ ...requiredInteger, initial: tiles, min: 0 })
  });

/* -------------------------------------------- */
/*  Shared Item base                            */
/* -------------------------------------------- */

export class ProjectAnimeItemBase extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: new fields.HTMLField({ required: false, blank: true }),
      source: new fields.StringField({ required: false, blank: true })
    };
  }
}

/* -------------------------------------------- */
/*  Skill                                       */
/* -------------------------------------------- */

export class ProjectAnimeSkill extends ProjectAnimeItemBase {
  static defineSchema() {
    const schema = super.defineSchema();

    schema.rank = new fields.NumberField({ ...requiredInteger, initial: 1, min: 1, max: 5 });
    schema.actionType = new fields.StringField({
      required: true, blank: false, initial: "action", choices: PROJECTANIME.actionTypes
    });
    schema.attributes = new fields.SchemaField({
      attrA: attrChoice("might"),
      attrB: attrChoice("spirit")
    });
    // For damage/heal Effects (Strike / Mend): which of the two Attributes' die to
    // roll for the amount (rules: "choose one of its two Attributes").
    schema.damageAttr = new fields.StringField({ required: true, blank: false, initial: "attrA", choices: ["attrA", "attrB"] });
    // Range = a named scope plus an editable tile count. The scope's "up to N"
    // is just a recommendation; the player sets the actual `tiles` (Self / Weapon /
    // Very Far ignore it). See PROJECTANIME.rangeTiles.
    schema.range = new fields.SchemaField({
      scope: new fields.StringField({ required: true, blank: false, initial: "near", choices: PROJECTANIME.ranges }),
      tiles: new fields.NumberField({ ...requiredInteger, initial: 5, min: 0 })
    });
    schema.effect = new fields.StringField({
      required: true, blank: false, initial: "strike", choices: PROJECTANIME.skillEffects
    });
    // Optional (free-form) — only some Skills deal typed damage or are Reactions.
    schema.damageType = new fields.StringField({ required: false, blank: true, initial: "" });
    schema.trigger = new fields.StringField({ required: false, blank: true, initial: "" });
    schema.modifiers = new fields.ArrayField(new fields.StringField({ blank: false }), { initial: [] });
    // Per-Modifier numeric growth from the "Turn a Modifier" advancement (e.g. Burst radius,
    // Chain target count). Keyed by modifier id; effective value = base + this (see
    // config.mjs modifierValue / PROJECTANIME.growableModifiers).
    schema.modifierGrowth = new fields.TypedObjectField(new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }));
    // A Strike can deal Hit Point or Energy damage; default Hit Points.
    schema.damagePool = new fields.StringField({ required: true, blank: false, initial: "hp", choices: PROJECTANIME.damagePools });

    // Advancement-tracked refinements (set via the Skill Builder's Improve mode).
    // Sharpen Accuracy adds a flat bonus (0–3) to the Skill's Accuracy Check.
    schema.accuracyMod = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0, max: 3 });
    // Lower Energy Cost reduces the Energy spent (floored at half the base cost).
    schema.energyReduction = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });

    return schema;
  }

  prepareDerivedData() {
    const rank = PROJECTANIME.skillRanks[this.rank] ?? PROJECTANIME.skillRanks[1];
    this.spCost = rank.sp;
    // Base Energy is rank×2; the "Lower Energy Cost" advancement reduces it, but never
    // below half the base (the rules' minimum).
    this.baseEnergy = rank.energy;
    this.minEnergy = Math.ceil(rank.energy / 2);
    // Passive Skills are always-on and cost nothing to use — only active/reaction Skills
    // spend Energy. Zeroing it here is the single source of truth, so no sheet, drawer,
    // tooltip, or chat card ever shows an Energy cost for a passive.
    this.energyCost = this.actionType === "passive"
      ? 0
      : Math.max(rank.energy - (this.energyReduction ?? 0), this.minEnergy);
    this.maxModifiers = rank.maxModifiers;
    // Heavy modifiers (Devour, Mass) count as two toward the Rank's budget.
    const heavy = PROJECTANIME.heavyModifiers;
    this.modifiersUsed = (this.modifiers ?? []).reduce((n, m) => n + (heavy.includes(m) ? 2 : 1), 0);
    this.modifiersOver = this.modifiersUsed > this.maxModifiers;
  }

  /** Range used to be a bare scope string; migrate it to { scope, tiles } using
   *  the scope's recommended tile count. */
  static migrateData(source) {
    if (typeof source?.range === "string") {
      const scope = source.range;
      source.range = { scope, tiles: PROJECTANIME.rangeTiles?.[scope] ?? 0 };
    }
    return super.migrateData(source);
  }
}

/* -------------------------------------------- */
/*  Weapon                                      */
/* -------------------------------------------- */

export class ProjectAnimeWeapon extends ProjectAnimeItemBase {
  static defineSchema() {
    const schema = super.defineSchema();
    schema.accuracy = accuracyField("might", "agility");
    schema.damage = damageField();
    schema.range = physicalRangeField("melee", 1);
    schema.size = sizeField(1);
    schema.cost = costField();
    schema.equipped = equippedField();
    schema.hand = new fields.StringField({ required: true, blank: false, initial: "main", choices: PROJECTANIME.hands });
    schema.grip = new fields.StringField({ required: true, blank: false, initial: "one", choices: PROJECTANIME.grips });
    schema.container = containerField();
    return schema;
  }

  /** Legacy `hand:"two"` cached two-handedness; `grip` is now the single source. */
  static migrateData(source) {
    if (source?.hand === "two") {
      source.hand = "main";
      source.grip = "two";
    }
    return super.migrateData(source);
  }
}

/* -------------------------------------------- */
/*  Armor                                       */
/* -------------------------------------------- */

export class ProjectAnimeArmor extends ProjectAnimeItemBase {
  static defineSchema() {
    const schema = super.defineSchema();
    schema.defenseBonus = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });
    schema.evasionPenalty = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });
    schema.size = sizeField(1);
    schema.cost = costField();
    schema.equipped = equippedField();
    schema.container = containerField();
    return schema;
  }
}

/* -------------------------------------------- */
/*  Shield                                      */
/* -------------------------------------------- */

export class ProjectAnimeShield extends ProjectAnimeItemBase {
  static defineSchema() {
    const schema = super.defineSchema();
    schema.evasionBonus = new fields.NumberField({ ...requiredInteger, initial: 1, min: 0 });
    // Heavier shields trade Evasion for damage reduction: a Defense Bonus that adds to the
    // wearer's Defense (folded in by the actor model, like a piece of armor).
    schema.defenseBonus = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });
    schema.accuracy = accuracyField("might", "agility");
    schema.damage = damageField();
    schema.range = physicalRangeField("melee", 1);
    schema.size = sizeField(2);
    schema.cost = costField();
    schema.equipped = equippedField();
    schema.hand = new fields.StringField({ required: true, blank: false, initial: "off", choices: PROJECTANIME.hands });
    schema.container = containerField();
    return schema;
  }

  /** Shields are never two-handed; coerce any legacy `hand:"two"` to the off-hand. */
  static migrateData(source) {
    if (source?.hand === "two") source.hand = "off";
    return super.migrateData(source);
  }
}

/* -------------------------------------------- */
/*  Accessory                                   */
/* -------------------------------------------- */

export class ProjectAnimeAccessory extends ProjectAnimeItemBase {
  static defineSchema() {
    const schema = super.defineSchema();
    schema.size = sizeField(1);
    schema.cost = costField();
    schema.equipped = equippedField();
    schema.container = containerField();
    return schema;
  }
}

/* -------------------------------------------- */
/*  Consumable                                  */
/* -------------------------------------------- */

export class ProjectAnimeConsumable extends ProjectAnimeItemBase {
  static defineSchema() {
    const schema = super.defineSchema();
    schema.size = sizeField(1);
    schema.cost = costField();
    schema.quantity = new fields.NumberField({ ...requiredInteger, initial: 1, min: 0 });
    // What using this consumable restores, and by how much (rules p.10 potions).
    schema.restoreType = new fields.StringField({ required: true, blank: false, initial: "none", choices: PROJECTANIME.consumableRestore });
    schema.restoreAmount = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });
    schema.container = containerField();
    return schema;
  }
}

/* -------------------------------------------- */
/*  Container                                   */
/* -------------------------------------------- */

export class ProjectAnimeContainer extends ProjectAnimeItemBase {
  static defineSchema() {
    const schema = super.defineSchema();
    schema.capacityBonus = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });
    schema.size = sizeField(0);
    schema.cost = costField();
    schema.equipped = equippedField();
    return schema;
  }
}

/* -------------------------------------------- */
/*  Package (ability bundle / grant carrier)    */
/* -------------------------------------------- */

/**
 * A bundle whose job is to GRANT a set of abilities — e.g. "Race: Saiyan" granting the
 * Saiyan Skills. The grant itself lives on the Package's Active Effects (a "Grant Item"
 * rule, drag-built in the Effect Builder); when the Package lands on an actor the granted
 * Items are created for free (see effects.mjs syncGrants). The model is intentionally
 * light — just an optional category label slotting it into a kind (Race/Class/Origin).
 */
export class ProjectAnimePackage extends ProjectAnimeItemBase {
  static defineSchema() {
    const schema = super.defineSchema();
    schema.category = new fields.StringField({ required: false, blank: true, initial: "" });
    return schema;
  }
}

/* -------------------------------------------- */
/*  Gear (generic / catch-all)                  */
/* -------------------------------------------- */

export class ProjectAnimeGear extends ProjectAnimeItemBase {
  static defineSchema() {
    const schema = super.defineSchema();
    schema.size = sizeField(1);
    schema.cost = costField();
    schema.quantity = new fields.NumberField({ ...requiredInteger, initial: 1, min: 0 });
    schema.container = containerField();
    return schema;
  }
}
