import { PROJECTANIME, gateLockedTechnique } from "../helpers/config.mjs";
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
      // XP spent (the option's price on the Advancement List).
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
        // A gated Villain's Passive locked behind a later Gate isn't live yet — no energy lock.
        if (!gateLockedTechnique(this.parent, item)) passiveEnergyTax += Number(data.passiveEnergyTax) || 0;
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

    // XP (rules: Advancement) — earned at story Milestones (Episode 2 / Arc 4 / Season 6),
    // spent on the Advancement List at each option's XP price. `value` = unspent XP;
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

    // Luck Die size (rules: Luck) — base d6, stepped d6→d8→d10→d12 by each "Step Up Luck Dice"
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

    // Every enemy BEGINS with 1 hit box and 1 energy box (rules: The Stat Block) — EXP buys
    // more. Same field shapes as the base; only the initials differ from a Character's 5.
    schema.hp = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 1, min: 0 }),
      max: new fields.NumberField({ ...requiredInteger, initial: 1, min: 0 })
    });
    schema.energy = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 1, min: 0 }),
      max: new fields.NumberField({ ...requiredInteger, initial: 1, min: 0 }),
      base: new fields.NumberField({ ...requiredInteger, initial: 1, min: 0 }),
      passiveTax: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 })
    });

    schema.disposition = new fields.StringField({
      required: true,
      blank: false,
      // NPCs are enemies by default (this is the monster sheet) — so they read Hostile and their
      // defeated tokens auto-hide.
      initial: "hostile",
      choices: PROJECTANIME.dispositions
    });

    // The enemy TIER this enemy was built at (see PROJECTANIME.enemyTiers:
    // minion/standard/elite/champion/villain; also "companion" for a bonded Companion).
    // A free StringField so the table can be retuned and hand-editing stays valid;
    // "" = an untyped NPC.
    schema.npcType = new fields.StringField({ required: false, blank: true, initial: "" });

    // Enemy XP (rules: Enemies) — the build budget is the Tier's base EXP + the XP the party
    // has earned (`party`, stamped by the Monster Creator). Spends are DERIVED from the built
    // statblock (npcSpentExp), not ledgered.
    schema.exp = new fields.SchemaField({
      party: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 })
    });

    // The equipment Styles this enemy wears (rules: The Stat Block — one Armor Style sets
    // Guard bonus/Movement, an optional Shield adds Guard). Keys into armorStyles/shieldStyles;
    // the stats live on the stamped equipped items — these keys are for the statblock line +
    // re-stamping. Attacks carry their own Weapon Style key per weapon item (`system.style`).
    schema.armorStyle = new fields.StringField({ required: false, blank: true, initial: "" });
    schema.shieldStyle = new fields.StringField({ required: false, blank: true, initial: "" });

    // XP (rules: Companion Advancement) — a bonded Companion earns 1 point per milestone its
    // bonder's XP came from (the Milestone tool pays them alongside the party) and spends on
    // the same Advancement List. Same pool + refundable ledger shape as Characters; monsters
    // simply never receive any.
    schema.advancement = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      log: advancementLogField()
    });

    // Luck Dice (rules: Villains; Companion Advancement) — three dice rolled and recorded like
    // a Player Character's. `luckDie` is the die SIZE: a Villain's is stored (base d6, stepped
    // up with EXP in the Monster Creator); a Companion's derives from its "luckDie" advancement
    // entries in prepareDerivedData, exactly like a Character's.
    schema.luckDice = new fields.ArrayField(
      new fields.NumberField({ ...requiredInteger, min: 1 }),
      { initial: [] }
    );
    schema.luckDie = new fields.NumberField({ ...requiredInteger, initial: 6, min: 4, max: 12 });

    // GATES (rules: Villains → Gates) — a climax Villain's hit boxes are replaced by Gates:
    // `hb` = each Gate's hit boxes (the purchased total divided across ⌈party ÷ 2⌉ Gates),
    // `broken` = Gates already destroyed. The token HP bar shows the CURRENT Gate. On a break
    // excess damage is lost, detrimental statuses clear, and the next Gate's Techniques
    // unlock; a gated Villain acts twice per Enemy Phase.
    schema.gates = new fields.SchemaField({
      enabled: new fields.BooleanField({ initial: false }),
      hb: new fields.ArrayField(
        new fields.NumberField({ ...requiredInteger, initial: 1, min: 1 }),
        { initial: [] }
      ),
      broken: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 })
    });

    return schema;
  }

  /** A gated Villain's Gate can legally exceed the 10-box cap (Villains have no hit-box
   *  ceiling when built with Gates); everything else answers to the same cap as PCs. The
   *  current Gate drives the visible HP pool. */
  prepareDerivedData() {
    super.prepareDerivedData();
    // A Companion's Luck Die (rules: Companion Advancement — Step Up Luck Dice): base d6,
    // stepped by each "luckDie" ledger entry like a Character's. Villains keep the stored size.
    if (this.npcType === "companion" || this.parent?.flags?.["project-anime"]?.companionOf) {
      const luckSteps = (this.advancement?.log ?? []).filter((e) => e.kind === "luckDie").length;
      this.luckDie = Math.min(PROJECTANIME.luckDieMax, PROJECTANIME.luckDie + 2 * luckSteps);
    }
    if (this.gates?.enabled && this.gates.hb.length) {
      // Re-widen the current Gate's boxes past the base clamp (the token bar shows ONE Gate).
      // The base clamp already crushed hp.value to the (stale) stored max, so re-derive the
      // value from SOURCE against the Gate size, and recompute Critical off the real pool.
      const idx = Math.clamp(this.gates.broken, 0, this.gates.hb.length - 1);
      const gate = Math.max(1, Number(this.gates.hb[idx]) || 1);
      this.hp.max = gate;
      this.hp.value = Math.clamp(Number(this._source.hp?.value) || 0, 0, gate);
      this.critical = this.hp.value > 0
        && (gate - this.hp.value) >= Math.ceil(gate * PROJECTANIME.criticalMarkedFraction);
    }
  }

  /**
   * Legacy migrations (in-memory; the one-time world migration persists them):
   *  1. Pre-V2 Role × Tier enemies map straight to the nearest Tier key.
   *  2. Retired V2 Type keys fold into the Tier ladder (bruiser → elite; skirmisher/support →
   *     standard); a Boss or Rival becomes a Villain (a Boss's Bars becoming its Gates).
   *  3. Pre-Tier numeric pools over the box cap re-baseline to the base line.
   */
  static migrateData(source) {
    if (!source?.npcType && source?.enemyRole) {
      const map = { grunt: "standard", brute: "elite", skirmisher: "standard", caster: "standard", support: "standard", swarm: "minion", elite: "elite" };
      source.npcType = map[source.enemyRole] ?? "";
    }
    const typeMap = { bruiser: "elite", skirmisher: "standard", support: "standard" };
    if (typeMap[source?.npcType]) source.npcType = typeMap[source.npcType];
    // Boss → Villain with Gates (Bars carry over 1:1); Rival → Villain without Gates.
    if (source?.boss?.enabled) {
      source.npcType = "villain";
      if (!source.gates?.enabled) {
        const bars = Math.max(1, Number(source.boss.bars) || 1);
        const barHp = Math.max(1, Number(source.boss.barHp) || 1);
        source.gates = {
          enabled: true,
          hb: Array(bars).fill(barHp),
          broken: Math.clamp(Number(source.boss.broken) || 0, 0, bars - 1)
        };
      }
    } else if (source?.rival && !PROJECTANIME.enemyTiers[source?.npcType]) {
      source.npcType = "villain";
    }
    const isGated = !!source?.gates?.enabled;
    for (const pool of ["hp", "energy"]) {
      const p = source?.[pool];
      if (!(isGated && pool === "hp") && p && typeof p === "object" && Number(p.max) > PROJECTANIME.maxBoxes) {
        p.max = PROJECTANIME.maxBoxes;
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
