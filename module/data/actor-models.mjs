import { PROJECTANIME, enemyStrongAttrs, enemyTierDie, tierFromRank } from "../helpers/config.mjs";
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

/**
 * A Talent — an NPC's work die for HQ downtime jobs (Exploration / Craft / Commerce / Lore /
 * Medicine). Only `base` is stored (4–12 = the die size); the die string is derived where used
 * (`d${base}`). A slimmed attributeField — no derived `value`, since Talents aren't Bolstered in play.
 */
function talentField(initial = 4) {
  return new fields.SchemaField({
    base: new fields.NumberField({ ...requiredInteger, initial, min: 4, max: 12 }),
    // Current die size: seeded from `base` in prepareBaseData, then Active Effects may Bolster/Hinder
    // it (a `talent` rule — effects.mjs) before it's clamped to [4,12] in prepareDerivedData. Declared
    // so AEs can target `system.talents.<k>.value` cleanly, mirroring attributes. `base` is the
    // unchanging creation value; `value` is "now" (what the HQ dispatch math rolls — factions.mjs).
    value: new fields.NumberField({ ...requiredInteger, initial, min: 0 })
  });
}

/**
 * One per-character Bond (rules doc "Variant Rules: Bond", v0.03) — a relationship shared between
 * EXACTLY two characters, kept on each partner's own sheet. `kind` is "party" (PC↔PC, automated
 * Party benefits) or "follower" (PC↔NPC, Follower benefits). Ranks are C/B/A/S, stored as index 0–3;
 * the bond deepens as it earns Bond Points (`bp`) and the pair plays a Bond Scene (config
 * bondThresholds / bondEligibleRank). The shape mirrors helpers/bonds.mjs `blankBond`, the single
 * source for fresh bonds; both sides are kept in sync (helpers/bonds.mjs syncPartner).
 */
function bondField() {
  const rid = () => foundry.utils.randomID();
  return new fields.SchemaField({
    id: new fields.StringField({ required: true, blank: false, initial: rid }),
    kind: new fields.StringField({ required: true, blank: false, initial: "follower", choices: PROJECTANIME.bondKinds }),
    // The OTHER character in the pair — a Player Character (party) or an NPC (follower). Cached name /
    // img / title / quote so the card renders without resolving the actor.
    partnerUuid: new fields.StringField({ required: false, blank: true, initial: "" }),
    name: new fields.StringField({ required: false, blank: true, initial: "" }),
    img: new fields.StringField({ required: false, blank: true, initial: "" }),
    title: new fields.StringField({ required: false, blank: true, initial: "" }),
    quote: new fields.StringField({ required: false, blank: true, initial: "" }),
    accent: new fields.StringField({ required: false, blank: true, initial: "" }),
    // Rank index 0–3 (C/B/A/S) and lifetime Bond Points. Rank rises only via a Bond Scene once BP
    // clears the next threshold — so the stored rank can trail eligibility (the "ready to rank up" gate).
    rank: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0, max: 3 }),
    bp: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
    // Follower rank-B "Aid" pick ("livelihood" | "hearth" | "access"); "" until chosen.
    aidChoice: new fields.StringField({ required: false, blank: true, initial: "" }),
    // GM-shaped flavour text per benefit key (sideBySide/backToBack/dualStrike or welcome/aid/lesson/
    // devotion). Optional — the preset description shows when a key is blank.
    notes: new fields.ObjectField({ required: false, initial: () => ({}) }),
    // Follower HQ hooks (feed Renown / stewarding in Phase 6): the follower's Favored Facility — a
    // snapshot (name + FA icon) of an HQ facility dragged onto the bond — and whether they reside at HQ.
    favoredFacility: new fields.StringField({ required: false, blank: true, initial: "" }),
    favoredFacilityIcon: new fields.StringField({ required: false, blank: true, initial: "" }),
    resides: new fields.BooleanField({ initial: false }),
    // Party rank-S Union Skill: the owned Skill item id built for this pair (each partner carries a copy
    // flagged `union`). "" until built.
    unionSkillId: new fields.StringField({ required: false, blank: true, initial: "" }),
    // Once-per-window guards — store the id of the window a boon was last claimed in, so the same window
    // can't grant it twice: sceneRestId (Bond Scene BP, 1/rest), standingCombatId (Standing Together BP,
    // 1/Conflict), dualStrikeCombatId (Dual Strike used, 1/Conflict).
    sceneRestId: new fields.StringField({ required: false, blank: true, initial: "" }),
    standingCombatId: new fields.StringField({ required: false, blank: true, initial: "" }),
    dualStrikeCombatId: new fields.StringField({ required: false, blank: true, initial: "" })
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

    // HP and Energy are fixed at creation (PCs: 6 + Might×2 / 6 + Spirit×2 — the Character subclass
    // overrides both initials to the d4 baseline 14; NPC vitals come from the Monster Creator).
    schema.hp = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 8, min: 0 }),
      max: new fields.NumberField({ ...requiredInteger, initial: 8, min: 0 })
    });
    schema.energy = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 8, min: 0 }),
      // EFFECTIVE maximum: the authored max (6 + Spirit×2 + stat buys) minus the Passive-Skill tax
      // and the servant tax (Animate's raised servants each lock part of it — rules v0.01).
      max: new fields.NumberField({ ...requiredInteger, initial: 8, min: 0 }),
      // Derived each prepare (never authored): `base` = the un-taxed maximum, so advancement
      // buys/refunds and the creators' "vitals" baseline operate on it; `passiveTax` = the total
      // max-Energy reduction from owned Passive Skills (each costs its FULL Energy, SP×2 — v0.03);
      // `servantTax` = the total locked by active servants (flags.project-anime.servants — the
      // ledger helpers/servants.mjs maintains as servants are raised and dismissed).
      base: new fields.NumberField({ ...requiredInteger, initial: 8, min: 0 }),
      passiveTax: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      servantTax: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 })
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
    schema.res = new fields.SchemaField({
      bonus: new fields.NumberField({ ...requiredInteger, initial: 0 }),
      value: new fields.NumberField({ ...requiredInteger, initial: 0 })
    });
    schema.atk = new fields.SchemaField({
      bonus: new fields.NumberField({ ...requiredInteger, initial: 0 }),
      value: new fields.NumberField({ ...requiredInteger, initial: 0 })
    });
    schema.matk = new fields.SchemaField({
      bonus: new fields.NumberField({ ...requiredInteger, initial: 0 }),
      value: new fields.NumberField({ ...requiredInteger, initial: 0 })
    });
    schema.as = new fields.SchemaField({
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
    const mind = this.attributes.mind.value;
    const spirit = this.attributes.spirit.value;

    // Aggregate contributions from embedded Items (load + equipped gear).
    let load = 0;
    let armorDefSplit = 0;
    let armorResSplit = 0;
    let armorEvasionMod = 0;
    let shieldEvasion = 0;
    let shieldDefense = 0;
    let containerBonus = 0;
    let passiveEnergyTax = 0;
    let weaponDmg = 0;
    let gearBulk = 0;
    let foundMainWeapon = false;

    for (const item of this.parent?.items ?? []) {
      const data = item.system ?? {};
      if (item.type === "skill") {
        passiveEnergyTax += Number(data.passiveEnergyTax) || 0;
        continue;
      }
      // Materials don't use the generic size×qty Bulk — they bundle at 3 units per 1 (derived `bulk`).
      if (item.type === "material") {
        load += Number(data.bulk) || 0;
        continue;
      }
      const qty = Number(data.quantity ?? 1) || 1;
      load += (Number(data.size ?? 0) || 0) * qty;
      if (item.type === "container") {
        containerBonus += Number(data.capacityBonus ?? 0) || 0;
        continue;
      }
      if (!data.equipped) continue;
      if (item.type === "armor") {
        armorDefSplit += Number(data.defSplit ?? data.defenseBonus ?? 0) || 0;
        armorResSplit += Number(data.resSplit ?? 0) || 0;
        armorEvasionMod += Number(data.evasionMod ?? -(Number(data.evasionPenalty ?? 0) || 0)) || 0;
      } else if (item.type === "shield") {
        shieldEvasion = Math.max(shieldEvasion, Number(data.evasionBonus ?? 0) || 0);
        shieldDefense = Math.max(shieldDefense, Number(data.defenseBonus ?? 0) || 0);
        gearBulk += Number(data.size) || 0;
      } else if (item.type === "weapon") {
        gearBulk += Number(data.size) || 0;
        // Main-hand DMG feeds the ATK/MATK display stats only — an actual strike reads the
        // striking weapon's own DMG (helpers/dice.mjs computeDamageRoll).
        if (!foundMainWeapon) {
          weaponDmg = Number(data.damage?.mod) || 0;
          if (data.hand === "main") foundMainWeapon = true;
        }
      }
    }

    // ATK = Might + Weapon DMG (main hand; unconditional — 0 DMG unarmed)
    this.atk.value = might + weaponDmg + (this.atk.bonus ?? 0);
    // MATK = Mind + Weapon DMG (main hand)
    this.matk.value = mind + weaponDmg + (this.matk.bonus ?? 0);
    // DEF = Might half-score + armor Protection→DEF + shield DEF + bonus
    this.defense.value = (this.defense.bonus ?? 0) + Math.floor(might / 2) + armorDefSplit + shieldDefense;
    // RES = Spirit half-score + armor Protection→RES + bonus
    this.res.value = (this.res.bonus ?? 0) + Math.floor(spirit / 2) + armorResSplit;
    // EVA = 5 + Agility half-score + gear mod (armor evasionMod + shield evasionBonus + manual bonus)
    this.evasion.gearMod = (this.evasion.bonus ?? 0) + armorEvasionMod + shieldEvasion;
    this.evasion.value = Math.max(0, 5 + Math.floor(agility / 2) + this.evasion.gearMod);
    // AS = Agility − total Bulk of equipped weapons and shields (minimum 0)
    this.as.value = Math.max(0, agility - gearBulk + (this.as.bonus ?? 0));
    // MOV = floor(Agility/2) + 3 + bonus (unchanged)
    this.movement.value = Math.floor(agility / 2) + 3 + (this.movement.bonus ?? 0);
    // CAP = Might + 3 + bonus (unchanged)
    this.carryingCapacity.max = might + 3 + (this.carryingCapacity.bonus ?? 0) + containerBonus;
    this.carryingCapacity.value = load;
    this.carryingCapacity.overloaded = load > this.carryingCapacity.max;

    // Active status conditions and their movement effects.
    const statuses = this.parent?.statuses ?? new Set();
    for (const c of PROJECTANIME.conditionKeys) this.conditions[c] = statuses.has(c);
    if (this.conditions.bound || this.conditions.prone) this.movement.value = 0;
    else if (this.conditions.slowed) this.movement.value = Math.floor(this.movement.value / 2);

    this.hp.value = Math.clamp(this.hp.value, 0, this.hp.max);

    // Critical (v0.03): HP at or below 25% of max, rounded down — some Skills trigger on
    // entering it (the "Critical" React trigger); 0 HP is Defeated, not Critical.
    this.critical = this.hp.value > 0 && this.hp.value <= Math.floor(this.hp.max * 0.25);

    // Passive Skills tax the maximum Energy, and so does each raised servant (Animate, rules
    // v0.01 — its ledger lives on the actor's own flags, so no cross-actor reads at prepare
    // time): `max` becomes the EFFECTIVE pool (authored maximum minus both taxes), while `base`
    // keeps the un-taxed maximum for advancement math + the creators.
    let servantTax = 0;
    const servants = this.parent?.flags?.["project-anime"]?.servants ?? {};
    for (const entry of Object.values(servants)) servantTax += Math.max(0, Number(entry?.tax) || 0);
    this.energy.base = this.energy.max;
    this.energy.passiveTax = passiveEnergyTax;
    this.energy.servantTax = servantTax;
    this.energy.max = Math.max(0, this.energy.max - passiveEnergyTax - servantTax);
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

    // HP = 6 + ⟪Might⟫×2 (v0.03) — a fresh all-d4 Character starts at 14.
    schema.hp = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 14, min: 0 }),
      max: new fields.NumberField({ ...requiredInteger, initial: 14, min: 0 })
    });

    // Energy = 6 + ⟪Spirit⟫×2 (v0.03) — the flat +6 mirrors HP so nobody is priced out of their own
    // Skills; a fresh all-d4 Character starts at 14. (base/passiveTax/servantTax are derived, so the
    // parent schema's fields carry through — only the authored max/value baseline moves.)
    schema.energy = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 14, min: 0 }),
      max: new fields.NumberField({ ...requiredInteger, initial: 14, min: 0 }),
      base: new fields.NumberField({ ...requiredInteger, initial: 14, min: 0 }),
      passiveTax: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      servantTax: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 })
    });

    schema.gold = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });

    schema.skillPoints = new fields.SchemaField({
      // Starting SP comes from the GM's Character-Creation setting (default 6). As a field
      // `initial` function it applies only to freshly-created characters; duplicated/imported
      // actors keep their stored value (the function isn't called when the field is present).
      value: new fields.NumberField({ ...requiredInteger, initial: () => creationStartingSkillPoints(), min: 0 }),
      // LEGACY scalar — superseded by `log` (below). Kept so old data still validates and the
      // one-time log backfill can read pre-existing advancement spend from it. No longer written.
      spent: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      // Lifetime SP EARNED in play (Milestones + Train) — creation SP never counts, spending never
      // lowers it. Drives the Rank ladder (config `ranks`); seeded once by migrateRankV003.
      earned: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
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

    // BONDS — the character's own relationship cards (the "Bonds" sheet drawer). Per-character,
    // player-authored; each is a rank 0–5 tarot card with abilities + a dossier. Formerly the
    // shared, GM-only "Covenant" codex — Factions stayed world-level (Party sheet), Bonds moved here.
    schema.bonds = new fields.ArrayField(bondField(), { initial: [] });

    // SPECIALTY (v0.03 Crafting) — a single crafting discipline (Brewer/Fieldcrafter/Salvager/Smith/
    // Steward), learned at a rest for 1 SP (apps/advancement.mjs). "" = none. One per character.
    schema.specialty = new fields.StringField({ required: false, blank: true, initial: "" });

    // RANK F–S (v0.03 "Rank and Tier"), stored as index 0–6. Set by lifetime SP earned
    // (`skillPoints.earned`) but rises only at a rest (apps/rest.mjs) — so the stored rank can
    // trail eligibility between rests. Never decreases. The character's own Tier derives from it
    // (config tierFromRank) and gates Temper + the Tier Ceilings.
    schema.rank = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0, max: 6 });

    return schema;
  }

  /** @override — Tier Ceilings (v0.03 "Rank and Tier"): after every contribution is summed,
   *  a character's DEF/RES cap at 9/11/13/15 by their own Tier and EVA caps at 12. The caps
   *  count everything (armor, Attributes, Bonds, shields, Skills, Statuses, Temper, Traits);
   *  ATK is uncapped. Monsters answer to the Four Rails instead, so this lives on Characters. */
  prepareDerivedData() {
    super.prepareDerivedData();
    const cap = PROJECTANIME.tierCeilings;
    const tier = tierFromRank(this.rank);
    this.defense.value = Math.min(this.defense.value, cap.def[tier - 1]);
    this.res.value = Math.min(this.res.value, cap.res[tier - 1]);
    this.evasion.value = Math.min(this.evasion.value, cap.eva);
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
      // NPCs are enemies by default (this is the monster sheet) — so they read Hostile and their
      // defeated tokens auto-hide. A future friendly/bystander NPC sheet type should default neutral.
      initial: "hostile",
      choices: PROJECTANIME.dispositions
    });

    // Monster "Tier" — the anime combat ROLE / shape the Monster Creator stamps on (see
    // PROJECTANIME.monsterTiers). A free StringField (not `choices`-locked) so the Tier
    // table can be renamed/retuned freely and hand-editing stays valid; "" = an untiered
    // NPC (a plain NPC the GM didn't run through the Monster Creator).
    schema.tier = new fields.StringField({ required: false, blank: true, initial: "" });

    // Star rating (1–5) — LEGACY (pre-v0.03 ★ power level). Retired by the Role × Tier model below;
    // kept only so stored data validates and the one-time npcRoleV003 migration can read it.
    schema.stars = new fields.NumberField({ required: false, integer: true, initial: 0, min: 0, max: 5 });

    // ---- Enemy model (v0.03: Role × Tier, Strong / Weak dice) ---------------------------------
    // ROLE — the combat archetype (Grunt / Brute / Skirmisher / Caster / Support / Swarm / Elite). It
    // sets which Attributes are Strong, the flat stat deltas, the HP multiplier, and the Threat cost.
    // A free StringField (not `choices`-locked) so the Role table can be retuned and hand-edits stay
    // valid; "" = an untiered NPC the GM didn't run through the Monster Creator.
    schema.enemyRole = new fields.StringField({ required: false, blank: true, initial: "" });
    // TIER — the party power band I–IV (1–4). 0 = untiered. The Strong die is the tier die; the Weak
    // die is two rungs down (config enemyTierDice). Distinct from the legacy `tier` string (kept for
    // the Animate servant tax).
    schema.enemyTier = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0, max: 4 });
    // STRONG ATTRIBUTES — for an Elite (or Build-Your-Own), which three Attributes use the Strong die.
    // For a fixed-Role enemy this is derived from the Role and this stored value is ignored.
    schema.strongAttrs = new fields.ArrayField(new fields.StringField({ required: true, blank: false }), { initial: [] });
    // RIVAL — a recurring named villain built on full PC rules; counts as Elite + 1 Threat (= 3) and
    // grows with the party. A designation only; the statblock is authored like any other NPC/PC.
    schema.rival = new fields.BooleanField({ initial: false });
    // BOSS — one enemy built to fight the whole party. Its HP is replaced by BARS: `bars` = the max Bar
    // count (⌈party ÷ 2⌉), `barHp` = one Bar's HP (8/10/12/14 × party by Tier), `remaining` = Bars not
    // yet broken (starts = bars), `broken` = Bars destroyed (Desperation: +2 ATK each), `resolveUsed` =
    // whether this Bar's once-per-Bar Resolve (shrug a Detrimental Status) has fired. On a Bar break the
    // token HP bar (which shows ONE Bar) refills, excess damage is lost, statuses end, and it may Shift.
    schema.boss = new fields.SchemaField({
      enabled: new fields.BooleanField({ initial: false }),
      bars: new fields.NumberField({ ...requiredInteger, initial: 1, min: 1 }),
      barHp: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      remaining: new fields.NumberField({ ...requiredInteger, initial: 1, min: 0 }),
      broken: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      resolveUsed: new fields.BooleanField({ initial: false })
    });

    // MINION SQUAD — a Minion-Tier NPC fields as a pooled unit (helpers/squad.mjs). `size` is the
    // member count (1 = a lone minion / not yet a squad); `memberHp` is the per-member HP pool,
    // recorded the first time the unit becomes a squad so resizing recomputes cleanly. The EFFECTIVE
    // max HP is derived (memberHp × size) below, but only at size ≥ 2 — so a size-1 minion keeps its
    // authored HP and every non-Minion is untouched. Squad behaviour is inert outside the Minion Tier.
    schema.squad = new fields.SchemaField({
      size: new fields.NumberField({ ...requiredInteger, initial: 1, min: 1 }),
      memberHp: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 })
    });

    // Tracked so the Scouter accessory can reveal an NPC's Skill Points. NPCs now carry the SAME
    // refundable ledger PCs do: `log` is the source of truth for "Spent" once present, so the Skill
    // Point Log dialog + recordSkillPointSpend treat NPCs and PCs identically (documents/actor.mjs
    // routes a spend to the log when it's an array). The `spent` scalar is LEGACY — kept so old data
    // validates and the one-time NPC backfill (project-anime.mjs) can read pre-ledger spend from it.
    schema.skillPoints = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      spent: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      log: new fields.ArrayField(
        new fields.SchemaField({
          id: new fields.StringField({ required: true, blank: false }),
          label: new fields.StringField({ required: true, blank: true }),
          amount: new fields.NumberField({ ...requiredInteger, initial: 0 }),
          // "skill" | "improve" | "attribute" | "stat" | "legacy" — drives the icon + how Refund reverses it.
          kind: new fields.StringField({ required: true, blank: false, initial: "skill" }),
          ref: new fields.StringField({ required: false, blank: true, initial: "" }),
          data: new fields.ObjectField({ required: false }),
          time: new fields.NumberField({ required: false, nullable: true, initial: null })
        }),
        { initial: [] }
      )
    });

    // Role — "monster" (the combat statblock: Tier + Monster Creator, hostile) or "npc" (a social
    // NPC a PC can forge a Follower Bond with). Toggled on the sheet header; defaults monster so
    // existing NPCs are unchanged. Drives the sheet layout (sheets/actor-sheet.mjs).
    schema.role = new fields.StringField({ required: true, blank: false, initial: "monster", choices: PROJECTANIME.npcRoles });

    // A social NPC's Faction affiliation — an optional id into the world's Factions (helpers/
    // factions.mjs), authored on the Biography "Profile". (Was system.bond.faction before v0.3.4.)
    schema.faction = new fields.StringField({ required: false, blank: true, initial: "" });

    // ---- HQ work profile (roster mechanics; see the Codex Home / HQ tab) ----------------------
    // TALENTS — five work dice (like Attributes, but for downtime jobs): a recruited NPC rolls these
    // for dispatch missions and scales facility output by them. UNIQUE TRAIT — a signature (name +
    // blurb). TRAIT BONUSES — a flat +N to a Talent / Attribute / HQ output (gold|sp|success) when
    // this NPC does the matching work. NPC-only for now (PCs stay combat-only).
    schema.talents = new fields.SchemaField({
      combat: talentField(),
      commerce: talentField(),
      craft: talentField(),
      exploration: talentField(),
      lore: talentField()
    });
    // SIGNATURE TRAIT — the NPC's ONE unique, defining ability, shown as a skill-style card. `name` /
    // `img` are the card's title + icon; `desc` is optional flavor (for bespoke abilities the rule
    // vocabulary can't yet express — e.g. "crafted weapons gain +1 Quality"); `rules` are the
    // dropdown-built mechanical effect. Authored in the shared no-code Effect Builder ("data mode") and
    // projected onto the actor as a flagged, always-on AE by reconcileTraits (helpers/trait-effect.mjs).
    // Empty `rules` → nothing projected (the card can still carry a name + flavor).
    schema.trait = new fields.SchemaField({
      name: new fields.StringField({ required: false, blank: true, initial: "" }),
      desc: new fields.StringField({ required: false, blank: true, initial: "" }),
      img: new fields.StringField({ required: false, blank: true, initial: "" }),
      rules: new fields.ArrayField(new fields.ObjectField(), { initial: [] })
    });
    // TRAITS — generic, reusable bonus-abilities (an NPC may have several), each its own skill-style
    // card authored in the Effect Builder and projected as its own always-on AE (reconcileTraits). These
    // replace the old flat `traitBonuses` rows; each carries a stable `id` for its AE flag key.
    schema.traits = new fields.ArrayField(new fields.SchemaField({
      id: new fields.StringField({ required: true, blank: false, initial: () => foundry.utils.randomID() }),
      name: new fields.StringField({ required: false, blank: true, initial: "" }),
      img: new fields.StringField({ required: false, blank: true, initial: "" }),
      rules: new fields.ArrayField(new fields.ObjectField(), { initial: [] })
    }), { initial: [] });
    // LEGACY flat Trait Bonuses (+N to a Talent / Attribute / HQ output) — superseded by `traits` (the
    // Effect Builder covers the same ground via the talent / attribute / hq rules). Kept so existing
    // worlds still validate and feed the HQ dispatch math; no longer authored on the sheet.
    schema.traitBonuses = new fields.ArrayField(new fields.SchemaField({
      target: new fields.StringField({ required: false, blank: true, initial: "" }), // "talent.<k>" | "attr.<k>" | "hq.<gold|sp|success>"
      value: new fields.NumberField({ ...requiredInteger, initial: 1 })
    }), { initial: [] });

    return schema;
  }

  /** Seed each Talent's current `value` from its `base`, before Active Effects run (so a `talent`
   *  rule can Bolster/Hinder the work die), seed the enemy's two-die Attributes from its Role × Tier,
   *  and pool a legacy Minion Squad's max HP. */
  prepareBaseData() {
    super.prepareBaseData();
    for (const t of Object.values(this.talents ?? {})) t.value = t.base;
    this.#applyEnemyDice();
    this.#poolSquadHp();
  }

  /** Clamp each Talent's post-effect `value` to a legal die size (d4–d12), after Active Effects, then
   *  read back the squad's living-member count and fold in Boss Desperation. */
  prepareDerivedData() {
    super.prepareDerivedData();
    for (const t of Object.values(this.talents ?? {})) t.value = Math.clamp(t.value, 4, 12);
    this.#deriveSquadMembers();
    // Boss Desperation (v0.03): each broken Bar grants +2 ATK. Folded live so it scales as Bars break
    // in play; applied to both attack stats so a magical Boss benefits too. The token HP bar shows ONE
    // Bar (hp.max is stored = boss.barHp at build).
    if (this.boss?.enabled) {
      const bonus = 2 * (Number(this.boss.broken) || 0);
      this.atk.value += bonus;
      this.matk.value += bonus;
    }
  }

  /** v0.03 enemy model: seed each Attribute's die from the Role × Tier — the Strong die when the Role
   *  marks that Attribute Strong, else the Weak die (two rungs down, min d4). Runs in prepareBaseData,
   *  BEFORE Active Effects, so a Step Down / Bolster still adjusts exactly one Attribute from here. Only
   *  a Monster-role NPC with a real Tier (I–IV) uses the two-die model; untiered / social NPCs keep
   *  their authored Attributes. */
  #applyEnemyDice() {
    if ((this.role ?? "monster") === "npc") return;
    const tier = Number(this.enemyTier) || 0;
    if (!(tier >= 1) || !this.enemyRole) return;
    const strong = enemyStrongAttrs(this.enemyRole, this.strongAttrs);
    for (const key of PROJECTANIME.attributeKeys) {
      this.attributes[key].value = enemyTierDie(tier, strong.includes(key));
    }
  }

  /** Minion Squad pooling (helpers/squad.mjs): at size ≥ 2 the EFFECTIVE max HP becomes the per-member
   *  pool × the member count, so single-target AND area damage simply drain one shared bar (free
   *  "spill-over"). This MUST run in prepareBaseData — BEFORE the base prepareDerivedData clamps
   *  hp.value to hp.max — or a full squad's pooled current HP would be clamped down to one member's
   *  worth. Stashes the per-member pool on `squad.per` for the member read-back. Engages only for the
   *  Minion Tier at size ≥ 2; a size-1 minion and every other NPC keep their authored HP untouched. */
  #poolSquadHp() {
    const sq = this.squad ?? (this.squad = {});
    const size = Math.max(1, Math.floor(Number(sq.size) || 1));
    if (this.tier === "minion" && size >= 2) {
      // Per-member pool: the recorded value, else the current (still per-member) max as one member's worth.
      const per = Math.max(1, Number(sq.memberHp) || Number(this.hp.max) || 1);
      sq.per = per;
      sq.maxMembers = size;
      sq.isSquad = true;
      this.hp.max = per * size;
    } else {
      sq.per = Math.max(1, Number(this.hp.max) || 1);
      sq.maxMembers = 1;
      sq.isSquad = false;
    }
  }

  /** Living members = ceil(current HP / per-member pool), clamped to the squad size (ad-hoc derived,
   *  read by the bars, the token panel, the Encounter Builder, and the squad-strike). Runs in
   *  prepareDerivedData, after the base has clamped hp.value to the (already pooled) max. */
  #deriveSquadMembers() {
    const sq = this.squad ?? (this.squad = {});
    const per = Math.max(1, Number(sq.per) || 1);
    sq.members = sq.isSquad
      ? Math.min(sq.maxMembers, Math.ceil(this.hp.value / per))
      : (this.hp.value > 0 ? 1 : 0);
  }

  /**
   * Migrate legacy Tier keys. The enemy chart collapsed from five Tiers (Minion / Standard /
   * Elite / Boss / Raid Boss) to four (Minion / Standard / Elite / Solo) — the old Boss and
   * Raid Boss both fold into Solo. A stored "boss"/"raid" relabels to "solo" so the badge,
   * Tier scaling, and servant Energy-tax keep keying off a known Tier; a finished NPC keeps its
   * already-derived statblock (only the label / icon / scaling readout changes).
   */
  static migrateData(source) {
    if (source?.tier === "boss" || source?.tier === "raid") source.tier = "solo";
    // Signature Trait flattened (was `trait.effect: {name, img, rules}`): lift the icon + rules up onto
    // `trait` itself so the skill-style card reads them directly. Idempotent — a no-op once unnested.
    const eff = source?.trait?.effect;
    if (eff && typeof eff === "object") {
      if (!source.trait.img) source.trait.img = eff.img ?? "";
      if (!Array.isArray(source.trait.rules) || !source.trait.rules.length) {
        source.trait.rules = Array.isArray(eff.rules) ? eff.rules : [];
      }
      delete source.trait.effect;
    }
    return super.migrateData(source);
  }
}

/* -------------------------------------------- */
/*  Party (encounter-budget planner)            */
/* -------------------------------------------- */

/**
 * A Party — an out-of-combat planning actor. It carries no combat stats of its own; it holds
 * a roster of Player Characters and a planned "encounter" of monsters (NPCs). The Party sheet
 * derives the encounter budget in Party-Equivalents (player count + difficulty offset) and how
 * much of it the planned threats spend (each Tier worth a fixed number of PCs — Minion 0.25,
 * Standard 1, Elite 2, Solo = the party). Members and monsters are stored as UUIDs.
 */
export class ProjectAnimeParty extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const schema = {};

    // Roster — Player Character actor UUIDs.
    schema.members = new fields.ArrayField(
      new fields.StringField({ required: true, blank: false }),
      { initial: [] }
    );

    // Encounter difficulty → the Threat budget shift (see PROJECTANIME.encounterDifficulty).
    schema.difficulty = new fields.StringField({
      required: true,
      blank: false,
      initial: "standard",
      choices: PROJECTANIME.encounterDifficultyKeys
    });

    // Planned encounter — one LINE per fielded threat (each a stable `id` so duplicates are distinct:
    // dragging the same Elite twice = two bodies = two lines). A Minion line is a SQUAD whose member
    // count lives on the NPC itself (system.squad.size, helpers/squad.mjs) — there is no per-line
    // quantity any more, which retires the old "× N" multiplier. `qty` is a DEPRECATED transitional
    // field: the one-time world migration (project-anime.mjs) turns a legacy minion's qty into its
    // squad size and a non-minion's qty into that many individual lines, then clears it.
    schema.encounter = new fields.ArrayField(
      new fields.SchemaField({
        id: new fields.StringField({ required: true, blank: false, initial: () => foundry.utils.randomID() }),
        uuid: new fields.StringField({ required: true, blank: false }),
        qty: new fields.NumberField({ required: false, nullable: true, integer: true, initial: null })
      }),
      { initial: [] }
    );

    // Manual estimate — plan a fight WITHOUT a built roster: when `encounterManual` is on the budget
    // is driven by the typed player count (`encounterPlayers`) instead of the live roster size. The
    // budget is Party-Equivalents = player count + difficulty offset (see helpers/encounter.mjs).
    schema.encounterManual = new fields.BooleanField({ initial: false });
    schema.encounterPlayers = new fields.NumberField({ ...requiredInteger, initial: 4, min: 1 });

    // Shared party treasury — a Gold pool the Stash tab can split evenly among members.
    schema.gold = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });

    return schema;
  }

  /** Give every legacy encounter line a stable `id` (older data stored only {uuid, qty}); the one-time
   *  world migration then consumes `qty` into squad sizes / split lines. Idempotent. */
  static migrateData(source) {
    if (Array.isArray(source?.encounter)) {
      for (const e of source.encounter) if (e && !e.id) e.id = foundry.utils.randomID();
    }
    // Difficulty keys were renamed for the v0.03 Threat budget (Medium→Standard, Extreme/Deadly→Climax);
    // remap stored values so the StringField's `choices` validation stays valid across versions.
    if (source && typeof source.difficulty === "string") {
      if (source.difficulty === "medium") source.difficulty = "standard";
      else if (source.difficulty === "extreme" || source.difficulty === "deadly") source.difficulty = "climax";
    }
    return super.migrateData(source);
  }
}
