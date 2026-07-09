import { PROJECTANIME } from "../helpers/config.mjs";
import { collectTradeRates } from "../helpers/effects.mjs";

const fields = foundry.data.fields;
const requiredInteger = { required: true, nullable: false, integer: true };

/**
 * A single attribute: its current value (which equals its die size) and its
 * unchanging base value set at character creation.
 */
function attributeField(initial = 4) {
  // Only `base` is stored (the creation value). The current `value` is derived
  // in prepareBaseData so Active Effects can Empower/Weaken it before derived
  // stats are computed. `base` changes only through advancement; `value` is "now".
  return new fields.SchemaField({
    base: new fields.NumberField({ ...requiredInteger, initial, min: 4, max: 12 }),
    value: new fields.NumberField({ ...requiredInteger, initial, min: 0 }),
    die: new fields.StringField({ required: true, blank: false, initial: `d${initial}` })
  });
}

/** The refundable advancement ledger rows shared by the Character model. */
function advancementLogField() {
  return new fields.ArrayField(
    new fields.SchemaField({
      id: new fields.StringField({ required: true, blank: false }),
      label: new fields.StringField({ required: true, blank: true }),
      // Advancements spent (1 for every option on the list).
      amount: new fields.NumberField({ ...requiredInteger, initial: 1 }),
      // One of PROJECTANIME.advancementOptionKeys — drives the slot caps + how Refund reverses it.
      kind: new fields.StringField({ required: true, blank: false, initial: "technique" }),
      // The thing this entry touches: an item id (technique), a `system.talents` key
      // (talent/talentStep), or an attribute key.
      ref: new fields.StringField({ required: false, blank: true, initial: "" }),
      // Reversal payload, kind-specific: attribute/talentStep {from, to}.
      data: new fields.ObjectField({ required: false }),
      time: new fields.NumberField({ required: false, nullable: true, initial: null })
    }),
    { initial: [] }
  );
}

/* -------------------------------------------- */
/*  Shared Actor base                           */
/* -------------------------------------------- */

/**
 * Fields and derivations shared by every actor type (PCs and NPCs).
 * V2 stats: Hit Boxes (base 5, max 10) · Energy Boxes (base 5, max 10) ·
 * Guard (6 + armor + shield) · Movement (set by armor).
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

    // Hit Boxes: `value` = unmarked boxes remaining, `max` = boxes owned (base 5, hard cap 10;
    // a Character's Wounds lock boxes off the effective max at derive time).
    schema.hp = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 5, min: 0 }),
      max: new fields.NumberField({ ...requiredInteger, initial: 5, min: 0 })
    });
    // Energy Boxes: Passive Techniques lock boxes from this pool (the lock is summed from owned
    // items each prepare into `passiveTax`; `base` keeps the un-locked maximum for advancement).
    schema.energy = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 5, min: 0 }),
      max: new fields.NumberField({ ...requiredInteger, initial: 5, min: 0 }),
      base: new fields.NumberField({ ...requiredInteger, initial: 5, min: 0 }),
      passiveTax: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 })
    });

    // Guard — the target number to hit this creature. Derived: 6 + armor + shield + bonus
    // (− 2 while Exposed). `bonus` is the manual/authored part (NPC stat lines write it).
    schema.guard = new fields.SchemaField({
      bonus: new fields.NumberField({ ...requiredInteger, initial: 0 }),
      value: new fields.NumberField({ ...requiredInteger, initial: 0 })
    });
    // Movement — tiles per turn. Derived from the equipped Armor Style (no armor = Unarmored 6)
    // plus `bonus`; NPC stat lines write `bonus` as an offset from the unarmored 6.
    schema.movement = new fields.SchemaField({
      bonus: new fields.NumberField({ ...requiredInteger, initial: 0 }),
      value: new fields.NumberField({ ...requiredInteger, initial: 0 })
    });

    // Trade rates as percents of an item's list price, derived each prepare from the base
    // rates + any `trade` effects (e.g. a Trader's Pass). Display data for the gear drawer.
    schema.sellRate = new fields.NumberField({ ...requiredInteger, initial: 50, min: 0 });
    schema.buyRate = new fields.NumberField({ ...requiredInteger, initial: 100, min: 0 });

    // Active status conditions, derived from the actor's statuses each prepare.
    schema.conditions = new fields.SchemaField(
      Object.fromEntries(PROJECTANIME.conditionKeys.map((k) => [k, new fields.BooleanField({ initial: false })]))
    );

    // Talents (rules: Talents) — trained disciplines (name · die d4–d12 · Primary Attribute),
    // embedded on the actor and keyed by id; weapons/Techniques link one through `talentId`.
    schema.talents = new fields.TypedObjectField(
      new fields.SchemaField({
        name: new fields.StringField({ required: true, blank: true, initial: "" }),
        die: new fields.NumberField({ ...requiredInteger, initial: 6, min: 4, max: 12 }),
        attribute: new fields.StringField({ required: true, blank: false, initial: "might", choices: PROJECTANIME.attributes })
      })
    );

    // Character profile / dossier shown on the Bio tab — a free-key map of field id → free-text
    // value. The field LIST is GM-configurable via the Bio Fields setting.
    schema.details = new fields.TypedObjectField(
      new fields.StringField({ required: false, blank: true })
    );

    schema.biography = new fields.HTMLField({ required: false, blank: true });

    return schema;
  }

  /** Seed each attribute's current `value` from its `base`. Runs before Active
   *  Effects, which may then Empower/Weaken the current value. */
  prepareBaseData() {
    for (const key of PROJECTANIME.attributeKeys) {
      const attr = this.attributes[key];
      attr.value = attr.base;
    }
  }

  /**
   * Compute every derived combat stat. This runs after embedded Items are
   * prepared, so it can safely read `this.parent.items` for equipped gear.
   */
  prepareDerivedData() {
    for (const key of PROJECTANIME.attributeKeys) {
      const attr = this.attributes[key];
      // Clamp the post-Active-Effect value to a legal die size (Empower caps at d12, Weaken at d4).
      attr.value = Math.clamp(attr.value, 4, 12);
      attr.die = `d${attr.value}`;
    }

    // Aggregate contributions from equipped gear.
    let armorGuard = 0;
    let armorMovement = null;   // null = no armor equipped → Unarmored line
    let armorRegen = null;
    let shieldGuard = 0;
    let passiveEnergyTax = 0;

    for (const item of this.parent?.items ?? []) {
      const data = item.system ?? {};
      if (item.type === "skill") {
        passiveEnergyTax += Number(data.passiveEnergyTax) || 0;
        continue;
      }
      if (!data.equipped) continue;
      if (item.type === "armor") {
        armorGuard += Number(data.guardBonus) || 0;
        const mov = Number(data.movement);
        if (Number.isFinite(mov) && mov > 0) armorMovement = mov;
        const regen = Number(data.energyRegen);
        if (Number.isFinite(regen) && regen > 0) armorRegen = regen;
      } else if (item.type === "shield") {
        shieldGuard = Math.max(shieldGuard, Number(data.guardBonus) || 0);
      }
    }

    // Guard = 6 + Armor Style Guard + Shield Style Guard + bonus (Exposed −2, below).
    this.guard.value = PROJECTANIME.baseGuard + armorGuard + shieldGuard + (this.guard.bonus ?? 0);
    // Movement is set by the Armor Style (no armor = Unarmored 6) + bonus.
    const unarmored = PROJECTANIME.armorStyles.unarmored;
    this.movement.value = Math.max(0, (armorMovement ?? unarmored.movement) + (this.movement.bonus ?? 0));
    // Energy Regen: clear 1 box at the start of each turn — Unarmored clears 2.
    this.energyRegen = armorRegen ?? (armorMovement == null ? unarmored.energyRegen : PROJECTANIME.baseEnergyRegen);

    // Active status conditions and their stat effects.
    const statuses = this.parent?.statuses ?? new Set();
    for (const c of PROJECTANIME.conditionKeys) this.conditions[c] = statuses.has(c);
    if (this.conditions.exposed) this.guard.value -= PROJECTANIME.exposedGuardPenalty;
    if (this.conditions.bound) this.movement.value = 0;
    else if (this.conditions.slowed) this.movement.value = Math.floor(this.movement.value / 2);

    // Box caps: nothing rises above 10 (rules: Stats). Wounds (Characters) lock further —
    // the Character override subtracts them after this runs.
    this.hp.max = Math.clamp(this.hp.max, 1, PROJECTANIME.maxBoxes);
    this.energy.max = Math.clamp(this.energy.max, 0, PROJECTANIME.maxBoxes);
    this.hp.value = Math.clamp(this.hp.value, 0, this.hp.max);

    // Critical (rules: Combat) — 75% of hit boxes marked. Some Techniques trigger on entering
    // it (the "Critical" React trigger); 0 boxes is Defeated, not Critical.
    this.critical = this.hp.value > 0
      && (this.hp.max - this.hp.value) >= Math.ceil(this.hp.max * PROJECTANIME.criticalMarkedFraction);

    // Passive Techniques lock energy boxes: `max` becomes the EFFECTIVE pool (authored maximum
    // minus the locks), while `base` keeps the un-locked maximum for advancement math.
    this.energy.base = this.energy.max;
    this.energy.passiveTax = passiveEnergyTax;
    this.energy.max = Math.max(0, this.energy.max - passiveEnergyTax);
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
    data.guard = this.guard?.value ?? 0;
    data.movement = this.movement?.value ?? 0;
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

    // Advancements (rules: Advancement) — earned at story Milestones (Episode 2 / Arc 4 /
    // Season 6), spent on the slot-capped Advancement List. `value` = unspent advancements;
    // `log` = one refundable entry per spend (the source of truth for slot usage: slots used
    // per option = count of log entries of that kind).
    schema.advancement = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      log: advancementLogField()
    });

    // Wounds (rules: Wounds) — each locks one hit box off the effective maximum until cleared
    // at a Town. Each carries its own description ("cracked ribs, a burned hand").
    schema.wounds = new fields.ArrayField(
      new fields.SchemaField({
        id: new fields.StringField({ required: true, blank: false, initial: () => foundry.utils.randomID() }),
        note: new fields.StringField({ required: false, blank: true, initial: "" })
      }),
      { initial: [] }
    );

    // Luck Dice are recorded numbers (three dice rolled at creation, base d6 — raised by
    // advancement, see the derived `luckDie` in prepareDerivedData) that get spent in play.
    schema.luckDice = new fields.ArrayField(
      new fields.NumberField({ ...requiredInteger, min: 1 }),
      { initial: [] }
    );

    schema.pronouns = new fields.StringField({ required: false, blank: true });

    return schema;
  }

  /** V2 re-baseline: fold the pre-V2 numeric pools (HP 14+, EP 14+) down to the box model the
   *  first time old data loads. Any stored max over the hard cap collapses to the base 5 —
   *  advancement under the new economy re-buys boxes explicitly. Idempotent: V2-era values
   *  (≤ 10) pass through untouched. */
  static migrateData(source) {
    for (const pool of ["hp", "energy"]) {
      const p = source?.[pool];
      if (p && typeof p === "object" && Number(p.max) > PROJECTANIME.maxBoxes) {
        p.max = PROJECTANIME.baseHitBoxes;
        p.value = Math.min(Number(p.value) || 0, p.max);
        if ("base" in p) p.base = p.max;
      }
    }
    return super.migrateData(source);
  }

  /** @override — Wounds lock hit boxes: the effective maximum drops by one per Wound (never
   *  below 1); Critical, Defeat, and every other rule read against the current maximum. A
   *  character with three Wounds cannot enter a Conflict Scene (`canEnterConflict`). */
  prepareDerivedData() {
    this.woundCount = (this.wounds ?? []).length;
    super.prepareDerivedData();

    // Luck Die size (rules: Luck) — base d6, stepped d6→d8→d10→d12 by each "Raise the Luck Die"
    // advancement (a "luckDie" ledger entry). Its 3-slot cap hard-limits this to d12. Held Luck
    // Dice keep their rolled faces; they reroll at this size on the next rest.
    const luckSteps = (this.advancement?.log ?? []).filter((e) => e.kind === "luckDie").length;
    this.luckDie = Math.min(PROJECTANIME.luckDieMax, PROJECTANIME.luckDie + 2 * luckSteps);

    if (this.woundCount > 0) {
      this.hp.max = Math.max(1, this.hp.max - this.woundCount);
      this.hp.value = Math.clamp(this.hp.value, 0, this.hp.max);
      this.critical = this.hp.value > 0
        && (this.hp.max - this.hp.value) >= Math.ceil(this.hp.max * PROJECTANIME.criticalMarkedFraction);
    }
    this.canEnterConflict = this.woundCount < 3;
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
      // defeated tokens auto-hide.
      initial: "hostile",
      choices: PROJECTANIME.dispositions
    });

    // The V2 enemy TYPE — the complete stat line this enemy was built from (see
    // PROJECTANIME.enemyTypes: minion/standard/bruiser/skirmisher/support/elite; also
    // "companion" for a bonded Companion). A free StringField so the table can be retuned and
    // hand-editing stays valid; "" = an untyped NPC.
    schema.npcType = new fields.StringField({ required: false, blank: true, initial: "" });

    // RIVAL — a recurring named villain built on full PC rules; counts as Threat 2 and grows
    // with the party. A designation only; the statblock is authored like a PC's.
    schema.rival = new fields.BooleanField({ initial: false });

    // Advancements (rules: Companion Advancement) — a bonded Companion earns 1 whenever its
    // bonder does (the Milestone tool pays them alongside the party) and spends on the
    // Companion slot caps. Same pool + refundable ledger shape as Characters; monsters simply
    // never receive any.
    schema.advancement = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      log: advancementLogField()
    });

    // BOSS — one enemy built to fight the whole party. Its hit boxes are replaced by BARS:
    // `bars` = the Bar count (⌈party ÷ 2⌉), `barHp` = one Bar's hit boxes (party × 2),
    // `remaining` = Bars not yet broken, `broken` = Bars destroyed. On a Bar break the token
    // HP bar (which shows ONE Bar) refills, excess damage is lost, detrimental statuses clear,
    // and the next Bar's Techniques unlock. A Boss acts twice per Enemy Phase.
    schema.boss = new fields.SchemaField({
      enabled: new fields.BooleanField({ initial: false }),
      bars: new fields.NumberField({ ...requiredInteger, initial: 1, min: 1 }),
      barHp: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      remaining: new fields.NumberField({ ...requiredInteger, initial: 1, min: 0 }),
      broken: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 })
    });

    return schema;
  }

  /** A Boss's hit boxes over the cap are legal (barHp = party × 2 can exceed 10); everything
   *  else answers to the same 10-box cap as PCs. Desperation is retired in V2 — a broken Bar
   *  only unlocks Techniques. */
  prepareDerivedData() {
    super.prepareDerivedData();
    if (this.boss?.enabled) {
      // Re-widen the Bar HP past the base clamp (the token bar shows ONE Bar).
      const bar = Math.max(1, Number(this.boss.barHp) || 1);
      this.hp.max = bar;
      this.hp.value = Math.clamp(this.hp.value, 0, bar);
    }
  }

  /**
   * Legacy migrations:
   *  1. Pre-V2 Role × Tier enemies map to the nearest V2 Type (stat rebase happens in the
   *     one-time world migration; this only seeds the type key so sheets render).
   *  2. Pre-V2 numeric pools over the box cap re-baseline from the Type's stat line.
   */
  static migrateData(source) {
    if (!source?.npcType && source?.enemyRole) {
      const map = { grunt: "standard", brute: "bruiser", skirmisher: "skirmisher", caster: "standard", support: "support", swarm: "minion", elite: "elite" };
      source.npcType = map[source.enemyRole] ?? "";
    }
    const line = PROJECTANIME.enemyTypes[source?.npcType] ?? null;
    const isBoss = !!source?.boss?.enabled;
    for (const pool of ["hp", "energy"]) {
      const p = source?.[pool];
      if (!isBoss && p && typeof p === "object" && Number(p.max) > PROJECTANIME.maxBoxes) {
        p.max = line ? (pool === "hp" ? line.hb : line.eb) : PROJECTANIME.baseHitBoxes;
        p.value = Math.min(Number(p.value) || 0, p.max);
        if ("base" in p) p.base = p.max;
      }
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
 * derives the Threat budget (rules: Encounter Budget — party size, shifted by difficulty) and
 * how much of it the planned enemies spend (each Type costing its printed Threat).
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

    // Planned encounter — one LINE per fielded enemy (each a stable `id` so duplicates are
    // distinct: dragging the same Elite twice = two bodies = two lines).
    schema.encounter = new fields.ArrayField(
      new fields.SchemaField({
        id: new fields.StringField({ required: true, blank: false, initial: () => foundry.utils.randomID() }),
        uuid: new fields.StringField({ required: true, blank: false })
      }),
      { initial: [] }
    );

    // Manual estimate — plan a fight WITHOUT a built roster: when `encounterManual` is on the
    // budget is driven by the typed player count (`encounterPlayers`) instead of the roster size.
    schema.encounterManual = new fields.BooleanField({ initial: false });
    schema.encounterPlayers = new fields.NumberField({ ...requiredInteger, initial: 4, min: 1 });

    // Shared party treasury — a Gold pool the Stash tab can split evenly among members.
    schema.gold = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });

    return schema;
  }

  /** Give every legacy encounter line a stable `id`; remap retired difficulty keys. */
  static migrateData(source) {
    if (Array.isArray(source?.encounter)) {
      for (const e of source.encounter) if (e && !e.id) e.id = foundry.utils.randomID();
    }
    if (source && typeof source.difficulty === "string") {
      if (source.difficulty === "medium") source.difficulty = "standard";
      else if (source.difficulty === "extreme" || source.difficulty === "deadly") source.difficulty = "climax";
    }
    return super.migrateData(source);
  }
}

/**
 * A Merchant — a shop actor with no combat stats. Its stock is its embedded gear Items
 * (the GM drags them in); players buy from the sheet and sell by dragging their own gear
 * onto it, with both sides settled by helpers/merchant.mjs (GM-relayed when needed).
 */
export class ProjectAnimeMerchant extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const schema = {};

    // One-line trade under the name ("Traveling Alchemist").
    schema.tagline = new fields.StringField({ required: false, blank: true, initial: "" });

    // The till. `infiniteGold` (the default) means it's not tracked: buys don't feed it and
    // sales always pay out. Turn it off for a shop that can actually run dry.
    schema.gold = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });
    schema.infiniteGold = new fields.BooleanField({ initial: true });

    // Infinite stock: buying never decrements the shelf.
    schema.infiniteStock = new fields.BooleanField({ initial: false });

    // The shop's base trade rates as percents of an item's list cost — what a patron pays
    // when buying / receives when selling. A patron's own `trade` effects (e.g. a Trader's
    // Pass) shift these as deltas from the world baselines (see tradePrices).
    schema.buyRate = new fields.NumberField({ ...requiredInteger, initial: 100, min: 0 });
    schema.sellRate = new fields.NumberField({ ...requiredInteger, initial: 50, min: 0 });

    return schema;
  }
}
