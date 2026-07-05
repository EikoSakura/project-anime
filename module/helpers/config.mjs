/**
 * Project: Anime — central configuration constants.
 * Values are localization keys (resolved from lang/en.json) unless noted.
 * This object is attached to `CONFIG.PROJECTANIME` during the init hook and
 * is also imported directly by the data models for use as field `choices`.
 */
export const PROJECTANIME = {};

/* -------------------------------------------- */
/*  Attributes                                  */
/* -------------------------------------------- */

/** The five core attributes, keyed by their stored id. */
PROJECTANIME.attributes = {
  might: "PROJECTANIME.Attribute.might.long",
  agility: "PROJECTANIME.Attribute.agility.long",
  mind: "PROJECTANIME.Attribute.mind.long",
  spirit: "PROJECTANIME.Attribute.spirit.long",
  charm: "PROJECTANIME.Attribute.charm.long"
};

/** Iteration order for the five attributes. */
PROJECTANIME.attributeKeys = ["might", "agility", "mind", "spirit", "charm"];

/** Three-letter abbreviations — used where space is tight (the status-window rail attribute strip). */
PROJECTANIME.attributeAbbr = {
  might: "PROJECTANIME.Attribute.might.abbr",
  agility: "PROJECTANIME.Attribute.agility.abbr",
  mind: "PROJECTANIME.Attribute.mind.abbr",
  spirit: "PROJECTANIME.Attribute.spirit.abbr",
  charm: "PROJECTANIME.Attribute.charm.abbr"
};

/** Font Awesome icon shown on each attribute card (FA6 Free Solid). */
PROJECTANIME.attributeIcons = {
  might: "fa-solid fa-hand-fist",
  agility: "fa-solid fa-feather-pointed",
  mind: "fa-solid fa-brain",
  spirit: "fa-solid fa-spa",
  charm: "fa-solid fa-masks-theater"
};

/** Half-score of a die value: d4→2, d6→3, d8→4, d10→5, d12→6. */
export function halfScore(dieValue) {
  return Math.floor((dieValue ?? 4) / 2);
}

/** True if a weapon's accuracy attributes include Might (physical weapon → ATK vs DEF). */
export function isPhysicalWeapon(weapon) {
  const a = weapon?.system?.accuracy?.attrA;
  const b = weapon?.system?.accuracy?.attrB;
  return a === "might" || b === "might";
}

/** True if a weapon's accuracy attributes include Mind (magical weapon → MATK vs RES). */
export function isMagicalWeapon(weapon) {
  const a = weapon?.system?.accuracy?.attrA;
  const b = weapon?.system?.accuracy?.attrB;
  return a === "mind" || b === "mind";
}

/* -------------------------------------------- */
/*  Talents (NPC HQ work dice)                  */
/* -------------------------------------------- */

/** The five NPC Talents — work dice the HQ taps (dispatch missions + facility output). */
PROJECTANIME.talents = {
  combat: "PROJECTANIME.Talent.combat.long",
  commerce: "PROJECTANIME.Talent.commerce.long",
  craft: "PROJECTANIME.Talent.craft.long",
  exploration: "PROJECTANIME.Talent.exploration.long",
  lore: "PROJECTANIME.Talent.lore.long"
};
PROJECTANIME.talentKeys = ["combat", "commerce", "craft", "exploration", "lore"];
PROJECTANIME.talentIcons = {
  combat: "fa-solid fa-khanda",
  commerce: "fa-solid fa-scale-balanced",
  craft: "fa-solid fa-hammer",
  exploration: "fa-solid fa-compass",
  lore: "fa-solid fa-book-open"
};

/** HQ outputs a Trait Bonus can boost (besides a Talent or an Attribute). `haste` is the odd one out:
 *  it shaves HQ turns off a dispatch mission's duration rather than feeding the roll / payout. */
PROJECTANIME.hqOutputs = {
  gold: "PROJECTANIME.Talent.hq.gold",
  sp: "PROJECTANIME.Talent.hq.sp",
  success: "PROJECTANIME.Talent.hq.success",
  haste: "PROJECTANIME.Talent.hq.haste"
};
PROJECTANIME.hqOutputKeys = ["gold", "sp", "success", "haste"];

/* -------------------------------------------- */
/*  Skills                                      */
/* -------------------------------------------- */

PROJECTANIME.actionTypes = {
  action: "PROJECTANIME.Skill.actionType.action",
  passive: "PROJECTANIME.Skill.actionType.passive",
  react: "PROJECTANIME.Skill.actionType.react"
};

/** Skill Range scopes (v0.03): a Skill defaults to WEAPON range; Self is free (a targeting
 *  choice); a set tile count ("Range (X tiles)") and Scene ("Range (Scene)") are RANGE MODIFIERS —
 *  each adds +1 to the Skill's SP cost (rangeModifierCost). Legacy Melee/Near/Far/Very Far scopes
 *  migrate to tiles/scene in item-models.mjs. */
PROJECTANIME.ranges = {
  weapon: "PROJECTANIME.Range.weapon",
  self: "PROJECTANIME.Range.self",
  tiles: "PROJECTANIME.Range.tiles",
  scene: "PROJECTANIME.Range.scene"
};

/** Default tile value per Range scope (0 = not a tile distance). */
PROJECTANIME.rangeTiles = { self: 0, weapon: 0, tiles: 1, scene: 0 };

/** Effects whose reach is INHERENT to the Effect itself — the tile Range is part of what the Effect
 *  does, not an optional Range Modifier, so it adds NO SP. Each maps to its natural tile reach, which
 *  the Builder seeds when the Effect is chosen. Sense detects within 5 tiles (homebrew, v0.03). */
PROJECTANIME.inherentRangeTiles = { sense: 5 };

/** True when a Range scope uses an editable tile count. */
export function rangeHasTiles(scope) {
  return scope === "tiles";
}

/** The SP a Skill's Range choice adds (v0.03: Range (X tiles) and Range (Scene) are Modifiers
 *  costing 1 each; Weapon and Self are free). An inherent-range Effect (Sense) carries its tile
 *  reach for free — the tiles ARE the Effect, already priced into its minimum. */
export function rangeModifierCost(sys) {
  const scope = sys?.range?.scope;
  if (scope !== "tiles" && scope !== "scene") return 0;
  if (sys?.effect && sys.effect in (PROJECTANIME.inherentRangeTiles ?? {})) return 0;
  return 1;
}

/** Localized display for a Skill's range: "Range · 4 tiles" for the tile scope, else just the
 *  scope ("Self" / "Weapon" / "Scene"). Tolerates the legacy string form during migration. */
export function rangeLabel(range) {
  const scope = (range && typeof range === "object" ? range.scope : range) ?? "weapon";
  const label = game.i18n.localize(PROJECTANIME.ranges[scope] ?? scope);
  if (!rangeHasTiles(scope)) return label;
  const tiles = (range && typeof range === "object" ? range.tiles : PROJECTANIME.rangeTiles[scope]) ?? 0;
  return `${label} · ${tiles} ${game.i18n.localize("PROJECTANIME.Skill.tiles")}`;
}

/** Localized display for a Weapon/Shield's physical range (v0.03: tile numbers only —
 *  "1" or "2–8"; the Melee/Ranged labels are gone). The Skill-range counterpart is rangeLabel. */
export function physicalRangeLabel(range) {
  const max = Number(range?.tiles) || 0;
  const min = Number(range?.minTiles) || 0;
  return (min > 0 && min !== max) ? `${min}–${max}` : `${max}`;
}

/** v0.03: Ranks are gone. A Skill's SP cost = the weight of its Modifiers, with a minimum equal
 *  to its Effect's cost. Heavy Modifiers count as two; Targeting, React, and Passive are free;
 *  Range (X tiles) / Range (Scene) each count 1. Energy to use = SP × 2. */
PROJECTANIME.effectMinCost = {
  affinity: 1, animate: 2, bolster: 2, companion: 2, conjure: 1, custom: 1,
  disguise: 1, elementalControl: 1, gate: 1, hinder: 1, illusion: 2, mend: 1,
  passive: 0, sense: 2, steal: 1, strike: 1, telepathy: 2, transform: 2, vanish: 1
};

/** An Effect's minimum SP cost (the "None"/Modifiers-only carrier is 0; unknown → 1). */
export function effectMinCost(effect) {
  return PROJECTANIME.effectMinCost[effect] ?? 1;
}

/** Effects retired from NEW authoring (v0.03): Animate moved to Modules; the Affinity Effect is
 *  covered by the Affinity / Immunity / Absorb Modifiers on a Modifiers-only Skill. Stored Skills
 *  keep working; the Builder only lists these while one is already the current selection. */
PROJECTANIME.retiredEffects = ["animate", "affinity"];

/**
 * A Skill's derived SP cost — ADDITIVE per the doc's Skill Cost rule (v0.03): the Effect's cost
 * plus 1 per Modifier (Heavy 🔶 add 2; Range overrides count as Modifiers; Targeting, React, and
 * Passive are free). A Skill with no Effect costs only its Modifiers. With the Secondary Effect
 * Modifier the total must still meet the second Effect's minimum cost. This is the single cost
 * authority — the data model, the Builder, and the SP reconcile all read it.
 */
export function skillSpCost(sys) {
  if (!sys) return 0;
  const weight = modifiersBudget(sys.modifiers ?? [], sys) + rangeModifierCost(sys);
  let cost = effectMinCost(sys.effect) + weight;
  if (skillHasSecondary(sys)) cost = Math.max(cost, effectMinCost(sys.secondaryEffect));
  return cost;
}

/** Card/badge label for a Skill's cost — "2 SP" (replaces the old rank stars). */
export function skillCostLabel(sys) {
  return `${Number(sys?.spCost ?? skillSpCost(sys)) || 0} SP`;
}

/** How many Attributes an attribute-touching Effect changes (rules v0.01): Empower steps up ONE
 *  chosen Attribute, Weaken steps down ONE; Transform steps up one Attribute by two OR two
 *  Attributes by one. Drives the Builder's Attribute pickers. Skills built under the older
 *  rank-scaled rule (up to three Attributes) are grandfathered — their stored extras still apply
 *  (effects.mjs bolsterHinderRules no longer trims), the Builder just won't author new ones. */
export function effectAttrCount(effect) {
  return effect === "transform" ? 2 : 1;
}

/** The single primary Effect a Skill is built around. "custom" is a free-form Effect with no
 *  automation — the player describes it in the Skill's text (it rolls no die, makes no Accuracy
 *  Check, and only delivers whatever Active Effects are authored on the Skill). */
PROJECTANIME.skillEffects = {
  affinity: "PROJECTANIME.Skill.effect.affinity",
  animate: "PROJECTANIME.Skill.effect.animate",
  bolster: "PROJECTANIME.Skill.effect.bolster",
  companion: "PROJECTANIME.Skill.effect.companion",
  conjure: "PROJECTANIME.Skill.effect.conjure",
  custom: "PROJECTANIME.Skill.effect.custom",
  disguise: "PROJECTANIME.Skill.effect.disguise",
  elementalControl: "PROJECTANIME.Skill.effect.elementalControl",
  gate: "PROJECTANIME.Skill.effect.gate",
  hinder: "PROJECTANIME.Skill.effect.hinder",
  illusion: "PROJECTANIME.Skill.effect.illusion",
  mend: "PROJECTANIME.Skill.effect.mend",
  passive: "PROJECTANIME.Skill.effect.passive",
  sense: "PROJECTANIME.Skill.effect.sense",
  steal: "PROJECTANIME.Skill.effect.steal",
  strike: "PROJECTANIME.Skill.effect.strike",
  telepathy: "PROJECTANIME.Skill.effect.telepathy",
  transform: "PROJECTANIME.Skill.effect.transform",
  vanish: "PROJECTANIME.Skill.effect.vanish"
};

/** Effects that can carry NO Modifiers at all (v0.03: "This Effect cannot have Modifiers" —
 *  Companion; Animate kept for legacy data). There is no other Modifier cap — v0.03 lets a
 *  Skill take as many Modifiers as it wants (each raises the SP cost). */
PROJECTANIME.noModifierEffects = ["animate", "companion"];

/** Servant tier → the multiplier on the Animate Skill's Energy cost that the raised servant
 *  locks out of the caster's MAXIMUM Energy while it exists (rules v0.01: Minion ½ · Standard
 *  1× · Elite 2× · Solo 3×). A blank / unknown tier (an untiered NPC, a raised PC) counts as
 *  Standard. */
PROJECTANIME.servantTierTax = { minion: 0.5, standard: 1, elite: 2, solo: 3 };

/** The max-Energy tax a servant of `tier` costs for an Animate Skill of `energyCost`
 *  (rounded down, like every halving — minimum 1). */
export function servantTax(tier, energyCost) {
  const mult = PROJECTANIME.servantTierTax[tier] ?? 1;
  return Math.max(1, Math.floor((Number(energyCost) || 0) * mult));
}

/** Who a Skill may affect — chosen at creation (rules v0.01: Targets). An Ally Skill can never be
 *  used on yourself (rules: "If an effect targets allies, you cannot use it on yourself"); Self
 *  always lands on the caster; Any is the open form every pre-v0.01 Skill is seeded with. */
PROJECTANIME.skillTargets = {
  self: "PROJECTANIME.Skill.target.self",
  foe: "PROJECTANIME.Skill.target.foe",
  ally: "PROJECTANIME.Skill.target.ally",
  any: "PROJECTANIME.Skill.target.any"
};

/** A Skill's Target, validated (legacy / blank → "any", the open pre-v0.01 behavior). */
export function skillTarget(sys) {
  const t = sys?.target;
  return t in PROJECTANIME.skillTargets ? t : "any";
}

/** How long a Skill's effect lasts (rules v0.01: Duration). Instant and Standard (2 turns, or the
 *  Skill's set count) are the intrinsic choices; Channeled and Scene are DURATION MODIFIERS that
 *  consume a Modifier slot and set this field (the Builder enforces the slot; pre-v0.01 Skills
 *  with a blank duration are seeded "scene" without the slot — grandfathered). */
PROJECTANIME.skillDurations = {
  channeled: "PROJECTANIME.Skill.duration.channeled",
  instant: "PROJECTANIME.Skill.duration.instant",
  standard: "PROJECTANIME.Skill.duration.standard",
  scene: "PROJECTANIME.Skill.duration.scene"
};

/** The two Duration Modifiers (normal weight, mutually exclusive). Selecting one sets the Skill's
 *  effective Duration; the intrinsic Builder choices are only Instant / Standard. */
PROJECTANIME.durationModifiers = ["channeled", "scene"];

/** A Skill's effective Duration, validated. A Duration Modifier wins over the stored field
 *  (defensive — the Builder keeps them in sync); legacy / blank → "scene" (the pre-v0.01
 *  behavior for a blank turn count) when the Skill has no turn count, else "standard". */
export function skillDuration(sys) {
  const mods = sys?.modifiers ?? [];
  if (mods.includes("channeled")) return "channeled";
  if (mods.includes("scene")) return "scene";
  const d = sys?.duration;
  if (d in PROJECTANIME.skillDurations) return d;
  return sys?.effectDuration != null ? "standard" : "scene";
}

/** A Standard-duration Skill's turn count: its set count, else the rules' default 2. */
PROJECTANIME.standardDurationTurns = 2;

/** Effects whose printed text carries a Duration — v0.03: "An Effect with a Duration cannot be
 *  Passive." Choosing one bounces the Passive Action Type in the Builder (stored Passives are
 *  grandfathered until re-edited). Empower = bolster, Weaken = hinder. Sense is deliberately
 *  EXEMPT (homebrew): a sense reads as an always-on passive, so it MAY be Passive — an active
 *  Sense still carries its normal Duration; only the passive-bar is lifted. */
PROJECTANIME.durationEffects = ["bolster", "disguise", "gate", "hinder", "illusion", "telepathy", "transform", "vanish"];

/** True when this Skill's Effect (or its Secondary Effect) is a printed-Duration Effect and so
 *  may not be Passive (v0.03). Pass the Skill data or the Builder draft. */
export function effectBarsPassive(sys) {
  const list = PROJECTANIME.durationEffects;
  return list.includes(sys?.effect) || (skillHasSecondary(sys) && list.includes(sys?.secondaryEffect));
}

/** The alternate Attributes a Skill Evasion may swap in for Agility (rules v0.01: Skill Evasion).
 *  All other Evasion bonuses and penalties still apply — only the Attribute changes. The doc
 *  defines some Effects' Skill Evasion as a PAIR ("Mind or Charm"): the defender uses whichever
 *  of the two is better (mirroring Banish/Nullify's better-of-Spirit), stored as one pair key. */
PROJECTANIME.skillEvasionAttrs = {
  mind: "PROJECTANIME.Attribute.mind.long",
  charm: "PROJECTANIME.Attribute.charm.long",
  spirit: "PROJECTANIME.Attribute.spirit.long",
  mindCharm: "PROJECTANIME.SkillEvasion.mindCharm",
  mindSpirit: "PROJECTANIME.SkillEvasion.mindSpirit"
};

/** The attribute keys a Skill-Evasion value resolves to: a pair key fans out to its two
 *  Attributes (the defender uses the better), a single key stands alone. [] for blank/unknown. */
export function skillEvasionKeys(value) {
  if (value === "mindCharm") return ["mind", "charm"];
  if (value === "mindSpirit") return ["mind", "spirit"];
  return value in PROJECTANIME.attributes ? [value] : [];
}

/** Localized display of a Skill-Evasion value — "Mind", or "Mind or Charm" for a pair. */
export function skillEvasionLabel(value) {
  const key = PROJECTANIME.skillEvasionAttrs[value];
  return key ? game.i18n.localize(key) : value;
}

/** A Skill's Skill-Evasion Attribute, validated ("" = none — the target defends with normal
 *  Agility-based Evasion). */
export function skillEvasionAttr(sys) {
  const k = sys?.skillEvasion;
  return k in PROJECTANIME.skillEvasionAttrs ? k : "";
}

/** The Attribute pair an Effect's "Targets ⟪X⟫ or ⟪Y⟫ (chosen at creation)" offers (v0.03):
 *  Disguise/Illusion target Mind or Charm, Telepathy/Vanish target Mind or Spirit. The Builder
 *  stores the ONE chosen Attribute in `skillEvasion`; legacy pair values ("mindCharm") still
 *  resolve at read as better-of-pair (skillEvasionKeys). */
PROJECTANIME.effectSkillEvasion = {
  disguise: "mindCharm", illusion: "mindCharm", telepathy: "mindSpirit", vanish: "mindSpirit"
};

/** The single-Attribute choices an Effect's evasion swap offers at creation ([] = none). */
export function effectEvasionChoices(effect) {
  return skillEvasionKeys(PROJECTANIME.effectSkillEvasion?.[effect] ?? "");
}

/** The Mental Modifier's choices (v0.03: "Choose ⟪Mind⟫, ⟪Spirit⟫, or ⟪Charm⟫. Targets the
 *  chosen Attribute instead of EVA") — written into `skillEvasion` like an Effect's swap. */
PROJECTANIME.mentalAttrs = ["mind", "spirit", "charm"];

/** A Strike Skill can deal Hit Point or Energy damage (rules: Strike). */
PROJECTANIME.damagePools = {
  hp: "PROJECTANIME.Skill.damagePool.hp",
  energy: "PROJECTANIME.Skill.damagePool.energy"
};

/** Effects that use a Damage Type: Strike (the damage it deals) and Affinity (the element you
 *  Resist/Immune/Absorb). Every other Effect hides the Damage Type field — Elemental Control's
 *  element is deliberately NOT one of these: it's free text (`controlElement`), any element the
 *  player can imagine, untied to the game's Damage Types. */
PROJECTANIME.damageEffects = ["strike", "affinity"];

/** Effects that roll one of the Skill's two Attribute dice for an amount: Strike
 *  (damage) and Mend (healing). The player picks WHICH of the two (rules: "choose
 *  one of its two Attributes. You roll that Attribute's die"). */
PROJECTANIME.dieEffects = ["strike", "mend"];

/** Effects that choose a pool (Hit Points / Energy): Strike (which pool its damage hits) and
 *  Mend/Heal (v0.03: "Restore HP or EP, chosen at creation"). Other Effects hide the pool field. */
PROJECTANIME.poolEffects = ["strike", "mend"];

/** Optional Modifiers that shape a Skill (v0.03: each adds +1 SP; Heavy 🔶 adds +2). One
 *  alphabetized list — Targeting lives on the Skill's Target field (free) and Range overrides on
 *  its Range field (rangeModifierCost). "burst" is a system-side area shape kept from v0.02. */
PROJECTANIME.skillModifiers = {
  none: "PROJECTANIME.Skill.modifier.none",
  absorb: "PROJECTANIME.Skill.modifier.absorb",
  affinityDamage: "PROJECTANIME.Skill.modifier.affinityDamage",
  affinityStatus: "PROJECTANIME.Skill.modifier.affinityStatus",
  analyze: "PROJECTANIME.Skill.modifier.analyze",
  aura: "PROJECTANIME.Skill.modifier.aura",
  banish: "PROJECTANIME.Skill.modifier.banish",
  burst: "PROJECTANIME.Skill.modifier.burst",
  chain: "PROJECTANIME.Skill.modifier.chain",
  channeled: "PROJECTANIME.Skill.modifier.channeled",
  charge: "PROJECTANIME.Skill.modifier.charge",
  cleanse: "PROJECTANIME.Skill.modifier.cleanse",
  combo: "PROJECTANIME.Skill.modifier.combo",
  cover: "PROJECTANIME.Skill.modifier.cover",
  custom: "PROJECTANIME.Skill.modifier.custom",
  devour: "PROJECTANIME.Skill.modifier.devour",
  disarm: "PROJECTANIME.Skill.modifier.disarm",
  drainEnergy: "PROJECTANIME.Skill.modifier.drainEnergy",
  drainHP: "PROJECTANIME.Skill.modifier.drainHP",
  immunity: "PROJECTANIME.Skill.modifier.immunity",
  inflict: "PROJECTANIME.Skill.modifier.inflict",
  infuse: "PROJECTANIME.Skill.modifier.infuse",
  line: "PROJECTANIME.Skill.modifier.line",
  manifest: "PROJECTANIME.Skill.modifier.manifest",
  mass: "PROJECTANIME.Skill.modifier.mass",
  mental: "PROJECTANIME.Skill.modifier.mental",
  move: "PROJECTANIME.Skill.modifier.move",
  nullify: "PROJECTANIME.Skill.modifier.nullify",
  pierce: "PROJECTANIME.Skill.modifier.pierce",
  protection: "PROJECTANIME.Skill.modifier.protection",
  pull: "PROJECTANIME.Skill.modifier.pull",
  push: "PROJECTANIME.Skill.modifier.push",
  reequip: "PROJECTANIME.Skill.modifier.reequip",
  retaliation: "PROJECTANIME.Skill.modifier.retaliation",
  scene: "PROJECTANIME.Skill.modifier.scene",
  secondaryEffect: "PROJECTANIME.Skill.modifier.secondaryEffect",
  waypoint: "PROJECTANIME.Skill.modifier.waypoint"
};
// NOTE: "reflect" is no longer a Modifier — rules v0.01 moved Reflect to the beneficial Status
// list (applied via Inflict, like Barrier/Regen). Stored skills migrate in item-models.mjs.

/** Modifiers flagged "Heavy" count as two (v0.03 🔶: Absorb, Devour, Immunity, Mass, Secondary
 *  Effect). "Custom" and "Re-equip" are Heavy per-skill instead (their own flag, toggled by a
 *  Builder checkbox) — see isHeavyModifier below, the single place that resolves a Modifier's
 *  effective weight. */
PROJECTANIME.heavyModifiers = ["absorb", "devour", "immunity", "mass", "secondaryEffect"];

/** Detrimental statuses that make Inflict a HEAVY Modifier (v0.03: "If the chosen effect is
 *  Stunned, Sealed, or Bound, Inflict is instead a Heavy Modifier"). Sealed's stored id is
 *  `exhausted` (label-only rename, see the Status list note above). */
PROJECTANIME.heavyInflictStatuses = ["stunned", "exhausted", "bound"];

/** Whether a Modifier counts as Heavy (weighs two SP) on a given Skill. The static Heavy set is
 *  fixed; "Inflict" is Heavy when its chosen status is Stunned/Sealed/Bound (v0.03); "Custom"
 *  and "Re-equip" are Heavy only when that Skill's flag is set. Pass the Skill's system data OR
 *  the Builder draft — both carry `inflictStatus` / `customModifierHeavy` / `reequipHeavy`. */
export function isHeavyModifier(key, sys) {
  if (PROJECTANIME.heavyModifiers.includes(key)) return true;
  if (key === "inflict") return PROJECTANIME.heavyInflictStatuses.includes(sys?.inflictStatus);
  if (key === "custom") return !!sys?.customModifierHeavy;
  return key === "reequip" && !!sys?.reequipHeavy;
}

/** A Modifier barred by a Skill's Action Type / Effect alone (before the Aura and Channeled↔Scene
 *  cross-checks each site layers on). A Passive (always-on) Skill can take neither Secondary Effect
 *  nor a Duration Modifier (Channeled/Scene — it has no duration to alter). The "None" Effect bars
 *  Secondary Effect on ANY Action Type (rules v0.01: "This Effect cannot have the Secondary Effect
 *  Modifier"), but — unlike a Passive — an Action/React "None" may still be Channeled/Scene. Pass the
 *  Skill data OR the Builder draft (both carry `actionType` / `effect`). */
export function modifierBarredByType(key, sys) {
  const passiveAction = sys?.actionType === "passive";
  if (key === "secondaryEffect") return passiveAction || sys?.effect === "passive";
  if (key === "channeled" || key === "scene") return passiveAction;
  return false;
}

/** Modifiers the rules let a Skill select MORE THAN ONCE ("This Modifier can be selected more
 *  than once"): Affinity (Damage) and Affinity (Status). Each take picks another Element / Status
 *  and weighs on the Rank's Modifier budget again. */
PROJECTANIME.multiTakeModifiers = ["affinityDamage", "affinityStatus"];

/** How many times a Modifier is taken on a Skill — 1 for everything except the multi-take
 *  Affinity Modifiers, whose count is their pick-array's length (never below 1 while selected). */
export function modifierTakes(key, sys) {
  if (key === "affinityDamage") return Math.max(1, (sys?.affinityDamages ?? []).length);
  if (key === "affinityStatus") return Math.max(1, (sys?.affinityStatusIds ?? []).length);
  return 1;
}

/** Modifiers that carry NO SP/EP weight — the "None" marker (an explicit "this Skill relies on its
 *  Effect, no Modifier"). Kept out of the SP budget and off the buy/target menus that price or scope
 *  real Modifiers. (Targeting / React / Passive are free too, but live on other Skill fields.) */
PROJECTANIME.freeModifiers = ["none"];

/** The Modifier budget a set of Modifiers consumes (Heavy = 2, a multi-take Modifier once per
 *  take), honoring the Custom Heavy flag; free Modifiers (the "None" marker) weigh nothing. `sys`
 *  is the Skill data / draft the modifiers belong to (for the per-skill Custom weight and the
 *  Affinity take counts). */
export function modifiersBudget(mods, sys) {
  const free = PROJECTANIME.freeModifiers ?? [];
  return (mods ?? []).reduce((n, m) => free.includes(m) ? n : n + (isHeavyModifier(m, sys) ? 2 : 1) * modifierTakes(m, sys), 0);
}

/** Area-of-effect modifiers and how each shapes targeting (see helpers/templates.mjs). These shape an
 *  ACTIVATED Skill's on-use targeting. Aura is NOT here — it's a continuous passive field, maintained
 *  by the reconcile engine (helpers/aura.mjs), not the on-use multi-target flow. */
PROJECTANIME.areaModifiers = ["burst", "line", "mass", "chain"];

/** True when an area Skill is a SELF-CENTERED emanation rather than a point placed within Range: a
 *  Burst whose Range is Self explodes from the caster's own token (no placement). Its radius is the
 *  Burst value (config.mjs modifierValue) and its Target (Foe/Ally/Any) decides who it catches — so
 *  "a burst of energy centered on you, hitting the foes around you" needs no Range trickery. The
 *  Builder lifts its "Self Range ⇒ Target Self" lock for this case, and dice.mjs skips placement. */
export function isSelfCenteredArea(sys) {
  return sys?.range?.scope === "self" && (sys?.modifiers ?? []).includes("burst");
}

/** Modifiers that only make sense on a PASSIVE Skill. Selecting one in the Skill Builder forces the
 *  Skill's Action Type to Passive. Currently none — Aura was moved off this list when it gained
 *  ACTIVE support (an active aura runs for its duration, then ends). The generic enforcement that
 *  reads this set is kept for any future passive-only Modifier. */
PROJECTANIME.passiveOnlyModifiers = [];

/** Aura (a Skill Modifier): the field radius in tiles. An Aura Skill grants its Effect(s) to every
 *  creature of the chosen group within this many tiles of the bearer. Maintained on-canvas by
 *  helpers/aura.mjs. A PASSIVE aura is always-on; an ACTIVE aura runs for its duration, then ends. */
PROJECTANIME.auraTiles = 2;

/** LEGACY (pre-v0.01): the Aura Modifier's own ally/enemy switch. Superseded by the Skill's
 *  explicit Target — migrateData seeds `target` from this on old aura skills, and all live code
 *  derives the audience via auraAudience below. Kept only so stored data still validates. */
PROJECTANIME.auraTargets = {
  ally: "PROJECTANIME.Skill.auraTarget.ally",
  enemy: "PROJECTANIME.Skill.auraTarget.enemy"
};

/** Who an Aura Skill's field affects — derived from the Skill's explicit Target (rules v0.01:
 *  area Modifiers affect "the type the Skill can already affect"): Foe → opposing creatures only,
 *  never the bearer; Any → every creature in the field INCLUDING the bearer; Ally (and the
 *  degenerate Self / legacy states) → same-side creatures PLUS the bearer. Bearer inclusion on an
 *  Ally aura is the system's one deliberate divergence from "an ally effect can't affect
 *  yourself": a field centered on you washes over you — it doesn't "target" you. */
export function auraAudience(sys) {
  const t = skillTarget(sys);
  return t === "foe" ? "foe" : t === "any" ? "any" : "ally";
}

/** Modifiers carrying a fixed numeric value (v0.03 — flat numbers, no Rank scaling):
 *    • Aura        — the field radius in tiles (2 — "within 2 tiles of you").
 *    • Burst       — the circle radius in tiles (2; system-side shape).
 *    • Chain       — extra targets it leaps to after the first hit (1).
 *    • Move        — tiles another creature is moved (2; moving yourself uses your MOV).
 *    • Protection  — the DEF/RES the Skill grants its target(s) (1).
 *    • Retaliation — the damage dealt back to a foe that strikes the target (2).
 *    • Push/Pull   — tiles of forced movement (2).
 *  Legacy "Tune a Modifier" growth (system.modifierGrowth) still adds on top — grandfathered;
 *  v0.03 removed Tune from the advancement list, so no new growth is authored. */
PROJECTANIME.growableModifiers = {
  aura: { base: 2, unit: "PROJECTANIME.Skill.growUnit.tiles" },
  burst: { base: 2, unit: "PROJECTANIME.Skill.growUnit.tiles" },
  chain: { base: 1, unit: "PROJECTANIME.Skill.growUnit.targets" },
  move: { base: 2, unit: "PROJECTANIME.Skill.growUnit.tiles" },
  protection: { base: 1, unit: "PROJECTANIME.Skill.growUnit.defense" },
  retaliation: { base: 2, unit: "PROJECTANIME.Skill.growUnit.damage" },
  push: { base: 2, unit: "PROJECTANIME.Skill.growUnit.tiles" },
  pull: { base: 2, unit: "PROJECTANIME.Skill.growUnit.tiles" }
};

/** The Modifiers the "Area" Enhancement grows (+1 tile to the area size, 1 SP each, max +3):
 *  a Burst's radius and an Aura's field radius. Growth rides system.modifierGrowth, same as the
 *  legacy Tune data, so refunds and re-edit carry-over already handle it. */
PROJECTANIME.areaGrowModifiers = ["burst", "aura"];

/** Cap on per-Modifier growth — the Area Enhancement's +3 limit (and the ceiling legacy "Tune a
 *  Modifier" data is clamped to at read). */
PROJECTANIME.modifierGrowthMax = 3;

/** How many tiles a Chain may leap between targets (rules: "within 3 tiles"). */
PROJECTANIME.chainTiles = 3;

/** A valued Modifier's effective value on an item = its fixed base + any grandfathered Tune
 *  growth (clamped to the legacy +3 cap). */
export function modifierValue(item, key) {
  const g = PROJECTANIME.growableModifiers?.[key];
  if (!g) return 0;
  const growth = Math.min(PROJECTANIME.modifierGrowthMax, Math.max(0, item?.system?.modifierGrowth?.[key] ?? 0));
  return (g.base ?? 0) + growth;
}

/** The level the Affinity (Damage) Modifier grants (v0.03: Resist only — full Immunity and
 *  Absorb are their own Heavy Modifiers). Stored immune/absorb takes are grandfathered at read. */
export function affinityModifierLevels() {
  return { resist: PROJECTANIME.affinityLevels.resist };
}

/* -------------------------------------------- */
/*  Secondary Effect ("Secondary Effect" mod)   */
/* -------------------------------------------- */
/* The "Secondary Effect" Modifier lets a Skill resolve a SECOND Effect on use (a Strike that
 * also Mends, a Mend that also Bolsters, …). Six of the eight Effects are delivered through the
 * Skill's Active Effects (only Strike/Mend roll dice), so "both Effects" means: one shared
 * Accuracy Check; a damage roll if EITHER slot is a Strike and a heal roll if EITHER is a Mend;
 * and the Skill's Active Effects apply whenever any slot is a non-die Effect. These three pure
 * readers are the single source of truth for "what Effect(s) does this Skill have", shared by the
 * dice resolver, the sheets, and the chat card. */

/** True if a Skill carries the "Secondary Effect" Modifier AND has a valid second Effect set.
 *  A Passive-Effect Skill never has one (rules v0.01: "This Effect cannot have the Secondary
 *  Effect Modifier") — the Builder blocks it; this guards legacy / hand-edited data. */
export function skillHasSecondary(sys) {
  if (!sys || sys.effect === "passive") return false;
  if (!(sys.modifiers ?? []).includes("secondaryEffect")) return false;
  return !!sys.secondaryEffect && sys.secondaryEffect in PROJECTANIME.skillEffects;
}

/** The Skill's Effect keys in order: [primary] plus the secondary (when active and distinct). */
export function skillEffectKeys(sys) {
  const keys = sys?.effect ? [sys.effect] : [];
  if (skillHasSecondary(sys) && sys.secondaryEffect !== sys.effect) keys.push(sys.secondaryEffect);
  return keys;
}

/**
 * The die-Effect (Strike / Mend) roll specs a Skill should offer, deduped by Effect (at most one
 * damage + one heal). Each spec carries which slot's attribute die / pool / damage-type to roll,
 * so a Skill with both a Strike and a Mend offers a damage AND a healing button. `primary` marks
 * the main slot — its button reads the Skill's base fields and needs no override.
 * @returns {{effect:string, damageAttr:string, damagePool:string, damageType:string, primary:boolean}[]}
 */
export function skillDieSpecs(sys) {
  const out = [];
  const add = (effect, damageAttr, damagePool, damageType, primary) => {
    if (effect !== "strike" && effect !== "mend") return;
    if (out.some((s) => s.effect === effect)) return; // one button per die-Effect
    out.push({ effect, damageAttr, damagePool, damageType, primary });
  };
  add(sys?.effect, sys?.damageAttr, sys?.damagePool, sys?.damageType, true);
  if (skillHasSecondary(sys)) {
    add(sys.secondaryEffect, sys.secondaryDamageAttr, sys.secondaryDamagePool, sys.secondaryDamageType, false);
  }
  return out;
}

/** Effects that contest the creature they land on — a Skill carrying one (in either slot) makes
 *  an Accuracy Check when aimed at a non-willing target. Strike / Weaken are dodged with Evasion;
 *  Steal is resisted; Disguise / Illusion / Telepathy roll against the target's Skill Evasion
 *  (rules v0.01 — their per-Effect Check). The Target still gates first (skillNeedsAccuracy):
 *  a Self/Ally aim never rolls (willing), a Foe aim always does — this list decides "Any".
 *  Every supportive Effect (Empower/Heal/Affinity/Sense) takes effect with no roll. */
PROJECTANIME.offensiveEffects = ["strike", "hinder", "steal", "disguise", "illusion", "telepathy"];

/** Modifiers that on their own land something hostile (a condition / a stolen secret / an ended
 *  Skill), so a Skill carrying one makes an Accuracy Check even when its Effect is otherwise
 *  neutral. Analyze, Banish and Nullify roll per the rules; Disarm makes a contested roll
 *  (v0.03). Lingering rides Inflict (its chosen Status). */
PROJECTANIME.offensiveModifiers = ["inflict", "analyze", "banish", "nullify", "disarm"];

/** What the Analyze Modifier reveals — chosen at Skill creation (rules: "Choose between the
 *  following categories"). Mirrors the Scouter's reveal categories. */
PROJECTANIME.analyzeCategories = {
  vitals: "PROJECTANIME.Skill.analyzeCategory.vitals",
  attributes: "PROJECTANIME.Skill.analyzeCategory.attributes",
  skills: "PROJECTANIME.Skill.analyzeCategory.skills",
  affinities: "PROJECTANIME.Skill.analyzeCategory.affinities"
};

/** What the Infuse Modifier imbues the target's weapons with — a Damage Type or a Status Effect
 *  (chosen at Skill creation, with the specific Element / Status picked alongside). */
PROJECTANIME.infuseKinds = {
  element: "PROJECTANIME.Skill.infuseKind.element",
  status: "PROJECTANIME.Skill.infuseKind.status"
};

/** Forced-movement Modifiers: shoving a creature is resisted (rolls vs Evasion) ONLY when it's an
 *  enemy — moving yourself or a willing ally is free. So the Move / Push / Pull Modifiers need an
 *  Accuracy Check only against a hostile target (see skillNeedsAccuracy's `enemyTarget`). */
PROJECTANIME.movementModifiers = ["push", "pull", "move"];

/**
 * True if a Skill makes an Accuracy Check vs Evasion — i.e. it targets an enemy. The single source
 * of truth for "is this an attack", shared by the dice resolver, the auto-description and the Skill
 * Builder. The explicit Target gates first (rules v0.01: "You do not need to roll an Accuracy
 * Check if the Skill only targets you or your allies"): a Self/Ally Skill never rolls, a Foe Skill
 * always does. A Target of "Any" (also every pre-v0.01 Skill) falls through to the per-Effect
 * logic: always true for an offensive Effect (Strike / Weaken, primary or Secondary) or an
 * offensive Modifier (inflict / analyze / banish / nullify) — friendly fire stays dodgeable.
 * Forced movement (Move / Push / Pull) is conditional: it rolls only against an enemy — pass
 * `enemyTarget` from the resolved target's disposition. With no target context (UI: the Builder,
 * the auto-description) `enemyTarget` is undefined and movement counts as potentially-offensive,
 * so e.g. "Sharpen Accuracy" stays offered on a Move Skill.
 */
export function skillNeedsAccuracy(sys, { enemyTarget } = {}) {
  if (!sys) return false;
  // An Aura delivers its Effect(s) through a continuous field (helpers/aura.mjs), never a to-hit roll —
  // so it makes no Accuracy Check (and "Sharpen Accuracy" isn't offered for it).
  if ((sys.modifiers ?? []).includes("aura")) return false;
  const target = skillTarget(sys);
  if (target === "self" || target === "ally") return false;
  if (target === "foe") return true;
  const effects = skillEffectKeys(sys);
  if (effects.some((e) => PROJECTANIME.offensiveEffects.includes(e))) return true;
  const mods = sys.modifiers ?? [];
  // Inflict is offensive — EXCEPT when it inflicts a BENEFICIAL valued status (Regen / Barrier):
  // that's a buff you put on yourself or an ally, not an attack, so it makes no Accuracy Check
  // (and so a Self / Any beneficial Inflict applies straight to you, with no target needed).
  const beneficialInflict = (PROJECTANIME.valuedStatuses ?? []).includes(sys.inflictStatus);
  if (PROJECTANIME.offensiveModifiers.some((m) => mods.includes(m) && !(m === "inflict" && beneficialInflict))) return true;
  const hasMovement = PROJECTANIME.movementModifiers.some((m) => mods.includes(m));
  if (hasMovement) return enemyTarget !== false;
  return false;
}

/** Triggers — required for every React Skill. */
PROJECTANIME.triggers = {
  alerted: "PROJECTANIME.Skill.trigger.alerted",
  attacked: "PROJECTANIME.Skill.trigger.attacked",
  critical: "PROJECTANIME.Skill.trigger.critical",
  damaged: "PROJECTANIME.Skill.trigger.damaged",
  enters: "PROJECTANIME.Skill.trigger.enters"
};

/* -------------------------------------------- */
/*  Damage, Affinities & Status                 */
/* -------------------------------------------- */

PROJECTANIME.damageTypes = {
  physical: "PROJECTANIME.DamageType.physical",
  earth: "PROJECTANIME.DamageType.earth",
  fire: "PROJECTANIME.DamageType.fire",
  mental: "PROJECTANIME.DamageType.mental",
  sonic: "PROJECTANIME.DamageType.sonic",
  water: "PROJECTANIME.DamageType.water",
  wind: "PROJECTANIME.DamageType.wind"
};

/** Font Awesome icon per damage type — FF8-style Elemental Defense grid. Easy to swap. */
PROJECTANIME.damageTypeIcons = {
  physical: "fa-solid fa-khanda",
  earth: "fa-solid fa-mountain",
  fire: "fa-solid fa-fire",
  mental: "fa-solid fa-brain",
  sonic: "fa-solid fa-volume-high",
  water: "fa-solid fa-droplet",
  wind: "fa-solid fa-wind"
};

/** Affinity levels including "none" — used for the per-damage-type selector. */
PROJECTANIME.affinityLevels = {
  none: "PROJECTANIME.Affinity.none",
  weak: "PROJECTANIME.Affinity.weak",
  resist: "PROJECTANIME.Affinity.resist",
  immune: "PROJECTANIME.Affinity.immune",
  absorb: "PROJECTANIME.Affinity.absorb"
};

/** Flat damage adjustments applied by affinity (before Defense). null = special. */
PROJECTANIME.affinityDamage = { weak: 2, resist: -2, immune: null, absorb: null };

/** Iteration order for the conditions. NOTE on ids vs labels: two conditions keep their original
 *  STORED id under a new rules-doc NAME — `decay` displays as "Lingering" and `exhausted` as
 *  "Sealed" (v0.01 renames). Label-only renames keep every existing actor, effect rule, and
 *  predicate valid with zero data migration; the ids are invisible to players. Barrier and Regen
 *  are the doc's BENEFICIAL Status Effects (each carries a pool + value on the bearer's flags);
 *  Vanished is the Vanish Effect's "cannot be seen" state. */
PROJECTANIME.conditionKeys = ["barrier", "blinded", "bound", "curse", "decay", "exhausted", "prone", "reflect", "regen", "slowed", "stunned", "vanished"];

/** The conditions that carry a VALUE on a chosen pool (rules: Barrier absorbs that much damage
 *  to the pool; Regen restores that much at the start of each turn). The value keys off the
 *  Skill's SP cost (see valuedStatusValue) and the Builder asks which pool (Hit Points / Energy). */
PROJECTANIME.valuedStatuses = ["barrier", "regen"];

/** The value a Skill's VALUED status carries (v0.03 — SP replaces Rank as the magnitude):
 *  Barrier absorbs the Skill's FULL SP cost; Regen restores HALF the SP cost (rounded down) at
 *  the start of each of the bearer's turns. Min 1. Single source of truth, shared by the
 *  inflict, aura, and on-use paths. */
export function valuedStatusValue(sp, statusId = "regen") {
  const n = Number(sp) || 1;
  return Math.max(1, statusId === "barrier" ? n : Math.floor(n / 2));
}

/** Conditions whose Inflict carries an HP/Energy POOL choice made at Skill creation (rules v0.01
 *  Inflict: "If a Status Effect has a choice between Hit Points or Energy, you make the selection
 *  during Skill Creation"). Barrier/Regen use the pool for their rolled value; Curse uses it to
 *  pick which pool's recovery it blocks. The Builder shows the pool selector for any of these. */
PROJECTANIME.poolChoiceStatuses = ["barrier", "regen", "curse"];

/** The recovery pools a creature's Curse currently blocks (rules v0.01: a Cursed creature cannot
 *  regain the cursed pool). A Skill-inflicted Curse records the pool chosen at creation on
 *  `flags.project-anime.curse.pool`; a pool-less Curse — toggled straight from the token HUD, or
 *  predating the choice — blocks BOTH pools, the original "no recovery at all" behavior. Returns
 *  `[]` when the creature isn't Cursed. The single authority every recovery path consults. */
export function cursedPools(actor) {
  if (!actor?.statuses?.has?.("curse")) return [];
  const pool = actor.getFlag?.("project-anime", "curse")?.pool;
  return pool === "hp" || pool === "energy" ? [pool] : ["hp", "energy"];
}

/**
 * Condition registry assigned to CONFIG.statusEffects during init, giving each
 * status a token-HUD icon. Foundry localizes the `name` keys.
 */
PROJECTANIME.statusConditions = [
  // Barrier (rules v0.01, beneficial): damage to the chosen pool is dealt to the Barrier's value
  // first (HP and Energy barriers are separate pools — flags.project-anime.barrier).
  { id: "barrier", name: "PROJECTANIME.Status.barrier", img: "icons/svg/holy-shield.svg" },
  { id: "blinded", name: "PROJECTANIME.Status.blinded", img: "icons/svg/blind.svg" },
  { id: "bound", name: "PROJECTANIME.Status.bound", img: "icons/svg/net.svg" },
  // Curse (rules v0.01): the bearer cannot regain its CURSED pool — healing, regen (Sustain),
  // drains, and consumables restore nothing to that pool while it lasts. The pool (Hit Points or
  // Energy) is chosen when the Skill is built; a Curse toggled by hand blocks both (see cursedPools).
  { id: "curse", name: "PROJECTANIME.Status.curse", img: "icons/svg/terror.svg" },
  { id: "decay", name: "PROJECTANIME.Status.decay", img: "icons/svg/degen.svg" },
  { id: "exhausted", name: "PROJECTANIME.Status.exhausted", img: "icons/svg/downgrade.svg" },
  { id: "prone", name: "PROJECTANIME.Status.prone", img: "icons/svg/falling.svg" },
  // Regen (rules v0.01, beneficial): the bearer regains the value into the chosen pool at the
  // start of each of their turns (flags.project-anime.regen, folded in by collectSustain).
  { id: "regen", name: "PROJECTANIME.Status.regen", img: "icons/svg/regen.svg" },
  { id: "slowed", name: "PROJECTANIME.Status.slowed", img: "icons/svg/daze.svg" },
  { id: "stunned", name: "PROJECTANIME.Status.stunned", img: "icons/svg/paralysis.svg" },
  // Vanished (rules v0.01: the Vanish Effect): the bearer cannot be seen; attacking reveals them
  // (dice.mjs revealVanished). Token visibility itself stays the GM's call.
  { id: "vanished", name: "PROJECTANIME.Status.vanished", img: "icons/svg/invisible.svg" },
  // Reflect (rules v0.01, beneficial): Skills targeting the bearer rebound on their user,
  // resolved with the attacker's own Accuracy and Damage; never reflects AOE (GM-adjudicated).
  // Was the Reflect MODIFIER pre-v0.01 — the doc moved it to the beneficial Status list, so it
  // now applies through Inflict like Barrier/Regen (migrateData swaps stored modifiers over).
  { id: "reflect", name: "PROJECTANIME.Status.reflect", img: "icons/svg/mage-shield.svg" }
];

/* -------------------------------------------- */
/*  Tests & Gear                                */
/* -------------------------------------------- */

/** What a consumable restores when used (the amount is set per item). */
PROJECTANIME.consumableRestore = {
  none: "PROJECTANIME.Consumable.restore.none",
  hp: "PROJECTANIME.Consumable.restore.hp",
  energy: "PROJECTANIME.Consumable.restore.energy"
};

/** Built-in HQ Resource types (Civ-style stockpile pools, Tensura-flavored). Setting-agnostic, so
 *  the GM can rename / re-icon / add / remove them via the Homebrew "Resources" menu
 *  (apps/material-config.mjs) — these are only the fallback defaults. A type's KEY is the stable
 *  identifier the HQ stockpile + (future) build costs reference; label + icon are presentation.
 *  Trimmed from a broad 8 to a genre-standard 5 (Pathfinder Kingmaker uses ~5 commodities): the
 *  build trio Wood/Stone, textile Cloth, the potion-economy Herbs, and Manacite — crystallized
 *  mana, the magical material the setting runs on. */
PROJECTANIME.materialCategories = {
  cloth: "PROJECTANIME.MaterialCategory.cloth",
  herb: "PROJECTANIME.MaterialCategory.herb",
  manacite: "PROJECTANIME.MaterialCategory.manacite",
  stone: "PROJECTANIME.MaterialCategory.stone",
  wood: "PROJECTANIME.MaterialCategory.wood"
};
PROJECTANIME.materialCategoryIcons = {
  cloth: "fa-solid fa-vest",
  herb: "fa-solid fa-leaf",
  manacite: "fa-solid fa-gem",
  stone: "fa-solid fa-mountain",
  wood: "fa-solid fa-tree"
};

/* -------------------------------------------- */
/*  Crafting (v0.03) — carried materials        */
/* -------------------------------------------- */

/** The four canonical Material TYPES (rules doc "Crafting"). DISTINCT from the legacy HQ resource
 *  pools (materialCategories, cloth/herb/…) that still feed the parallel HQ Workshop until Phase 6.
 *  A `material` Item's `category` is one of these keys; Forging, Brewing, Traits and Temper all key
 *  off them. Worlds may reflavor the LABELS, but the keys are the stable mechanical axis. */
PROJECTANIME.materialTypes = {
  essence: "PROJECTANIME.Material.type.essence",
  hide:    "PROJECTANIME.Material.type.hide",
  ore:     "PROJECTANIME.Material.type.ore",
  reagent: "PROJECTANIME.Material.type.reagent"
};
PROJECTANIME.materialTypeIcons = {
  essence: "fa-solid fa-atom",
  hide:    "fa-solid fa-paw",
  ore:     "fa-solid fa-gem",
  reagent: "fa-solid fa-mortar-pestle"
};
PROJECTANIME.materialTypeKeys = ["essence", "hide", "ore", "reagent"];

/** Material grades. A Prime counts as TWO Commons toward any Commons cost, and as 2 units toward
 *  its Bulk bundle. Prime is earned in the field (Elites / Bosses / finds); shops never sell it. */
PROJECTANIME.materialGrades = {
  common: "PROJECTANIME.Material.grade.common",
  prime:  "PROJECTANIME.Material.grade.prime"
};

/** Materials bundle at this many units per 1 Bulk (a Prime is 2 units). */
PROJECTANIME.materialBundleSize = 3;

/** Per-unit shop price of a Common material = this × the settlement's Tier (50G × Tier). */
PROJECTANIME.materialShopPricePerTier = 50;

/** Gear TRAITS (rules doc "Traits") — permanent modifications crafted onto a weapon / shield / armor.
 *  DISTINCT from NPC Signature Traits (helpers/trait-effect.mjs, system.traits, PROJECTANIME.Talent.*).
 *  Each row: `applies` (weapon|armor|shield|any — the item kinds it may be crafted onto) and `cost`
 *  (the materials for ONE application, which must match the party's Tier). `wired` rows adjust the
 *  item's derived stats (helpers/crafting.mjs `applyGearTraits`); the rest are display-only rules on
 *  the item. Traded stats floor at their printed minimums (DMG and Bulk stop at 0); Traits never
 *  spend DMG. An item holds up to `gearTraitCap` Traits (a Socket counts as one; Temper does not),
 *  each at most once, and accessories can hold none. `needs` marks a Trait that picks a parameter
 *  when crafted (an Element, a disguise, or a Status). */
PROJECTANIME.gearTraits = {
  attuned:     { applies: "weapon", cost: [{ type: "essence", qty: 3 }], needs: "element", wired: true },
  collapsible: { applies: "any",    cost: [{ type: "ore",     qty: 3 }], wired: true },
  concealed:   { applies: "weapon", cost: [{ type: "hide",    qty: 3 }], needs: "disguise" },
  extended:    { applies: "weapon", cost: [{ type: "ore",     qty: 3 }], wired: true },
  fitted:      { applies: "armor",  cost: [{ type: "hide",    qty: 3 }], wired: true },
  honed:       { applies: "weapon", cost: [{ type: "ore",     qty: 3 }], wired: true },
  insulated:   { applies: "armor",  cost: [{ type: "hide",    qty: 3 }] },
  lightened:   { applies: "weapon", cost: [{ type: "ore",     qty: 3 }], wired: true },
  luminous:    { applies: "any",    cost: [{ type: "essence", qty: 3 }] },
  marked:      { applies: "any",    cost: [{ type: "essence", qty: 3 }] },
  reinforced:  { applies: "armor",  cost: [{ type: "hide",    qty: 3 }], wired: true },
  socket:      { applies: "any",    cost: [{ type: "essence", qty: 2 }, { type: "essence", qty: 1, grade: "prime" }], socket: true },
  sturdy:      { applies: "any",    cost: [{ type: "hide",    qty: 3 }] },
  warded:      { applies: "armor",  cost: [{ type: "essence", qty: 3 }], needs: "status" }
};
PROJECTANIME.gearTraitKeys = [
  "attuned", "collapsible", "concealed", "extended", "fitted", "honed", "insulated",
  "lightened", "luminous", "marked", "reinforced", "socket", "sturdy", "warded"
];
/** Max Traits on one item (a Socket counts as a Trait; Temper does not). */
PROJECTANIME.gearTraitCap = 2;

/** BREWING recipes (rules doc "Brewing"). One Craft Activity brews a batch of `brewBatchSize`
 *  consumables of one recipe (a Brewer makes `brewBatchSizeBrewer`). Materials must match the
 *  recipe's Tier or higher. `out` is the consumable produced: `restore`/`amount` map to the normal
 *  consumable engine where possible; recipes whose effect the engine can't model (Field Meal's Camp
 *  bonus, Ward Salve's typed Resist, the "or EP" half of an Elixir) ship as display-only rules text.
 *  NOTE: the doc prints HP Potion two ways — "remove a Status" (Brewing table) vs "4 HP" (shop
 *  table). Resolved here to 4 HP to match its name, the shop, and the existing consumable. */
PROJECTANIME.brewRecipes = {
  elixir:            { tier: 4, cost: [{ type: "reagent", qty: 2, grade: "prime" }], out: { restore: "hp", amount: 999 } },
  energyDrink:       { tier: 1, cost: [{ type: "reagent", qty: 3 }], out: { restore: "energy", amount: 4 } },
  fieldMeal:         { tier: 1, cost: [{ type: "reagent", qty: 3 }], out: { restore: "none" } },
  hpPotion:          { tier: 1, cost: [{ type: "reagent", qty: 3 }], out: { restore: "hp", amount: 4 } },
  strongEnergyDrink: { tier: 2, cost: [{ type: "reagent", qty: 3 }], out: { restore: "energy", amount: 8 } },
  strongHpDrink:     { tier: 2, cost: [{ type: "reagent", qty: 3 }], out: { restore: "hp", amount: 8 } },
  wardSalve:         { tier: 3, cost: [{ type: "reagent", qty: 3 }], out: { restore: "none" }, needs: "element" }
};
PROJECTANIME.brewRecipeKeys = [
  "elixir", "energyDrink", "fieldMeal", "hpPotion", "strongEnergyDrink", "strongHpDrink", "wardSalve"
];
PROJECTANIME.brewBatchSize = 3;
PROJECTANIME.brewBatchSizeBrewer = 4;

/** Crafting SPECIALTIES (rules doc "Specialties") — 1 SP, one per character, downtime-only. Each
 *  tweaks a Craft mechanic (see helpers/crafting.mjs): Brewer (batch 4 + a Tier-above brew),
 *  Fieldcrafter (Craft during a Camp with an Artisan's Kit), Salvager (recover half a removed
 *  Trait's cost + convert materials), Smith (Forging costs no Gold; Trait bills −1 Common min 1),
 *  Steward (a HQ gathering facility yields double; Project Stages −1 Common min 1). */
PROJECTANIME.craftSpecialties = {
  brewer:       { icon: "fa-solid fa-flask" },
  fieldcrafter: { icon: "fa-solid fa-screwdriver-wrench" },
  salvager:     { icon: "fa-solid fa-recycle" },
  smith:        { icon: "fa-solid fa-hammer" },
  steward:      { icon: "fa-solid fa-clipboard-check" }
};
PROJECTANIME.craftSpecialtyKeys = ["brewer", "fieldcrafter", "salvager", "smith", "steward"];

/** PROJECT scopes (rules doc "Projects"). Stage-based works; one Stage per rest max. Personal's
 *  bill is the combined Forge+Trait+Temper cost split across its 2 Stages (author it freely); Grand
 *  and Legendary carry the printed per-Stage material bill. */
PROJECTANIME.projectScopes = {
  personal:  { stages: 2, bill: [] },
  grand:     { stages: 3, bill: [{ grade: "common", qty: 6 }, { grade: "prime", qty: 1 }] },
  legendary: { stages: 4, bill: [{ grade: "common", qty: 6 }, { grade: "prime", qty: 2 }] }
};
PROJECTANIME.projectScopeKeys = ["personal", "grand", "legendary"];

/** Weapon/Skill physical range categories. */
PROJECTANIME.rangeTypes = {
  melee: "PROJECTANIME.RangeType.melee",
  ranged: "PROJECTANIME.RangeType.ranged"
};

/** Which equipment slot a weapon/shield occupies. Two-handedness is `grip`, not a hand. */
PROJECTANIME.hands = {
  main: "PROJECTANIME.Hand.main",
  off: "PROJECTANIME.Hand.off"
};

/** Grip — one- or two-handed (the single source of two-handedness; Steps Up damage). */
PROJECTANIME.grips = {
  one: "PROJECTANIME.Grip.one",
  two: "PROJECTANIME.Grip.two"
};

/** A weapon's base TYPE — its category ("Sword", "Bow", …), distinct from its given name (a
 *  "Katana" IS a Sword). Free text per weapon (system.weaponType); these are just the datalist
 *  suggestions offered on the weapon sheet, and what a "Weapon Adjustment" effect matches against
 *  when scoped "By weapon type". Not an exhaustive list — GMs may type anything. */
PROJECTANIME.weaponTypeSuggestions = [
  "Sword", "Axe", "Spear", "Polearm", "Dagger", "Mace", "Hammer",
  "Club", "Flail", "Staff", "Whip", "Bow", "Crossbow", "Gun", "Thrown", "Fist", "Shield"
];

/** How a shield is wielded. "Dual Wielding" treats it as an off-hand weapon — it counts toward
 *  Dual Wielding, so both Damage dice Step Down (rules p.10). "Just for Shields" carries it for
 *  defense only: your main-hand weapon keeps its full Damage die, but a bash with the shield Steps
 *  its OWN Damage die Down (it isn't a committed weapon). See dice.mjs isDualWielding / computeDamageRoll. */
PROJECTANIME.shieldUses = {
  dual: "PROJECTANIME.ShieldUse.dual",
  shield: "PROJECTANIME.ShieldUse.shield"
};

/** NPC disposition toward the party. */
PROJECTANIME.dispositions = {
  friendly: "PROJECTANIME.Disposition.friendly",
  neutral: "PROJECTANIME.Disposition.neutral",
  hostile: "PROJECTANIME.Disposition.hostile"
};

/* -------------------------------------------- */
/*  Side Initiative (Fire-Emblem phases)        */
/* -------------------------------------------- */

/** Combat runs as SIDE INITIATIVE: the whole PLAYER side acts (Player Phase), then the whole ENEMY
 *  side (Enemy Phase), then NEUTRALS (Neutral Phase); a round = one pass through all three. Phase
 *  order is fixed — players always first — and a combatant's side comes from its token disposition.
 *  Within a phase units are FREE-PICKED (any not-yet-acted unit, in any order). */
PROJECTANIME.sides = ["friendly", "hostile", "neutral"];   // acting order: Player → Enemy → Neutral

/** Each side's initiative band. Combatants sort by `initiative` DESC, so friendly (highest) leads,
 *  then hostile, then neutral. Bands are 1000 apart — far wider than any within-side tiebreak — so
 *  sides never interleave. Assigned deterministically (no dice) by sideInitiative(). */
PROJECTANIME.sideBase = { friendly: 3000, hostile: 2000, neutral: 1000 };

/** Phase display labels (the tracker's phase headers + round line). */
PROJECTANIME.sideLabel = {
  friendly: "PROJECTANIME.Combat.phase.player",
  hostile: "PROJECTANIME.Combat.phase.enemy",
  neutral: "PROJECTANIME.Combat.phase.neutral"
};

/** Resolve a combatant's SIDE (Player/Enemy/Neutral phase) from its token disposition — FRIENDLY →
 *  friendly, NEUTRAL → neutral, HOSTILE/SECRET → hostile. A GM can override per-combatant via the
 *  `side` flag. Reads the live token disposition first, falling back to the actor's prototype token. */
export function combatantSide(combatant) {
  const D = CONST.TOKEN_DISPOSITIONS;
  const override = combatant?.getFlag?.("project-anime", "side");
  if (override && PROJECTANIME.sideBase[override] != null) return override;
  const disp = combatant?.token?.disposition
    ?? combatant?.actor?.prototypeToken?.disposition
    ?? D.HOSTILE;
  if (disp === D.FRIENDLY) return "friendly";
  if (disp === D.NEUTRAL) return "neutral";
  return "hostile";   // HOSTILE and SECRET both fight on the enemy side
}

/** A combatant's deterministic initiative = its side band + a within-side tiebreak (Agility + Mind,
 *  so faster units sit higher in the fallback order) + a tiny per-id epsilon (keeps entries distinct
 *  and stably ordered). No dice: side membership, not a roll, decides turn order. The within-side
 *  order is only a display/fallback ordering — activation itself is free-pick. */
export function sideInitiative(combatant) {
  const base = PROJECTANIME.sideBase[combatantSide(combatant)] ?? PROJECTANIME.sideBase.neutral;
  const attrs = combatant?.actor?.system?.attributes ?? {};
  const tie = (Number(attrs.agility?.value) || 0) + (Number(attrs.mind?.value) || 0);
  const id = String(combatant?.id ?? "");
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 997;
  return base + tie + h / 100000;
}

/** A combatant has already acted this round when its `actedRound` marker equals the live round. Markers
 *  are round-stamped, so a stale one (from a prior round) is inert without needing to be cleared. */
export function hasActed(combatant, round) {
  return combatant?.getFlag?.("project-anime", "actedRound") === round;
}

/** A unit that can't take an activation: Defeated (down) or Stunned (loses this turn). Such units are
 *  never pickable — the truly-down are excluded from the phase, the Stunned are auto-passed. */
export function isSkippable(combatant) {
  return !!combatant?.isDefeated || !!combatant?.actor?.statuses?.has?.("stunned");
}

/** Not-yet-acted, non-defeated combatants on a side, in stable within-side order (display + auto-pick).
 *  Stunned units are INCLUDED (they hold the phase until auto-skipped); the Defeated are excluded. */
export function pendingOnSide(combat, side) {
  return [...(combat?.combatants ?? [])]
    .filter((c) => !c.isDefeated && combatantSide(c) === side && !hasActed(c, combat.round))
    .sort((a, b) => (b.initiative ?? 0) - (a.initiative ?? 0));
}

/** The side whose phase is active right now: the highest-priority side (Player → Enemy → Neutral) that
 *  still has a pending unit. null = every side is spent → the round is complete. */
export function activeSide(combat) {
  for (const side of PROJECTANIME.sides) if (pendingOnSide(combat, side).length) return side;
  return null;
}

/** An NPC actor's role — which face of the sheet it shows. "monster" is the combat statblock (Tier,
 *  the Monster Creator, hostile by default); "npc" is a social/ally NPC a Player Character can forge a
 *  Follower Bond with (drag the NPC onto the PC's Bonds drawer — helpers/bonds.mjs). Toggled on the
 *  sheet header; defaults monster so existing NPCs are unchanged. */
PROJECTANIME.npcRoles = {
  monster: "PROJECTANIME.NpcRole.monster",
  npc: "PROJECTANIME.NpcRole.npc"
};

/* -------------------------------------------- */
/*  Bonds (v0.03)                               */
/* -------------------------------------------- */

/**
 * A Bond (rules doc "Variant Rules: Bond") is a relationship shared between EXACTLY two characters,
 * tracked per-character on `system.bonds` (data/actor-models.mjs). Two kinds:
 *   • Party Bond    — between two Player Characters. Grants the automated Party benefits below.
 *   • Follower Bond — between a Player Character and an NPC (role "npc"). Grants the Follower benefits.
 * A bond starts at rank C with 0 Bond Points; it deepens as the pair earns BP and plays a Bond Scene
 * (the scene gate). Both sides of the bond are kept in sync (helpers/bonds.mjs).
 */
PROJECTANIME.bondKinds = {
  party: "PROJECTANIME.Bond.kind.party",
  follower: "PROJECTANIME.Bond.kind.follower"
};

/** Bond ranks low→high. Stored on the bond as an index 0–3; these are the display letters. */
PROJECTANIME.bondRanks = ["C", "B", "A", "S"];
PROJECTANIME.bondMaxRank = 3; // index of "S"

/** Cumulative Bond-Point thresholds to become ELIGIBLE for each rank (index → BP needed): C free,
 *  B at 2, A at 4, S at 7. Reaching a threshold only unlocks the rank — the pair must still share a
 *  Bond Scene to actually rise (bondEligibleRank vs the stored rank drives the "ready to rank up" gate). */
PROJECTANIME.bondThresholds = [0, 2, 4, 7];

/** Party-Bond benefits, cumulative at their rank index. `rules` (Effect-Builder rules) project as a
 *  player-TOGGLEABLE Active Effect the player flips on while within 1 tile of the partner
 *  (helpers/bond-effect.mjs); a `tracked` benefit (Dual Strike) is a 1/Conflict reaction surfaced in
 *  the book rather than an automatic effect. */
PROJECTANIME.partyBondBenefits = [
  { rank: 0, key: "sideBySide", rules: [{ type: "roll", selector: "attack", value: 1 }], toggle: true },
  { rank: 2, key: "backToBack", rules: [{ type: "stat", key: "defense", value: 1 }, { type: "stat", key: "res", value: 1 }], toggle: true },
  { rank: 3, key: "dualStrike", tracked: true }
];

/** Follower-Bond benefits, cumulative at their rank index. All four are qualitative ("shaped with the
 *  GM") — surfaced as preset text; Aid (rank B) additionally carries a pick-one choice. No projected
 *  Active Effect. */
PROJECTANIME.followerBondBenefits = [
  { rank: 0, key: "welcome" },
  { rank: 1, key: "aid", choice: true },
  { rank: 2, key: "lesson" },
  { rank: 3, key: "devotion" }
];

/** The three Aid (Follower rank B) options the player picks one of. */
PROJECTANIME.bondAidChoices = {
  livelihood: "PROJECTANIME.Bond.aid.livelihood",
  hearth: "PROJECTANIME.Bond.aid.hearth",
  access: "PROJECTANIME.Bond.aid.access"
};

/** Highest rank index a Bond holding `bp` Bond Points is ELIGIBLE for (ignores the scene gate). */
export function bondEligibleRank(bp) {
  const n = Number(bp) || 0;
  let r = 0;
  for (let i = 0; i < PROJECTANIME.bondThresholds.length; i++) if (n >= PROJECTANIME.bondThresholds[i]) r = i;
  return r;
}

/** BP total needed for the NEXT rank above index `rank`, or null when already at S (max). */
export function bondNextThreshold(rank) {
  const r = Number(rank) || 0;
  return r >= PROJECTANIME.bondMaxRank ? null : PROJECTANIME.bondThresholds[r + 1];
}

/* -------------------------------------------- */
/*  Headquarters (v0.03)                        */
/* -------------------------------------------- */

/**
 * A Headquarters (rules doc "Variant Rules: Headquarters") is the home the party owns. It grows on
 * two things: Gold builds the rooms (Facilities), People bring them to life (resident Followers who
 * STEWARD a facility). Its state is a single world object (the `covenantHQ` setting; helpers/hq.mjs).
 *   • RENOWN = facilities built + resident Followers (derived, never stored).
 *   • RANK C/B/A/S rises at a rest here once Renown meets the threshold; each rank raises the Facility
 *     Cap and grants a cumulative benefit.
 *   • Residents are the party's Follower Bonds flagged "resides" (data/actor-models.mjs `bonds[].resides`);
 *     a resident STEWARDS one facility, and while stewarding their Favored Facility its Favor line applies.
 */

/** HQ ranks low→high. `renown` = the Renown needed to reach this rank; `cap` = its Facility Cap. Rank
 *  benefits are cumulative and wired where their mechanics live (rest.mjs, shop.mjs, helpers/bonds.mjs). */
PROJECTANIME.hqRanks = [
  { key: "C", name: "Hideout",   renown: 0,  cap: 3  },
  { key: "B", name: "Stronghold", renown: 6,  cap: 6  },
  { key: "A", name: "Haven",     renown: 12, cap: 10 },
  { key: "S", name: "Legend",    renown: 20, cap: 15 }
];
PROJECTANIME.hqRankKeys = ["C", "B", "A", "S"];

/** The Mission Board opens at rank B. Active-mission cap by rank: Stronghold 1, Haven 2, Legend 3. */
PROJECTANIME.hqMissionCap = { C: 0, B: 1, A: 2, S: 3 };

/** The six Ask shapes a recruit candidate can carry (recruitment is never a roll — meet the Ask or don't). */
PROJECTANIME.hqAsks = {
  bond:      { label: "Bond",      hint: "Reach a Bond rank with them or with someone they trust." },
  debt:      { label: "Debt",      hint: "Settle what weighs on them: a rival paid off, a name cleared, a promise kept." },
  deed:      { label: "Deed",      hint: "Do something that matters to them: clear the bandits, save the shop, win the tournament." },
  delivery:  { label: "Delivery",  hint: "Bring them something: a rare item, a lost heirloom, word from someone far away." },
  duel:      { label: "Duel",      hint: "Beat them, or impress them, in a contest of their choosing." },
  threshold: { label: "Threshold", hint: "Wait until the base is worthy: a facility build, a rank reached." }
};

/** Mission Board types (flavour + which facilities tend to be Suited). */
PROJECTANIME.missionTypes = {
  scout:  { label: "Scout" },
  trade:  { label: "Trade" },
  search: { label: "Search" },
  escort: { label: "Escort" },
  aid:    { label: "Aid" }
};

/** Mission reward-by-duration (Gold auto-scales by party Tier; the alternatives are GM-narrated). */
PROJECTANIME.missionRewards = {
  1: { goldPerTier: 100, note: "100G × Tier, a lead, or a minor item" },
  2: { goldPerTier: 200, note: "200G × Tier, an uncommon item, or a follower candidate" },
  3: { goldPerTier: 0,   note: "A rare item, a major lead, or a named recruit (Storyteller's discretion)" }
};

/**
 * The 14 printed Facilities. Each is built once with Gold at a minimum HQ rank, and does one thing
 * unstaffed, more when Staffed by a steward, more still on its Favor line (steward's Favored Facility),
 * and carries one Gold Upgrade (needs the steward's Follower Bond at rank B+). The four lines are printed
 * reference; `auto` flags the benefits the SYSTEM wires:
 *   vendor:      opens the HQ Shop ("consumable" | "gear"); `accessoriesOnUpgrade` stocks accessories.
 *   restGrant:   a once-per-rest staffed benefit resolved in rest.mjs
 *                ("freeConsumable" | "freeBondScene" | "freeCraft" | "materials" | "workGold" | "luckExtra").
 *   luckStep:    Steps Up the Charm die for Luck Dice rolled here (Shrine).
 */
PROJECTANIME.hqFacilities = {
  apothecary: {
    name: "Apothecary", icon: "fa-solid fa-mortar-pestle", rank: "C", cost: 750, upgradeCost: 1500,
    vendor: "consumable",
    restGrant: "freeConsumable",
    unstaffed: "Buy consumables at the Headquarters at list price.",
    staffed:   "Consumables cost 10% less. Once per rest, each character receives one free HP Potion or Energy Drink.",
    favor:     "The free consumable may be a Strong HP Potion or Strong Energy Drink.",
    upgrade:   "Potions bought here restore +2."
  },
  archive: {
    name: "Archive", icon: "fa-solid fa-book-bookmark", rank: "B", cost: 1500, upgradeCost: 3000,
    unstaffed: "Pursuit Checks to research gain +1.",
    staffed:   "Once per rest, one research Pursuit succeeds without a Check, within reason.",
    favor:     "The Archive keeps a record of every foe the party has fought, with one Analyze category noted for each.",
    upgrade:   "When the party faces a foe they researched here, learn one Analyze category at the start of the Conflict."
  },
  bathhouse: {
    name: "Bathhouse", icon: "fa-solid fa-hot-tub-person", rank: "C", cost: 500, upgradeCost: 1000,
    restGrant: "freeBondScene",
    unstaffed: "Bond Scenes held here cost a slot from only one partner.",
    staffed:   "Once per rest, one character may share a Bond Scene with a resident without spending a slot.",
    favor:     "The free Bond Scene may include a third participant; each pair present gains 1 BP.",
    upgrade:   "Visiting NPCs may be hosted. Follower Bond Scenes with visitors count as held at the Headquarters."
  },
  forge: {
    name: "Forge", icon: "fa-solid fa-hammer", rank: "C", cost: 1000, upgradeCost: 2000,
    vendor: "gear", accessoriesOnUpgrade: true,
    unstaffed: "Buy and sell weapons, armor, and shields at the Headquarters at standard rates.",
    staffed:   "Those goods cost 10% less, and you may adjust your armor's Protection split any time you rest here.",
    favor:     "The Forge buys weapons, armor, and shields at 60%, and once per rest one character may re-split their Protection mid-stay.",
    upgrade:   "The Forge stocks Accessories."
  },
  garden: {
    name: "Garden", icon: "fa-solid fa-seedling", rank: "C", cost: 500, upgradeCost: 1000,
    restGrant: "workGold",
    unstaffed: "The Work activity is always available at the Headquarters.",
    staffed:   "Work at the Headquarters yields +50G.",
    favor:     "Once per rest, one Work yields double.",
    upgrade:   "The staffed bonus becomes +100G."
  },
  gatheringGrounds: {
    name: "Gathering Grounds", icon: "fa-solid fa-wheat-awn", rank: "C", cost: 750, upgradeCost: 1500,
    restGrant: "materials", gather: true,
    unstaffed: "Once per rest, the party gains 1 Common of a type fitting the grounds, at party Tier.",
    staffed:   "Each rest, the grounds yield 3 Commons of one type, chosen when built, at party Tier.",
    favor:     "Choose the yield's type freely each rest.",
    upgrade:   "The grounds yield a second type, chosen when upgraded, at the same rate."
  },
  infirmary: {
    name: "Infirmary", icon: "fa-solid fa-kit-medical", rank: "C", cost: 750, upgradeCost: 1500,
    restGrant: "luckExtra",
    unstaffed: "Recover here may remove complications that normally require a specialist.",
    staffed:   "One Recover here removes up to two complications.",
    favor:     "At the end of a rest here, every character may roll to restore one additional spent Luck Die.",
    upgrade:   "Once per Season, the healer travels: the party may use the Infirmary's benefits at a Camp."
  },
  shrine: {
    name: "Shrine", icon: "fa-solid fa-torii-gate", rank: "B", cost: 1500, upgradeCost: 3000,
    luckStep: true,
    unstaffed: "When replacing Luck Dice at a rest here, roll one extra time and drop the lowest.",
    staffed:   "Step Up your Charm die for Luck Dice rolled here.",
    favor:     "The Step Up applies to every character resting here.",
    upgrade:   "Once per Season, one character may set one Luck Die to its maximum value instead of rolling."
  },
  stables: {
    name: "Stables", icon: "fa-solid fa-horse", rank: "B", cost: 1500, upgradeCost: 3000,
    unstaffed: "Travel from the Headquarters takes half the time.",
    staffed:   "Once per trip, one Camp on the road counts as a Town for recovery only. It grants no slots.",
    favor:     "Missions of the Scout and Escort types resolve one rest sooner, minimum 1.",
    upgrade:   "The wagon carries a shared stash: +10 CAP split among the party while traveling."
  },
  tavern: {
    name: "Tavern", icon: "fa-solid fa-beer-mug-empty", rank: "C", cost: 750, upgradeCost: 1500,
    unstaffed: "At each rest, the Storyteller offers one rumor or lead.",
    staffed:   "Once per rest, the party meets one potential Follower candidate.",
    favor:     "The candidate is someone connected to a lead the party is already chasing.",
    upgrade:   "Once per Season, host a festival: every pair attending gains 1 BP, and rank-up Scenes may be played here."
  },
  trainingGrounds: {
    name: "Training Grounds", icon: "fa-solid fa-dumbbell", rank: "C", cost: 1000, upgradeCost: 2000,
    unstaffed: "You may test a Skill build in a practice bout before spending SP on it.",
    staffed:   "When you Train here, you may immediately spend the SP gained on Refine without taking the Refine activity.",
    favor:     "Practice bouts may include the steward as a sparring partner; once per rest, one character gains 1 BP with the steward.",
    upgrade:   "Practice bouts can simulate any Twist or Boss mechanic the party has faced."
  },
  warRoom: {
    name: "War Room", icon: "fa-solid fa-chess-rook", rank: "A", cost: 2500, upgradeCost: 5000,
    unstaffed: "For planned battles, the players choose their own starting positions.",
    staffed:   "Before a planned Conflict, learn the enemy count and roles.",
    favor:     "Also learn the enemy's Tier.",
    upgrade:   "When a Conflict begins at the Headquarters, the Storyteller grants prepared ground: cover, fortifications, and chosen terrain."
  },
  watchtower: {
    name: "Watchtower", icon: "fa-solid fa-binoculars", rank: "B", cost: 1500, upgradeCost: 3000,
    unstaffed: "The Headquarters cannot be taken by surprise. The Storyteller gives warning of approaching threats.",
    staffed:   "Before traveling, learn one true fact about the destination.",
    favor:     "Once per rest, the Storyteller reveals whether a chosen mission on the Board is riskier than it appears.",
    upgrade:   "Warnings extend across the region. Allies and Followers elsewhere can send word within a day."
  },
  workshop: {
    name: "Workshop", icon: "fa-solid fa-screwdriver-wrench", rank: "C", cost: 1000, upgradeCost: 2000,
    restGrant: "freeCraft",
    unstaffed: "Materials stored here have no Bulk and cannot be stolen.",
    staffed:   "Once per rest, one character may take one Craft Activity without spending a slot.",
    favor:     "While the party is away, the steward may advance one Project Stage per rest, paying its bill from stored materials.",
    upgrade:   "Once per Season, remove one Flaw here without a bill. Flaws that refuse the forge still refuse."
  }
};

/** Custom Facilities (up to 3 slots) — GM-built, must stay inside the Four Rails. Reference limits. */
PROJECTANIME.hqCustomRails = {
  maxSlots: 3,
  costByRank: { C: "500–1000G", B: "1500G", A: "2500G" },
  function: "Touches downtime, information, economy, or story. Never combat stats, never the action economy, never SP beyond Train.",
  shape:    "One unstaffed line, one staffed line, one Favor line, one upgrade.",
  relief:   "If it lets an activity skip a slot: once per rest, and only if no printed facility already relieves that activity."
};

/** The rank a Headquarters with `renown` Renown qualifies for (index into hqRanks). Rank only actually
 *  rises at a rest there — this is the ELIGIBLE rank the rest checks against the stored rank. */
export function hqRankForRenown(renown) {
  const n = Number(renown) || 0;
  const ranks = PROJECTANIME.hqRanks;
  let r = 0;
  for (let i = 0; i < ranks.length; i++) if (n >= ranks[i].renown) r = i;
  return r;
}

/** The Facility Cap for a rank index (0–3). */
export function hqCapForRank(rankIndex) {
  const ranks = PROJECTANIME.hqRanks;
  const i = Math.max(0, Math.min(ranks.length - 1, Number(rankIndex) || 0));
  return ranks[i].cap;
}

/** The Renown needed for the NEXT rank above index `rank`, or null when already at S (max). */
export function hqNextRenown(rankIndex) {
  const ranks = PROJECTANIME.hqRanks;
  const r = Number(rankIndex) || 0;
  return r >= ranks.length - 1 ? null : ranks[r + 1].renown;
}

/* -------------------------------------------- */
/*  Monster Tiers (anime ranking)               */
/* -------------------------------------------- */

/** Default "Encounter Power" — the party-power baseline the Monster Creator scales Tiers
 *  from until the GM sets the world setting. Read it as "a typical CURRENT PC's total Skill
 *  Points" (a fresh PC starts around 6); the GM raises it as the campaign advances. */
PROJECTANIME.encounterPowerDefault = 6;

/**
 * Monster "Tier" — the anime combat ROLE / shape an NPC plays (minion / standard / elite / solo),
 * INDEPENDENT of its power level (that's the per-NPC ★ star rating — see PROJECTANIME.starPower).
 * A monster is built on the same rules as a Player Character (the five Attributes start at d4 and
 * you spend Step-Ups); the ★ rating sets the build BUDGET and MAGNITUDE and the Tier sets the SHAPE
 * it's spent in. So a "★1 Solo" and a "★5 Minion" are both legal and mean something different. Stars
 * own MAGNITUDE; the Tier owns the split + frame + role:
 *   • `spFactor`  — Skill Points granted = round-to-nearest-5(power × spFactor), floored at 5 for any
 *                   real Tier, where `power` = the ★ rating's local Encounter Power (starPower) or the
 *                   global dial when unstarred. SP always lands on a multiple of 5 (the grain players
 *                   spend in). The factors are tuned so the ★3 baseline (power 9) yields a clean,
 *                   distinct ladder — Minion 5 / Standard 10 / Elite 15 / Solo 25 — and scale from there.
 *   • `hpRank` / `epRank` — the RANK multiplier on the Fabula-Ultima vitals base (see PROJECTANIME.starLevel
 *                   and npcVitals): HP = round5(Level + 2.5·Might) × hpRank, Energy = round5(Level + 2.5·Spirit)
 *                   × epRank. Mirrors FU's rank scaling — Standard ×1, Elite ×2 HP, Solo (Champion) ×N HP
 *                   (N = soloChampionX) and ×2 Energy. `hpRank: null` = the live Champion factor. A Minion's
 *                   base is its PER-MEMBER pool (the squad pools it × size, helpers/squad.mjs).
 *   • `stepUps`   — the Attribute Step-Up budget (a starting PC gets 5). Attributes cap at d12 for
 *                   everyone, so a Tier's dice top out near a maxed PC's and need no star scaling.
 *   • `evasion` / `defense` — flat bonuses written to the NPC's Evasion / Defense Bonus.
 *   • `turns` — fixed actions this Tier takes PER ROUND (action economy): Minion 1, Standard 1,
 *               Elite 2. Solo is `null` = the LIVE player count, computed in actionsPerRound (a Boss
 *               matches the party's action economy). The old ★4+ apex bonus is retired. A Boss gets this
 *               many Combatant ENTRIES at spread initiative values (project-anime.mjs ensureBossSlots), so
 *               its actions interleave with the players' turns natively — never back-to-back.
 *   • `pcWorth` — the ENCOUNTER-BUDGET currency: how many Player Characters this ONE body is worth
 *                 (the Fabula-Ultima rank model). Minion 0.25 (×4 = 1 PC), Standard 1, Elite 2; a Solo
 *                 is dynamic (= the party's player count, a balanced 1-v-party boss) so it's stored
 *                 `null` and resolved live (helpers/encounter.mjs tierPcWorth). This folds power AND
 *                 action economy into one number, and is INDEPENDENT of ★ power — build the NPC
 *                 on-level for its ★ and the flat worth holds.
 * All plain, easily-tuned numbers (like `skillRanks`) — a starting point to iterate on, not a
 * finished balance pass. `icon` / `color` drive the ★-Tier badge on the NPC sheet header.
 * NOTE: `hpRank` / `epRank` only affect NEW derivations (the Monster Creator); a built NPC stores
 * concrete HP/EN, so retuning these never moves an existing statblock.
 */
PROJECTANIME.monsterTiers = {
  minion:   { label: "PROJECTANIME.Tier.minion",   icon: "fa-solid fa-skull",         color: "#7a8a8f", stepUps: 3,  hpRank: 1,    epRank: 1, evasion: 0, defense: 0, spFactor: 0.5,  turns: 1, pcWorth: 0.25 },
  standard: { label: "PROJECTANIME.Tier.standard", icon: "fa-solid fa-hand-fist",     color: "#4f6c9c", stepUps: 4,  hpRank: 1,    epRank: 1, evasion: 0, defense: 0, spFactor: 1,    turns: 1, pcWorth: 1 },
  elite:    { label: "PROJECTANIME.Tier.elite",    icon: "fa-solid fa-shield-halved", color: "#4f9c6c", stepUps: 5,  hpRank: 2,    epRank: 1, evasion: 1, defense: 1, spFactor: 1.5,  turns: 2,    pcWorth: 2 },
  solo:     { label: "PROJECTANIME.Tier.solo",     icon: "fa-solid fa-crown",         color: "#9c4f6c", stepUps: 8,  hpRank: null, epRank: 2, evasion: 2, defense: 2, spFactor: 2.5,  turns: null, pcWorth: null }
};

/** Iteration order for monster Tiers (weakest → strongest). */
PROJECTANIME.monsterTierKeys = ["minion", "standard", "elite", "solo"];

/* -------------------------------------------- */
/*  Enemies v0.03 — Role × Tier, Strong/Weak    */
/* -------------------------------------------- */

/**
 * The v0.03 Enemy model. An enemy is a **Role** (what it does) at a **Tier** I–IV (the party's power
 * band). It does not track five Attributes — it has a **Strong die** (the tier's die) and a **Weak die**
 * (two steps down, min d4). The Role picks WHICH Attributes are Strong; every other Attribute is Weak.
 * HP / EP / the combat stats fall out of those dice the same way a PC's do, plus the Role's flat deltas.
 * This retires the ★-power × shape (minion/standard/elite/solo) model — those symbols above are kept
 * only for legacy validation + the Animate servant tax; nothing new keys off them.
 */

/** Tier → its Strong and Weak die SIZE (the attribute value 4–12). Strong = the tier die; Weak = two
 *  rungs down the d4/d6/d8/d10/d12 ladder, floored at d4. (I d6/d4 · II d8/d4 · III d10/d6 · IV d12/d8.) */
PROJECTANIME.enemyTierDice = {
  1: { strong: 6,  weak: 4 },
  2: { strong: 8,  weak: 4 },
  3: { strong: 10, weak: 6 },
  4: { strong: 12, weak: 8 }
};

/** Iteration order for enemy Tiers (1–4). */
PROJECTANIME.enemyTierKeys = [1, 2, 3, 4];

/** The Strong or Weak die value for a Tier (clamped to a real tier; defaults to Tier I). */
export function enemyTierDie(tier, strong = true) {
  const row = PROJECTANIME.enemyTierDice[Math.clamp(Math.round(Number(tier) || 1), 1, 4)] ?? PROJECTANIME.enemyTierDice[1];
  return strong ? row.strong : row.weak;
}

/**
 * The 7 Roles as data (rules doc "Enemies" table). Each Role sets:
 *   • `strong` — the Attributes that use the Strong die (the rest use the Weak die). `null` = Elite,
 *                which picks ANY three (stored per-NPC in `system.strongAttrs`).
 *   • `hpMult` — HP multiplier on the 6 + ⟪Might⟫×2 base (Brute ×1.5, Elite ×1.25, the squishy Roles
 *                ×0.75). Swarm ignores this and uses `hpFlat` (a flat HP by tier).
 *   • `hpFlat` — Swarm only: HP is a flat 5 / 8 / 10 / 12 by Tier (index = tier−1), not a formula.
 *   • `deltas` — flat bonuses written to the stat's `.bonus` at build time (atk / defense / res /
 *                evasion / as / movement).
 *   • `magic`  — the Role's Basic Attack targets RES (a magical strike) instead of DEF (Caster).
 *   • `twists` — how many Twists the Role brings "for free" (Caster 1, Support 2); the soft cap on
 *                total Twists before an enemy should become an Elite is 2 (see enemyTwistCap).
 *   • `threat` — its cost in the Threat encounter budget (Grunt 1 · Brute 1.5 · Skirmisher 1 · Caster 1
 *                · Support 1 · Swarm ½ · Elite 2). Rival = Elite + 1 (3); Boss is computed live.
 *   • `skirmisher` — exempt from the Speed rail (a Skirmisher is allowed to cross the Follow-Up line).
 */
PROJECTANIME.enemyRoles = {
  grunt:      { label: "PROJECTANIME.EnemyRole.grunt",      icon: "fa-solid fa-helmet-battle",  color: "#7a8a8f", strong: ["might", "agility"], hpMult: 1,    threat: 1,   twists: 0, deltas: {} },
  brute:      { label: "PROJECTANIME.EnemyRole.brute",      icon: "fa-solid fa-hand-fist",      color: "#9c6b4f", strong: ["might", "spirit"],  hpMult: 1.5,  threat: 1.5, twists: 0, deltas: { atk: 2, evasion: -2, as: -2 } },
  skirmisher: { label: "PROJECTANIME.EnemyRole.skirmisher", icon: "fa-solid fa-wind",           color: "#4f9c8f", strong: ["agility", "mind"],  hpMult: 0.75, threat: 1,   twists: 0, deltas: { evasion: 2, as: 2, movement: 1 }, skirmisher: true },
  caster:     { label: "PROJECTANIME.EnemyRole.caster",     icon: "fa-solid fa-wand-sparkles",  color: "#7a5fa8", strong: ["mind", "spirit"],   hpMult: 0.75, threat: 1,   twists: 1, deltas: {}, magic: true },
  support:    { label: "PROJECTANIME.EnemyRole.support",    icon: "fa-solid fa-staff-snake",    color: "#4f7c9c", strong: ["spirit", "charm"],  hpMult: 0.75, threat: 1,   twists: 2, deltas: { atk: -2 } },
  swarm:      { label: "PROJECTANIME.EnemyRole.swarm",      icon: "fa-solid fa-bugs",           color: "#8a8f4f", strong: ["agility"],          hpFlat: [5, 8, 10, 12], threat: 0.5, twists: 0, deltas: { atk: -2 } },
  elite:      { label: "PROJECTANIME.EnemyRole.elite",      icon: "fa-solid fa-shield-halved",  color: "#4f9c6c", strong: null, strongCount: 3, hpMult: 1.25, threat: 2,   twists: 1, deltas: { atk: 1, defense: 1, res: 1, evasion: 1 } }
};

/** Iteration order for enemy Roles (weakest → strongest / chaff → elite). */
PROJECTANIME.enemyRoleKeys = ["grunt", "brute", "skirmisher", "caster", "support", "swarm", "elite"];

/** Soft cap on Twists (pre-built Skills) an enemy carries before it should be an Elite. A 3rd makes
 *  it an Elite (the creator warns). */
PROJECTANIME.enemyTwistCap = 2;

/** The Roman numeral for an enemy Tier (I–IV; 0/blank → ""). */
PROJECTANIME.enemyTierNumerals = { 0: "", 1: "I", 2: "II", 3: "III", 4: "IV" };

/** Which Attributes are Strong for an enemy: the Role's fixed pair, or (Elite) the per-NPC stored
 *  choice of three — falling back to a sensible default when unset/malformed. Returns a lowercase
 *  Attribute-key array; every other Attribute is Weak. */
export function enemyStrongAttrs(roleKey, stored = []) {
  const role = PROJECTANIME.enemyRoles[roleKey];
  if (!role) return [];
  if (Array.isArray(role.strong)) return role.strong;
  // Elite (or a custom Role) picks its own set. Keep only valid, de-duplicated Attribute keys.
  const want = role.strongCount ?? 3;
  const picks = [...new Set((Array.isArray(stored) ? stored : []).filter((k) => PROJECTANIME.attributeKeys.includes(k)))];
  if (picks.length === want) return picks;
  // Default three for an Elite that hasn't chosen: a balanced bruiser.
  return picks.length ? picks.slice(0, want) : ["might", "agility", "spirit"].slice(0, want);
}

/** An enemy's Threat — its cost in the encounter budget. A Rival counts as Elite + 1 (= 3). A Boss is
 *  computed from party size + extra Bars (bossThreat); here a plain Boss with no extra Bars reads its
 *  Role threat, and callers with a party size use bossThreat. Unknown Role → 1. */
export function enemyRoleThreat(roleKey) {
  return PROJECTANIME.enemyRoles[roleKey]?.threat ?? 1;
}

/** An enemy's HP and EP under the v0.03 Role × Tier model:
 *    HP = round( (6 + ⟪Might⟫×2) × Role HP multiplier ), or a Swarm's flat 5/8/10/12 by tier.
 *    EP = ⟪Spirit⟫ × 2.
 *  ⟪Might⟫ / ⟪Spirit⟫ are each the Strong die when that Attribute is in the Strong set, else the Weak
 *  die. `tier` is 1–4; `strong` is the resolved Strong-Attribute array (enemyStrongAttrs). Floored at 1. */
export function enemyVitals(roleKey, tier, strong) {
  const role = PROJECTANIME.enemyRoles[roleKey] ?? PROJECTANIME.enemyRoles.grunt;
  const t = Math.clamp(Math.round(Number(tier) || 1), 1, 4);
  const dieOf = (attr) => enemyTierDie(t, (strong ?? []).includes(attr));
  const might = dieOf("might");
  const spirit = dieOf("spirit");
  const hp = Array.isArray(role.hpFlat)
    ? (role.hpFlat[t - 1] ?? role.hpFlat[0])
    : Math.round((6 + might * 2) * (role.hpMult ?? 1));
  return { hp: Math.max(1, hp), energy: Math.max(1, spirit * 2) };
}

/* -------------------------------------------- */
/*  Boss Bars (v0.03)                           */
/* -------------------------------------------- */

/** A Boss's Bar count = half the party size, rounded up (min 1). */
export function bossBarCount(partySize) {
  return Math.max(1, Math.ceil((Number(partySize) || 1) / 2));
}

/** Per-Bar HP by Tier: 8 / 10 / 12 / 14 × party size (Tier I–IV). */
export function bossBarHp(tier, partySize) {
  const perTier = { 1: 8, 2: 10, 3: 12, 4: 14 };
  const mult = perTier[Math.clamp(Math.round(Number(tier) || 1), 1, 4)] ?? 8;
  return Math.max(1, mult * Math.max(1, Number(partySize) || 1));
}

/** A Boss's Threat: party size, +2 for each Bar beyond the standard formula (bossBarCount). */
export function bossThreat(partySize, bars) {
  const size = Math.max(1, Number(partySize) || 1);
  const extra = Math.max(0, (Number(bars) || 0) - bossBarCount(size));
  return size + 2 * extra;
}

/* -------------------------------------------- */
/*  Minion Squads (pooled-unit hordes)          */
/* -------------------------------------------- */

/**
 * A MINION is the only Tier that fields in numbers, and it does so as a SQUAD — a single
 * combat unit (one token, one initiative, one pooled HP bar), NOT N independent bodies. This
 * is the 13th-Age mob / Draw-Steel squad / Genesys minion-group model, and it replaces the old
 * per-row "× quantity" multiplier on the Encounter Builder. The squad's max HP is its per-member
 * HP × its size (so area damage spills naturally across the unit), and a Basic Attack is one shared
 * group-strike — a single to-hit whose damage sums every living member (dice.mjs rollSquadStrike) —
 * so durability AND output scale with the count, which is what keeps the unit's encounter price
 * honest. Standard / Elite / Solo never squad: each
 * is its own body (drag the actor again to field another).
 */

/** Squad worth is LINEAR in the encounter budget: each member is worth 0.25 of a PC (the Minion
 *  Tier's `pcWorth`), so four = one PC and a size-N squad spends N×0.25 Party-Equivalents. The pooled
 *  one-initiative HP bar is what keeps that honest — the swarm acts once and dies to one good AoE. */

/** Default size a freshly-dropped minion squad takes when the party size is unknown (manual mode):
 *  Draw Steel buys minions four at a time; we mirror that. The Encounter Builder prefers the live
 *  player count when it has one. */
PROJECTANIME.squadDefaultSize = 4;

/** Hard ceiling on a squad's member count (the +/- stepper and the size clamp). */
PROJECTANIME.squadMaxSize = 12;

/* -------------------------------------------- */
/*  Star rating (per-NPC power level)           */
/* -------------------------------------------- */

/**
 * A monster's per-NPC ★ star rating (1–5) → its LOCAL Encounter Power, substituted for the global
 * dial when building and pricing THAT one NPC. This is the single new magnitude knob the star
 * system introduces. GEOMETRIC (~1.5×/step) so each rank is a felt "wall" (the anime / gacha rank
 * jump), and ANCHORED so ★2 = the default dial of 6 — which means an unrated NPC left at the
 * on-level ★2 reproduces today's numbers exactly (zero-break migration). ★0 / unrated = fall back
 * to the global getEncounterPower() dial. Plain, tunable numbers.
 */
PROJECTANIME.starPower = { 1: 4, 2: 6, 3: 9, 4: 14, 5: 22 };

/** Highest star rating offered (the picker + clamp ceiling). */
PROJECTANIME.maxStars = 5;

/** The ★ a legacy tier-only NPC reads as "on level" — used ONLY for the one-time cosmetic star seed
 *  and as the Monster Creator's default star when a Tier is first picked. Never auto-derived after. */
PROJECTANIME.tierOnLevelStar = { minion: 1, standard: 2, elite: 3, solo: 4 };

/** A star rating's local Encounter Power, or 0 if it's outside the 1..maxStars band (unrated). */
export function starPowerValue(stars) {
  const s = Number(stars) || 0;
  return (s >= 1 && s <= PROJECTANIME.maxStars) ? (PROJECTANIME.starPower[s] ?? 0) : 0;
}

/** The power an NPC is built/priced against: its ★ rating's local power, else the global dial. The
 *  ONE substitution that makes stars a per-NPC override of the campaign Encounter Power. */
export function starOrDialPower(actor) {
  return starPowerValue(actor?.system?.stars) || getEncounterPower();
}

/* -------------------------------------------- */
/*  NPC vitals — Fabula-Ultima additive model   */
/* -------------------------------------------- */

/**
 * A monster's ★ rating → its Fabula-Ultima "Level" band, the magnitude term in the HP/Energy formula
 * (npcVitals). FU keys vitals to an integer Level that climbs in multiples of 5/10; the ★ rating picks
 * the band. Numbers stay multiples of 5 because both terms of the formula are: the Level here, and
 * 2.5 × an (always-even) attribute die. ★0 / unrated falls back to npcLevelDefault (the ★2 baseline).
 */
PROJECTANIME.starLevel = { 1: 5, 2: 10, 3: 20, 4: 30, 5: 40 };

/** The Level an unrated NPC derives vitals at — the ★2 baseline / on-level default. */
PROJECTANIME.npcLevelDefault = 10;

/** Solo "Champion factor": how many PCs' worth of HP a Solo's body carries (FU Champion(X), X ≈ party
 *  size). The Tier's `hpRank: null` resolves to this — a plain, tunable assumed party size. */
PROJECTANIME.soloChampionX = 4;

/** An NPC's vitals Level from its ★ rating (the FU magnitude band), or the unrated default. */
export function starLevel(stars) {
  return PROJECTANIME.starLevel[Number(stars) || 0] ?? PROJECTANIME.npcLevelDefault;
}

/** Round to the nearest 5 (the Fabula-Ultima vitals grain). */
function round5(n) {
  return Math.round((Number(n) || 0) / 5) * 5;
}

/**
 * A monster's derived HP and Energy under the Fabula-Ultima additive model (Spec B), keyed to its ★
 * Level and Tier rank — NOT a multiplier on ⟪attr⟫×2. Per FU:
 *   HP     = round5( Level + 2.5 × Might  ) × hpRank
 *   Energy = round5( Level + 2.5 × Spirit ) × epRank
 * where Level = starLevel(stars) and the Tier supplies the rank multipliers (Standard ×1, Elite ×2 HP,
 * Solo ×soloChampionX HP and ×2 Energy). For a Minion the returned HP is the PER-MEMBER pool (hpRank 1);
 * the squad pools it × size (helpers/squad.mjs). Floored at 5. `might`/`spirit` are die-size numbers.
 */
export function npcVitals(tierKey, stars, might, spirit) {
  const t = PROJECTANIME.monsterTiers[tierKey] ?? PROJECTANIME.monsterTiers.standard;
  const level = starLevel(stars);
  const hpRank = (t.hpRank == null) ? PROJECTANIME.soloChampionX : t.hpRank;
  const epRank = t.epRank ?? 1;
  return {
    hp: Math.max(5, round5(level + 2.5 * (Number(might) || 4)) * hpRank),
    energy: Math.max(5, round5(level + 2.5 * (Number(spirit) || 4)) * epRank)
  };
}

/** World-setting key for the Monster Creator's Encounter Power dial. */
export const ENCOUNTER_POWER_SETTING = "encounterPower";

/** The GM's Encounter Power (the party-power baseline Tiers scale from) — falls back to the
 *  default until the world sets it. Always a positive integer. */
export function getEncounterPower() {
  try {
    const v = Number(game.settings.get("project-anime", ENCOUNTER_POWER_SETTING));
    if (Number.isFinite(v) && v > 0) return Math.round(v);
  } catch (_e) { /* setting not registered yet (very early) — use the default */ }
  return PROJECTANIME.encounterPowerDefault;
}

/** A Tier's EFFECTIVE numbers at a given Encounter Power: its Skill-Point grant scaled by the dial,
 *  with the fixed knobs (stepUps / evasion / defense / label / icon / color / hpRank / epRank) spread
 *  through. Vitals are derived separately by npcVitals. Returns null for an unknown Tier key. */
export function tierScaling(tierKey, power = getEncounterPower()) {
  const t = PROJECTANIME.monsterTiers[tierKey];
  if (!t) return null;
  const rawSP = power * (t.spFactor ?? 0);
  return {
    ...t,
    // Skill Points always land on a multiple of 5 (round to the nearest 5, the SP grain), with a
    // floor of 5 for any real Tier so even a ★1 trash mob gets one rank's worth — never zero.
    skillPoints: rawSP > 0 ? Math.max(5, round5(rawSP)) : 0
  };
}

/* -------------------------------------------- */
/*  Encounter budget (Party sheet)              */
/* -------------------------------------------- */

/**
 * Encounter difficulty → the THREAT budget (v0.03). Budget = number of PCs, shifted by difficulty:
 * Easy = party − 1, Standard = party, Hard = party + 1.5, Climax = party × 2 (usually a Boss + escorts).
 * `offset` adds to the party size; `mult` multiplies it (Climax). Threat is spent by Role: Grunt 1 ·
 * Brute 1.5 · Skirmisher 1 · Caster 1 · Support 1 · Swarm ½ · Elite 2 · Rival 3 · Boss = party size.
 */
PROJECTANIME.encounterDifficulty = {
  easy:     { label: "PROJECTANIME.Encounter.difficulty.easy",     offset: -1 },
  standard: { label: "PROJECTANIME.Encounter.difficulty.standard", offset: 0 },
  hard:     { label: "PROJECTANIME.Encounter.difficulty.hard",     offset: 1.5 },
  climax:   { label: "PROJECTANIME.Encounter.difficulty.climax",   mult: 2 }
};

/** Iteration order for encounter difficulties (easiest → hardest). */
PROJECTANIME.encounterDifficultyKeys = ["easy", "standard", "hard", "climax"];

/* -------------------------------------------- */
/*  Health status ladder (hidden-HP descriptor) */
/* -------------------------------------------- */

/** Qualitative wound descriptor shown IN PLACE of an exact HP number when a viewer isn't allowed to
 *  see a creature's vitals (pf2e-hud style — you learn "Badly Hurt", not "7/22"). Steps match
 *  high→low by remaining-HP fraction; `tint` reuses the HP-gradient palette. */
PROJECTANIME.healthLadder = [
  { min: 1,    key: "PROJECTANIME.Health.fine",    tint: "#8ad35f" },
  { min: 0.75, key: "PROJECTANIME.Health.barely",  tint: "#c3d35f" },
  { min: 0.5,  key: "PROJECTANIME.Health.wounded", tint: "#f4b15e" },
  { min: 0.25, key: "PROJECTANIME.Health.hurt",    tint: "#ef8a6e" },
  { min: 0,    key: "PROJECTANIME.Health.dying",   tint: "#c34155" }
];

/** Resolve an actor's HP to a {key, tint, pct} health descriptor, or null when it has no HP track.
 *  0 HP → "Down". Callers localize `key`. */
export function healthStatus(actor) {
  const hp = actor?.system?.hp;
  const max = Number(hp?.max) || 0;
  if (!max) return null;
  const val = Number(hp?.value) || 0;
  if (val <= 0) return { key: "PROJECTANIME.Health.down", tint: "#a39db8", pct: 0 };
  const frac = val / max;
  const step = PROJECTANIME.healthLadder.find((s) => frac >= s.min) ?? PROJECTANIME.healthLadder.at(-1);
  return { key: step.key, tint: step.tint, pct: Math.round(frac * 100) };
}

/* -------------------------------------------- */
/*  Biography dossier                           */
/* -------------------------------------------- */

/** Default Bio-tab dossier fields. The GM can rename / re-icon / retype / add / remove
 *  these via the Bio Fields setting (apps/bio-field-config.mjs); this is just the
 *  built-in starting set, used until the world customizes it. Each: `label` (lang key),
 *  `icon` (FA class or image path — optional), `type` ("short" input | "long" textarea). */
PROJECTANIME.bioFields = {
  age:         { label: "PROJECTANIME.Bio.age",         icon: "fa-solid fa-hourglass-half" },
  gender:      { label: "PROJECTANIME.Bio.gender",      icon: "fa-solid fa-venus-mars" },
  height:      { label: "PROJECTANIME.Bio.height",      icon: "fa-solid fa-ruler-vertical" },
  weight:      { label: "PROJECTANIME.Bio.weight",      icon: "fa-solid fa-weight-hanging" },
  homeland:    { label: "PROJECTANIME.Bio.homeland",    icon: "fa-solid fa-mountain-sun" },
  affiliation: { label: "PROJECTANIME.Bio.affiliation", icon: "fa-solid fa-flag" },
  occupation:  { label: "PROJECTANIME.Bio.occupation",  icon: "fa-solid fa-briefcase" },
  alias:       { label: "PROJECTANIME.Bio.alias",       icon: "fa-solid fa-mask" },
  likes:       { label: "PROJECTANIME.Bio.likes",       icon: "fa-solid fa-heart" },
  dislikes:    { label: "PROJECTANIME.Bio.dislikes",    icon: "fa-solid fa-heart-crack" },
  goal:        { label: "PROJECTANIME.Bio.goal",        icon: "fa-solid fa-bullseye", type: "long" }
};
