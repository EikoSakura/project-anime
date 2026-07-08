/**
 * Project: Anime — central configuration constants (rules doc Version 2).
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

/** The die ladder. A die never rises above d12 or below d4 (rules: Step Up / Step Down). */
PROJECTANIME.dieSteps = [4, 6, 8, 10, 12];

/** Step a die size up (+n) or down (−n) the d4→d12 ladder, clamped at the ends. */
export function stepDie(size, steps = 1) {
  const ladder = PROJECTANIME.dieSteps;
  const i = Math.max(0, ladder.indexOf(Number(size)));
  return ladder[Math.clamp(i + steps, 0, ladder.length - 1)];
}

/* -------------------------------------------- */
/*  Checks (V2)                                 */
/* -------------------------------------------- */

/** A Check always rolls exactly two dice: Attribute + Talent (+1 Trained Edge) when a Talent
 *  applies, else Attribute + Attribute. */

/** The Trained Edge — the flat bonus a relevant Talent adds to a roll. */
PROJECTANIME.trainedEdge = 1;

/** One embedded Talent row off `actor.system.talents`, normalized ({id, name, die, attribute});
 *  null when the key doesn't resolve. */
export function getTalent(actor, id) {
  const t = actor?.system?.talents?.[id ?? ""];
  if (!t) return null;
  return { id, name: t.name ?? "", die: Number(t.die) || 4, attribute: t.attribute ?? "might" };
}

/** The actor's Talents as an array of normalized rows, in stored (creation) order. */
export function actorTalents(actor) {
  return Object.keys(actor?.system?.talents ?? {}).map((id) => getTalent(actor, id));
}

/** Challenge Thresholds for Tests (rules: Checks → Tests). */
PROJECTANIME.challengeThresholds = {
  easy:     { value: 7,  label: "PROJECTANIME.Threshold.easy" },
  moderate: { value: 9,  label: "PROJECTANIME.Threshold.moderate" },
  hard:     { value: 11, label: "PROJECTANIME.Threshold.hard" },
  daunting: { value: 13, label: "PROJECTANIME.Threshold.daunting" },
  extreme:  { value: 15, label: "PROJECTANIME.Threshold.extreme" }
};
PROJECTANIME.challengeThresholdKeys = ["easy", "moderate", "hard", "daunting", "extreme"];

/** Contest Target (rules: Opposing Techniques) = 6 + defender's die/2. The defending die is the
 *  Talent die when the defending Technique is built under a Talent (and the Trained Edge then
 *  applies: 7 + die/2), else the relevant Attribute die. */
export function contestTarget(dieSize, hasTalent = false) {
  const die = Number(dieSize) || 4;
  return 6 + Math.floor(die / 2) + (hasTalent ? PROJECTANIME.trainedEdge : 0);
}

/* -------------------------------------------- */
/*  Vitals & Stats (V2)                         */
/* -------------------------------------------- */

/** Hit Boxes and Energy Boxes: fixed baselines, grown through advancement and gear. */
PROJECTANIME.baseHitBoxes = 5;
PROJECTANIME.baseEnergyBoxes = 5;
PROJECTANIME.maxBoxes = 10;

/** Guard = 6 + Armor Style Guard bonus + Shield Style Guard bonus. */
PROJECTANIME.baseGuard = 6;

/** Energy Regen: clear this many energy boxes at the start of each turn (Unarmored clears 2). */
PROJECTANIME.baseEnergyRegen = 1;

/** Critical (rules: Combat) — in Critical when 75% of hit boxes are marked. */
PROJECTANIME.criticalMarkedFraction = 0.75;

/** Luck Dice: three dice, recorded at creation, restored by resting. The die STARTS at d6 and
 *  steps up d6→d8→d10→d12 as the character buys the "Raise the Luck Die" advancement (capped at
 *  3 steps by its slot cap). The effective size per actor is derived in the Character data model
 *  (`system.luckDie`); `luckDie` here is only the base, `luckDieMax` the ceiling. */
PROJECTANIME.luckDiceCount = 3;
PROJECTANIME.luckDie = 6;
PROJECTANIME.luckDieMax = 12;

/* -------------------------------------------- */
/*  Techniques                                  */
/* -------------------------------------------- */

PROJECTANIME.actionTypes = {
  action: "PROJECTANIME.Skill.actionType.action",
  passive: "PROJECTANIME.Skill.actionType.passive",
  react: "PROJECTANIME.Skill.actionType.react"
};

/** A Passive Technique's mode (rules: Passive Techniques): Sustained (has a Duration, always
 *  active) or Standing (no Duration; triggers automatically when its condition is met). */
PROJECTANIME.passiveModes = {
  sustained: "PROJECTANIME.Skill.passiveMode.sustained",
  standing: "PROJECTANIME.Skill.passiveMode.standing"
};

/** Technique Range (V2): Self · Touch (1 tile) · Weapon (the weapon's range, Damage, and
 *  Threshold) · Range (X tiles, chosen at construction). Legacy "scene" ranges migrate to tiles. */
PROJECTANIME.ranges = {
  self: "PROJECTANIME.Range.self",
  touch: "PROJECTANIME.Range.touch",
  weapon: "PROJECTANIME.Range.weapon",
  tiles: "PROJECTANIME.Range.tiles"
};

/** Default tile value per Range scope (0 = not a tile distance). */
PROJECTANIME.rangeTiles = { self: 0, touch: 1, weapon: 0, tiles: 1 };

/** Effects whose reach is INHERENT to the Effect itself — Sense detects within 5 tiles. */
PROJECTANIME.inherentRangeTiles = { sense: 5 };

/** True when a Range scope uses an editable tile count. */
export function rangeHasTiles(scope) {
  return scope === "tiles";
}

/** Localized display for a Technique's range: "Range · 4 tiles" for the tile scope, else just the
 *  scope ("Self" / "Touch" / "Weapon"). Tolerates the legacy string form during migration. */
export function rangeLabel(range) {
  const scope = (range && typeof range === "object" ? range.scope : range) ?? "weapon";
  const label = game.i18n.localize(PROJECTANIME.ranges[scope] ?? scope);
  if (!rangeHasTiles(scope)) return label;
  const tiles = (range && typeof range === "object" ? range.tiles : PROJECTANIME.rangeTiles[scope]) ?? 0;
  return `${label} · ${tiles} ${game.i18n.localize("PROJECTANIME.Skill.tiles")}`;
}

/** Localized display for a Weapon/Shield's physical range — "1" or "2–8" tile numbers. */
export function physicalRangeLabel(range) {
  const max = Number(range?.tiles) || 0;
  const min = Number(range?.minTiles) || 0;
  return (min > 0 && min !== max) ? `${min}–${max}` : `${max}`;
}

/** Whether an `icon` value is an image file path (vs a Font Awesome class). Shared by every
 *  config dialog that lets the GM set a row icon (bio fields, token fields, quest icons, …). */
export function isImageIcon(icon) {
  return typeof icon === "string" && /\.(webp|png|jpe?g|svg|gif|avif)$/i.test(icon.trim());
}

/** Every Effect has a base cost of 0, except Companion at 2 (rules: Effects). */
PROJECTANIME.effectCost = { companion: 2 };

/** An Effect's Energy cost contribution (0 unless listed). */
export function effectCost(effect) {
  return PROJECTANIME.effectCost[effect] ?? 0;
}

/** Effects retired from NEW authoring: Animate (pre-V2). Stored Techniques keep working; the
 *  Builder only lists these while one is already the current selection. The bare "None" carrier
 *  (`passive`) stays selectable — a Technique can be built entirely from its Modifiers. */
PROJECTANIME.retiredEffects = ["animate"];

/**
 * A Technique's derived Energy cost (rules: Total Energy Cost) — the Effect's cost plus every
 * Modifier's cost (Target Modifiers are free and live on the Target field). A Technique built
 * entirely from free parts still costs 1 Energy to use. This is the single cost authority —
 * the data model, the Builder, and every sheet read it.
 */
export function techniqueEnergyCost(sys) {
  if (!sys) return 0;
  let cost = effectCost(sys.effect) + modifiersEnergy(sys.modifiers ?? [], sys);
  if (skillHasSecondary(sys)) cost += effectCost(sys.secondaryEffect);
  return Math.max(1, cost);
}

/** How many Attributes an attribute-touching Effect changes: Empower steps up ONE chosen
 *  Attribute, Weaken steps down ONE; Transform steps up one Attribute twice OR two once each. */
export function effectAttrCount(effect) {
  return effect === "transform" ? 2 : 1;
}

/** The Effects a Technique is built around (rules doc V2, 15 printed + Custom homebrew).
 *  STORED IDS: `bolster` displays as "Empower", `mend` as "Heal", `hinder` as "Weaken",
 *  `elementalControl` as "Control" — label-only renames keep existing data valid. */
PROJECTANIME.skillEffects = {
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

/** Effects that can carry NO Modifiers at all (rules: Companion "cannot take Modifiers";
 *  Animate kept for legacy data). */
PROJECTANIME.noModifierEffects = ["animate", "companion"];

/** Who a Technique may affect — the free Target Modifiers (rules: Target Modifiers, +0 Energy).
 *  An Ally Technique can never be used on yourself ("an effect that targets allies cannot
 *  target you"); Self always lands on the caster; Any is the open form. */
PROJECTANIME.skillTargets = {
  self: "PROJECTANIME.Skill.target.self",
  foe: "PROJECTANIME.Skill.target.foe",
  ally: "PROJECTANIME.Skill.target.ally",
  any: "PROJECTANIME.Skill.target.any"
};

/** A Technique's Target, validated (legacy / blank → "any"). */
export function skillTarget(sys) {
  const t = sys?.target;
  return t in PROJECTANIME.skillTargets ? t : "any";
}

/** How long a Technique's effect lasts. Instant and Standard (Duration 2, or the Technique's
 *  set count) are the intrinsic choices; Channeled (+1) and Scene (🔶 +2) are MODIFIERS that
 *  set this field. Outside a Conflict Scene, a Technique with a duration lasts the scene. */
PROJECTANIME.skillDurations = {
  channeled: "PROJECTANIME.Skill.duration.channeled",
  instant: "PROJECTANIME.Skill.duration.instant",
  standard: "PROJECTANIME.Skill.duration.standard",
  scene: "PROJECTANIME.Skill.duration.scene"
};

/** The two Duration Modifiers (mutually exclusive). Selecting one sets the Technique's
 *  effective Duration; the intrinsic Builder choices are only Instant / Standard. */
PROJECTANIME.durationModifiers = ["channeled", "scene"];

/** Effects that are Scene-length BY RULE: Conjure "lasts the Scene"; Gate persists until ended.
 *  At no Modifier cost. */
PROJECTANIME.sceneEffects = ["conjure", "gate"];

/** Effects whose printed text carries "Duration: 2" (rules doc V2): Disguise, Empower, Sense,
 *  Telepathy, Transform, Vanish, Weaken. The Builder seeds Standard duration for these. A
 *  Passive Technique in SUSTAINED mode embraces its Duration (always active) — V2 has no
 *  "Duration bars Passive" rule. */
PROJECTANIME.durationEffects = ["bolster", "disguise", "hinder", "sense", "telepathy", "transform", "vanish"];

/** A Technique's effective Duration, validated. A Duration Modifier wins over the stored field;
 *  a Scene-by-rule Effect reads Scene regardless; legacy / blank falls back sensibly. */
export function skillDuration(sys) {
  const mods = sys?.modifiers ?? [];
  if (mods.includes("channeled")) return "channeled";
  if (mods.includes("scene")) return "scene";
  if (PROJECTANIME.sceneEffects.includes(sys?.effect)) return "scene";
  const d = sys?.duration;
  if (d in PROJECTANIME.skillDurations) return d;
  return sys?.effectDuration != null ? "standard" : "scene";
}

/** A Standard-duration Technique's round count: its set count, else the printed default 2. */
PROJECTANIME.standardDurationTurns = 2;

/** A Strike deals hit-box damage; Heal and Drain choose a pool (hit or energy boxes) at creation. */
PROJECTANIME.damagePools = {
  hp: "PROJECTANIME.Skill.damagePool.hp",
  energy: "PROJECTANIME.Skill.damagePool.energy"
};

/** Effects that choose a pool at creation: Heal ("Clear 1 hit box or 1 energy box"). */
PROJECTANIME.poolEffects = ["mend"];

/* -------------------------------------------- */
/*  Modifiers (V2 — three cost tiers)           */
/* -------------------------------------------- */

/** Every Modifier a Technique can take. Targeting lives on the Target field (free); "none" is
 *  the explicit no-Modifier marker; "custom" is the free-form homebrew Modifier (its per-
 *  Technique cost tier is a Builder checkbox). STORED IDS kept from earlier printings where
 *  they exist; new V2 Modifiers get new ids. */
PROJECTANIME.skillModifiers = {
  none: "PROJECTANIME.Skill.modifier.none",
  analyze: "PROJECTANIME.Skill.modifier.analyze",
  aura: "PROJECTANIME.Skill.modifier.aura",
  barrier: "PROJECTANIME.Skill.modifier.barrier",
  burst: "PROJECTANIME.Skill.modifier.burst",
  chain: "PROJECTANIME.Skill.modifier.chain",
  channeled: "PROJECTANIME.Skill.modifier.channeled",
  charge: "PROJECTANIME.Skill.modifier.charge",
  cleanse: "PROJECTANIME.Skill.modifier.cleanse",
  cover: "PROJECTANIME.Skill.modifier.cover",
  custom: "PROJECTANIME.Skill.modifier.custom",
  devour: "PROJECTANIME.Skill.modifier.devour",
  disarm: "PROJECTANIME.Skill.modifier.disarm",
  drain: "PROJECTANIME.Skill.modifier.drain",
  inflict: "PROJECTANIME.Skill.modifier.inflict",
  inflictSevere: "PROJECTANIME.Skill.modifier.inflictSevere",
  line: "PROJECTANIME.Skill.modifier.line",
  link: "PROJECTANIME.Skill.modifier.link",
  manifest: "PROJECTANIME.Skill.modifier.manifest",
  mass: "PROJECTANIME.Skill.modifier.mass",
  move: "PROJECTANIME.Skill.modifier.move",
  nullify: "PROJECTANIME.Skill.modifier.nullify",
  potent: "PROJECTANIME.Skill.modifier.potent",
  protection: "PROJECTANIME.Skill.modifier.protection",
  reequip: "PROJECTANIME.Skill.modifier.reequip",
  reflect: "PROJECTANIME.Skill.modifier.reflect",
  regen: "PROJECTANIME.Skill.modifier.regen",
  reposition: "PROJECTANIME.Skill.modifier.reposition",
  retaliation: "PROJECTANIME.Skill.modifier.retaliation",
  scene: "PROJECTANIME.Skill.modifier.scene",
  secondaryEffect: "PROJECTANIME.Skill.modifier.secondaryEffect",
  waypoint: "PROJECTANIME.Skill.modifier.waypoint"
};

/** Heavy Modifiers 🔶 (+2 Energy each): Aura, Burst, Devour, Inflict (Severe), Line, Reflect,
 *  Regen, Scene, Secondary Effect. */
PROJECTANIME.heavyModifiers = ["aura", "burst", "devour", "inflictSevere", "line", "reflect", "regen", "scene", "secondaryEffect"];

/** Extreme Modifiers (+3 Energy each): Link, Mass. */
PROJECTANIME.extremeModifiers = ["link", "mass"];

/** Modifiers that carry NO Energy weight — the "None" marker. */
PROJECTANIME.freeModifiers = ["none"];

/** A Modifier's Energy cost on a given Technique: Standard +1 · Heavy 🔶 +2 · Extreme +3.
 *  "Custom" prices by its per-Technique Heavy flag. Free markers cost 0. */
export function modifierCost(key, sys) {
  if ((PROJECTANIME.freeModifiers ?? []).includes(key)) return 0;
  if (PROJECTANIME.extremeModifiers.includes(key)) return 3;
  if (PROJECTANIME.heavyModifiers.includes(key)) return 2;
  if (key === "custom" && sys?.customModifierHeavy) return 2;
  return 1;
}

/** Back-compat alias — some sites ask "is this Modifier Heavy" for display (🔶 mark). */
export function isHeavyModifier(key, sys) {
  return modifierCost(key, sys) >= 2;
}

/** Modifiers the rules let a Technique select MORE THAN ONCE: Potent ("Can be taken twice"). */
PROJECTANIME.multiTakeModifiers = ["potent"];

/** How many times a Modifier is taken on a Technique — Potent reads its stored count (1–2). */
export function modifierTakes(key, sys) {
  if (key === "potent") return Math.clamp(Math.round(Number(sys?.potentCount) || 1), 1, 2);
  return 1;
}

/** The Energy a set of Modifiers adds (each × its takes). `sys` is the Technique data / draft. */
export function modifiersEnergy(mods, sys) {
  return (mods ?? []).reduce((n, m) => n + modifierCost(m, sys) * modifierTakes(m, sys), 0);
}

/** A Modifier barred by a Technique's Action Type / Effect alone. A Passive Technique can't
 *  take Channeled (it doesn't pay per turn) — Scene IS allowed (a Sustained passive that runs
 *  the scene). Companion/Animate can host nothing (noModifierEffects, enforced in the Builder). */
export function modifierBarredByType(key, sys) {
  if (key === "channeled") return sys?.actionType === "passive";
  if (key === "secondaryEffect") return sys?.effect === "passive";
  // Manifest wakes a Passive while its carrier is ACTIVE — a Passive carrier is never
  // "activated", so only Action/React Techniques may carry it.
  if (key === "manifest") return sys?.actionType === "passive";
  return false;
}

/** The Statuses the standard Inflict Modifier may apply (rules: "Blinded, Lingering, Prone,
 *  Slowed, or Weakened. Duration: 2"). `decay` is Lingering's stored id. */
PROJECTANIME.inflictStatuses = ["blinded", "decay", "prone", "slowed", "weakened"];

/** The Statuses Inflict (Severe) 🔶 may apply (rules: "Bound, Cursed (choose hit or energy
 *  boxes), Exposed, or Sealed. Duration 2"). `exhausted` is Sealed's stored id. */
PROJECTANIME.inflictSevereStatuses = ["bound", "curse", "exposed", "exhausted"];

/** Area-of-effect modifiers and how each shapes targeting (see helpers/templates.mjs). These shape an
 *  ACTIVATED Technique's on-use targeting. Aura is NOT here — it's a continuous field, maintained
 *  by the reconcile engine (helpers/aura.mjs), not the on-use multi-target flow. */
PROJECTANIME.areaModifiers = ["burst", "line", "mass", "chain"];

/** You cannot stack area Modifiers (rules: Aura, Burst, Line or Mass are exclusive). */
PROJECTANIME.exclusiveAreaModifiers = ["aura", "burst", "line", "mass"];

/** True when an area Technique is a SELF-CENTERED emanation rather than a point placed within
 *  Range: a Burst whose Range is Self explodes from the caster's own token (no placement). */
export function isSelfCenteredArea(sys) {
  return sys?.range?.scope === "self" && (sys?.modifiers ?? []).includes("burst");
}

/** Modifiers that only make sense on a PASSIVE Technique. Currently none; enforcement kept. */
PROJECTANIME.passiveOnlyModifiers = [];

/** Who an Aura Technique's field affects — derived from the explicit Target: Foe → opposing
 *  creatures only, never the bearer; Any → everyone in the field INCLUDING the bearer; Ally →
 *  same-side creatures PLUS the bearer. */
export function auraAudience(sys) {
  const t = skillTarget(sys);
  return t === "foe" ? "foe" : t === "any" ? "any" : "ally";
}

/** Modifiers whose range / area / distance SCALES with the Technique's die (rules: "When a
 *  Modifier uses die/2 … a technique built under a talent uses Talent die/2 + 1"):
 *    • Aura       — field radius in tiles around you.
 *    • Burst      — circle radius in tiles at a chosen point.
 *    • Chain      — leap distance in tiles to 1 additional target.
 *    • Move       — tiles YOU move.
 *    • Reposition — tiles you move ANOTHER creature.
 */
PROJECTANIME.scaledModifiers = {
  aura: { unit: "PROJECTANIME.Skill.growUnit.tiles" },
  burst: { unit: "PROJECTANIME.Skill.growUnit.tiles" },
  chain: { unit: "PROJECTANIME.Skill.growUnit.tiles" },
  move: { unit: "PROJECTANIME.Skill.growUnit.tiles" },
  reposition: { unit: "PROJECTANIME.Skill.growUnit.tiles" }
};

/** Fixed Modifier numbers (V2): Chain leaps to 1 extra target; Potent = +1 box per take;
 *  Protection grants +1 Guard; Retaliation deals 1 box back; Regen clears 1 box per turn. */
PROJECTANIME.chainExtraTargets = 1;
PROJECTANIME.potentBonus = 1;
PROJECTANIME.protectionGuard = 1;
PROJECTANIME.retaliationDamage = 1;
PROJECTANIME.regenHeal = 1;

/**
 * The die a Technique's scaling reads: the linked Talent's die when the Technique is built
 * under a Talent (resolved against the owning actor), else its primary Attribute's die.
 * Returns { die, hasTalent }.
 */
export function techniqueDie(item) {
  const actor = item?.actor ?? item?.parent;
  const sys = item?.system ?? item;
  const talent = getTalent(actor, sys?.talentId);
  if (talent) return { die: talent.die, hasTalent: true };
  const key = sys?.attributes?.attrA;
  const die = Number(actor?.system?.attributes?.[key]?.value) || 4;
  return { die, hasTalent: false };
}

/** A scaled Modifier's effective value in tiles on an item: die/2, +1 with the Trained Edge
 *  (a Talent-built Technique). Non-scaled keys return 0. Minimum 1 tile. */
export function modifierValue(item, key) {
  if (!(key in (PROJECTANIME.scaledModifiers ?? {}))) return 0;
  const { die, hasTalent } = techniqueDie(item);
  return Math.max(1, Math.floor(die / 2) + (hasTalent ? 1 : 0));
}

/* -------------------------------------------- */
/*  Secondary Effect ("Secondary Effect" mod)   */
/* -------------------------------------------- */

/** True if a Technique carries the "Secondary Effect" Modifier AND has a valid second Effect
 *  set. Companion can never ride along (it takes no Modifiers and locks its own cost). */
export function skillHasSecondary(sys) {
  if (!sys || sys.effect === "passive") return false;
  if (!(sys.modifiers ?? []).includes("secondaryEffect")) return false;
  if (sys.secondaryEffect === "companion" || sys.secondaryEffect === "animate") return false;
  return !!sys.secondaryEffect && sys.secondaryEffect in PROJECTANIME.skillEffects;
}

/** The Technique's Effect keys in order: [primary] plus the secondary (when active and distinct). */
export function skillEffectKeys(sys) {
  const keys = sys?.effect ? [sys.effect] : [];
  if (skillHasSecondary(sys) && sys.secondaryEffect !== sys.effect) keys.push(sys.secondaryEffect);
  return keys;
}

/**
 * The Strike / Heal action specs a Technique should offer, deduped by Effect (at most one
 * damage + one heal button). Damage/healing amounts are FIXED in V2 (no dice) — the spec just
 * carries which pool a Heal clears. `primary` marks the main slot.
 * @returns {{effect:string, damagePool:string, primary:boolean}[]}
 */
export function skillDieSpecs(sys) {
  const out = [];
  const add = (effect, damagePool, primary) => {
    if (effect !== "strike" && effect !== "mend") return;
    if (out.some((s) => s.effect === effect)) return;
    out.push({ effect, damagePool, primary });
  };
  add(sys?.effect, sys?.damagePool, true);
  if (skillHasSecondary(sys)) add(sys.secondaryEffect, sys.secondaryDamagePool, false);
  return out;
}

/** Effects that contest the creature they land on — a Technique carrying one (in either slot)
 *  rolls to hit when aimed at a non-willing target ("Techniques that target an enemy require a
 *  roll to hit"). The Target gates first: Self/Ally never rolls, Foe always does — this list
 *  decides "Any". */
PROJECTANIME.offensiveEffects = ["strike", "hinder", "steal", "illusion", "telepathy"];

/** Modifiers that on their own land something hostile, so a Technique carrying one rolls even
 *  when its Effect is otherwise neutral. Disarm and Nullify are CONTESTED (see contestModifiers). */
PROJECTANIME.offensiveModifiers = ["inflict", "inflictSevere", "analyze", "disarm", "nullify"];

/** Pieces resolved as an Opposing-Techniques CONTEST (roll vs the defender's Contest Target,
 *  6 + die/2) rather than vs Guard: the Weaken Effect on a non-willing creature, and the
 *  Disarm / Nullify Modifiers ("The target contests this Technique"). */
PROJECTANIME.contestEffects = ["hinder"];
PROJECTANIME.contestModifiers = ["disarm", "nullify"];

/** What the Analyze Modifier reveals — chosen at creation (rules: "learn one category about
 *  the target: current hit and energy boxes, Attributes, or Techniques"). */
PROJECTANIME.analyzeCategories = {
  vitals: "PROJECTANIME.Skill.analyzeCategory.vitals",
  attributes: "PROJECTANIME.Skill.analyzeCategory.attributes",
  skills: "PROJECTANIME.Skill.analyzeCategory.skills"
};

/** Forced-movement Modifiers: Reposition rolls only against a hostile target — moving yourself
 *  (Move) or a willing ally is free. */
PROJECTANIME.movementModifiers = ["reposition"];

/**
 * True if a Technique rolls to hit — i.e. it targets an enemy (vs Guard, or a Contest Target
 * for contested pieces). The single source of truth for "is this an attack". The explicit
 * Target gates first: a Self/Ally Technique never rolls, a Foe Technique always does. "Any"
 * falls through to the per-Effect/per-Modifier logic.
 */
export function skillNeedsAccuracy(sys, { enemyTarget } = {}) {
  if (!sys) return false;
  // An Aura delivers its Effect(s) through a continuous field (helpers/aura.mjs), never a to-hit roll.
  if ((sys.modifiers ?? []).includes("aura")) return false;
  const target = skillTarget(sys);
  if (target === "self" || target === "ally") return false;
  if (target === "foe") return true;
  const effects = skillEffectKeys(sys);
  if (effects.some((e) => PROJECTANIME.offensiveEffects.includes(e))) return true;
  const mods = sys.modifiers ?? [];
  if (PROJECTANIME.offensiveModifiers.some((m) => mods.includes(m))) return true;
  const hasMovement = PROJECTANIME.movementModifiers.some((m) => mods.includes(m));
  if (hasMovement) return enemyTarget !== false;
  return false;
}

/** Triggers — required for every React Technique (rules: React Techniques). Attacked and
 *  Enters resolve BEFORE the triggering action completes; Damaged and Critical resolve after. */
PROJECTANIME.triggers = {
  alerted: "PROJECTANIME.Skill.trigger.alerted",
  attacked: "PROJECTANIME.Skill.trigger.attacked",
  critical: "PROJECTANIME.Skill.trigger.critical",
  damaged: "PROJECTANIME.Skill.trigger.damaged",
  enters: "PROJECTANIME.Skill.trigger.enters"
};

/* -------------------------------------------- */
/*  Status                                      */
/* -------------------------------------------- */

/** Iteration order for the conditions. NOTE on ids vs labels: `decay` displays as "Lingering"
 *  and `exhausted` as "Sealed" — label-only renames keep existing actors valid. The nine
 *  player-facing V2 Statuses are Blinded / Bound / Cursed / Exposed / Lingering / Prone /
 *  Sealed / Slowed / Weakened. Barrier / Regen / Reflect are SYSTEM-SIDE markers their
 *  Modifiers stamp (temp boxes, per-turn clear, redirect-once); Vanished marks the Vanish
 *  Effect's "cannot be seen" state. */
PROJECTANIME.conditionKeys = ["barrier", "blinded", "bound", "curse", "decay", "exhausted", "exposed", "prone", "reflect", "regen", "slowed", "vanished", "weakened"];

/** The conditions that carry a VALUE on the bearer's flags: Barrier holds temporary hit boxes;
 *  Regen clears 1 hit box at the start of each of the bearer's turns. */
PROJECTANIME.valuedStatuses = ["barrier", "regen"];

/** The value a Technique's VALUED status carries (V2): Barrier grants temporary hit boxes
 *  equal to the Technique's TOTAL Energy cost (capped at the target's max hit boxes by the
 *  applier); Regen clears a flat 1. Min 1. */
export function valuedStatusValue(energyCost, statusId = "regen") {
  if (statusId === "regen") return PROJECTANIME.regenHeal;
  return Math.max(1, Number(energyCost) || 1);
}

/** Conditions whose Inflict carries a pool choice made at creation: Cursed ("choose hit or
 *  energy boxes" — which pool's clearing it blocks). */
PROJECTANIME.poolChoiceStatuses = ["curse"];

/** The pools a creature's Curse currently blocks (Cursed: cannot clear the cursed pool's
 *  boxes). A pool-less Curse — toggled straight from the token HUD — blocks BOTH pools.
 *  Returns `[]` when the creature isn't Cursed. */
export function cursedPools(actor) {
  if (!actor?.statuses?.has?.("curse")) return [];
  const pool = actor.getFlag?.("project-anime", "curse")?.pool;
  return pool === "hp" || pool === "energy" ? [pool] : ["hp", "energy"];
}

/** Status mechanics constants (rules: Status Effects). */
PROJECTANIME.exposedGuardPenalty = 2;   // Exposed: Guard reduced by 2.
PROJECTANIME.weakenedThresholdMod = 2;  // Weakened: your attacks increase their Threshold by 2.
PROJECTANIME.proneThresholdMod = 2;     // Prone: attacks against you reduce their Threshold by 2.

/**
 * Condition registry assigned to CONFIG.statusEffects during init, giving each
 * status a token-HUD icon. Foundry localizes the `name` keys.
 */
PROJECTANIME.statusConditions = [
  // Barrier (system marker): temporary hit boxes, marked before your own (flags.project-anime.barrier).
  { id: "barrier", name: "PROJECTANIME.Status.barrier", img: "icons/svg/holy-shield.svg" },
  { id: "blinded", name: "PROJECTANIME.Status.blinded", img: "icons/svg/blind.svg" },
  { id: "bound", name: "PROJECTANIME.Status.bound", img: "icons/svg/net.svg" },
  // Cursed: cannot clear hit boxes or energy boxes (the pool chosen at creation; see cursedPools).
  { id: "curse", name: "PROJECTANIME.Status.curse", img: "icons/svg/terror.svg" },
  // Lingering (stored id `decay`): mark 1 hit box at the end of each of your turns.
  { id: "decay", name: "PROJECTANIME.Status.decay", img: "icons/svg/degen.svg" },
  // Sealed (stored id `exhausted`): cannot use techniques.
  { id: "exhausted", name: "PROJECTANIME.Status.exhausted", img: "icons/svg/downgrade.svg" },
  // Exposed: Guard reduced by 2.
  { id: "exposed", name: "PROJECTANIME.Status.exposed", img: "icons/svg/ruins.svg" },
  { id: "prone", name: "PROJECTANIME.Status.prone", img: "icons/svg/falling.svg" },
  // Reflect (system marker): the next technique that targets the bearer redirects to its user.
  { id: "reflect", name: "PROJECTANIME.Status.reflect", img: "icons/svg/mage-shield.svg" },
  // Regen (system marker): clear 1 hit box at the start of each of the bearer's turns.
  { id: "regen", name: "PROJECTANIME.Status.regen", img: "icons/svg/regen.svg" },
  { id: "slowed", name: "PROJECTANIME.Status.slowed", img: "icons/svg/daze.svg" },
  // Vanished (the Vanish Effect): the bearer cannot be seen; attacking reveals them.
  { id: "vanished", name: "PROJECTANIME.Status.vanished", img: "icons/svg/invisible.svg" },
  // Weakened: your attacks increase their Threshold by 2.
  { id: "weakened", name: "PROJECTANIME.Status.weakened", img: "icons/svg/unconscious.svg" }
];

/* -------------------------------------------- */
/*  Gear (V2 Styles)                            */
/* -------------------------------------------- */

/** What a consumable restores when used (the amount is set per item). */
PROJECTANIME.consumableRestore = {
  none: "PROJECTANIME.Consumable.restore.none",
  hp: "PROJECTANIME.Consumable.restore.hp",
  energy: "PROJECTANIME.Consumable.restore.energy"
};

/** Weapon/Skill physical range categories (legacy display data; V2 shows tile numbers). */
PROJECTANIME.rangeTypes = {
  melee: "PROJECTANIME.RangeType.melee",
  ranged: "PROJECTANIME.RangeType.ranged"
};

/** Which equipment slot a weapon/shield occupies. Two-handedness is `grip`, not a hand. */
PROJECTANIME.hands = {
  main: "PROJECTANIME.Hand.main",
  off: "PROJECTANIME.Hand.off"
};

/** Grip — one- or two-handed (the single source of two-handedness). */
PROJECTANIME.grips = {
  one: "PROJECTANIME.Grip.one",
  two: "PROJECTANIME.Grip.two"
};

/**
 * Weapon Styles (rules: Equipment). Damage = hit boxes marked on a hit (fixed, never rolled);
 * Threshold = the attack-roll number that marks 1 additional box; range in tiles [min, max];
 * `dual` = Dual Wield property, `twoHanded` = occupies both hands. Heavy weapons may pair
 * Might + Might (the one same-attribute exception).
 */
PROJECTANIME.weaponStyles = {
  light:    { label: "PROJECTANIME.WeaponStyle.light",    damage: 1, threshold: 8,  range: [1, 1], dual: true,      icon: "icons/weapons/daggers/dagger-simple-black.webp" },
  balanced: { label: "PROJECTANIME.WeaponStyle.balanced", damage: 2, threshold: 10, range: [1, 1],                  icon: "icons/weapons/swords/sword-guard-blue.webp" },
  heavy:    { label: "PROJECTANIME.WeaponStyle.heavy",    damage: 3, threshold: 12, range: [1, 1], twoHanded: true, icon: "icons/weapons/swords/greatsword-crossguard-steel.webp" },
  reach:    { label: "PROJECTANIME.WeaponStyle.reach",    damage: 1, threshold: 10, range: [1, 2],                  icon: "icons/weapons/polearms/spear-hooked-broad.webp" },
  thrown:   { label: "PROJECTANIME.WeaponStyle.thrown",   damage: 1, threshold: 9,  range: [1, 4], dual: true,      icon: "icons/weapons/thrown/shuriken-blue.webp" },
  ranged:   { label: "PROJECTANIME.WeaponStyle.ranged",   damage: 2, threshold: 11, range: [3, 8], twoHanded: true, icon: "icons/weapons/bows/bow-recurve-black.webp" },
  casting:  { label: "PROJECTANIME.WeaponStyle.casting",  damage: 1, threshold: 10, range: [1, 5],                  icon: "icons/weapons/staves/staff-orb-purple.webp" }
};
PROJECTANIME.weaponStyleKeys = ["light", "balanced", "heavy", "reach", "thrown", "ranged", "casting"];

/** Shield Styles — weapon Styles that also provide a Guard bonus. A Light Shield dual-wields;
 *  a Heavy Shield is one hand but not dual-wieldable with weapons. */
PROJECTANIME.shieldStyles = {
  lightShield: { label: "PROJECTANIME.ShieldStyle.light", damage: 1, threshold: 10, range: [1, 1], guard: 1, dual: true, icon: "icons/equipment/shield/buckler-wooden-boss-steel.webp" },
  heavyShield: { label: "PROJECTANIME.ShieldStyle.heavy", damage: 2, threshold: 12, range: [1, 1], guard: 2,             icon: "icons/equipment/shield/heater-embossed-gold.webp" }
};
PROJECTANIME.shieldStyleKeys = ["lightShield", "heavyShield"];

/** Armor Styles — set the Guard bonus and Movement. Unarmored clears 2 energy boxes per turn
 *  instead of 1. */
PROJECTANIME.armorStyles = {
  unarmored: { label: "PROJECTANIME.ArmorStyle.unarmored", guard: 0, movement: 6, energyRegen: 2, icon: "icons/equipment/chest/shirt-collared-brown.webp" },
  light:     { label: "PROJECTANIME.ArmorStyle.light",     guard: 1, movement: 6,                 icon: "icons/equipment/chest/breastplate-collared-leather-brown.webp" },
  medium:    { label: "PROJECTANIME.ArmorStyle.medium",    guard: 3, movement: 5,                 icon: "icons/equipment/chest/breastplate-banded-steel.webp" },
  heavy:     { label: "PROJECTANIME.ArmorStyle.heavy",     guard: 5, movement: 4,                 icon: "icons/equipment/chest/breastplate-collared-steel-grey.webp" }
};
PROJECTANIME.armorStyleKeys = ["unarmored", "light", "medium", "heavy"];

/** A Style's printed table line as rich tooltip HTML — the system's `.pa-tooltip` card (icon
 *  header, labeled stat rows, property chips). Pair with `data-tooltip-class="pa-tooltip"`.
 *  Used by the item-sheet Style pickers and the Character Creator's Style cards.
 *  @param {object} s       The style row (weaponStyles / shieldStyles / armorStyles entry).
 *  @param {string} kindKey Lang key of the subtitle ("PROJECTANIME.Style.weapon" …). */
export function styleTooltipHTML(s, kindKey) {
  const L = (k) => game.i18n.localize(k);
  const row = (icon, key, value) =>
    `<div class="pa-tt-row"><span class="k"><i class="fa-solid ${icon}"></i> ${L(key)}</span><span class="v">${value}</span></div>`;
  const rows = [];
  if (s.damage != null) rows.push(row("fa-burst", "PROJECTANIME.Roll.damage", s.damage));
  if (s.threshold != null) rows.push(row("fa-bullseye", "PROJECTANIME.Field.threshold", s.threshold));
  if (s.range) rows.push(row("fa-arrows-left-right-to-line", "PROJECTANIME.Field.range",
    physicalRangeLabel({ tiles: s.range[1], minTiles: s.range[0] > 1 ? s.range[0] : 0 })));
  if (s.guard != null) rows.push(row("fa-shield", "PROJECTANIME.Stat.guard", `+${s.guard}`));
  if (s.movement != null) rows.push(row("fa-shoe-prints", "PROJECTANIME.Stat.movement", s.movement));
  if (s.energyRegen) rows.push(row("fa-bolt", "PROJECTANIME.Field.energyRegen", s.energyRegen));
  const tags = [];
  if (s.dual) tags.push(L("PROJECTANIME.Field.dualWield"));
  if (s.twoHanded) tags.push(L("PROJECTANIME.Grip.two"));
  const tagHTML = tags.length
    ? `<div class="pa-tt-tags">${tags.map((t) => `<span class="pa-tt-tag">${t}</span>`).join("")}</div>`
    : "";
  return `<div class="pa-tt-head"><img class="pa-tt-img" src="${s.icon}" />`
    + `<div class="pa-tt-heads"><div class="pa-tt-title">${L(s.label)}</div>`
    + `<div class="pa-tt-type">${kindKey ? L(kindKey) : L("PROJECTANIME.Field.style")}</div></div></div>`
    + `<div class="pa-tt-body"><div class="pa-tt-rows">${rows.join("")}</div>${tagHTML}</div>`;
}

/** A weapon's base TYPE — its category ("Sword", "Bow", …), distinct from its given name.
 *  Free text per weapon (system.weaponType); these are the datalist suggestions. */
PROJECTANIME.weaponTypeSuggestions = [
  "Sword", "Axe", "Spear", "Polearm", "Dagger", "Mace", "Hammer",
  "Club", "Flail", "Staff", "Whip", "Bow", "Crossbow", "Gun", "Thrown", "Fist", "Shield"
];

/** How a shield is wielded. "Dual Wielding" treats it as an off-hand weapon; "Just for
 *  Shields" carries it for defense only. */
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
/*  Advancement (V2 milestones)                 */
/* -------------------------------------------- */

/** Milestones and the advancements each pays (rules: Advancement). */
PROJECTANIME.milestones = {
  episode: { label: "PROJECTANIME.Milestone.episode", advancements: 2 },
  arc:     { label: "PROJECTANIME.Milestone.arc",     advancements: 4 },
  season:  { label: "PROJECTANIME.Milestone.season",  advancements: 6 }
};
PROJECTANIME.milestoneKeys = ["episode", "arc", "season"];

/** The Advancement List — each option's slot cap (`slots`), and the Companion's own cap where
 *  it differs (rules: Companion Advancement — Create a Technique has 3 slots there). Rebuild
 *  does not consume a Create-a-Technique slot. */
PROJECTANIME.advancementOptions = {
  technique:  { label: "PROJECTANIME.Advance.technique",  slots: 6, companionSlots: 3 },
  energy:     { label: "PROJECTANIME.Advance.energy",     slots: 5 },
  hitBox:     { label: "PROJECTANIME.Advance.hitBox",     slots: 5 },
  talent:     { label: "PROJECTANIME.Advance.talent",     slots: 2 },
  rebuild:    { label: "PROJECTANIME.Advance.rebuild",    slots: 2 },
  attribute:  { label: "PROJECTANIME.Advance.attribute",  slots: 4 },
  talentStep: { label: "PROJECTANIME.Advance.talentStep", slots: 8 },
  // Raise the Luck Die one size (d6→d8→d10→d12); 3 slots = the d12 ceiling. Characters only —
  // Companions hold no Luck Dice, so their cap is 0.
  luckDie:    { label: "PROJECTANIME.Advance.luckDie",    slots: 3, companionSlots: 0 }
};
PROJECTANIME.advancementOptionKeys = ["technique", "energy", "hitBox", "talent", "rebuild", "attribute", "talentStep", "luckDie"];

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

/** The SIDE that CREATED an effect — the phase whose start counts its Duration down ("When a
 *  side's phase begins, every duration that side created drops by 1"). An effect's creator is
 *  the acting creature that applied it. */
export function actorSide(actor) {
  if (!actor) return "hostile";
  const c = game.combat?.combatants?.find((cb) => cb.actorId === actor.id);
  if (c) return combatantSide(c);
  const D = CONST.TOKEN_DISPOSITIONS;
  const disp = actor.getActiveTokens?.()?.[0]?.document?.disposition
    ?? actor.prototypeToken?.disposition
    ?? D.HOSTILE;
  if (disp === D.FRIENDLY) return "friendly";
  if (disp === D.NEUTRAL) return "neutral";
  return "hostile";
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

/** A unit that can't take an activation: Defeated (down — cannot move or act). */
export function isSkippable(combatant) {
  return !!combatant?.isDefeated;
}

/** Not-yet-acted, non-defeated combatants on a side, in stable within-side order (display + auto-pick). */
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

/* -------------------------------------------- */
/*  Enemies (V2 types)                          */
/* -------------------------------------------- */

/**
 * The V2 enemy Types — each a complete stat line (rules: Enemies → Building Your Own).
 *   • hb/eb/guard/movement/damage/threshold — the printed stat line.
 *   • threat — its cost in the encounter budget (Minion ½ · Standard 1 · Bruiser 1½ ·
 *     Skirmisher 1 · Support 1 · Elite 2).
 *   • attrs — the Attribute budget as die sizes, largest first (assigned to fit the concept).
 *   • talents — starting Talent die sizes ([8] = one at d8; Elite may swap for two at d6).
 *   • techniques — the suggested Technique count (0 = none printed for Minions).
 */
PROJECTANIME.enemyTypes = {
  minion:     { label: "PROJECTANIME.EnemyType.minion",     icon: "fa-solid fa-bugs",           color: "#8a8f4f", hb: 1, eb: 0, guard: 7,  movement: 5, damage: 1, threshold: 8,  threat: 0.5, attrs: [6, 6, 4, 4, 4], talents: [],  techniques: 0 },
  standard:   { label: "PROJECTANIME.EnemyType.standard",   icon: "fa-solid fa-helmet-battle",  color: "#7a8a8f", hb: 4, eb: 3, guard: 7,  movement: 5, damage: 2, threshold: 10, threat: 1,   attrs: [8, 8, 4, 4, 4], talents: [6], techniques: 2 },
  bruiser:    { label: "PROJECTANIME.EnemyType.bruiser",    icon: "fa-solid fa-hand-fist",      color: "#9c6b4f", hb: 6, eb: 3, guard: 7,  movement: 4, damage: 3, threshold: 12, threat: 1.5, attrs: [8, 8, 6, 4, 4], talents: [8], techniques: 2 },
  skirmisher: { label: "PROJECTANIME.EnemyType.skirmisher", icon: "fa-solid fa-wind",           color: "#4f9c8f", hb: 3, eb: 3, guard: 10, movement: 6, damage: 1, threshold: 9,  threat: 1,   attrs: [8, 8, 4, 4, 4], talents: [6], techniques: 2 },
  support:    { label: "PROJECTANIME.EnemyType.support",    icon: "fa-solid fa-staff-snake",    color: "#4f7c9c", hb: 3, eb: 5, guard: 8,  movement: 5, damage: 1, threshold: 10, threat: 1,   attrs: [8, 8, 6, 4, 4], talents: [6], techniques: 2 },
  elite:      { label: "PROJECTANIME.EnemyType.elite",      icon: "fa-solid fa-shield-halved",  color: "#4f9c6c", hb: 6, eb: 5, guard: 9,  movement: 5, damage: 2, threshold: 10, threat: 2,   attrs: [8, 8, 8, 4, 4], talents: [8], techniques: 2 }
};

/** Iteration order for enemy Types (chaff → elite). */
PROJECTANIME.enemyTypeKeys = ["minion", "standard", "bruiser", "skirmisher", "support", "elite"];

/** A Rival — a recurring villain built as a full player character — counts as Threat 2. */
PROJECTANIME.rivalThreat = 2;

/** An enemy Type's Threat cost (unknown → 1). */
export function enemyTypeThreat(typeKey) {
  return PROJECTANIME.enemyTypes[typeKey]?.threat ?? 1;
}

/* -------------------------------------------- */
/*  Bosses (V2)                                 */
/* -------------------------------------------- */

/** A Boss is one enemy built to fight the whole party (start from an Elite):
 *  Attributes three at d10 + two at d6 · Talents one at d10 or two at d8 · Damage 3,
 *  Threshold 11 · Guard 9, Movement 5 · Energy Boxes 6 per Bar · acts TWICE per Enemy Phase ·
 *  two Techniques per Bar (a break unlocks the next Bar's) · a break clears all detrimental
 *  statuses and loses excess damage. */
PROJECTANIME.boss = {
  attrs: [10, 10, 10, 6, 6],
  talents: [10],
  damage: 3,
  threshold: 11,
  guard: 9,
  movement: 5,
  energyPerBar: 6,
  actionsPerPhase: 2,
  techniquesPerBar: 2
};

/** A Boss's Bar count = half the party size, rounded up (min 1). */
export function bossBarCount(partySize) {
  return Math.max(1, Math.ceil((Number(partySize) || 1) / 2));
}

/** Each Bar has hit boxes = party size × 2. */
export function bossBarHp(partySize) {
  return Math.max(1, 2 * Math.max(1, Number(partySize) || 1));
}

/** A Boss's Threat = the party size. */
export function bossThreat(partySize) {
  return Math.max(1, Number(partySize) || 1);
}

/* -------------------------------------------- */
/*  Companions (V2)                             */
/* -------------------------------------------- */

/** The Companion Effect's stat line (rules: Companion Rules). One Talent at d6, one Technique,
 *  Attributes one at d6 + four at d4; on your turn you act OR the Companion acts. Carries the
 *  same presentation fields as an enemyTypes entry (label/icon/color) so the sheet badge and
 *  the Monster Creator's Companion tile can render it, but it is NOT an enemy Type — it has
 *  no Threat and never enters the encounter budget. */
PROJECTANIME.companion = {
  label: "PROJECTANIME.EnemyType.companion",
  icon: "fa-solid fa-paw",
  color: "#4f7c9c",
  hb: 3,
  eb: 2,
  guard: 7,
  movement: 5,
  damage: 1,
  threshold: 10,
  attrs: [6, 4, 4, 4, 4],
  energyLock: 2,
  talents: [6],
  techniques: 1
};

/** A bonded Companion actor — an NPC created by the Companion Effect (flagged `companionOf`),
 *  hand-typed "companion", or filed under a companions folder (matches partyCompanions'
 *  folder test). Companions advance on their own slot caps and ride the party. */
export function isCompanion(actor) {
  if (actor?.type !== "npc") return false;
  if (actor.system?.npcType === "companion" || actor.getFlag?.("project-anime", "companionOf")) return true;
  for (let f = actor.folder; f; f = f.folder) if (/companion/i.test(f.name ?? "")) return true;
  return false;
}

/* -------------------------------------------- */
/*  Encounter budget (Party sheet)              */
/* -------------------------------------------- */

/**
 * Encounter difficulty → the THREAT budget (rules: Encounter Budget). The base budget is the
 * number of Player Characters; Easy = party − 1, Standard = party, Hard = party × 1.5,
 * Climax = party × 2. Threat is spent by Type (enemyTypeThreat); Rival = 2; Boss = party size.
 * Minions may not exceed half the budget.
 */
PROJECTANIME.encounterDifficulty = {
  easy:     { label: "PROJECTANIME.Encounter.difficulty.easy",     offset: -1 },
  standard: { label: "PROJECTANIME.Encounter.difficulty.standard", offset: 0 },
  hard:     { label: "PROJECTANIME.Encounter.difficulty.hard",     mult: 1.5 },
  climax:   { label: "PROJECTANIME.Encounter.difficulty.climax",   mult: 2 }
};

/** Iteration order for encounter difficulties (easiest → hardest). */
PROJECTANIME.encounterDifficultyKeys = ["easy", "standard", "hard", "climax"];

/* -------------------------------------------- */
/*  Health status ladder (hidden-HP descriptor) */
/* -------------------------------------------- */

/** Qualitative wound descriptor shown IN PLACE of exact hit boxes when a viewer isn't allowed to
 *  see a creature's vitals (pf2e-hud style). Steps match high→low by remaining-box fraction. */
PROJECTANIME.healthLadder = [
  { min: 1,    key: "PROJECTANIME.Health.fine",    tint: "#8ad35f" },
  { min: 0.75, key: "PROJECTANIME.Health.barely",  tint: "#c3d35f" },
  { min: 0.5,  key: "PROJECTANIME.Health.wounded", tint: "#f4b15e" },
  { min: 0.25, key: "PROJECTANIME.Health.hurt",    tint: "#ef8a6e" },
  { min: 0,    key: "PROJECTANIME.Health.dying",   tint: "#c34155" }
];

/** Resolve an actor's hit boxes to a {key, tint, pct} health descriptor, or null when it has no
 *  HP track. 0 → "Down". Callers localize `key`. */
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
