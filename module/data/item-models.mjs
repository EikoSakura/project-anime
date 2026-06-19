import { PROJECTANIME, modifiersBudget, effectModifierCap } from "../helpers/config.mjs";

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
      attrB: attrChoice("spirit"),
      // Optional third Attribute — only used by a ⭐⭐⭐⭐⭐ Bolster/Hinder (which affects 3). Blank otherwise.
      // Legacy: superseded by `effectAttrs` below; kept as a fallback target for old skills.
      attrC: new fields.StringField({ required: false, blank: true, initial: "" })
    });
    // Which Attributes an Empower/Weaken/Transform Skill changes — chosen INDEPENDENTLY of the
    // roll Attributes (attrA/attrB). Rules v0.01: ONE Attribute for Empower/Weaken, one or two for
    // Transform (config.mjs effectAttrCount); skills built under the older rank-scaled rule may
    // hold more — grandfathered, still applied. Values validated at read in bolsterHinderRules.
    schema.effectAttrs = new fields.ArrayField(new fields.StringField({ required: true, blank: true }), { required: false, initial: [] });
    // Which Status Effects a legacy Weaken inflicts on a hit. Rules v0.01 removed the built-in
    // rider (the Inflict Modifier is the status path), so the Builder no longer authors these —
    // stored lists keep working (validated at read in hinderStatusIds).
    schema.hinderStatuses = new fields.ArrayField(new fields.StringField({ required: true, blank: true }), { required: false, initial: [] });
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
    // Who the Skill may affect (rules v0.01: Targets) — Self / Foe / Ally / Any. Every pre-v0.01
    // Skill fills "any" (the open behavior it was built under); the doc's "an Ally Skill can't be
    // used on yourself" rule is enforced at use (dice.mjs), not stored.
    schema.target = new fields.StringField({ required: true, blank: false, initial: "any", choices: PROJECTANIME.skillTargets });
    // Effective Duration (rules v0.01): Instant / Standard are the intrinsic choices; "channeled"
    // and "scene" are set by their Duration Modifiers (the Builder keeps field and Modifier in
    // sync; config.mjs skillDuration re-derives defensively). Legacy skills are seeded by
    // migrateData from their effectDuration: a set turn count → standard, blank → scene (exactly
    // the old blank-duration behavior), so nothing changes for existing actors.
    schema.duration = new fields.StringField({ required: true, blank: false, initial: "standard", choices: PROJECTANIME.skillDurations });
    // Skill Evasion (rules v0.01): the Attribute the DEFENDER swaps in for Agility when evading
    // this Skill (Mind / Charm / Spirit; all other Evasion bonuses still apply). Blank = the
    // target defends with normal Evasion. Validated at read (config.mjs skillEvasionAttr).
    schema.skillEvasion = new fields.StringField({ required: false, blank: true, initial: "" });
    // Optional (free-form) — only some Skills deal typed damage or are Reactions.
    schema.damageType = new fields.StringField({ required: false, blank: true, initial: "" });
    // Elemental Control's element — FREE TEXT, deliberately untied to the game's Damage Types
    // (any element the player can imagine). Only meaningful while an Effect slot holds
    // Elemental Control; migrateData folds a legacy damageType pick into it.
    schema.controlElement = new fields.StringField({ required: false, blank: true, initial: "" });
    schema.trigger = new fields.StringField({ required: false, blank: true, initial: "" });
    schema.modifiers = new fields.ArrayField(new fields.StringField({ blank: false }), { initial: [] });
    // Per-Modifier numeric growth from the "Tune a Modifier" advancement (Aura/Burst radius, Chain
    // target count, Move/Push/Pull tiles, Protection's Defense…). Keyed by modifier id; effective
    // value = base + this (see config.mjs modifierValue / PROJECTANIME.growableModifiers). Capped at
    // the +3 Tune ceiling (PROJECTANIME.modifierGrowthMax); legacy over-cap data is clamped in migrateData.
    schema.modifierGrowth = new fields.TypedObjectField(new fields.NumberField({ ...requiredInteger, initial: 0, min: 0, max: PROJECTANIME.modifierGrowthMax }));
    // The free-form "Custom" Modifier can be flagged Heavy per-skill (the Builder checkbox), making
    // it count as two Modifiers toward the Rank budget. Meaningless unless "custom" is selected.
    schema.customModifierHeavy = new fields.BooleanField({ initial: false });
    // Re-equip Modifier: normal = swap one or two weapons / an armor / one accessory around the
    // Skill's activation; flagged Heavy (two Modifiers) it swaps the ENTIRE loadout. Meaningless
    // unless "reequip" is selected.
    schema.reequipHeavy = new fields.BooleanField({ initial: false });

    // Affinity (Damage) Modifier — one entry PER TAKE (rules: "This Modifier can be selected
    // more than once"): the Element the target(s) gain an Affinity to, and the level granted
    // (Resist; ⭐⭐⭐ may pick Immune; ⭐⭐⭐⭐⭐ may pick Absorb — config.mjs
    // affinityModifierLevels). Element keys follow the GM's Elements setting (no fixed choices).
    // Each take weighs on the Modifier budget (config.mjs modifierTakes). Only meaningful while
    // the "affinityDamage" Modifier is selected; migrateData folds the old single pick in.
    schema.affinityDamages = new fields.ArrayField(new fields.SchemaField({
      type: new fields.StringField({ required: false, blank: true, initial: "" }),
      level: new fields.StringField({ required: true, blank: false, initial: "resist", choices: ["resist", "immune", "absorb"] })
    }), { initial: [] });
    // Affinity (Status) Modifier — one Status Effect PER TAKE; the target(s) become IMMUNE to
    // each (rules: status affinities only grant Immune — no Resist/Absorb ladder). Display-first:
    // the status-affinity engine isn't automated yet, so these drive the rules text on the card.
    // Only meaningful while the "affinityStatus" Modifier is selected.
    schema.affinityStatusIds = new fields.ArrayField(new fields.StringField({ blank: true }), { initial: [] });
    // A Strike can deal Hit Point or Energy damage; default Hit Points.
    schema.damagePool = new fields.StringField({ required: true, blank: false, initial: "hp", choices: PROJECTANIME.damagePools });
    // How long an ACTIVE Bolster/Hinder effect lasts, in combat rounds. Null/blank = "the scene"
    // (auto-expires when combat ends). Ignored by Passive Skills — their effect is always-on. An
    // ACTIVE Aura reuses this as the field's lifetime (when it elapses, the aura ends).
    schema.effectDuration = new fields.NumberField({ required: false, nullable: true, integer: true, min: 1, initial: null });

    // LEGACY — the Aura Modifier's old ally/enemy switch. The aura's audience now derives from the
    // Skill's explicit `target` (config.mjs auraAudience); migrateData seeds `target` from this on
    // pre-v0.01 aura skills. Kept only so stored data validates; nothing live reads it anymore.
    schema.auraTarget = new fields.StringField({ required: true, blank: false, initial: "ally", choices: PROJECTANIME.auraTargets });

    // Inflict Modifier — the Status Effect this Skill inflicts on a hit (rules: "choose a Status
    // Effect"), picked in the Builder while "inflict" is selected. Validated at read against the
    // condition list. The old "decay" Modifier migrated into Inflict with Lingering chosen.
    schema.inflictStatus = new fields.StringField({ required: false, blank: true, initial: "" });
    // The pool a VALUED inflicted Status protects/restores (rules v0.01 Inflict: "If a Status
    // Effect has a choice between Hit Points or Energy, you make the selection during Skill
    // Creation") — only meaningful while Inflict carries Barrier or Regen.
    schema.inflictPool = new fields.StringField({ required: true, blank: false, initial: "hp", choices: PROJECTANIME.damagePools });
    // Lingering element — the damage type of an inflicted Lingering's end-of-turn tick, chosen
    // from the game's Elements. Blank = untyped. Only meaningful while Inflict carries Lingering.
    schema.decayType = new fields.StringField({ required: false, blank: true, initial: "" });
    // Retaliation element — the damage type a Retaliation ward deals back to a foe that strikes the
    // target. Chosen from the game's Elements at creation; blank = untyped. Only meaningful while
    // the `retaliation` Modifier is selected (see helpers/effects.mjs skillModifierRules).
    schema.retaliationType = new fields.StringField({ required: false, blank: true, initial: "" });

    // Analyze Modifier — which category a successful hit reveals (chosen at creation).
    schema.analyzeCategory = new fields.StringField({ required: true, blank: false, initial: "vitals", choices: PROJECTANIME.analyzeCategories });
    // Infuse Modifier — imbue the target's weapons with a Damage Type or a Status Effect: the
    // kind, plus the specific Element / Status (each only meaningful while "infuse" is selected).
    schema.infuseKind = new fields.StringField({ required: true, blank: false, initial: "element", choices: PROJECTANIME.infuseKinds });
    schema.infuseElement = new fields.StringField({ required: false, blank: true, initial: "" });
    schema.infuseStatus = new fields.StringField({ required: false, blank: true, initial: "" });

    // "Secondary Effect" Modifier: an optional SECOND Effect the Skill also resolves on use (a
    // Strike that also Mends, a Mend that also Bolsters, …). Only meaningful while the
    // `secondaryEffect` Modifier is selected — see config.mjs skillHasSecondary / skillDieSpecs.
    // It mirrors the primary's die-attribute / pool / damage-type, used when it is a Strike/Mend
    // (the other six Effects deliver their mechanic through the Skill's Active Effects). Left
    // blank (no choices constraint) when unset; the Skill Builder validates it against skillEffects.
    schema.secondaryEffect = new fields.StringField({ required: false, blank: true, initial: "" });
    schema.secondaryDamageAttr = new fields.StringField({ required: true, blank: false, initial: "attrA", choices: ["attrA", "attrB"] });
    schema.secondaryDamagePool = new fields.StringField({ required: true, blank: false, initial: "hp", choices: PROJECTANIME.damagePools });
    schema.secondaryDamageType = new fields.StringField({ required: false, blank: true, initial: "" });

    // Advancement-tracked refinements (set via the Skill Builder's Improve mode).
    // Sharpen Accuracy adds a flat bonus (0–3) to the Skill's Accuracy Check.
    schema.accuracyMod = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0, max: 3 });
    // Sharpen Damage / Sharpen Healing adds a flat bonus (0–3) to the Skill's rolled output —
    // damage for a Strike, healing for a Mend (one field; the Effect decides which it boosts).
    schema.damageMod = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0, max: 3 });
    // Lower Energy Cost reduces the Energy spent (floored at half the base cost).
    schema.energyReduction = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });

    // Optional player-authored rules text that REPLACES the auto-generated rules write-up
    // (helpers/skill-description.mjs `skillRulesHTML`). Blank = show the live auto rules. The typed
    // `description` (base model) stays separate FLAVOR text shown alongside the rules.
    schema.rulesOverride = new fields.HTMLField({ required: false, blank: true, initial: "" });

    return schema;
  }

  /**
   * Legacy migrations, oldest first. (One combined override — an earlier build declared
   * migrateData twice, so the second silently shadowed the first.)
   *  1. Range was a bare scope string → the { scope, tiles } object.
   *  2. Before `effectAttrs` existed, a Bolster/Hinder raised/lowered its ROLL Attributes
   *     (attrA/attrB/attrC) directly — seed `effectAttrs` from them to preserve behavior.
   *  3. v0.01 folded the old "decay" Modifier into Inflict: swap the key and choose Lingering
   *     as the inflicted Status (its element field `decayType` carries over unchanged).
   *  4. Before the `duration` field existed, lifetime was only `effectDuration`: a set turn
   *     count → Standard; blank meant "lasts the scene" → Scene (grandfathered WITHOUT the
   *     Scene Modifier slot the Builder now charges — re-editing re-justifies it).
   *  5. An aura's audience was its own `auraTarget` switch before the explicit Target existed —
   *     seed `target` from it (ally → Ally, enemy → Foe) so old auras keep their exact audience
   *     (a bare "any" seed would suddenly include everyone).
   *  6. v0.01 moved Reflect from a Modifier to a beneficial STATUS: like decay, the key folds
   *     into Inflict with Reflect as the chosen Status (an already-chosen Inflict Status wins —
   *     the same one-status-per-Inflict concession the decay migration made).
   */
  static migrateData(source) {
    if (typeof source?.range === "string") {
      const scope = source.range;
      source.range = { scope, tiles: PROJECTANIME.rangeTiles?.[scope] ?? 0 };
    }
    if (source && source.effectAttrs === undefined && (source.effect === "bolster" || source.effect === "hinder")) {
      const at = source.attributes ?? {};
      source.effectAttrs = [at.attrA, at.attrB, at.attrC].filter(Boolean);
    }
    if (Array.isArray(source?.modifiers) && source.modifiers.includes("decay")) {
      source.modifiers = source.modifiers.filter((m) => m !== "decay");
      if (!source.modifiers.includes("inflict")) source.modifiers.push("inflict");
      if (!source.inflictStatus) source.inflictStatus = "decay";
    }
    if (Array.isArray(source?.modifiers) && source.modifiers.includes("reflect")) {
      source.modifiers = source.modifiers.filter((m) => m !== "reflect");
      if (!source.modifiers.includes("inflict")) source.modifiers.push("inflict");
      if (!source.inflictStatus) source.inflictStatus = "reflect";
    }
    // The Sustain EFFECT was removed (per-turn regen is now Inflict → Regen, like Barrier). Fold a
    // legacy Sustain-effect Skill into a Custom effect that Inflicts the Regen status on the pool it
    // used to regenerate, so it still grants regeneration (collectSustain reads the Regen flag). A
    // Sustain secondary just vacates (one Inflict slot holds the Regen).
    if (source && (source.effect === "sustain" || source.secondaryEffect === "sustain")) {
      if (!Array.isArray(source.modifiers)) source.modifiers = [];
      if (!source.modifiers.includes("inflict")) source.modifiers.push("inflict");
      if (!source.inflictStatus) source.inflictStatus = "regen";
      if (!source.inflictPool && (source.damagePool === "energy" || source.damagePool === "hp")) {
        source.inflictPool = source.damagePool;
      }
      if (source.effect === "sustain") source.effect = "custom";
      if (source.secondaryEffect === "sustain") {
        source.secondaryEffect = "";
        source.modifiers = source.modifiers.filter((m) => m !== "secondaryEffect");
      }
    }
    // The Move EFFECT was removed (movement is now the Move / Push / Pull MODIFIERS only). Fold a
    // legacy Move-effect Skill into a Custom effect carrying the Move Modifier so it still
    // repositions; a Move secondary just vacates (the Move Modifier covers the movement once).
    if (source && (source.effect === "move" || source.secondaryEffect === "move")) {
      if (!Array.isArray(source.modifiers)) source.modifiers = [];
      if (!source.modifiers.includes("move")) source.modifiers.push("move");
      if (source.effect === "move") source.effect = "custom";
      if (source.secondaryEffect === "move") {
        source.secondaryEffect = "";
        // The Secondary Effect Modifier now hosts nothing — drop it so it stops eating budget.
        source.modifiers = source.modifiers.filter((m) => m !== "secondaryEffect");
      }
    }
    if (source && source.duration === undefined && source.effect !== undefined) {
      source.duration = source.effectDuration != null ? "standard" : "scene";
    }
    // The Affinity Modifiers are multi-take now (arrays, one entry per take) — fold the old
    // single-pick fields in as the first take.
    if (source && !Array.isArray(source.affinityDamages) && typeof source.affinityType === "string" && source.affinityType) {
      source.affinityDamages = [{ type: source.affinityType, level: source.affinityLevel || "resist" }];
    }
    if (source && !Array.isArray(source.affinityStatusIds) && typeof source.affinityStatusId === "string" && source.affinityStatusId) {
      source.affinityStatusIds = [source.affinityStatusId];
    }
    // Elemental Control's element moved off the Damage Type field into free-text controlElement —
    // fold a legacy pick in (the stored element KEY, capitalized; i18n isn't safe here). The
    // primary slot vacates damageType; a secondary EC vacates secondaryDamageType.
    if (source && !source.controlElement) {
      const cap = (s) => (typeof s === "string" && s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
      if (source.effect === "elementalControl" && source.damageType) {
        source.controlElement = cap(source.damageType);
        source.damageType = "";
      } else if (source.secondaryEffect === "elementalControl" && source.secondaryDamageType) {
        source.controlElement = cap(source.secondaryDamageType);
        source.secondaryDamageType = "";
      }
    }
    if (source && source.target === undefined && Array.isArray(source.modifiers) && source.modifiers.includes("aura")) {
      source.target = source.auraTarget === "enemy" ? "foe" : "ally";
    }
    // The +3 Tune cap is new — clamp any Modifier growth bought before it existed back into range
    // (and drop bad/negative values) so it validates and never over-reads.
    if (source?.modifierGrowth && typeof source.modifierGrowth === "object") {
      const cap = PROJECTANIME.modifierGrowthMax ?? 3;
      for (const k of Object.keys(source.modifierGrowth)) {
        source.modifierGrowth[k] = Math.min(cap, Math.max(0, Math.round(Number(source.modifierGrowth[k]) || 0)));
      }
    }
    return super.migrateData(source);
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
    // A Passive Skill spends no Energy on use; instead, while known it permanently taxes the
    // bearer's MAXIMUM Energy by half its nominal cost (rank×2), floored — a Rank 1 passive
    // (2 EP) lowers max Energy by 1. The actor sums this across owned Skills (actor-models.mjs).
    this.passiveEnergyTax = this.actionType === "passive" ? Math.floor(this.baseEnergy / 2) : 0;
    // Animate / Companion can carry NO Modifiers (rules v0.01) — their budget is zero.
    this.maxModifiers = effectModifierCap(this.effect, this.rank);
    // Heavy modifiers (Devour, Mass, or a Custom flagged Heavy) count as two toward the Rank budget.
    this.modifiersUsed = modifiersBudget(this.modifiers, this);
    this.modifiersOver = this.modifiersUsed > this.maxModifiers;
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
    // The weapon's base TYPE / category ("Sword", "Bow", …) — its name is just flavour (a "Katana"
    // IS a Sword). Free text; a "Weapon Adjustment" effect scoped "By weapon type" matches it
    // (case-insensitive). Blank = uncategorized (only "Any weapon" / "Unarmed" adjustments catch it).
    schema.weaponType = new fields.StringField({ required: false, blank: true, initial: "" });
    schema.range = physicalRangeField("melee", 1);
    schema.size = sizeField(1);
    schema.cost = costField();
    schema.equipped = equippedField();
    schema.hand = new fields.StringField({ required: true, blank: false, initial: "main", choices: PROJECTANIME.hands });
    schema.grip = new fields.StringField({ required: true, blank: false, initial: "one", choices: PROJECTANIME.grips });
    // A weapon that can ONLY be wielded in two hands (rules: bows). Its listed Damage already IS
    // the two-handed profile, so it never gains the two-handed Step-Up — and it always occupies
    // both hands (grip is coerced below, which the equip-exclusivity and dual-wield checks read).
    schema.twoHandedOnly = new fields.BooleanField({ initial: false });
    schema.container = containerField();
    return schema;
  }

  /** A Two-Handed-Only weapon is always gripped in both hands, whatever was stored. */
  prepareDerivedData() {
    if (this.twoHandedOnly) this.grip = "two";
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
    // Base TYPE / category of the bash ("Shield", "Buckler", …) — lets a "Weapon Adjustment" scoped
    // "By weapon type" match a shield (its bash is a weapon attack; weaponModScopeApplies already
    // treats shields as weapons). Free text; blank = only "Any weapon" / "Unarmed" adjustments catch it.
    schema.weaponType = new fields.StringField({ required: false, blank: true, initial: "" });
    schema.range = physicalRangeField("melee", 1);
    schema.size = sizeField(2);
    schema.cost = costField();
    schema.equipped = equippedField();
    schema.hand = new fields.StringField({ required: true, blank: false, initial: "off", choices: PROJECTANIME.hands });
    // Dual-wield the shield as an off-hand weapon, or carry it for defense only — see
    // PROJECTANIME.shieldUses. Drives Dual Wielding detection + the bash Damage die (dice.mjs).
    schema.use = new fields.StringField({ required: true, blank: false, initial: "dual", choices: PROJECTANIME.shieldUses });
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
