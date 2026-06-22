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

/** Font Awesome icon shown on each attribute card (FA6 Free Solid). */
PROJECTANIME.attributeIcons = {
  might: "fa-solid fa-hand-fist",
  agility: "fa-solid fa-feather-pointed",
  mind: "fa-solid fa-brain",
  spirit: "fa-solid fa-spa",
  charm: "fa-solid fa-masks-theater"
};

/* -------------------------------------------- */
/*  Talents (NPC HQ work dice)                  */
/* -------------------------------------------- */

/** The five NPC Talents — work dice the HQ taps (dispatch missions + facility output). */
PROJECTANIME.talents = {
  exploration: "PROJECTANIME.Talent.exploration.long",
  craft: "PROJECTANIME.Talent.craft.long",
  commerce: "PROJECTANIME.Talent.commerce.long",
  lore: "PROJECTANIME.Talent.lore.long",
  medicine: "PROJECTANIME.Talent.medicine.long"
};
PROJECTANIME.talentKeys = ["exploration", "craft", "commerce", "lore", "medicine"];
PROJECTANIME.talentIcons = {
  exploration: "fa-solid fa-compass",
  craft: "fa-solid fa-hammer",
  commerce: "fa-solid fa-scale-balanced",
  lore: "fa-solid fa-book-open",
  medicine: "fa-solid fa-staff-snake"
};

/** HQ outputs a Trait Bonus can boost (besides a Talent or an Attribute). */
PROJECTANIME.hqOutputs = {
  gold: "PROJECTANIME.Talent.hq.gold",
  sp: "PROJECTANIME.Talent.hq.sp",
  success: "PROJECTANIME.Talent.hq.success"
};
PROJECTANIME.hqOutputKeys = ["gold", "sp", "success"];

/* -------------------------------------------- */
/*  Skills                                      */
/* -------------------------------------------- */

PROJECTANIME.actionTypes = {
  action: "PROJECTANIME.Skill.actionType.action",
  passive: "PROJECTANIME.Skill.actionType.passive",
  react: "PROJECTANIME.Skill.actionType.react"
};

/** Skill Range scopes (single-target / AOE centre point). */
PROJECTANIME.ranges = {
  self: "PROJECTANIME.Range.self",
  weapon: "PROJECTANIME.Range.weapon",
  melee: "PROJECTANIME.Range.melee",
  near: "PROJECTANIME.Range.near",
  far: "PROJECTANIME.Range.far",
  veryFar: "PROJECTANIME.Range.veryFar"
};

/** Recommended ("up to") tile value per Range scope. 0 = not a tile distance
 *  (Self / Weapon / Very Far carry no tile count); the rest the player sets, with
 *  these as the rules' suggested cap. */
PROJECTANIME.rangeTiles = { self: 0, weapon: 0, melee: 1, near: 5, far: 10, veryFar: 0 };

/** True when a Range scope uses an editable tile count (Melee / Near / Far). */
export function rangeHasTiles(scope) {
  return (PROJECTANIME.rangeTiles[scope] ?? 0) > 0;
}

/** Localized display for a Skill's range: "Near · 4 tiles" for tile scopes, else
 *  just the scope ("Self"). Tolerates the legacy string form during migration. */
export function rangeLabel(range) {
  const scope = (range && typeof range === "object" ? range.scope : range) ?? "near";
  const label = game.i18n.localize(PROJECTANIME.ranges[scope] ?? scope);
  if (!rangeHasTiles(scope)) return label;
  const tiles = (range && typeof range === "object" ? range.tiles : PROJECTANIME.rangeTiles[scope]) ?? 0;
  return `${label} · ${tiles} ${game.i18n.localize("PROJECTANIME.Skill.tiles")}`;
}

/** Localized display for a Weapon/Shield's physical range: "Melee · 1" / "Ranged · 5"
 *  — the range type plus its tile reach. The Skill-range counterpart is rangeLabel. */
export function physicalRangeLabel(range) {
  const type = game.i18n.localize(PROJECTANIME.rangeTypes[range?.type] ?? range?.type ?? "");
  return `${type} · ${range?.tiles ?? 0}`;
}

/** Rank metadata: SP cost to create, Energy cost to use, and max Modifiers. */
PROJECTANIME.skillRanks = {
  1: { label: "PROJECTANIME.Skill.rank.basic", stars: "★", sp: 1, energy: 2, maxModifiers: 1 },
  2: { label: "PROJECTANIME.Skill.rank.intermediate", stars: "★★", sp: 2, energy: 4, maxModifiers: 2 },
  3: { label: "PROJECTANIME.Skill.rank.advanced", stars: "★★★", sp: 3, energy: 6, maxModifiers: 3 },
  4: { label: "PROJECTANIME.Skill.rank.expert", stars: "★★★★", sp: 4, energy: 8, maxModifiers: 4 },
  5: { label: "PROJECTANIME.Skill.rank.master", stars: "★★★★★", sp: 5, energy: 10, maxModifiers: 5 }
};

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

/** Each Effect's Base Rank — the minimum Rank a Skill must be to take it (rules v0.01: Effects
 *  have a Base Rank). Doc values for the Effects the doc defines; the system-side Effects
 *  (Affinity / Custom) stay open at ⭐. Skills created before the gate are
 *  grandfathered: the Builder blocks NEW picks below the Base Rank, stored ones keep working. */
PROJECTANIME.effectBaseRanks = {
  affinity: 1, animate: 2, bolster: 3, companion: 2, conjure: 1, custom: 1,
  disguise: 1, elementalControl: 1, gate: 1, hinder: 1, illusion: 2, mend: 1,
  passive: 1, sense: 2, steal: 1, strike: 1,
  telepathy: 2, transform: 2, vanish: 1
};

/** An Effect's Base Rank (1 when unlisted). */
export function effectBaseRank(effect) {
  return PROJECTANIME.effectBaseRanks[effect] ?? 1;
}

/** Effects that can carry NO Modifiers at all (rules v0.01: "This effect cannot have
 *  Modifiers" — Animate, Companion). Their Modifier budget is zero whatever the Rank. */
PROJECTANIME.noModifierEffects = ["animate", "companion"];

/** The Modifier budget a Skill's Rank allows, honoring the no-Modifier Effects (zero for
 *  Animate / Companion). The single authority — the data model, the Builder, and the
 *  Improve list all size their budget through here. */
export function effectModifierCap(effect, rank) {
  if (PROJECTANIME.noModifierEffects.includes(effect)) return 0;
  return PROJECTANIME.skillRanks[rank]?.maxModifiers ?? (Number(rank) || 1);
}

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

/** The Skill Evasion the doc assigns each Effect (the Builder's seed when the Effect is
 *  chosen): Disguise/Illusion vs Mind-or-Charm, Telepathy/Vanish vs Mind-or-Spirit. */
PROJECTANIME.effectSkillEvasion = {
  disguise: "mindCharm", illusion: "mindCharm", telepathy: "mindSpirit", vanish: "mindSpirit"
};

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

/** Effects that choose a pool (Hit Points / Energy): Strike (which pool its damage hits). Other
 *  Effects hide the pool field. */
PROJECTANIME.poolEffects = ["strike"];

/** Optional Modifiers that shape a Skill (count toward the Rank's max). */
PROJECTANIME.skillModifiers = {
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
  cover: "PROJECTANIME.Skill.modifier.cover",
  custom: "PROJECTANIME.Skill.modifier.custom",
  devour: "PROJECTANIME.Skill.modifier.devour",
  drainEnergy: "PROJECTANIME.Skill.modifier.drainEnergy",
  drainHP: "PROJECTANIME.Skill.modifier.drainHP",
  inflict: "PROJECTANIME.Skill.modifier.inflict",
  infuse: "PROJECTANIME.Skill.modifier.infuse",
  line: "PROJECTANIME.Skill.modifier.line",
  manifest: "PROJECTANIME.Skill.modifier.manifest",
  mass: "PROJECTANIME.Skill.modifier.mass",
  move: "PROJECTANIME.Skill.modifier.move",
  nullify: "PROJECTANIME.Skill.modifier.nullify",
  pierce: "PROJECTANIME.Skill.modifier.pierce",
  protection: "PROJECTANIME.Skill.modifier.protection",
  pull: "PROJECTANIME.Skill.modifier.pull",
  push: "PROJECTANIME.Skill.modifier.push",
  reequip: "PROJECTANIME.Skill.modifier.reequip",
  retaliation: "PROJECTANIME.Skill.modifier.retaliation",
  scene: "PROJECTANIME.Skill.modifier.scene",
  secondaryEffect: "PROJECTANIME.Skill.modifier.secondaryEffect"
};
// NOTE: "reflect" is no longer a Modifier — rules v0.01 moved Reflect to the beneficial Status
// list (applied via Inflict, like Barrier/Regen). Stored skills migrate in item-models.mjs.

/** Modifiers flagged "Heavy" count as two Modifiers (rules: Devour, Mass, Secondary Effect).
 *  "Custom" and "Re-equip" are Heavy per-skill instead (their own flag, toggled by a Builder
 *  checkbox — Re-equip's Heavy form swaps the ENTIRE loadout) — see isHeavyModifier below,
 *  the single place that resolves a Modifier's effective weight. */
PROJECTANIME.heavyModifiers = ["devour", "mass", "secondaryEffect"];

/** Whether a Modifier counts as Heavy (two toward the Rank's Modifier budget) on a given Skill.
 *  The static Heavy set (Devour / Mass / Secondary Effect) is fixed; "Custom" and "Re-equip" are
 *  Heavy only when that Skill's flag is set. Pass the Skill's system data OR the Builder draft —
 *  both carry `customModifierHeavy` / `reequipHeavy`. */
export function isHeavyModifier(key, sys) {
  if (PROJECTANIME.heavyModifiers.includes(key)) return true;
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

/** The Modifier budget a set of Modifiers consumes (Heavy = 2, a multi-take Modifier once per
 *  take), honoring the Custom Heavy flag. `sys` is the Skill data / draft the modifiers belong
 *  to (for the per-skill Custom weight and the Affinity take counts). */
export function modifiersBudget(mods, sys) {
  return (mods ?? []).reduce((n, m) => n + (isHeavyModifier(m, sys) ? 2 : 1) * modifierTakes(m, sys), 0);
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

/** EVERY Modifier carrying a numeric value the "Tune a Modifier" advancement grows (+1 per SP, up
 *  to PROJECTANIME.modifierGrowthMax). `rankBased: true` means the base is the Skill's RANK; a plain
 *  `base` is the fixed value before any growth. Per-skill growth is stored in system.modifierGrowth.
 *  The full set of "numbers you can improve":
 *    • Aura       — the field radius in tiles (base = the Skill's Rank).
 *    • Burst      — the circle radius in tiles (base = the Skill's Rank).
 *    • Chain      — extra targets it leaps to after the first hit (base = the Skill's Rank).
 *    • Move       — bonus tiles on top of the Modifier's half-Skill-die movement (base = the Skill's Rank).
 *    • Protection  — the Defense the Skill grants its target(s) (fixed base 1).
 *    • Retaliation — the damage dealt back to a foe that strikes the target (fixed base 2).
 *    • Push/Pull   — tiles of forced movement (base = the Skill's Rank). */
PROJECTANIME.growableModifiers = {
  aura: { rankBased: true, unit: "PROJECTANIME.Skill.growUnit.tiles" },
  burst: { rankBased: true, unit: "PROJECTANIME.Skill.growUnit.tiles" },
  chain: { rankBased: true, unit: "PROJECTANIME.Skill.growUnit.targets" },
  move: { rankBased: true, unit: "PROJECTANIME.Skill.growUnit.tiles" },
  protection: { base: 1, unit: "PROJECTANIME.Skill.growUnit.defense" },
  retaliation: { base: 2, unit: "PROJECTANIME.Skill.growUnit.damage" },
  push: { rankBased: true, unit: "PROJECTANIME.Skill.growUnit.tiles" },
  pull: { rankBased: true, unit: "PROJECTANIME.Skill.growUnit.tiles" }
};

/** The most "Tune a Modifier" can add to any one Modifier (homebrew cap): growth is 0–3, so e.g. a
 *  Push tops out at Rank + 3 tiles and Protection at +1 + 3 = +4 Defense. Enforced by the Tune
 *  handler, the Builder UI, the data model (item-models.mjs), and clamped at read in modifierValue. */
PROJECTANIME.modifierGrowthMax = 3;

/** How many tiles a Chain may leap between targets (rules: "within 3 tiles"). */
PROJECTANIME.chainTiles = 3;

/** A growable Modifier's effective value on an item = its base (the Skill's Rank for a
 *  rank-based one) + that item's stored growth, the growth clamped to the +3 Tune cap. */
export function modifierValue(item, key) {
  const g = PROJECTANIME.growableModifiers?.[key];
  if (!g) return 0;
  const base = g.rankBased ? (Number(item?.system?.rank) || 1) : (g.base ?? 0);
  const growth = Math.min(PROJECTANIME.modifierGrowthMax, Math.max(0, item?.system?.modifierGrowth?.[key] ?? 0));
  return base + growth;
}

/** The Affinity levels an Affinity Modifier may grant at a given Rank (rules: Resist; ⭐⭐⭐ may
 *  be Immune instead; ⭐⭐⭐⭐⭐ may be Absorb instead). Returns a {value: labelKey} choices map. */
export function affinityModifierLevels(rank) {
  const r = Number(rank) || 1;
  const out = { resist: PROJECTANIME.affinityLevels.resist };
  if (r >= 3) out.immune = PROJECTANIME.affinityLevels.immune;
  if (r >= 5) out.absorb = PROJECTANIME.affinityLevels.absorb;
  return out;
}

/** Clamp a chosen affinity level to what the Rank allows (used when a Skill's Rank drops). */
export function clampAffinityLevel(level, rank) {
  const allowed = affinityModifierLevels(rank);
  return level in allowed ? level : "resist";
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
 *  neutral. Analyze, Banish and Nullify roll per the rules ("on a successful Accuracy Check" /
 *  "requires an Accuracy Check"). Lingering rides Inflict (its chosen Status). */
PROJECTANIME.offensiveModifiers = ["inflict", "analyze", "banish", "nullify"];

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

/** The conditions that carry a VALUE on a chosen pool (rules v0.01: Barrier absorbs that much
 *  damage to the pool; Regen restores that much at the start of each turn). The value is the
 *  Skill's Rank × 2 (see valuedStatusValue) and the Builder asks which pool (Hit Points / Energy). */
PROJECTANIME.valuedStatuses = ["barrier", "regen"];

/** The value a Skill's VALUED status (Regen / Barrier) carries: the Skill's Rank × 2 (rules) —
 *  Regen heals that much HP/Energy at the start of each of the bearer's turns, Barrier absorbs that
 *  much. Min 1. Single source of truth, shared by the inflict, aura, and on-use paths. */
export function valuedStatusValue(rank) {
  return Math.max(1, (Number(rank) || 1) * 2);
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
  wood: "PROJECTANIME.MaterialCategory.wood",
  stone: "PROJECTANIME.MaterialCategory.stone",
  cloth: "PROJECTANIME.MaterialCategory.cloth",
  herb: "PROJECTANIME.MaterialCategory.herb",
  manacite: "PROJECTANIME.MaterialCategory.manacite"
};
PROJECTANIME.materialCategoryIcons = {
  wood: "fa-solid fa-tree",
  stone: "fa-solid fa-mountain",
  cloth: "fa-solid fa-vest",
  herb: "fa-solid fa-leaf",
  manacite: "fa-solid fa-gem"
};

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

/** An NPC actor's role — which face of the sheet it shows. "monster" is the combat statblock (Tier,
 *  the Monster Creator, hostile by default); "npc" is a social/ally NPC that offers a Bond (a bond
 *  definition + per-rank rewards) players forge by dragging the NPC onto their sheet. Toggled on the
 *  sheet header; defaults monster so existing NPCs are unchanged. */
PROJECTANIME.npcRoles = {
  monster: "PROJECTANIME.NpcRole.monster",
  npc: "PROJECTANIME.NpcRole.npc"
};

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
 * you spend Step-Ups; HP = ⟪Might⟫×2, Energy = ⟪Spirit⟫×2); the ★ rating sets the build BUDGET and
 * the Tier sets the SHAPE it's spent in. So a "★1 Solo" and a "★5 Minion" are both legal and mean
 * something different. Stars own MAGNITUDE; the Tier owns the split + frame + role:
 *   • `spFactor`  — Skill Points granted = round(power × spFactor), where `power` = the ★ rating's
 *                   local Encounter Power (starPower) or the global dial when unstarred. Read the
 *                   factor as "how many PCs' worth of skills": Elite 1 (a peer), Solo 2.5.
 *   • `vitalBase` — base HP/Energy multiplier on ⟪Might⟫×2 / ⟪Spirit⟫×2; the EFFECTIVE multiplier
 *                   grows with the power = vitalBase × (power / default).
 *   • `stepUps`   — the Attribute Step-Up budget (a starting PC gets 5). Attributes cap at d12 for
 *                   everyone, so a Tier's dice top out near a maxed PC's and need no star scaling.
 *   • `evasion` / `defense` — flat bonuses written to the NPC's Evasion / Defense Bonus.
 *   • `evaDefCost` — what those flat Eva/Def are worth in Skill Points for ENCOUNTER PRICING only
 *                    (monsterStarCost). PCs can't buy flat Eva/Def, so it isn't a build cost — but a
 *                    boss's +2/+2 is real threat and must be priced into the budget.
 *   • `turns` — combat turns this Tier takes PER ROUND (action economy). Solo takes 2 (3 at ★4+),
 *               the rest take 1. Wired into the turn loop (see project-anime.mjs nextTurn patch).
 * All plain, easily-tuned numbers (like `skillRanks`) — a starting point to iterate on, not a
 * finished balance pass. `icon` / `color` drive the ★-Tier badge on the NPC sheet header.
 * NOTE: `vitalBase` only affects NEW derivations (the Monster Creator); a built NPC stores concrete
 * HP/EN, so retuning these never moves an existing statblock.
 */
PROJECTANIME.monsterTiers = {
  minion:   { label: "PROJECTANIME.Tier.minion",   icon: "fa-solid fa-skull",         color: "#7a8a8f", stepUps: 3,  vitalBase: 1,    evasion: 0, defense: 0, spFactor: 0.5,  evaDefCost: 0, turns: 1 },
  standard: { label: "PROJECTANIME.Tier.standard", icon: "fa-solid fa-hand-fist",     color: "#4f6c9c", stepUps: 4,  vitalBase: 1.25, evasion: 0, defense: 0, spFactor: 0.75, evaDefCost: 0, turns: 1 },
  elite:    { label: "PROJECTANIME.Tier.elite",    icon: "fa-solid fa-shield-halved", color: "#4f9c6c", stepUps: 5,  vitalBase: 1.75, evasion: 1, defense: 1, spFactor: 1,    evaDefCost: 1, turns: 1 },
  solo:     { label: "PROJECTANIME.Tier.solo",     icon: "fa-solid fa-crown",         color: "#9c4f6c", stepUps: 8,  vitalBase: 3.5,  evasion: 2, defense: 2, spFactor: 2.5,  evaDefCost: 3, turns: 2 }
};

/** Iteration order for monster Tiers (weakest → strongest). */
PROJECTANIME.monsterTierKeys = ["minion", "standard", "elite", "solo"];

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

/** A Tier's EFFECTIVE numbers at a given Encounter Power: its Skill-Point grant and HP/Energy
 *  multiplier scaled by the dial, with the fixed knobs (stepUps / evasion / defense / label /
 *  icon / color) spread through. Returns null for an unknown Tier key. */
export function tierScaling(tierKey, power = getEncounterPower()) {
  const t = PROJECTANIME.monsterTiers[tierKey];
  if (!t) return null;
  const base = PROJECTANIME.encounterPowerDefault || 6;
  return {
    ...t,
    skillPoints: Math.max(0, Math.round(power * (t.spFactor ?? 0))),
    vitalMult: (t.vitalBase ?? 1) * (power / base)
  };
}

/* -------------------------------------------- */
/*  Encounter budget (Party sheet)              */
/* -------------------------------------------- */

/**
 * Encounter difficulty → the multiplier on the party's total Skill Points that yields the
 * monster budget for a fight (Budget = Party SP × mult). Plain, tunable numbers. NOTE: a raw
 * SP sum ignores action economy (many small monsters out-act one big brute), so treat these
 * as a planning guide, not a guarantee.
 */
PROJECTANIME.encounterDifficulty = {
  easy:     { label: "PROJECTANIME.Encounter.difficulty.easy",     mult: 0.5 },
  standard: { label: "PROJECTANIME.Encounter.difficulty.standard", mult: 1 },
  hard:     { label: "PROJECTANIME.Encounter.difficulty.hard",     mult: 1.5 },
  deadly:   { label: "PROJECTANIME.Encounter.difficulty.deadly",   mult: 2 }
};

/** Iteration order for encounter difficulties (easiest → hardest). */
PROJECTANIME.encounterDifficultyKeys = ["easy", "standard", "hard", "deadly"];

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
