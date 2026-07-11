import { PROJECTANIME, techniqueEnergyCost, modifiersEnergy, techniqueResistance } from "../helpers/config.mjs";

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

/** Accuracy block — the Paired Attribute (attrA) plus the fallback second Attribute rolled
 *  when no Talent applies, and a flat modifier. */
const accuracyField = (a = "might", b = "agility") =>
  new fields.SchemaField({
    attrA: attrChoice(a),
    attrB: attrChoice(b),
    mod: new fields.NumberField({ ...requiredInteger, initial: 0 })
  });

/** Physical range block — tile reach, with an optional minimum for banded ranges ("3–8").
 *  `type` (melee/ranged) is legacy display data; kept so stored gear validates. */
const physicalRangeField = (type = "melee", tiles = 1) =>
  new fields.SchemaField({
    type: new fields.StringField({ required: true, blank: false, initial: type, choices: PROJECTANIME.rangeTypes }),
    tiles: new fields.NumberField({ ...requiredInteger, initial: tiles, min: 0 }),
    minTiles: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 })
  });

/** The Talent a weapon/Technique is used under — a key into the owner's `system.talents`
 *  ("" = none: roll the two Attributes instead). */
const talentIdField = () => new fields.StringField({ required: false, blank: true, initial: "" });

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

// (Talents are actor data — `system.talents` on the actor models, Daggerheart-Experience-style.
// The retired `talent` Item type migrates there at ready; see project-anime.mjs.)

/* -------------------------------------------- */
/*  Technique (stored type id: "skill")         */
/* -------------------------------------------- */

export class ProjectAnimeSkill extends ProjectAnimeItemBase {
  static defineSchema() {
    const schema = super.defineSchema();

    schema.actionType = new fields.StringField({
      required: true, blank: false, initial: "action", choices: PROJECTANIME.actionTypes
    });
    // A Passive Technique's mode (rules: Passive Techniques) — Sustained (has a Duration,
    // always active) or Standing (fires automatically when its condition is met).
    schema.passiveMode = new fields.StringField({
      required: true, blank: false, initial: "sustained", choices: PROJECTANIME.passiveModes
    });
    // React Trigger (rules: React Techniques) — required for every React Technique.
    schema.trigger = new fields.StringField({ required: false, blank: true, initial: "" });

    // The Talent this Technique is built under ("" = none: roll two different Attributes).
    // Rolls = the Talent's Primary Attribute die + the Talent die + 1 (Trained Edge).
    schema.talentId = talentIdField();
    // The fallback Attribute pair when no Talent applies (two DIFFERENT Attributes).
    schema.attributes = new fields.SchemaField({
      attrA: attrChoice("might"),
      attrB: attrChoice("spirit")
    });

    // Range (rules: Building a Technique): Self · Touch (1 tile) · Weapon (uses the weapon's
    // Damage and Threshold) · Range (X tiles, chosen at construction).
    schema.range = new fields.SchemaField({
      scope: new fields.StringField({ required: true, blank: false, initial: "weapon", choices: PROJECTANIME.ranges }),
      tiles: new fields.NumberField({ ...requiredInteger, initial: 1, min: 0 })
    });

    schema.effect = new fields.StringField({
      required: true, blank: false, initial: "strike", choices: PROJECTANIME.skillEffects
    });
    // Who the Technique may affect (the free Target Modifiers) — Self / Foe / Ally / Any.
    schema.target = new fields.StringField({ required: true, blank: false, initial: "any", choices: PROJECTANIME.skillTargets });
    // Effective Duration: Instant / Standard (2) are intrinsic; "channeled" and "scene" are
    // set by their Modifiers (the Builder keeps field and Modifier in sync).
    schema.duration = new fields.StringField({ required: true, blank: false, initial: "standard", choices: PROJECTANIME.skillDurations });
    // A Standard duration's round count (the printed Duration is 2). Null = the default.
    schema.effectDuration = new fields.NumberField({ required: false, nullable: true, integer: true, min: 1, initial: null });

    // Control's element — FREE TEXT, chosen at creation ("Choose an element…").
    schema.controlElement = new fields.StringField({ required: false, blank: true, initial: "" });
    // Which Attributes an Empower/Weaken/Transform changes — chosen at creation.
    schema.effectAttrs = new fields.ArrayField(new fields.StringField({ required: true, blank: true }), { required: false, initial: [] });
    // Heal clears a hit box or an energy box (chosen at creation); Drain mirrors the choice.
    schema.damagePool = new fields.StringField({ required: true, blank: false, initial: "hp", choices: PROJECTANIME.damagePools });

    schema.modifiers = new fields.ArrayField(new fields.StringField({ blank: false }), { initial: [] });
    // Potent can be taken twice (+1 box each) — the stored take count (1–2).
    schema.potentCount = new fields.NumberField({ ...requiredInteger, initial: 1, min: 1, max: 2 });
    // The free-form "Custom" Modifier can be flagged Heavy per-Technique (the Builder checkbox).
    schema.customModifierHeavy = new fields.BooleanField({ initial: false });
    // Inflict — one Status chosen at creation (Blinded / Lingering / Prone / Slowed / Weakened).
    schema.inflictStatus = new fields.StringField({ required: false, blank: true, initial: "" });
    // Inflict (Severe) 🔶 — one of Bound / Cursed / Exposed / Sealed.
    schema.inflictSevereStatus = new fields.StringField({ required: false, blank: true, initial: "" });
    // The pool a Cursed Inflict blocks (chosen at creation).
    schema.inflictPool = new fields.StringField({ required: true, blank: false, initial: "hp", choices: PROJECTANIME.damagePools });
    // Drain — clears 1 hit box or 1 energy box on the user (chosen at creation).
    schema.drainPool = new fields.StringField({ required: true, blank: false, initial: "hp", choices: PROJECTANIME.damagePools });
    // Analyze — which category a hit reveals (chosen at creation).
    schema.analyzeCategory = new fields.StringField({ required: true, blank: false, initial: "vitals", choices: PROJECTANIME.analyzeCategories });

    // "Secondary Effect" Modifier 🔶: an optional SECOND Effect the Technique also resolves.
    schema.secondaryEffect = new fields.StringField({ required: false, blank: true, initial: "" });
    schema.secondaryDamagePool = new fields.StringField({ required: true, blank: false, initial: "hp", choices: PROJECTANIME.damagePools });

    // Companion (rules: Companion Energy Lock): the 2 boxes are locked only while the
    // Companion is actively adventuring. `companionHome` = left behind (no lock).
    schema.companionHome = new fields.BooleanField({ initial: false });

    // Manifest (rules: Manifest Modifier) — the id of the owned PASSIVE Technique this
    // carrier wakes: the bound Passive runs only while this Technique is active, and its
    // locked energy is unlocked. "" = unbound (display-only until a Passive is chosen).
    schema.manifestSkillId = new fields.StringField({ required: false, blank: true, initial: "" });

    // Per-Conflict limiter: EXPLICIT uses per encounter — a GM knob for enemy design. 0 =
    // unlimited. Tracked per-combat on the actor's flags; reset at combat start/end.
    schema.usesPerConflict = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });

    // LEGACY (retired with the auto-written rules): the old hand-typed override. Kept in the
    // schema ONLY so the one-time `proseDescriptionsV1` migration can fold stored values into
    // `system.description`; it is blanked there and read nowhere else. Drop in a future sweep.
    schema.rulesOverride = new fields.HTMLField({ required: false, blank: true, initial: "" });

    return schema;
  }

  /**
   * Legacy migrations (pre-V2 stored Skills → V2 Techniques), oldest first:
   *  1. Range was a bare scope string → the { scope, tiles } object; the retired band scopes
   *     (melee/near/far/veryFar/scene) fold to tile counts; a 1-tile range reads Touch.
   *  2. The old "decay" Modifier folded into Inflict with Lingering chosen (pre-v0.01).
   *  3. Modifier renames: drainHP/drainEnergy → drain (+drainPool), combo → link,
   *     push/pull → reposition.
   *  4. Statuses that became Modifiers: an Inflict of Barrier/Regen/Reflect becomes that
   *     Modifier; a HEAVY Inflict status (Bound/Cursed/Sealed; retired Stunned → Bound)
   *     moves to Inflict (Severe).
   *  5. Retired Modifiers vanish: affinityStatus, banish, immunity, infuse, mental, pierce,
   *     absorb, affinityDamage, waypoint stays (V2 printed it).
   *  6. Retired Effects fold to Custom carriers (sustain / move / affinity — pre-v0.4 folds
   *     kept; the bare "passive" carrier stays valid but is no longer authorable).
   */
  static migrateData(source) {
    // 1 — range shapes.
    if (typeof source?.range === "string") {
      const scope = source.range;
      source.range = { scope, tiles: PROJECTANIME.rangeTiles?.[scope] ?? 0 };
    }
    if (source?.range && typeof source.range === "object") {
      const legacyTiles = { melee: 1, near: 5, far: 10, veryFar: 10, scene: 10 };
      const sc = source.range.scope;
      if (sc in legacyTiles) {
        source.range.scope = "tiles";
        if (!(Number(source.range.tiles) > 0)) source.range.tiles = legacyTiles[sc];
      }
    }
    // 2 — decay Modifier → Inflict(Lingering).
    if (Array.isArray(source?.modifiers) && source.modifiers.includes("decay")) {
      source.modifiers = source.modifiers.filter((m) => m !== "decay");
      if (!source.modifiers.includes("inflict")) source.modifiers.push("inflict");
      if (!source.inflictStatus) source.inflictStatus = "decay";
    }
    // 3 — Modifier renames.
    if (Array.isArray(source?.modifiers)) {
      const mods = source.modifiers;
      if (mods.includes("drainHP") || mods.includes("drainEnergy")) {
        if (!source.drainPool) source.drainPool = mods.includes("drainEnergy") ? "energy" : "hp";
        source.modifiers = mods.filter((m) => m !== "drainHP" && m !== "drainEnergy");
        if (!source.modifiers.includes("drain")) source.modifiers.push("drain");
      }
      if (source.modifiers.includes("combo")) {
        source.modifiers = source.modifiers.filter((m) => m !== "combo");
        if (!source.modifiers.includes("link")) source.modifiers.push("link");
      }
      if (source.modifiers.includes("push") || source.modifiers.includes("pull")) {
        source.modifiers = source.modifiers.filter((m) => m !== "push" && m !== "pull");
        if (!source.modifiers.includes("reposition")) source.modifiers.push("reposition");
      }
      if (source.modifiers.includes("move") && source.effect === "custom" && !source.modifiers.includes("reposition")) {
        // pre-v0.4 Move-effect folds kept their Move Modifier — still valid in V2 (self move).
      }
    }
    // 4 — status → Modifier promotions, and Severe split.
    if (Array.isArray(source?.modifiers) && source.modifiers.includes("inflict")) {
      const st = source.inflictStatus;
      const promote = { barrier: "barrier", regen: "regen", reflect: "reflect" };
      if (st in promote) {
        source.modifiers = source.modifiers.filter((m) => m !== "inflict");
        if (!source.modifiers.includes(promote[st])) source.modifiers.push(promote[st]);
        source.inflictStatus = "";
      } else if (["bound", "curse", "exhausted", "stunned", "exposed"].includes(st)) {
        source.modifiers = source.modifiers.filter((m) => m !== "inflict");
        if (!source.modifiers.includes("inflictSevere")) source.modifiers.push("inflictSevere");
        source.inflictSevereStatus = st === "stunned" ? "bound" : st;
        source.inflictStatus = "";
      }
    }
    // 5 — retired Modifiers vanish.
    if (Array.isArray(source?.modifiers)) {
      const retired = ["affinityStatus", "banish", "immunity", "infuse", "mental", "pierce", "absorb", "affinityDamage", "protectionTargetless"];
      source.modifiers = source.modifiers.filter((m) => !retired.includes(m));
    }
    // 6 — retired Effect folds (kept from earlier versions so very old data still lands).
    if (source && (source.effect === "sustain" || source.secondaryEffect === "sustain")) {
      if (!Array.isArray(source.modifiers)) source.modifiers = [];
      if (!source.modifiers.includes("regen")) source.modifiers.push("regen");
      if (source.effect === "sustain") source.effect = "custom";
      if (source.secondaryEffect === "sustain") {
        source.secondaryEffect = "";
        source.modifiers = source.modifiers.filter((m) => m !== "secondaryEffect");
      }
    }
    if (source && (source.effect === "move" || source.secondaryEffect === "move")) {
      if (!Array.isArray(source.modifiers)) source.modifiers = [];
      if (!source.modifiers.includes("move")) source.modifiers.push("move");
      if (source.effect === "move") source.effect = "custom";
      if (source.secondaryEffect === "move") {
        source.secondaryEffect = "";
        source.modifiers = source.modifiers.filter((m) => m !== "secondaryEffect");
      }
    }
    if (source && (source.effect === "affinity" || source.secondaryEffect === "affinity")) {
      if (source.effect === "affinity") source.effect = "custom";
      if (source.secondaryEffect === "affinity") {
        source.secondaryEffect = "";
        if (Array.isArray(source.modifiers)) source.modifiers = source.modifiers.filter((m) => m !== "secondaryEffect");
      }
    }
    if (source && source.duration === undefined && source.effect !== undefined) {
      source.duration = source.effectDuration != null ? "standard" : "scene";
    }
    // Control's element carried on the retired damage-type fields (very old data).
    if (source && !source.controlElement) {
      const cap = (s) => (typeof s === "string" && s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
      if (source.effect === "elementalControl" && source.damageType) source.controlElement = cap(source.damageType);
    }
    return super.migrateData(source);
  }

  prepareDerivedData() {
    // V2: the Energy cost = the Effect's cost + every Modifier's cost, minimum 1 (config.mjs
    // techniqueEnergyCost — the single cost authority).
    this.totalCost = techniqueEnergyCost(this);
    // Passive Techniques pay nothing per use; instead they LOCK energy boxes equal to their
    // total cost (rules: Passive Techniques). A Companion's lock lifts while it's left home.
    const passive = this.actionType === "passive" || this.effect === "companion";
    this.energyCost = passive ? 0 : this.totalCost;
    // Manifest (rules: Manifest Modifier): a sibling carrier Technique that binds this Passive
    // makes it dormant-until-manifested. The lock lifts ONLY while the Passive is actually
    // running — a live marker from the carrier's activation (dice.mjs ensureManifestMarker);
    // when the carrier's duration ends the marker dies and the lock RETURNS. Sibling/effect
    // SOURCE data only: prep-order safe.
    const item = this.parent;
    this.manifestedBy = (this.actionType === "passive" && this.effect !== "companion" && item?.actor)
      ? (item.actor.items.find((i) => i !== item && i.type === "skill"
          && (i._source?.system?.modifiers ?? []).includes("manifest")
          && i._source?.system?.manifestSkillId === item.id)?.id ?? "")
      : "";
    this.manifested = !!this.manifestedBy && (item.actor.effects ?? []).some((e) =>
      !e.disabled && e.flags?.["project-anime"]?.manifestSkillId === item.id);
    this.passiveEnergyTax = passive && !this.manifested && !(this.effect === "companion" && this.companionHome)
      ? this.totalCost : 0;
    // The Modifier weight shown on sheets.
    this.modifiersUsed = modifiersEnergy(this.modifiers, this);

    // An EXPLICIT usesPerConflict limits a Technique per encounter (a GM knob for enemy
    // design); `usesLimit` is that cap (0 = unlimited).
    this.perConflict = this.usesPerConflict > 0;
    this.usesLimit = this.perConflict ? this.usesPerConflict : 0;
  }

  /** Resistance (rules: Resistance) — derived live so it tracks Talent/Attribute growth:
   *  Talent-built 7 + Talent die/2 (Trained Edge folded in), else 6 + higher Attribute die/2. */
  get resistance() {
    return techniqueResistance(this.parent ?? this);
  }
}

/* -------------------------------------------- */
/*  Weapon                                      */
/* -------------------------------------------- */

export class ProjectAnimeWeapon extends ProjectAnimeItemBase {
  static defineSchema() {
    const schema = super.defineSchema();
    // The Weapon Style this weapon was picked from (rules: Weapon Styles). Free text so
    // homebrew lines stay valid; "" = custom.
    schema.style = new fields.StringField({ required: false, blank: true, initial: "" });
    // The Paired Attribute (attrA) + the fallback second Attribute when no Talent applies.
    schema.accuracy = accuracyField("might", "agility");
    // The Talent rolled alongside the Paired Attribute for basic attacks ("" = none).
    schema.talentId = talentIdField();
    // Damage — the number of hit boxes the target marks on a hit. Fixed, never rolled.
    schema.damage = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 1, min: 0 })
    });
    // Threshold — meet or exceed it on the attack roll and the target marks 1 additional box.
    schema.threshold = new fields.NumberField({ ...requiredInteger, initial: 10, min: 0 });
    // The weapon's base TYPE / category ("Sword", "Bow", …) — its name is just flavour.
    schema.weaponType = new fields.StringField({ required: false, blank: true, initial: "" });
    schema.range = physicalRangeField("melee", 1);
    // Dual Wield property — a pair of these can be wielded together (basic attacks only).
    schema.dual = new fields.BooleanField({ initial: false });
    schema.size = sizeField(1);
    schema.cost = costField();
    schema.equipped = equippedField();
    schema.hand = new fields.StringField({ required: true, blank: false, initial: "main", choices: PROJECTANIME.hands });
    schema.grip = new fields.StringField({ required: true, blank: false, initial: "one", choices: PROJECTANIME.grips });
    // Two-handed property — always occupies both hands (Heavy / Ranged styles).
    schema.twoHandedOnly = new fields.BooleanField({ initial: false });
    schema.container = containerField();
    return schema;
  }

  /** A Two-Handed weapon is always gripped in both hands, whatever was stored. */
  prepareDerivedData() {
    if (this.twoHandedOnly) this.grip = "two";
  }

  /** Legacy folds: `hand:"two"` cached two-handedness; the pre-V2 `damage.mod` (an additive
   *  bonus on a rolled attribute) becomes the fixed Damage value (min 1). */
  static migrateData(source) {
    if (source?.hand === "two") {
      source.hand = "main";
      source.grip = "two";
    }
    if (source?.damage && typeof source.damage === "object"
      && source.damage.value === undefined && source.damage.mod !== undefined) {
      source.damage.value = Math.max(1, Math.round(Number(source.damage.mod) || 0) || 1);
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
    // The Armor Style (rules: Armor Styles). "" = custom.
    schema.style = new fields.StringField({ required: false, blank: true, initial: "" });
    // Guard bonus — added to the wearer's Guard (6 + armor + shield).
    schema.guardBonus = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });
    // Movement — the wearer's Movement while this armor is equipped.
    schema.movement = new fields.NumberField({ ...requiredInteger, initial: 6, min: 0 });
    // Energy Regen override (Unarmored clears 2 boxes per turn instead of 1). 0 = the base 1.
    schema.energyRegen = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });
    schema.size = sizeField(1);
    schema.cost = costField();
    schema.equipped = equippedField();
    schema.container = containerField();
    return schema;
  }

  /** Pre-V2 armor carried protection/defSplit/resSplit/evasionMod — fold to a Guard bonus and
   *  guess the Style's Movement from its weight (the pack rebase rewrites real gear). */
  static migrateData(source) {
    if (source && source.guardBonus === undefined) {
      const prot = Number(source.protection ?? source.defenseBonus ?? 0) || 0;
      if (prot || source.protection !== undefined || source.defenseBonus !== undefined) {
        source.guardBonus = Math.clamp(prot, 0, 5);
        if (source.movement === undefined) {
          source.movement = prot >= 4 ? 4 : prot >= 3 ? 5 : 6;
        }
      }
    }
    return super.migrateData(source);
  }
}

/* -------------------------------------------- */
/*  Shield                                      */
/* -------------------------------------------- */

export class ProjectAnimeShield extends ProjectAnimeItemBase {
  static defineSchema() {
    const schema = super.defineSchema();
    // The Shield Style (rules: Shield Styles). "" = custom.
    schema.style = new fields.StringField({ required: false, blank: true, initial: "" });
    // Guard bonus — added to the wielder's Guard while the shield is equipped.
    schema.guardBonus = new fields.NumberField({ ...requiredInteger, initial: 1, min: 0 });
    // A shield attacks as though it were a weapon: Paired Attribute + fixed Damage + Threshold.
    schema.accuracy = accuracyField("might", "agility");
    schema.talentId = talentIdField();
    schema.damage = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 1, min: 0 })
    });
    schema.threshold = new fields.NumberField({ ...requiredInteger, initial: 10, min: 0 });
    schema.weaponType = new fields.StringField({ required: false, blank: true, initial: "" });
    schema.range = physicalRangeField("melee", 1);
    // A Light Shield dual-wields (with weapons or a second Light Shield).
    schema.dual = new fields.BooleanField({ initial: false });
    schema.size = sizeField(2);
    schema.cost = costField();
    schema.equipped = equippedField();
    schema.hand = new fields.StringField({ required: true, blank: false, initial: "off", choices: PROJECTANIME.hands });
    // Dual-wield the shield as an off-hand weapon, or carry it for defense only.
    schema.use = new fields.StringField({ required: true, blank: false, initial: "dual", choices: PROJECTANIME.shieldUses });
    schema.container = containerField();
    return schema;
  }

  /** Shields are never two-handed; fold the pre-V2 evasion/defense bonuses into Guard. */
  static migrateData(source) {
    if (source?.hand === "two") source.hand = "off";
    if (source && source.guardBonus === undefined
      && (source.evasionBonus !== undefined || source.defenseBonus !== undefined)) {
      source.guardBonus = Math.clamp(
        (Number(source.evasionBonus) || 0) + (Number(source.defenseBonus) || 0), 0, 2);
    }
    if (source?.damage && typeof source.damage === "object"
      && source.damage.value === undefined && source.damage.mod !== undefined) {
      source.damage.value = Math.max(1, Math.round(Number(source.damage.mod) || 0) || 1);
    }
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
    // What using this consumable restores (clears), and how many boxes.
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
 * Saiyan Techniques. The grant itself lives on the Package's Active Effects (a "Grant Item"
 * rule, drag-built in the Effect Builder); when the Package lands on an actor the granted
 * Items are created for free (see effects.mjs syncGrants).
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
