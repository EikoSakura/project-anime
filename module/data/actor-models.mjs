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
 * One per-character Bond — a tracked relationship the player keeps on their own sheet (rank 0–5,
 * per-rank ability boons, a dossier, vitals, a quote). The shape mirrors helpers/bonds.mjs
 * `blankBond`, the single source for fresh bonds; players author and rank these freely. `faction`
 * is an optional id into the world's Factions (helpers/factions.mjs, surfaced on the Party sheet).
 */
function bondField() {
  const rid = () => foundry.utils.randomID();
  return new fields.SchemaField({
    id: new fields.StringField({ required: true, blank: false, initial: rid }),
    name: new fields.StringField({ required: false, blank: true, initial: "" }),
    faction: new fields.StringField({ required: false, blank: true, initial: "" }),
    actorUuid: new fields.StringField({ required: false, blank: true, initial: "" }),
    img: new fields.StringField({ required: false, blank: true, initial: "" }),
    banner: new fields.StringField({ required: false, blank: true, initial: "" }),
    accent: new fields.StringField({ required: false, blank: true, initial: "" }),
    title: new fields.StringField({ required: false, blank: true, initial: "" }),
    rank: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0, max: 5 }),
    prog: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0, max: 100 }),
    // Highest bond rank whose linked-NPC rewards have already been delivered to this character —
    // idempotency for the re-drag sync (helpers/bonds.mjs deliverBondRewards). 0 = none yet.
    rewardedRank: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0, max: 5 }),
    locked: new fields.BooleanField({ initial: false }),
    vitals: new fields.ArrayField(new fields.SchemaField({
      id: new fields.StringField({ required: true, blank: false, initial: rid }),
      k: new fields.StringField({ required: false, blank: true, initial: "" }),
      v: new fields.StringField({ required: false, blank: true, initial: "" })
    }), { initial: [] }),
    dossier: new fields.StringField({ required: false, blank: true, initial: "" }),
    quote: new fields.StringField({ required: false, blank: true, initial: "" }),
    abilities: new fields.ArrayField(new fields.SchemaField({
      rank: new fields.NumberField({ ...requiredInteger, initial: 1, min: 1, max: 5 }),
      name: new fields.StringField({ required: false, blank: true, initial: "" }),
      desc: new fields.StringField({ required: false, blank: true, initial: "" }),
      // The no-code Effect this rank unlocks (Grant Items/Skills + buffs + Skill adjustments), authored in
      // the shared Effect Builder on the NPC offer and copied here on forge. Projected as an always-on
      // AE while the bond holds this rank — and its Grant rules delivered once — by helpers/bond-effect.mjs.
      rules: new fields.ArrayField(new fields.ObjectField(), { initial: [] }),
      // When true, the projected effect is a PLAYER toggle (off by default) rather than always-on — for a
      // situational boon like "+1 Charm vs nobles" the player flips on when relevant (effects.mjs toggle gate).
      toggle: new fields.BooleanField({ initial: false })
    }), { initial: [] })
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
      // EFFECTIVE maximum: the authored max (Spirit×2 + stat buys) minus the Passive-Skill tax
      // and the servant tax (Animate's raised servants each lock part of it — rules v0.01).
      max: new fields.NumberField({ ...requiredInteger, initial: 8, min: 0 }),
      // Derived each prepare (never authored): `base` = the un-taxed maximum, so advancement
      // buys/refunds and the creators' "vitals" baseline operate on it; `passiveTax` = the total
      // max-Energy reduction from owned Passive Skills (each costs half its nominal Energy);
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
    let shieldDefense = 0;
    let containerBonus = 0;
    let passiveEnergyTax = 0;

    for (const item of this.parent?.items ?? []) {
      const data = item.system ?? {};
      // Passive Skills tax max Energy (applied after the loop); they carry no load or gear.
      if (item.type === "skill") {
        passiveEnergyTax += Number(data.passiveEnergyTax) || 0;
        continue;
      }
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
        // With two shields equipped, only the higher bonus of each kind applies.
        shieldEvasion = Math.max(shieldEvasion, Number(data.evasionBonus ?? 0) || 0);
        shieldDefense = Math.max(shieldDefense, Number(data.defenseBonus ?? 0) || 0);
      }
    }

    // Everything Evasion adds on top of the Attribute (manual bonus, armor penalty, shield),
    // kept separately so Skill Evasion (rules v0.01) can rebuild the total around a DIFFERENT
    // Attribute: swap Agility for Mind/Charm/Spirit, keep every other bonus and penalty.
    this.evasion.gearMod = (this.evasion.bonus ?? 0) - evasionPenalty + shieldEvasion;
    this.evasion.value = Math.max(0, agility + this.evasion.gearMod);
    this.movement.value = Math.floor(agility / 2) + 3 + (this.movement.bonus ?? 0);
    this.defense.value = (this.defense.bonus ?? 0) + defenseFromArmor + shieldDefense;
    this.carryingCapacity.max = might + 3 + (this.carryingCapacity.bonus ?? 0) + containerBonus;
    this.carryingCapacity.value = load;
    this.carryingCapacity.overloaded = load > this.carryingCapacity.max;

    // Active status conditions and their movement effects.
    const statuses = this.parent?.statuses ?? new Set();
    for (const c of PROJECTANIME.conditionKeys) this.conditions[c] = statuses.has(c);
    if (this.conditions.bound || this.conditions.prone) this.movement.value = 0;
    else if (this.conditions.slowed) this.movement.value = Math.floor(this.movement.value / 2);

    this.hp.value = Math.clamp(this.hp.value, 0, this.hp.max);

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

    // BONDS — the character's own relationship cards (the "Bonds" sheet drawer). Per-character,
    // player-authored; each is a rank 0–5 tarot card with abilities + a dossier. Formerly the
    // shared, GM-only "Covenant" codex — Factions stayed world-level (Party sheet), Bonds moved here.
    schema.bonds = new fields.ArrayField(bondField(), { initial: [] });

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

    // Star rating (1–5) — the NPC's per-monster POWER LEVEL, the partner to its Tier (role). It is a
    // LOCAL Encounter Power: substituted for the global dial when the Monster Creator builds/scales
    // this NPC and when the encounter budget prices it (see helpers/config.mjs starPower /
    // starOrDialPower). 0 = unrated → fall back to the global dial (and the badge hides the stars).
    schema.stars = new fields.NumberField({ required: false, integer: true, initial: 0, min: 0, max: 5 });

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
    // NPC that offers a Bond). Toggled on the sheet header; defaults monster so existing NPCs are
    // unchanged. Drives the sheet layout (sheets/actor-sheet.mjs).
    schema.role = new fields.StringField({ required: true, blank: false, initial: "monster", choices: PROJECTANIME.npcRoles });

    // The Bond this NPC OFFERS — only meaningful in the "npc" role. The GM authors it on the NPC's
    // Bond drawer; dragging the NPC onto a Player Character forges/syncs a matching bond on that PC
    // and delivers each rank's rewards (helpers/bonds.mjs forgeBondFromNpc). The bond's name +
    // portrait default from the NPC itself; these are the extra fields.
    schema.bond = new fields.SchemaField({
      title: new fields.StringField({ required: false, blank: true, initial: "" }),
      accent: new fields.StringField({ required: false, blank: true, initial: "" }),
      banner: new fields.StringField({ required: false, blank: true, initial: "" }),
      faction: new fields.StringField({ required: false, blank: true, initial: "" }),
      dossier: new fields.StringField({ required: false, blank: true, initial: "" }),
      quote: new fields.StringField({ required: false, blank: true, initial: "" }),
      vitals: new fields.ArrayField(new fields.SchemaField({
        id: new fields.StringField({ required: true, blank: false, initial: () => foundry.utils.randomID() }),
        k: new fields.StringField({ required: false, blank: true, initial: "" }),
        v: new fields.StringField({ required: false, blank: true, initial: "" })
      }), { initial: [] }),
      // One row per bond Rank (1–5): the ability boon it unlocks + the rewards delivered on reaching
      // it. rewardItems are self-contained Item snapshots (toObject), so a reward survives the source
      // item being moved or deleted. Seeded with five empty rows.
      ranks: new fields.ArrayField(new fields.SchemaField({
        rank: new fields.NumberField({ ...requiredInteger, initial: 1, min: 1, max: 5 }),
        abilityName: new fields.StringField({ required: false, blank: true, initial: "" }),
        abilityDesc: new fields.StringField({ required: false, blank: true, initial: "" }),
        rewardGold: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
        rewardSP: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
        rewardItems: new fields.ArrayField(new fields.ObjectField(), { initial: [] }),
        // The mechanical Effect this rank grants — no-code Effect-Builder rules (Grant Items/Skills,
        // passive buffs, Skill adjustments). Authored via the rank's "Edit Effect" button; copied onto the
        // player's bond and projected/delivered as they deepen the bond (helpers/bond-effect.mjs).
        rules: new fields.ArrayField(new fields.ObjectField(), { initial: [] }),
        // Mark this rank's effect a PLAYER toggle (off by default) instead of always-on — for a
        // situational boon like "+1 Charm vs nobles". Copied to the player's bond + projected with the
        // toggle flag (helpers/bond-effect.mjs); flipped by the player at roll time (effects.mjs gate).
        toggle: new fields.BooleanField({ initial: false })
      }), { initial: () => [1, 2, 3, 4, 5].map((r) => ({ rank: r, abilityName: "", abilityDesc: "", rewardGold: 0, rewardSP: 0, rewardItems: [], rules: [], toggle: false })) })
    });

    // ---- HQ work profile (roster mechanics; see the Codex Home / HQ tab) ----------------------
    // TALENTS — five work dice (like Attributes, but for downtime jobs): a recruited NPC rolls these
    // for dispatch missions and scales facility output by them. UNIQUE TRAIT — a signature (name +
    // blurb). TRAIT BONUSES — a flat +N to a Talent / Attribute / HQ output (gold|sp|success) when
    // this NPC does the matching work. NPC-only for now (PCs stay combat-only).
    schema.talents = new fields.SchemaField({
      exploration: talentField(),
      craft: talentField(),
      commerce: talentField(),
      lore: talentField(),
      medicine: talentField()
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
   *  rule can Bolster/Hinder the work die, mirroring how attributes are handled on the base). */
  prepareBaseData() {
    super.prepareBaseData();
    for (const t of Object.values(this.talents ?? {})) t.value = t.base;
  }

  /** Clamp each Talent's post-effect `value` to a legal die size (d4–d12), after Active Effects. */
  prepareDerivedData() {
    super.prepareDerivedData();
    for (const t of Object.values(this.talents ?? {})) t.value = Math.clamp(t.value, 4, 12);
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

    // Manual estimate — plan a fight WITHOUT a built roster. When `encounterManual` is on, the
    // budget is driven by the typed party total Skill Points (`encounterSP`) instead of the
    // roster's summed power; `encounterPlayers` is an action-economy guide only (it does not
    // scale the budget — see helpers/encounter.mjs).
    schema.encounterManual = new fields.BooleanField({ initial: false });
    schema.encounterPlayers = new fields.NumberField({ ...requiredInteger, initial: 4, min: 1 });
    schema.encounterSP = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });

    // Shared party treasury — a Gold pool the Stash tab can split evenly among members.
    schema.gold = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });

    return schema;
  }
}
