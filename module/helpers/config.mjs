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

/** Rank metadata: SP cost to create, Energy cost to use, and max Modifiers. */
PROJECTANIME.skillRanks = {
  1: { label: "PROJECTANIME.Skill.rank.basic", stars: "★", sp: 1, energy: 2, maxModifiers: 1 },
  2: { label: "PROJECTANIME.Skill.rank.intermediate", stars: "★★", sp: 2, energy: 4, maxModifiers: 2 },
  3: { label: "PROJECTANIME.Skill.rank.advanced", stars: "★★★", sp: 3, energy: 6, maxModifiers: 3 },
  4: { label: "PROJECTANIME.Skill.rank.expert", stars: "★★★★", sp: 4, energy: 8, maxModifiers: 4 },
  5: { label: "PROJECTANIME.Skill.rank.master", stars: "★★★★★", sp: 5, energy: 10, maxModifiers: 5 }
};

/** The single primary Effect a Skill is built around. */
PROJECTANIME.skillEffects = {
  affinity: "PROJECTANIME.Skill.effect.affinity",
  bolster: "PROJECTANIME.Skill.effect.bolster",
  hinder: "PROJECTANIME.Skill.effect.hinder",
  mend: "PROJECTANIME.Skill.effect.mend",
  move: "PROJECTANIME.Skill.effect.move",
  sense: "PROJECTANIME.Skill.effect.sense",
  strike: "PROJECTANIME.Skill.effect.strike",
  sustain: "PROJECTANIME.Skill.effect.sustain"
};

/** A Strike Skill can deal Hit Point or Energy damage (rules: Strike). */
PROJECTANIME.damagePools = {
  hp: "PROJECTANIME.Skill.damagePool.hp",
  energy: "PROJECTANIME.Skill.damagePool.energy"
};

/** Effects that use a Damage Type: Strike (the damage it deals) and Affinity (the
 *  element you Resist/Immune/Absorb). Every other Effect hides the Damage Type field. */
PROJECTANIME.damageEffects = ["strike", "affinity"];

/** Effects that roll one of the Skill's two Attribute dice for an amount: Strike
 *  (damage) and Mend (healing). The player picks WHICH of the two (rules: "choose
 *  one of its two Attributes. You roll that Attribute's die"). */
PROJECTANIME.dieEffects = ["strike", "mend"];

/** Effects that choose a pool (Hit Points / Energy): Strike (which pool its damage hits) and
 *  Sustain (which pool it regenerates each turn). Other Effects hide the pool field. */
PROJECTANIME.poolEffects = ["strike", "sustain"];

/** Optional Modifiers that shape a Skill (count toward the Rank's max). */
PROJECTANIME.skillModifiers = {
  burst: "PROJECTANIME.Skill.modifier.burst",
  chain: "PROJECTANIME.Skill.modifier.chain",
  charge: "PROJECTANIME.Skill.modifier.charge",
  cleanse: "PROJECTANIME.Skill.modifier.cleanse",
  decay: "PROJECTANIME.Skill.modifier.decay",
  devour: "PROJECTANIME.Skill.modifier.devour",
  drainEnergy: "PROJECTANIME.Skill.modifier.drainEnergy",
  drainHP: "PROJECTANIME.Skill.modifier.drainHP",
  inflict: "PROJECTANIME.Skill.modifier.inflict",
  line: "PROJECTANIME.Skill.modifier.line",
  mass: "PROJECTANIME.Skill.modifier.mass",
  pierce: "PROJECTANIME.Skill.modifier.pierce",
  pull: "PROJECTANIME.Skill.modifier.pull",
  push: "PROJECTANIME.Skill.modifier.push",
  reflect: "PROJECTANIME.Skill.modifier.reflect",
  secondaryEffect: "PROJECTANIME.Skill.modifier.secondaryEffect"
};

/** Modifiers flagged "Heavy" count as two Modifiers. */
PROJECTANIME.heavyModifiers = ["devour", "mass"];

/** Area-of-effect modifiers and how each shapes targeting (see helpers/templates.mjs). */
PROJECTANIME.areaModifiers = ["burst", "line", "mass", "chain"];

/** Modifiers with a numeric value the "Tune a Modifier" advancement grows (+1 per SP).
 *  `base` is the value before any growth; per-skill growth is stored in system.modifierGrowth.
 *  Burst = the circle radius in tiles; Chain = extra targets it leaps to after the first hit;
 *  Push / Pull = how many tiles of Forced Movement the target is shoved (rules base: one tile). */
PROJECTANIME.growableModifiers = {
  burst: { base: 2, unit: "PROJECTANIME.Skill.growUnit.tiles" },
  chain: { base: 2, unit: "PROJECTANIME.Skill.growUnit.targets" },
  push: { base: 1, unit: "PROJECTANIME.Skill.growUnit.tiles" },
  pull: { base: 1, unit: "PROJECTANIME.Skill.growUnit.tiles" }
};

/** The Range scope a Chain may leap within between targets ("within Near"). */
PROJECTANIME.chainRangeScope = "near";

/** A growable Modifier's effective value on an item = its base + that item's stored growth. */
export function modifierValue(item, key) {
  const g = PROJECTANIME.growableModifiers?.[key];
  if (!g) return 0;
  return (g.base ?? 0) + (item?.system?.modifierGrowth?.[key] ?? 0);
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

/** True if a Skill carries the "Secondary Effect" Modifier AND has a valid second Effect set. */
export function skillHasSecondary(sys) {
  if (!sys || !(sys.modifiers ?? []).includes("secondaryEffect")) return false;
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

/** Effects that ALWAYS target an enemy — a Skill carrying one (in either slot) makes an Accuracy
 *  Check vs Evasion, even against an ally (friendly fire is dodgeable). You can dodge a Strike or
 *  shrug off a Hinder; every supportive Effect (Bolster/Mend/Sustain/Affinity/Sense) takes effect
 *  with no roll — you can't "evade" a heal or a buff. */
PROJECTANIME.offensiveEffects = ["strike", "hinder"];

/** Modifiers that on their own land something hostile (a condition / damage-over-time), so a Skill
 *  carrying one makes an Accuracy Check even when its Effect is otherwise neutral. */
PROJECTANIME.offensiveModifiers = ["inflict", "decay"];

/** Forced-movement Effect/Modifiers: shoving a creature is resisted (rolls vs Evasion) ONLY when
 *  it's an enemy — moving yourself or a willing ally is free. So Move / Push / Pull need an Accuracy
 *  Check only against a hostile target (see skillNeedsAccuracy's `enemyTarget`). */
PROJECTANIME.movementEffects = ["move"];
PROJECTANIME.movementModifiers = ["push", "pull"];

/**
 * True if a Skill makes an Accuracy Check vs Evasion — i.e. it targets an enemy. The single source
 * of truth for "is this an attack", shared by the dice resolver, the auto-description and the Skill
 * Builder. Always true for an offensive Effect (Strike / Hinder, primary or Secondary) or an
 * offensive Modifier (inflict / decay). Forced movement (Move / Push / Pull) is conditional: it
 * rolls only against an enemy — pass `enemyTarget` from the resolved target's disposition. With no
 * target context (UI: the Builder, the auto-description) `enemyTarget` is undefined and movement
 * counts as potentially-offensive, so e.g. "Sharpen Accuracy" stays offered on a Move Skill.
 */
export function skillNeedsAccuracy(sys, { enemyTarget } = {}) {
  if (!sys) return false;
  const effects = skillEffectKeys(sys);
  if (effects.some((e) => PROJECTANIME.offensiveEffects.includes(e))) return true;
  const mods = sys.modifiers ?? [];
  if (PROJECTANIME.offensiveModifiers.some((m) => mods.includes(m))) return true;
  const hasMovement = effects.some((e) => PROJECTANIME.movementEffects.includes(e))
    || PROJECTANIME.movementModifiers.some((m) => mods.includes(m));
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

/** Iteration order for the conditions. */
PROJECTANIME.conditionKeys = ["blinded", "bound", "decay", "exhausted", "prone", "slowed", "stunned"];

/**
 * Condition registry assigned to CONFIG.statusEffects during init, giving each
 * status a token-HUD icon. Foundry localizes the `name` keys.
 */
PROJECTANIME.statusConditions = [
  { id: "blinded", name: "PROJECTANIME.Status.blinded", img: "icons/svg/blind.svg" },
  { id: "bound", name: "PROJECTANIME.Status.bound", img: "icons/svg/net.svg" },
  { id: "decay", name: "PROJECTANIME.Status.decay", img: "icons/svg/degen.svg" },
  { id: "exhausted", name: "PROJECTANIME.Status.exhausted", img: "icons/svg/downgrade.svg" },
  { id: "prone", name: "PROJECTANIME.Status.prone", img: "icons/svg/falling.svg" },
  { id: "slowed", name: "PROJECTANIME.Status.slowed", img: "icons/svg/daze.svg" },
  { id: "stunned", name: "PROJECTANIME.Status.stunned", img: "icons/svg/paralysis.svg" },
  // Reflect ward — applied by the Reflect Skill Modifier (see dice.mjs applyReflectMark). A
  // removable marker: the next attack against a warded creature rebounds on its attacker, then it
  // shatters (GM-adjudicated). Deliberately NOT in `conditionKeys` — it's a marker, not a stored
  // debuff with derived effects, so it stays out of the actor model + Effect-Builder condition pickers.
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
/*  Monster Tiers (anime ranking)               */
/* -------------------------------------------- */

/** Default "Encounter Power" — the party-power baseline the Monster Creator scales Tiers
 *  from until the GM sets the world setting. Read it as "a typical CURRENT PC's total Skill
 *  Points" (a fresh PC starts around 6); the GM raises it as the campaign advances. */
PROJECTANIME.encounterPowerDefault = 6;

/**
 * Monster "Tier" — the anime power-ranking the Monster Creator stamps on an NPC. A monster
 * is built on the same rules as a Player Character (the five Attributes start at d4 and you
 * spend Step-Ups; HP = ⟪Might⟫×2, Energy = ⟪Spirit⟫×2); the Tier scales that baseline up.
 *
 * Two knobs SCALE with the GM's Encounter Power dial (see getEncounterPower / tierScaling),
 * so monsters keep pace as the party accumulates Skill Points over a campaign — bump the
 * dial and newly-built monsters rescale:
 *   • `spFactor`  — Skill Points granted = round(EncounterPower × spFactor). Read the factor
 *                   as "how many PCs' worth of skills": Elite 1 (a peer), Boss 2, Raid 3.5.
 *   • `vitalBase` — base HP/Energy multiplier on ⟪Might⟫×2 / ⟪Spirit⟫×2; the EFFECTIVE
 *                   multiplier grows with the dial = vitalBase × (EncounterPower / default).
 * The other knobs are FIXED per Tier — Attributes cap at d12 for everyone, so a Tier's dice
 * already top out near a maxed PC's and need no runaway scaling:
 *   • `stepUps`   — the Attribute Step-Up budget (a starting PC gets 5).
 *   • `evasion` / `defense` — flat bonuses written to the NPC's Evasion / Defense Bonus.
 * All plain, easily-tuned numbers (like `skillRanks`) — a starting point to iterate on, not
 * a finished balance pass. `icon` / `color` drive the Tier badge on the NPC sheet header.
 */
PROJECTANIME.monsterTiers = {
  minion:   { label: "PROJECTANIME.Tier.minion",   icon: "fa-solid fa-skull",         color: "#7a8a8f", stepUps: 3,  vitalBase: 1,    evasion: 0, defense: 0, spFactor: 0.5 },
  standard: { label: "PROJECTANIME.Tier.standard", icon: "fa-solid fa-hand-fist",     color: "#4f6c9c", stepUps: 4,  vitalBase: 1.25, evasion: 0, defense: 0, spFactor: 0.75 },
  elite:    { label: "PROJECTANIME.Tier.elite",    icon: "fa-solid fa-shield-halved", color: "#4f9c6c", stepUps: 5,  vitalBase: 1.5,  evasion: 1, defense: 1, spFactor: 1 },
  boss:     { label: "PROJECTANIME.Tier.boss",     icon: "fa-solid fa-dragon",        color: "#9c6c4f", stepUps: 7,  vitalBase: 2.5,  evasion: 2, defense: 2, spFactor: 2 },
  raid:     { label: "PROJECTANIME.Tier.raid",     icon: "fa-solid fa-crown",         color: "#9c4f6c", stepUps: 10, vitalBase: 4,    evasion: 3, defense: 3, spFactor: 3.5 }
};

/** Iteration order for monster Tiers (weakest → strongest). */
PROJECTANIME.monsterTierKeys = ["minion", "standard", "elite", "boss", "raid"];

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
