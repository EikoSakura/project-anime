import { PROJECTANIME } from "../helpers/config.mjs";
import { collectTradeRates } from "../helpers/effects.mjs";
import { creationStartingSkillPoints } from "../helpers/creation.mjs";

const fields = foundry.data.fields;
const requiredInteger = { required: true, nullable: false, integer: true };

/**
 * A single attribute: its current value (which equals its die size) and its
 * unchanging base value set at character creation.
 */
function attributeField(initial = 4) {
  // Only `base` is stored (the creation value). The current `value` is derived
  // in prepareBaseData so Active Effects can Bolster/Hinder it before derived
  // stats are computed. `base` never changes through play; `value` is "now".
  return new fields.SchemaField({
    base: new fields.NumberField({ ...requiredInteger, initial, min: 4, max: 12 }),
    // Current die size: seeded from base in prepareBaseData, then Active Effects may
    // Bolster/Hinder it (clamped to [4,12] in prepareDerivedData). Declared so AEs can
    // target `system.attributes.<k>.value` cleanly and the prepare writes hit real fields.
    value: new fields.NumberField({ ...requiredInteger, initial, min: 0 }),
    die: new fields.StringField({ required: true, blank: false, initial: `d${initial}` })
  });
}

/* -------------------------------------------- */
/*  Shared Actor base                           */
/* -------------------------------------------- */

/**
 * Fields and derivations shared by every actor type (PCs and NPCs).
 */
export class ProjectAnimeActorBase extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const schema = {};

    schema.attributes = new fields.SchemaField({
      might: attributeField(),
      agility: attributeField(),
      mind: attributeField(),
      spirit: attributeField(),
      charm: attributeField()
    });

    // HP and Energy are fixed at creation (Might x2 / Spirit x2) and tracked here.
    schema.hp = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 8, min: 0 }),
      max: new fields.NumberField({ ...requiredInteger, initial: 8, min: 0 })
    });
    schema.energy = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 8, min: 0 }),
      max: new fields.NumberField({ ...requiredInteger, initial: 8, min: 0 })
    });

    // Manual bonuses; the derived `.value` / `.max` are computed each prepare.
    schema.evasion = new fields.SchemaField({
      bonus: new fields.NumberField({ ...requiredInteger, initial: 0 }),
      value: new fields.NumberField({ ...requiredInteger, initial: 0 })
    });
    schema.movement = new fields.SchemaField({
      bonus: new fields.NumberField({ ...requiredInteger, initial: 0 }),
      value: new fields.NumberField({ ...requiredInteger, initial: 0 })
    });
    schema.carryingCapacity = new fields.SchemaField({
      bonus: new fields.NumberField({ ...requiredInteger, initial: 0 }),
      max: new fields.NumberField({ ...requiredInteger, initial: 0 }),
      value: new fields.NumberField({ ...requiredInteger, initial: 0 }),
      overloaded: new fields.BooleanField({ initial: false })
    });
    schema.defense = new fields.SchemaField({
      bonus: new fields.NumberField({ ...requiredInteger, initial: 0 }),
      value: new fields.NumberField({ ...requiredInteger, initial: 0 })
    });

    // Trade rates as percents of an item's list price, purely derived each prepare from the
    // base rates + any `trade` effects (e.g. a Trader's Pass). `sellRate` = recovered on sale
    // (default 50); `buyRate` = paid to purchase (default 100). Shown on the gear drawer beside
    // Gold. On the shared base so the derivation always has a field to write, though only
    // Characters (who carry Gold) actually trade. NOTE: display only — no transactions yet.
    schema.sellRate = new fields.NumberField({ ...requiredInteger, initial: 50, min: 0 });
    schema.buyRate = new fields.NumberField({ ...requiredInteger, initial: 100, min: 0 });

    // Active status conditions, derived from the actor's statuses each prepare.
    // Declared so prepareDerivedData mutates known fields rather than an ad-hoc object.
    schema.conditions = new fields.SchemaField(
      Object.fromEntries(PROJECTANIME.conditionKeys.map((k) => [k, new fields.BooleanField({ initial: false })]))
    );

    // Affinity per damage type, keyed by element id — editable on the sheet and
    // targetable by Active Effects. A flexible map (not fixed slots) so the
    // homebrew Elements setting can add/remove/rename damage types with no schema
    // change; keys absent from an actor default to "none" in the UI.
    schema.affinities = new fields.TypedObjectField(
      new fields.StringField({ required: true, blank: false, initial: "none", choices: PROJECTANIME.affinityLevels })
    );

    // Character profile / dossier shown on the Bio tab — a free-key map of field id →
    // free-text value. The field LIST (which keys, and their labels) is GM-configurable
    // via the Bio Fields setting (apps/bio-field-config.mjs), so this is a flexible
    // TypedObjectField rather than fixed slots — same shape as `affinities`. Strings
    // (not numbers) keep it anime-flexible ("Unknown", "300 (looks 16)", "172 cm"…).
    // On the shared base so NPCs get a dossier too; keys absent from an actor read "".
    schema.details = new fields.TypedObjectField(
      new fields.StringField({ required: false, blank: true })
    );

    schema.biography = new fields.HTMLField({ required: false, blank: true });

    return schema;
  }

  /**
   * Coerce legacy or invalid affinity values to "none". `affinities` is a
   * free-key TypedObjectField constrained to the affinity levels; without this,
   * a stored value outside those levels (an older shape, or a renamed level)
   * would fail validation and stop the actor from loading.
   */
  static migrateData(source) {
    if (source?.affinities && typeof source.affinities === "object") {
      for (const [key, val] of Object.entries(source.affinities)) {
        if (typeof val !== "string" || !(val in PROJECTANIME.affinityLevels)) source.affinities[key] = "none";
      }
    }
    return super.migrateData(source);
  }

  /** Seed each attribute's current `value` from its `base`. Runs before Active
   *  Effects, which may then Bolster/Hinder the current value. */
  prepareBaseData() {
    for (const key of PROJECTANIME.attributeKeys) {
      const attr = this.attributes[key];
      attr.value = attr.base;
    }
  }

  /**
   * Compute every derived combat stat. This runs after embedded Items are
   * prepared, so it can safely read `this.parent.items` for equipped gear and
   * carried load — keeping all derivation self-contained and order-independent.
   */
  prepareDerivedData() {
    for (const key of PROJECTANIME.attributeKeys) {
      const attr = this.attributes[key];
      // Clamp the post-Active-Effect value to a legal die size (Bolster caps at d12, Hinder at d4).
      attr.value = Math.clamp(attr.value, 4, 12);
      attr.die = `d${attr.value}`;
    }

    const agility = this.attributes.agility.value;
    const might = this.attributes.might.value;

    // Aggregate contributions from embedded Items (load + equipped gear).
    let load = 0;
    let defenseFromArmor = 0;
    let evasionPenalty = 0;
    let shieldEvasion = 0;
    let containerBonus = 0;

    for (const item of this.parent?.items ?? []) {
      const data = item.system ?? {};
      const qty = Number(data.quantity ?? 1) || 1;
      load += (Number(data.size ?? 0) || 0) * qty;
      // Containers (bags) always extend capacity — no "equip" step in the bag UI.
      if (item.type === "container") {
        containerBonus += Number(data.capacityBonus ?? 0) || 0;
        continue;
      }
      if (!data.equipped) continue;
      if (item.type === "armor") {
        defenseFromArmor += Number(data.defenseBonus ?? 0) || 0;
        evasionPenalty += Number(data.evasionPenalty ?? 0) || 0;
      } else if (item.type === "shield") {
        // With two shields equipped, only the higher Evasion Bonus applies.
        shieldEvasion = Math.max(shieldEvasion, Number(data.evasionBonus ?? 0) || 0);
      }
    }

    this.evasion.value = Math.max(0, agility + (this.evasion.bonus ?? 0) - evasionPenalty + shieldEvasion);
    this.movement.value = Math.floor(agility / 2) + 3 + (this.movement.bonus ?? 0);
    this.defense.value = (this.defense.bonus ?? 0) + defenseFromArmor;
    this.carryingCapacity.max = might + 3 + (this.carryingCapacity.bonus ?? 0) + containerBonus;
    this.carryingCapacity.value = load;
    this.carryingCapacity.overloaded = load > this.carryingCapacity.max;

    // Active status conditions and their movement effects.
    const statuses = this.parent?.statuses ?? new Set();
    for (const c of PROJECTANIME.conditionKeys) this.conditions[c] = statuses.has(c);
    if (this.conditions.bound || this.conditions.prone) this.movement.value = 0;
    else if (this.conditions.slowed) this.movement.value = Math.floor(this.movement.value / 2);

    this.hp.value = Math.clamp(this.hp.value, 0, this.hp.max);
    this.energy.value = Math.clamp(this.energy.value, 0, this.energy.max);

    // Effective trade rates (percent) = base + any live `trade` effects (e.g. a Trader's Pass).
    const trade = collectTradeRates(this.parent);
    this.sellRate = trade.sell;
    this.buyRate = trade.buy;
  }

  /** Expose attribute values for roll formulas: `@attributes.agility.value`, `@agility`. */
  getRollData() {
    const data = { attributes: {} };
    for (const key of PROJECTANIME.attributeKeys) {
      const attr = this.attributes[key];
      const value = attr.value ?? attr.base;
      data.attributes[key] = { value, base: attr.base, die: `d${value}` };
      data[key] = value;
    }
    data.hp = { ...this.hp };
    data.energy = { ...this.energy };
    data.evasion = this.evasion?.value ?? 0;
    data.movement = this.movement?.value ?? 0;
    data.defense = this.defense?.value ?? 0;
    return data;
  }
}

/* -------------------------------------------- */
/*  Character (Player Character)                */
/* -------------------------------------------- */

export class ProjectAnimeCharacter extends ProjectAnimeActorBase {
  static defineSchema() {
    const schema = super.defineSchema();

    schema.gold = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });

    schema.skillPoints = new fields.SchemaField({
      // Starting SP comes from the GM's Character-Creation setting (default 6). As a field
      // `initial` function it applies only to freshly-created characters; duplicated/imported
      // actors keep their stored value (the function isn't called when the field is present).
      value: new fields.NumberField({ ...requiredInteger, initial: () => creationStartingSkillPoints(), min: 0 }),
      // LEGACY scalar — superseded by `log` (below). Kept so old data still validates and the
      // one-time log backfill can read pre-existing advancement spend from it. No longer written.
      spent: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      // The Skill-Point ledger: one entry per SP spend (skill built/improved, attribute raise,
      // stat buy). It is the source of truth for "Spent" — `Spent = Σ log.amount`, and the
      // TOTAL readout = value (unspent) + Spent + free granted skills. Each entry can be
      // Refunded from the Skills drawer, which reverses the change and returns its SP. Seeded
      // once from existing skills + prior advancement by the backfill in project-anime.mjs.
      log: new fields.ArrayField(
        new fields.SchemaField({
          id: new fields.StringField({ required: true, blank: false }),
          label: new fields.StringField({ required: true, blank: true }),
          amount: new fields.NumberField({ ...requiredInteger, initial: 0 }),
          // "skill" | "improve" | "attribute" | "stat" | "legacy" — drives the icon + how Refund reverses it.
          kind: new fields.StringField({ required: true, blank: false, initial: "skill" }),
          // The thing this entry touches: a skill id (skill/improve), an attribute key, or a stat key.
          ref: new fields.StringField({ required: false, blank: true, initial: "" }),
          // Reversal payload, kind-specific: improve {op, key?}, attribute {from, to}.
          data: new fields.ObjectField({ required: false }),
          // Spend timestamp (ms) for sorting/display; null on backfilled entries.
          time: new fields.NumberField({ required: false, nullable: true, initial: null })
        }),
        { initial: [] }
      )
    });

    // Luck Dice are recorded numbers (rolled from Charm) that get spent in play.
    schema.luckDice = new fields.ArrayField(
      new fields.NumberField({ ...requiredInteger, min: 1 }),
      { initial: [] }
    );

    schema.pronouns = new fields.StringField({ required: false, blank: true });

    return schema;
  }
}

/* -------------------------------------------- */
/*  NPC                                         */
/* -------------------------------------------- */

export class ProjectAnimeNPC extends ProjectAnimeActorBase {
  static defineSchema() {
    const schema = super.defineSchema();

    schema.disposition = new fields.StringField({
      required: true,
      blank: false,
      initial: "neutral",
      choices: PROJECTANIME.dispositions
    });

    // Monster "Tier" — the anime power-ranking the Monster Creator stamps on (see
    // PROJECTANIME.monsterTiers). A free StringField (not `choices`-locked) so the Tier
    // table can be renamed/retuned freely and hand-editing stays valid; "" = an untiered
    // NPC (a plain NPC the GM didn't run through the Monster Creator).
    schema.tier = new fields.StringField({ required: false, blank: true, initial: "" });

    // Tracked so the Scouter accessory can reveal an NPC's Skill Points.
    schema.skillPoints = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      spent: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 })
    });

    return schema;
  }
}

/* -------------------------------------------- */
/*  Party (encounter-budget planner)            */
/* -------------------------------------------- */

/**
 * A Party — an out-of-combat planning actor. It carries no combat stats of its own; it holds
 * a roster of Player Characters and a planned "encounter" of monsters (NPCs). The Party sheet
 * derives the party's total Skill Points, the monster budget (Party SP × difficulty), and how
 * much of that budget the listed monsters spend. Members and monsters are stored as UUIDs.
 */
export class ProjectAnimeParty extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const schema = {};

    // Roster — Player Character actor UUIDs.
    schema.members = new fields.ArrayField(
      new fields.StringField({ required: true, blank: false }),
      { initial: [] }
    );

    // Encounter difficulty → the budget multiplier (see PROJECTANIME.encounterDifficulty).
    schema.difficulty = new fields.StringField({
      required: true,
      blank: false,
      initial: "standard",
      choices: PROJECTANIME.encounterDifficultyKeys
    });

    // Planned encounter — monster (NPC) UUIDs, each with a quantity (for "3 of these").
    schema.encounter = new fields.ArrayField(
      new fields.SchemaField({
        uuid: new fields.StringField({ required: true, blank: false }),
        qty: new fields.NumberField({ ...requiredInteger, initial: 1, min: 1 })
      }),
      { initial: [] }
    );

    // Shared party treasury — a Gold pool the Stash tab can split evenly among members.
    schema.gold = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });

    return schema;
  }
}
