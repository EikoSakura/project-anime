/**
 * Project: Anime — no-code Active Effects engine.
 *
 * Effects are carried by core Foundry ActiveEffect documents (for free transfer,
 * enable/disable, duration and drag-drop) but their MEANING is stored as a
 * structured, dropdown-authored flag — not in core `changes[]`:
 *
 *   effect.flags["project-anime"].rules = { version: 1, list: [ <rule>, … ] }
 *
 * A "rule" is one friendly modification. This module is the single source of the
 * rule vocabulary, plus the engine that applies PASSIVE rules during the actor's
 * data preparation. Roll-time rules (Phase 2) and predicates/toggles (Phase 3) are
 * layered on later; Phase 1 covers the always-on passive data rules below.
 *
 * IMPORTANT — field-targeting contract (see actor-models.mjs prepare order):
 * passive rules run in `Actor#applyActiveEffects()`, AFTER prepareBaseData (attribute
 * `value` already seeded from `base`) and BEFORE prepareDerivedData (which reads the
 * `.bonus` fields and clamps attribute `.value`). So a rule may ONLY write to:
 *   • attribute  → system.attributes.<k>.value   (delta of ±2 per die step; clamped later)
 *   • stat       → system.<stat>.bonus            (evasion/movement/defense/carryingCapacity)
 *   • resource   → system.<hp|energy>.max
 * Writing a DERIVED field (evasion.value, attribute.die, system.conditions, …) is
 * silently clobbered by prepareDerivedData and does nothing. The engine must stay a
 * PURE in-memory transform — never call update()/setFlag() from here (infinite loop).
 */

import { PROJECTANIME, skillEffectKeys, auraAudience, modifierValue, modifierTakes } from "./config.mjs";
import { stampCompendiumSource } from "./gear.mjs";

const FLAG_SCOPE = "project-anime";

/** Item types whose effects apply only while the item is equipped. Items without an
 *  `equipped` field (consumable/gear/skill/container) apply their effects whenever present. */
const EQUIP_GATED = new Set(["weapon", "armor", "shield", "accessory"]);

/* -------------------------------------------- */
/*  Rule vocabulary (the dropdown choices)      */
/* -------------------------------------------- */

/** The rule "verbs" a player/GM can pick. Values are localization keys. */
export const RULE_TYPES = {
  // Inert: a marker rule that applies nothing on its own. Lets an effect exist purely as a
  // named/icon'd (optionally timed) carrier — e.g. the visible duration rider for a Skill
  // modifier — without forcing a stat change. See normalizeRule / the engine's type guards.
  none: "PROJECTANIME.Effect.type.none",
  attribute: "PROJECTANIME.Effect.type.attribute",
  stat: "PROJECTANIME.Effect.type.stat",
  resource: "PROJECTANIME.Effect.type.resource",
  // Per-turn regeneration of a pool (Hit Points / Energy). The "Sustain" mechanic generalized into a
  // rule any effect can carry — applied at the combat turn-tick (project-anime.mjs), not in prepare.
  sustain: "PROJECTANIME.Effect.type.sustain",
  roll: "PROJECTANIME.Effect.type.roll",
  // Improve (or worsen) ONE Attribute for NON-COMBAT Checks only — the general two-die Check/Test
  // (dice.mjs performCheck), never attacks / skills / damage. Either Steps the matching die(s) or
  // adds a flat bonus to the total. NOT a passive prepare rule (it must NOT change the attribute's
  // die size, which would leak into combat) — read at check time via collectNonCombatCheckMods.
  ncCheck: "PROJECTANIME.Effect.type.ncCheck",
  condition: "PROJECTANIME.Effect.type.condition",
  // Status immunity: while live, the bearer can't be afflicted with the chosen Status Effect — any
  // attempt to INFLICT it (a Skill/weapon on-hit, a Hinder status, the Inflict Modifier, Lingering)
  // is shrugged off. A passive, self-only guard read at inflict time (statusImmunities, consulted in
  // dice.mjs), NOT a prepare rule — it changes no stat, only blocks an incoming condition.
  immunity: "PROJECTANIME.Effect.type.immunity",
  luck: "PROJECTANIME.Effect.type.luck",
  trade: "PROJECTANIME.Effect.type.trade",
  reveal: "PROJECTANIME.Effect.type.reveal",
  grant: "PROJECTANIME.Effect.type.grant",
  // Modifier-scoped Skill adjustment: while live, the bearer's Skills that carry a chosen Modifier
  // (or any Skill) deal a flat ±damage and cost ±Energy. NOT a passive prepare rule — read at use
  // time (collectSkillModBonuses, folded into dice.mjs).
  skillMod: "PROJECTANIME.Effect.type.skillMod",
  // The weapon-side sibling of skillMod: while live, the bearer's WEAPON attacks (any weapon, their
  // Unarmed strike, or a chosen weapon TYPE like "Sword") gain a flat ±Attack (accuracy) and
  // ±Damage. Read at use time (collectWeaponModBonuses, folded into dice.mjs).
  weaponMod: "PROJECTANIME.Effect.type.weaponMod"
};

/** The "scope" a `skillMod` rule keys off: a Skill Modifier key (Burst, Pierce, …) OR `skill` (any
 *  Skill). Merged with PROJECTANIME.skillModifiers in the builder menu (`skill` pinned first). The
 *  weapon/unarmed scopes moved to `weaponMod` (WEAPONMOD_SCOPES). */
export const SKILLMOD_SCOPES = {
  skill: "PROJECTANIME.Effect.modScope.skill"
};

/** The "scope" a `weaponMod` rule keys off — which weapon attacks it boosts. `any` = every
 *  weapon/shield attack; `unarmed` = the Natural-Attack ("fighting with your hands"); `type` =
 *  weapons whose base Type (system.weaponType) matches the rule's `typeName` (case-insensitive). */
export const WEAPONMOD_SCOPES = {
  any: "PROJECTANIME.Effect.modScope.weapon",
  unarmed: "PROJECTANIME.Effect.modScope.unarmed",
  type: "PROJECTANIME.Effect.weaponModScope.type"
};

/** Which roll a "roll" rule modifies. "check" applies to any 2-die Check (incl. attacks). */
export const ROLL_SELECTORS = {
  check: "PROJECTANIME.Effect.selector.check",
  attack: "PROJECTANIME.Effect.selector.attack",
  damage: "PROJECTANIME.Effect.selector.damage"
};

/** Who an applied condition affects: the wearer (passive) or a struck target (on hit). */
export const CONDITION_SCOPES = {
  self: "PROJECTANIME.Effect.scope.self",
  target: "PROJECTANIME.Effect.scope.target"
};

/** Optional per-rule condition ("only when…"). self* read the acting actor; target*
 *  (roll rules + on-hit inflicts only) read the struck target. "always" = no condition. */
export const PRED_TYPES = {
  always: "PROJECTANIME.Effect.pred.always",
  selfCondition: "PROJECTANIME.Effect.pred.selfCondition",
  hpBelow: "PROJECTANIME.Effect.pred.hpBelow",
  energyBelow: "PROJECTANIME.Effect.pred.energyBelow",
  targetCondition: "PROJECTANIME.Effect.pred.targetCondition"
};

/** Effect duration units offered in the builder (mapped onto core effect.duration). */
export const DURATION_UNITS = {
  none: "PROJECTANIME.Effect.dur.none",
  rounds: "PROJECTANIME.Effect.dur.rounds",
  turns: "PROJECTANIME.Effect.dur.turns",
  minutes: "PROJECTANIME.Effect.dur.minutes"
};

/* -------------------------------------------- */
/*  Effect duration (Foundry v13 ↔ v14)         */
/* -------------------------------------------- */

/** True on Foundry v14+, whose Active Effect duration schema is `{value, units, expiry}` —
 *  v13's `rounds`/`turns`/`seconds` and `start*` anchor fields no longer exist there. */
export const durationV14 = () => Number(game?.release?.generation ?? 0) >= 14;

/** A round-counted effect duration in the running generation's schema, anchored to now
 *  (v13 needs the `start*` anchors for core's displayed `remaining`; v14 tracks `value`). */
export function makeRoundsDuration(rounds) {
  if (durationV14()) return { value: rounds, units: "rounds" };
  const d = { rounds, startTime: game.time?.worldTime ?? 0 };
  if (game.combat) { d.startRound = game.combat.round ?? 0; d.startTurn = game.combat.turn ?? 0; }
  return d;
}

/** The rounds left on an effect's round-counted duration, or null when it carries none. */
export function durationRounds(effect) {
  const d = effect?.duration;
  if (!d) return null;
  if (durationV14()) return d.units === "rounds" && Number.isFinite(d.value) ? d.value : null;
  return Number.isFinite(d.rounds) ? d.rounds : null;
}

/** Update payload writing a new round count onto an effect (v13 also re-anchors `startRound`
 *  so core's displayed `remaining` follows the caster-keyed countdown). */
export function durationRoundsUpdate(rounds, combat = null) {
  if (durationV14()) return { "duration.value": rounds };
  return { "duration.rounds": rounds, "duration.startRound": combat?.round ?? game.combat?.round ?? 0, "duration.startTurn": 0 };
}

/** Step Up (step the die up) / Step Down (step it down) — the no-code builder's Attribute rule;
 *  stored values stay `bolster`/`hinder`. "Empower / Weaken" are Skill-Effect names
 *  (kept distinct on Skill.effect.*), so the no-code die-step reads neutrally. */
export const ATTRIBUTE_MODES = {
  bolster: "PROJECTANIME.Effect.mode.bolster",
  hinder: "PROJECTANIME.Effect.mode.hinder"
};

/** How a `ncCheck` rule improves its Attribute on non-combat Checks: Step the die(s) up/down, or add
 *  a flat bonus to the total. Stored values stay `step`/`bonus`; a signed magnitude carries the
 *  direction (e.g. value −1 in `step` mode Steps the die DOWN). */
export const NCCHECK_MODES = {
  step: "PROJECTANIME.Effect.ncMode.step",
  bonus: "PROJECTANIME.Effect.ncMode.bonus"
};

/** Derived stats an effect can flat-modify (all carry a `.bonus` field). V2: Guard and
 *  Movement are the only derived stats. */
export const STAT_TARGETS = {
  guard: "PROJECTANIME.Stat.guard",
  movement: "PROJECTANIME.Stat.movement"
};

/** Retired pre-V2 stat keys folded to their nearest V2 stat at read (normalizeRule): the
 *  defensive trio becomes Guard; the offense/speed/capacity stats have no V2 counterpart and
 *  their rules go inert (kept valid so stored effects don't explode). */
const LEGACY_STAT_MAP = { evasion: "guard", defense: "guard", res: "guard" };

/** Resource maximums an effect can flat-modify. */
export const RESOURCE_TARGETS = {
  hp: "PROJECTANIME.Effect.maxHp",
  energy: "PROJECTANIME.Effect.maxEnergy"
};

/** The pool a `sustain` rule regenerates each turn. */
export const SUSTAIN_POOLS = {
  hp: "PROJECTANIME.Stat.hp",
  energy: "PROJECTANIME.Stat.energy"
};

/** Which trade rate a `trade` rule shifts: what you recover on sale, or what you pay to buy. */
export const TRADE_TARGETS = {
  sell: "PROJECTANIME.Effect.trade.sell",
  buy: "PROJECTANIME.Effect.trade.buy"
};

/** What a `reveal` rule unlocks for the VIEWER who carries it (a Scouter) — surfaced in a
 *  token's hover panel / right-click dossier. Each category is gated independently. V2: the
 *  printed Scouter reveals Guard; the retired Skill-Points category folds to it at read. */
export const REVEAL_CATEGORIES = {
  guard: "PROJECTANIME.Effect.reveal.guard",
  attributes: "PROJECTANIME.Effect.reveal.attributes",
  combatStats: "PROJECTANIME.Effect.reveal.combatStats",
  skills: "PROJECTANIME.Effect.reveal.skills"
};

/** Default shape for a freshly added rule row. */
export function blankRule() {
  return { type: "attribute", mode: "bolster", key: "might", steps: 1 };
}

/**
 * Coerce a raw (form-read) rule into a clean, stored rule — dropping fields that
 * don't belong to its type. Returns null for an unknown/empty type.
 */
/** Coerce a raw (form-read) predicate to a clean stored one, or null for "always". */
function normalizePred(raw) {
  const keys = PROJECTANIME.conditionKeys ?? [];
  const pct = (v) => Math.max(1, Math.min(100, Math.round(Number(v) || 0)));
  switch (raw?.type) {
    case "selfCondition": return { type: "selfCondition", status: keys.includes(raw.status) ? raw.status : (keys[0] ?? "") };
    case "hpBelow": return { type: "hpBelow", pct: pct(raw.pct) };
    case "energyBelow": return { type: "energyBelow", pct: pct(raw.pct) };
    case "targetCondition": return { type: "targetCondition", status: keys.includes(raw.status) ? raw.status : (keys[0] ?? "") };
    default: return null; // "always" / unknown → no predicate
  }
}

export function normalizeRule(raw) {
  if (!raw || !raw.type) return null;
  let rule = null;
  switch (raw.type) {
    case "none":
      return { type: "none" }; // inert marker — no fields, no predicate
    case "attribute":
      rule = {
        type: "attribute",
        mode: raw.mode === "hinder" ? "hinder" : "bolster",
        key: raw.key in PROJECTANIME.attributes ? raw.key : "might",
        steps: Math.max(1, Math.min(4, Math.round(Number(raw.steps) || 1)))
      };
      break;
    case "stat": {
      const key = raw.key in STAT_TARGETS ? raw.key : (LEGACY_STAT_MAP[raw.key] ?? "guard");
      rule = { type: "stat", key, value: Math.round(Number(raw.value) || 0) };
      break;
    }
    case "resource":
      rule = { type: "resource", target: raw.target in RESOURCE_TARGETS ? raw.target : "hp", value: Math.round(Number(raw.value) || 0) };
      break;
    case "sustain":
      // Per-turn regen of a pool. Value is the amount restored each turn (≥ 0; 0 is ignored when collected).
      rule = { type: "sustain", pool: raw.pool === "energy" ? "energy" : "hp", value: Math.max(0, Math.round(Number(raw.value) || 0)) };
      break;
    case "roll":
      rule = { type: "roll", selector: raw.selector in ROLL_SELECTORS ? raw.selector : "check", value: Math.round(Number(raw.value) || 0) };
      break;
    case "ncCheck": {
      const mode = raw.mode === "step" ? "step" : "bonus";
      let value = Math.round(Number(raw.value) || 0);
      // Step magnitude is a die-ladder count (signed, ±1..4); a flat bonus is a wider signed range.
      if (mode === "step") { value = Math.max(-4, Math.min(4, value)); if (value === 0) value = 1; }
      else value = Math.max(-20, Math.min(20, value));
      rule = { type: "ncCheck", key: raw.key in PROJECTANIME.attributes ? raw.key : "might", mode, value };
      break;
    }
    case "luck":
      rule = { type: "luck", steps: Math.max(1, Math.min(4, Math.round(Number(raw.steps) || 1))) };
      break;
    case "trade":
      // Percentage points added to a sell or buy rate (signed; e.g. a Trader's Pass = sell +10).
      rule = {
        type: "trade",
        target: raw.target === "buy" ? "buy" : "sell",
        pct: Math.max(-100, Math.min(100, Math.round(Number(raw.pct) || 0)))
      };
      break;
    case "condition": {
      const keys = PROJECTANIME.conditionKeys ?? [];
      rule = { type: "condition", scope: raw.scope === "target" ? "target" : "self", status: keys.includes(raw.status) ? raw.status : (keys[0] ?? "") };
      break;
    }
    case "immunity": {
      const keys = PROJECTANIME.conditionKeys ?? [];
      rule = { type: "immunity", status: keys.includes(raw.status) ? raw.status : (keys[0] ?? "") };
      break;
    }
    case "reveal":
      rule = { type: "reveal", category: raw.category in REVEAL_CATEGORIES ? raw.category : "attributes" };
      break;
    case "grant": {
      // The dragged-in Item references this effect grants when its carrier lands on an
      // actor. NOT a passive in-memory rule — applied event-driven by syncGrants (below).
      const items = Object.values(raw.items ?? {})
        .map((it) => {
          const out = {
            uuid: String(it?.uuid ?? "").trim(),
            name: String(it?.name ?? "").trim(),
            img: String(it?.img ?? "").trim()
          };
          // Self-contained snapshot captured at author time, so the grant still delivers after
          // its source Item is deleted/renamed. Preserved verbatim.
          if (it?.data && typeof it.data === "object") out.data = it.data;
          return out;
        })
        .filter((it) => it.uuid || it.data);
      rule = { type: "grant", items };
      break;
    }
    case "skillMod": {
      // Legacy: the weapon/unarmed scopes used to live on skillMod — fold them into the new
      // weaponMod rule (preserving the damage bump; weapons never carried an Energy delta).
      if (raw.scope === "weapon" || raw.scope === "unarmed") {
        rule = {
          type: "weaponMod",
          scope: raw.scope === "weapon" ? "any" : "unarmed",
          typeName: "",
          attack: 0,
          damage: Math.round(Number(raw.damage) || 0)
        };
        break;
      }
      const scope = (raw.scope in SKILLMOD_SCOPES || raw.scope in PROJECTANIME.skillModifiers) ? raw.scope : "burst";
      rule = {
        type: "skillMod",
        scope,
        damage: Math.round(Number(raw.damage) || 0),
        energy: Math.round(Number(raw.energy) || 0)
      };
      break;
    }
    case "weaponMod": {
      const scope = raw.scope in WEAPONMOD_SCOPES ? raw.scope : "any";
      rule = {
        type: "weaponMod",
        scope,
        typeName: scope === "type" ? String(raw.typeName ?? "").trim() : "",
        attack: Math.round(Number(raw.attack) || 0),
        damage: Math.round(Number(raw.damage) || 0)
      };
      break;
    }
    default:
      return null;
  }
  const pred = normalizePred(raw.pred);
  if (pred) rule.pred = pred;
  return rule;
}

/* -------------------------------------------- */
/*  Reading rules off an effect                 */
/* -------------------------------------------- */

/** The structured rule list stored on an ActiveEffect (tolerant of legacy shapes). */
export function effectRules(effect) {
  const data = effect?.flags?.[FLAG_SCOPE]?.rules;
  if (!data) return [];
  if (Array.isArray(data)) return data; // defensive: a bare array
  return Array.isArray(data.list) ? data.list : [];
}

/** The attribute rules an Empower/Weaken/Transform Skill applies to its chosen `effectAttrs`
 *  (picked on the Effect step, INDEPENDENT of the roll Attributes — attrA/attrB drive the
 *  Accuracy Check; these drive what changes). Rules v0.01: Empower (stored id `bolster`) steps
 *  ONE Attribute up, Weaken (`hinder`) steps one down, Transform steps one Attribute up by TWO or
 *  two Attributes up by one each. Skills built under the older rank-scaled rule may store more
 *  Attributes than the Effect now allows — grandfathered: everything stored (valid, deduped)
 *  still applies; only the Builder caps new picks (config.mjs effectAttrCount). `mode` is the
 *  effect key. [] for any other Effect. */
export function bolsterHinderRules(item, mode) {
  if (mode !== "bolster" && mode !== "hinder" && mode !== "transform") return [];
  const sys = item?.system ?? {};
  const keys = [...new Set((sys.effectAttrs ?? []).filter((k) => k in PROJECTANIME.attributes))];
  if (mode === "transform") {
    const steps = keys.length === 1 ? 2 : 1;
    return keys.map((key) => ({ type: "attribute", mode: "bolster", key, steps }));
  }
  return keys.map((key) => ({ type: "attribute", mode, key, steps: 1 }));
}

/** The Status ids a legacy Weaken inflicts on a hit: its stored `hinderStatuses`, kept to valid
 *  conditions. Rules v0.01 removed Weaken's built-in status rider (the Inflict Modifier is the
 *  status path), so the Builder no longer authors these — stored lists are grandfathered. */
export function hinderStatusIds(item) {
  if (item?.type !== "skill" || !skillEffectKeys(item.system).includes("hinder")) return [];
  const keys = PROJECTANIME.conditionKeys ?? [];
  return [...new Set((item.system?.hinderStatuses ?? []).filter((s) => keys.includes(s)))];
}

/** True if the Skill carries a hand-authored attribute-rule effect — so the auto Bolster/Hinder
 *  isn't generated (it would double the designer's own). */
export function hasAuthoredAttributeEffect(item) {
  return (item?.effects ?? []).some((e) => !e.disabled && effectRules(e).some((r) => r.type === "attribute"));
}

/** The rules a Skill's MODIFIERS contribute automatically (like bolsterHinderRules, but driven by
 *  the Modifier list instead of the Effect): Protection grants the target(s) +1 Defense (more if
 *  Tuned — config.mjs modifierValue); Retaliation wards the target so a foe that damages it takes
 *  the warded value (read reactively by collectRetaliation, NOT a passive stat
 *  change — applyPassiveRule ignores it). Used by all three delivery paths — the passive in-memory
 *  engine (below), the on-use copy (dice.mjs), and the aura projection (helpers/aura.mjs) — so
 *  every path grants the identical thing. [] for non-Skills or Skills carrying none of these
 *  Modifiers. */
export function skillModifierRules(item) {
  if (item?.type !== "skill") return [];
  const sys = item.system ?? {};
  const mods = sys.modifiers ?? [];
  const out = [];
  // Protection (V2): the target gains +1 Guard; Duration follows the technique.
  if (mods.includes("protection")) out.push({ type: "stat", key: "guard", value: PROJECTANIME.protectionGuard ?? 1 });
  // Retaliation (V2): an enemy that marks hit boxes on the target marks 1 hit box. Sibling
  // Modifiers on the same Technique shape the ward: Potent fattens the bounce (+1 per take)
  // and Drain rides along (the rule carries its pool) so a fired ward clears a box on its
  // bearer — paid out in dice.mjs applyRetaliation.
  if (mods.includes("retaliation")) {
    let value = PROJECTANIME.retaliationDamage ?? 1;
    if (mods.includes("potent")) value += (PROJECTANIME.potentBonus ?? 1) * modifierTakes("potent", sys);
    const rule = { type: "retaliation", value };
    if (mods.includes("drain")) rule.drain = sys.drainPool === "energy" ? "energy" : "hp";
    out.push(rule);
  }
  return out;
}

/** Localized display name of a status-condition id (e.g. "slowed" → "Slowed"). */
function conditionLabelOf(id) {
  const c = (PROJECTANIME.statusConditions ?? []).find((x) => x.id === id);
  return c ? game.i18n.localize(c.name) : id;
}

/** True if the Skill is a FOE-audience Aura (its Target is Foe). Its Effect projects onto enemies
 *  only (helpers/aura.mjs) and never applies to the bearer, so the bearer's normal in-memory
 *  application is suppressed. Ally and Any audiences are unaffected here — both include the
 *  bearer, who keeps the Effect like any passive. */
export function isEnemyAura(item) {
  const sys = item?.system;
  return !!sys && (sys.modifiers ?? []).includes("aura") && auraAudience(sys) === "foe";
}

/** True if this effect's rules should currently apply to its actor (equip + Action-Type gating). */
function effectIsLive(effect) {
  const parent = effect?.parent;
  if (typeof Item !== "undefined" && parent instanceof Item) {
    // An effect owned by an equippable item only applies while that item is equipped.
    if (EQUIP_GATED.has(parent.type)) return !!parent.system?.equipped;
    // An ENEMY aura's Effect is projected onto enemies, never the bearer — keep it dormant here.
    if (isEnemyAura(parent)) return false;
    // A Skill's effect applies passively (always-on) ONLY if the Skill is a Passive.
    // Action / React Skill effects stay dormant here — they're applied ON USE as a copy
    // on the recipient (see dice.mjs). That copy is parented to the actor, not this Skill,
    // so it isn't re-gated by this branch.
    if (parent.type === "skill") {
      if (parent.system?.actionType !== "passive") return false;
      // A Manifest-bound Passive (rules: Manifest Modifier) is dormant except while its
      // carrier runs — the carrier's use stamps a duration marker on the actor (dice.mjs
      // ensureManifestMarker); the marker's expiry puts the Passive back to sleep (and its
      // energy lock returns — item-models.mjs).
      if (parent.system?.manifestedBy) {
        return (parent.actor?.effects ?? []).some((e) =>
          !e.disabled && e.flags?.[FLAG_SCOPE]?.manifestSkillId === parent.id);
      }
      return true;
    }
  }
  return true;
}

/** True if the effect is a player-flippable toggle (shows an on-sheet switch). */
function isToggleEffect(effect) {
  return !!effect?.flags?.[FLAG_SCOPE]?.toggle;
}

/** Current on/off state of an effect's toggle for an actor (stored on the actor). */
function toggleState(actor, effect) {
  return !!actor?.flags?.[FLAG_SCOPE]?.toggles?.[effect?.id];
}

/** Whether an effect currently contributes: equipped (effectIsLive) AND, if it's a
 *  toggle, switched on. The single gate used by both the passive and roll-time paths. */
function effectGateOpen(actor, effect) {
  if (!effectIsLive(effect)) return false;
  if (isToggleEffect(effect) && !toggleState(actor, effect)) return false;
  return true;
}

/** The actor's toggleable live effects, for the on-sheet toggle bar.
 *  @returns {{id:string, label:string, img:string, on:boolean}[]} */
export function collectToggles(actor) {
  const out = [];
  let effects;
  try { effects = actor?.appliedEffects ?? []; } catch (_) { return out; }
  for (const effect of effects) {
    if (!effectIsLive(effect) || !isToggleEffect(effect)) continue;
    out.push({ id: effect.id, label: effect.name, img: effect.img, on: toggleState(actor, effect), effect });
  }
  return out;
}

/**
 * The actor's currently-LIVE effects — the exact set the passive engine applies: enabled
 * (in `appliedEffects`) AND gate-open (equipped if the carrier is equippable, and toggled
 * on if it's a toggle effect). Used by the floating Effects Panel so it shows only what's
 * truly affecting the actor, never the dormant effects of unequipped gear.
 * @returns {ActiveEffect[]}
 */
export function liveEffects(actor) {
  let effects;
  try { effects = actor?.appliedEffects ?? []; } catch (_) { return []; }
  return effects.filter((effect) => effectGateOpen(actor, effect));
}

/** Icons that count as "no real icon chosen" — an effect wearing one of these inherits the icon of
 *  whatever applied it. `aura.svg` is the default new-effect icon; `upgrade.svg` is the default Skill
 *  icon (DEFAULT_SKILL_IMG in skill-builder.mjs). */
const GENERIC_EFFECT_ICONS = new Set(["", "icons/svg/aura.svg", "icons/svg/upgrade.svg"]);

/**
 * Build a duration-stamped copy object of an effect: its `_id` stripped and any duration
 * restarted from now (world-time + combat round/turn) so it counts down from application.
 * Shared by drag-on (applyEffectCopy) and the on-use Skill-effect application in dice.mjs
 * (which may relay the object to the GM to create on an unowned target). `sourceImg` is the
 * icon of whatever applied it (Skill/weapon), stamped on when the effect has no custom icon.
 */
export function effectCopyData(effect, sourceImg = null) {
  const obj = effect.toObject();
  delete obj._id;
  // Effects wear the icon of whatever applied them: if the copy still has a generic icon (the
  // default new-effect aura, the default Skill arrow `upgrade.svg`, or none), stamp it with the
  // source item's icon — the Skill, or the borrowed weapon for a Weapon-range Skill. A
  // deliberately-chosen custom icon (anything else) is preserved untouched.
  const src = sourceImg || effect.parent?.img || "";
  if (src && GENERIC_EFFECT_ICONS.has(obj.img ?? "")) obj.img = src;
  // v13 only: restart the countdown's anchors. v14 durations are `{value, units}` with no
  // start fields — a fresh copy anchors itself at creation.
  const d = obj.duration;
  if (!durationV14() && d && (d.rounds || d.turns || d.seconds)) {
    d.startTime = game.time?.worldTime ?? 0;
    if (game.combat) { d.startRound = game.combat.round ?? 0; d.startTurn = game.combat.turn ?? 0; }
  }
  return obj;
}

/**
 * Apply a COPY of an effect onto an actor (drag-on). Strips the source id and re-stamps
 * any duration so it counts down from now. No-op if the effect already lives on the actor.
 */
export async function applyEffectCopy(actor, effect) {
  if (!actor || !effect || effect.parent === actor) return null;
  return actor.createEmbeddedDocuments("ActiveEffect", [effectCopyData(effect)]);
}

/* -------------------------------------------- */
/*  Passive application (called from prepare)   */
/* -------------------------------------------- */

/** Apply one passive rule by mutating the actor's in-memory system data. */
function applyPassiveRule(system, rule) {
  switch (rule?.type) {
    case "attribute": {
      const attr = system.attributes?.[rule.key];
      if (!attr) return;
      const dir = rule.mode === "hinder" ? -1 : 1;
      // Each die step is 2 (d4→d6→…→d12); clamp to a legal die happens in prepareDerivedData.
      attr.value += dir * 2 * (Math.abs(Math.round(Number(rule.steps) || 0)));
      return;
    }
    case "stat": {
      const stat = system[rule.key];
      if (stat && typeof stat === "object" && "bonus" in stat) stat.bonus += Math.round(Number(rule.value) || 0);
      return;
    }
    case "resource": {
      const res = system[rule.target];
      if (res && typeof res === "object" && "max" in res) res.max += Math.round(Number(rule.value) || 0);
      return;
    }
  }
}

/** Evaluate a rule's optional predicate. `target` may be null (passive context — where
 *  target* predicates simply don't pass). */
function predicatePasses(pred, actor, target = null) {
  if (!pred || !pred.type || pred.type === "always") return true;
  switch (pred.type) {
    case "selfCondition": return !!actor?.statuses?.has?.(pred.status);
    case "hpBelow": { const hp = actor?.system?.hp; return hp?.max > 0 && (hp.value / hp.max) * 100 <= pred.pct; }
    case "energyBelow": { const en = actor?.system?.energy; return en?.max > 0 && (en.value / en.max) * 100 <= pred.pct; }
    case "targetCondition": return !!target?.statuses?.has?.(pred.status);
    default: return true;
  }
}

/**
 * Apply every live effect's passive rules to the actor. Called from
 * `ProjectAnimeActor#applyActiveEffects()` — i.e. between prepareBaseData and
 * prepareDerivedData. PURE: mutates `actor.system` in place, never persists.
 */
export function applyStructuredRules(actor) {
  let effects;
  try {
    effects = actor.appliedEffects; // active (non-disabled, non-suppressed) effects, item-transferred included
  } catch (_) {
    return;
  }
  const system = actor.system;
  if (!system) return;
  for (const effect of effects) {
    if (!effectGateOpen(actor, effect)) continue;
    for (const rule of effectRules(effect)) {
      if (!predicatePasses(rule.pred, actor, null)) continue;
      if (rule?.type === "condition") {
        // Self-scope conditions add their status to the wearer (equip-gated by effectIsLive);
        // target-scope conditions are inflicted on hit in dice.mjs, not here.
        if (rule.scope !== "target" && rule.status) actor.statuses?.add?.(rule.status);
      } else {
        applyPassiveRule(system, rule);
      }
    }
  }
  // PASSIVE Bolster/Hinder Skills bake their attribute change into the owner always-on — they don't
  // go through the on-use copy path (applySkillEffects skips Passives). Applied in-memory (no AE doc),
  // like any other passive rule. Skipped if the Skill authored its own attribute effect. Passive
  // Modifier rules (Protection — skillModifierRules) ride the same loop.
  for (const item of actor.items ?? []) {
    if (item.type !== "skill" || item.system?.actionType !== "passive") continue;
    if (isEnemyAura(item)) continue;                 // an enemy aura never buffs/debuffs its bearer
    for (const rule of skillModifierRules(item)) applyPassiveRule(system, rule);
    if (hasAuthoredAttributeEffect(item)) continue;
    for (const mode of skillEffectKeys(item.system)) {
      for (const rule of bolsterHinderRules(item, mode)) applyPassiveRule(system, rule);
    }
  }
}

/* -------------------------------------------- */
/*  Roll-time application (called from dice.mjs)*/
/* -------------------------------------------- */

/** Does a stored roll rule's selector apply to the queried roll? A "check" rule
 *  applies to plain Checks AND attacks; an "attack" rule only to attacks; "damage"
 *  only to damage rolls. */
function rollRuleApplies(ruleSelector, query) {
  if (query === "damage") return ruleSelector === "damage";
  if (query === "attack") return ruleSelector === "check" || ruleSelector === "attack";
  return ruleSelector === "check";
}

/** Would any of an effect's rules actually change a roll of this context? Used to show only the
 *  RELEVANT player toggles in the roll dialog (a non-combat-Check Might bonus is hidden on an attack,
 *  and on an Agility+Charm Check). `ctx` = {selector: "check"|"attack"|"damage", attrA, attrB}. A
 *  `roll` rule matches by selector; `ncCheck` only on Checks and only when the rolled Attribute
 *  matches; an `attribute` die-step when its Attribute is rolled; `weaponMod` on attacks. Effects
 *  carrying only off-roll rules (sustain, stat, resource, …) are never relevant, so their toggle
 *  stays out of the roll dialog (it still lives in the Effects tab). */
export function effectAffectsRoll(effect, { selector = "check", attrA = null, attrB = null } = {}) {
  for (const rule of effectRules(effect)) {
    switch (rule?.type) {
      case "roll": if (rollRuleApplies(rule.selector, selector)) return true; break;
      case "ncCheck": if (selector === "check" && (rule.key === attrA || rule.key === attrB)) return true; break;
      case "attribute": if (rule.key === attrA || rule.key === attrB) return true; break;
      case "weaponMod": if (selector === "attack") return true; break;
    }
  }
  return false;
}

/**
 * Sum the flat roll modifiers an actor's live effects grant to a roll. Read-only —
 * safe at roll time. `selector` is "check" | "attack" | "damage".
 * @returns {{flat:number, sources:{name:string, value:number}[]}}
 */
export function collectRollModifiers(actor, selector, { target = null } = {}) {
  const out = { flat: 0, sources: [] };
  let effects;
  try { effects = actor?.appliedEffects ?? []; } catch (_) { return out; }
  for (const effect of effects) {
    if (!effectGateOpen(actor, effect)) continue;
    for (const rule of effectRules(effect)) {
      if (rule?.type !== "roll" || !rollRuleApplies(rule.selector, selector)) continue;
      if (!predicatePasses(rule.pred, actor, target)) continue;
      const v = Math.round(Number(rule.value) || 0);
      if (!v) continue;
      out.flat += v;
      out.sources.push({ name: effect.name, value: v });
    }
  }
  return out;
}

/**
 * The Attribute improvements an actor's live effects grant to ONE non-combat Check — the two-die
 * Check/Test in dice.mjs performCheck, NEVER attacks / skills / damage (which is why this is its
 * own collector instead of an `attribute`/`roll` rule: those leak into combat). `attrA`/`attrB` are
 * the Attributes the Check rolls. Each live `ncCheck` rule whose Attribute matches a rolled die
 * contributes either die Steps (to that specific die — both, if the Check rolls the Attribute twice)
 * or a flat bonus to the total. Equip-/toggle-/self-predicate-gated like the sibling collectors
 * (no target context in a Check). Read at check time.
 * @returns {{stepsA:number, stepsB:number, flat:number, sources:{name:string, label:string}[]}}
 */
export function collectNonCombatCheckMods(actor, attrA, attrB) {
  const out = { stepsA: 0, stepsB: 0, flat: 0, sources: [] };
  let effects;
  try { effects = actor?.appliedEffects ?? []; } catch (_) { return out; }
  for (const effect of effects) {
    if (!effectGateOpen(actor, effect)) continue;
    for (const rule of effectRules(effect)) {
      if (rule?.type !== "ncCheck") continue;
      if (!predicatePasses(rule.pred, actor, null)) continue;
      const v = Math.round(Number(rule.value) || 0);
      if (!v) continue;
      const hitA = rule.key === attrA;
      const hitB = rule.key === attrB;
      if (!hitA && !hitB) continue;
      const attr = game.i18n.localize(PROJECTANIME.attributes[rule.key] ?? "") || rule.key;
      if (rule.mode === "step") {
        if (hitA) out.stepsA += v;
        if (hitB) out.stepsB += v;
        const n = Math.abs(v);
        out.sources.push({ name: effect.name, label: `${attr} ${v > 0 ? "+" : "−"}${n} ${n === 1 ? "step" : "steps"}` });
      } else {
        out.flat += v;
        out.sources.push({ name: effect.name, label: `${attr} ${v > 0 ? "+" : ""}${v}` });
      }
    }
  }
  return out;
}

/** Does a `skillMod` rule's scope apply to THIS cast? `item` is the Skill being used. `skill` =
 *  any Skill; a Modifier-key scope reads the SKILL's own modifier list. (Weapon/unarmed scopes are
 *  now `weaponMod` — see weaponModScopeApplies.) */
function skillModScopeApplies(scope, item) {
  if (scope === "skill") return item?.type === "skill";
  // A Skill Modifier key (burst, pierce, …): the acting Skill must carry it.
  return item?.type === "skill" && (item.system?.modifiers ?? []).includes(scope);
}

/** Does a `weaponMod` rule apply to THIS attack? `src` is the weapon actually rolled (the borrowed
 *  weapon for a Weapon-range Skill, else the item itself). `any` = any weapon/shield attack;
 *  `unarmed` = the Natural-Attack weapon; `type` = a weapon whose base Type matches `typeName`
 *  (case-insensitive, trimmed). */
function weaponModScopeApplies(scope, typeName, src) {
  const isWeapon = src?.type === "weapon" || src?.type === "shield";
  if (scope === "any") return isWeapon || !!src?.getFlag?.(FLAG_SCOPE, "natural");
  if (scope === "unarmed") return !!src?.getFlag?.(FLAG_SCOPE, "natural");
  if (scope === "type") {
    const want = String(typeName ?? "").trim().toLowerCase();
    if (!want || !isWeapon) return false;
    return String(src.system?.weaponType ?? "").trim().toLowerCase() === want;
  }
  return false;
}

/**
 * Sum the Modifier-scoped Skill adjustments (`skillMod` rules) the actor's live effects grant to ONE
 * cast: a flat ±damage baked into the rolled output and a ±delta to the Energy cost (signed —
 * −1 = cheaper). `item` is the Skill being used. Equip-/toggle-/predicate-gated like the sibling
 * collectors. Read at use time from dice.mjs (computeDamageRoll + spendSkillEnergy). Weapon/unarmed
 * adjustments are NOW `weaponMod` (collectWeaponModBonuses) — legacy weapon-scoped skillMod rules
 * are skipped here (skillModScopeApplies rejects them) and honoured there instead.
 * @returns {{damage:number, energy:number, sources:{name:string, value:number}[]}}
 */
export function collectSkillModBonuses(actor, item, { target = null } = {}) {
  const out = { damage: 0, energy: 0, sources: [] };
  if (!actor || !item) return out;
  let effects;
  try { effects = actor.appliedEffects ?? []; } catch (_) { return out; }
  for (const effect of effects) {
    if (!effectGateOpen(actor, effect)) continue;
    for (const rule of effectRules(effect)) {
      if (rule?.type !== "skillMod" || !skillModScopeApplies(rule.scope, item)) continue;
      if (!predicatePasses(rule.pred, actor, target)) continue;
      const d = Math.round(Number(rule.damage) || 0);
      const e = Math.round(Number(rule.energy) || 0);
      if (!d && !e) continue;
      out.damage += d;
      out.energy += e;
      if (d) out.sources.push({ name: effect.name, value: d });
    }
  }
  return out;
}

/**
 * Sum the Weapon Adjustments (`weaponMod` rules) the actor's live effects grant to ONE weapon
 * attack: a flat ±Attack (accuracy) and ±Damage. `item` is the Skill/weapon used; `src` is the
 * weapon actually rolled (the borrowed weapon for a Weapon-range Skill, else `item`) and is what
 * scope matching reads. Equip-/toggle-/predicate-gated like the sibling collectors. Read at use
 * time from dice.mjs (rollAttack + the Skill accuracy path for Attack; computeDamageRoll for
 * Damage). Also honours LEGACY weapon/unarmed-scoped `skillMod` rules (damage only) so pre-split
 * stored effects keep working until re-saved.
 * @returns {{attack:number, damage:number, attackSources:{name,value}[], damageSources:{name,value}[]}}
 */
export function collectWeaponModBonuses(actor, item, { src = null, target = null } = {}) {
  const out = { attack: 0, damage: 0, attackSources: [], damageSources: [] };
  if (!actor) return out;
  const weapon = src ?? item;
  if (!weapon) return out;
  let effects;
  try { effects = actor.appliedEffects ?? []; } catch (_) { return out; }
  for (const effect of effects) {
    if (!effectGateOpen(actor, effect)) continue;
    for (const rule of effectRules(effect)) {
      let scope, typeName, atk, dmg;
      if (rule?.type === "weaponMod") {
        scope = rule.scope; typeName = rule.typeName;
        atk = Math.round(Number(rule.attack) || 0);
        dmg = Math.round(Number(rule.damage) || 0);
      } else if (rule?.type === "skillMod" && (rule.scope === "weapon" || rule.scope === "unarmed")) {
        // Legacy un-migrated skillMod: weapon/unarmed scope, damage only.
        scope = rule.scope === "weapon" ? "any" : "unarmed"; typeName = "";
        atk = 0; dmg = Math.round(Number(rule.damage) || 0);
      } else continue;
      if (!weaponModScopeApplies(scope, typeName, weapon)) continue;
      if (!predicatePasses(rule.pred, actor, target)) continue;
      if (!atk && !dmg) continue;
      out.attack += atk;
      out.damage += dmg;
      if (atk) out.attackSources.push({ name: effect.name, value: atk });
      if (dmg) out.damageSources.push({ name: effect.name, value: dmg });
    }
  }
  return out;
}

/** Die-size ladder for stepping a die up (d4→d6→…→d12). */
const DIE_SIZES = [4, 6, 8, 10, 12];

/** Step a die size up `steps` rungs on the d4–d12 ladder (capped at d12). An off-ladder
 *  value (shouldn't happen for a clamped attribute) is returned unchanged. */
export function stepUpDie(value, steps = 1) {
  const i = DIE_SIZES.indexOf(Number(value));
  if (i < 0) return Number(value) || 4;
  return DIE_SIZES[Math.min(DIE_SIZES.length - 1, i + Math.max(0, Math.round(Number(steps) || 0)))];
}

/**
 * Total Luck-die tune steps an actor's live effects grant (e.g. a Lucky Pendant). Read AFTER
 * Luck Dice are restored — a rest, a Go-Again's restored die — to let the bearer raise or lower
 * one held Luck Die by this many (rules: Accessories — Lucky Pendant). 0 = no tuning. Equip-gated
 * + toggle-gated like the other collectors; self-predicates apply (there's no target).
 */
export function collectLuckTunes(actor) {
  let steps = 0;
  let effects;
  try { effects = actor?.appliedEffects ?? []; } catch (_) { return 0; }
  for (const effect of effects) {
    if (!effectGateOpen(actor, effect)) continue;
    for (const rule of effectRules(effect)) {
      if (rule?.type !== "luck") continue;
      if (!predicatePasses(rule.pred, actor, null)) continue;
      steps += Math.max(1, Math.round(Number(rule.steps) || 1));
    }
  }
  return steps;
}

/**
 * The per-turn pool regeneration an actor's live effects grant — the "Sustain" total, summed across
 * every live `sustain` rule (authored effects on gear / skills / drag-ons / aura projections) PLUS
 * the Regen status. Equip-gated + toggle-gated + self-predicate-gated like the other collectors.
 * Read at the combat turn-tick (project-anime.mjs); the caller gates whether the actor may regen at
 * all (e.g. not while defeated) and clamps to each pool's max.
 * @returns {{hp:number, energy:number}}
 */
export function collectSustain(actor) {
  const gains = { hp: 0, energy: 0 };
  const add = (rule) => {
    const v = Math.max(0, Math.round(Number(rule.value) || 0));
    if (v > 0) gains[rule.pool === "energy" ? "energy" : "hp"] += v;
  };
  let effects;
  try { effects = actor?.appliedEffects ?? []; } catch (_) { effects = []; }
  for (const effect of effects) {
    if (!effectGateOpen(actor, effect)) continue;
    for (const rule of effectRules(effect)) {
      if (rule?.type !== "sustain" || !predicatePasses(rule.pred, actor, null)) continue;
      add(rule);
    }
    // A Skill effect that GRANTS the Regen status heals the bearer the Skill's Rank × 2 each turn
    // (rules: Sustain) — the value rides the granting effect's `regenValue` flag (dice.mjs
    // applySkillEffects), folded in like a sustain rule and gone the moment the effect expires.
    const rv = effect.flags?.["project-anime"]?.regenValue;
    if (rv) add(rv);
  }
  // The Regen STATUS (rules v0.01, beneficial): the bearer regains its value into the chosen
  // pool at the start of each turn — the value rides flags.project-anime.regen (stamped by
  // dice.mjs applyStatusTo when the status is inflicted), folded in like any other sustain.
  if (actor?.statuses?.has?.("regen")) {
    const regen = actor.getFlag?.("project-anime", "regen") ?? {};
    for (const pool of ["hp", "energy"]) add({ pool, value: Number(regen[pool]) || 0 });
  }
  return gains;
}

/**
 * The Retaliation wards currently live on a creature — read reactively when a foe damages it
 * (dice.mjs applyRetaliation) so the foe takes the warded value. Mirrors
 * collectSustain: an active/aura Retaliation rides an applied effect copy carrying its rule (the
 * `skillModifierRules` bundle), while a PASSIVE Retaliation Skill protects its bearer always-on
 * (no copy is made — the in-memory engine ignores the rule, so its ward is read straight off the
 * bearer's own passive Skill here). Equip-/toggle-/predicate-gated like the other collectors.
 * @returns {{value:number, drain:string|null}[]} one entry per live ward (they stack); `drain`
 *   is the pool a Drain on the warding Technique clears on the bearer when the ward stings.
 */
export function collectRetaliation(actor) {
  const out = [];
  const add = (rule) => {
    const value = Math.max(0, Math.round(Number(rule.value) || 0));
    if (value > 0) out.push({ value, drain: rule.drain === "energy" || rule.drain === "hp" ? rule.drain : null });
  };
  let effects;
  try { effects = actor?.appliedEffects ?? []; } catch (_) { effects = []; }
  for (const effect of effects) {
    if (!effectGateOpen(actor, effect)) continue;
    for (const rule of effectRules(effect)) {
      if (rule?.type !== "retaliation" || !predicatePasses(rule.pred, actor, null)) continue;
      add(rule);
    }
  }
  // A passive Retaliation-modifier Skill wards its bearer (the in-memory path grants no copy).
  for (const item of actor?.items ?? []) {
    if (item.type !== "skill" || item.system?.actionType !== "passive") continue;
    if (isEnemyAura(item)) continue;             // an enemy aura's ward projects onto enemies, not the bearer
    for (const rule of skillModifierRules(item)) {
      if (rule.type === "retaliation") add(rule);
    }
  }
  return out;
}

/**
 * The set of reveal categories a VIEWER currently unlocks (their Scouter). Read at token
 * hover / dossier time to decide which extra layers a non-owner may see. Equip-gated +
 * toggle-gated like the other collectors; self-predicates apply (no target context here).
 * @returns {Set<string>} category ids from REVEAL_CATEGORIES
 */
export function collectReveals(actor) {
  const set = new Set();
  let effects;
  try { effects = actor?.appliedEffects ?? []; } catch (_) { return set; }
  for (const effect of effects) {
    if (!effectGateOpen(actor, effect)) continue;
    for (const rule of effectRules(effect)) {
      if (rule?.type !== "reveal") continue;
      // Skill Points are gone (V2) — a stored SP reveal folds to its nearest analog, Guard.
      const cat = rule.category === "skillPoints" ? "guard" : rule.category;
      if (!(cat in REVEAL_CATEGORIES)) continue;
      if (!predicatePasses(rule.pred, actor, null)) continue;
      set.add(cat);
    }
  }
  return set;
}

/** Base percents of an item's list price for trade (the rules' defaults): you recover half
 *  (50%) when selling and pay full (100%) when buying. `trade` effects shift these — e.g. a
 *  Trader's Pass is sell +10 (→ 60%); a haggler's discount is buy −10 (→ 90%). */
export const BASE_SELL_PCT = 50;
export const BASE_BUY_PCT = 100;

/**
 * The actor's effective trade rates, as percents of an item's list price (Gold): `sell` =
 * how much you recover on sale (from BASE_SELL_PCT), `buy` = how much you pay to purchase
 * (from BASE_BUY_PCT). Each live `trade` effect adds its percentage points to its target.
 * Equip-gated + toggle-gated like the other collectors; self-predicates apply (no target at
 * prepare time). `sell` clamps to [0, 100]; `buy` to [0, 1000]. Read in prepareDerivedData.
 * NOTE: these are display values only — buying & selling themselves aren't yet mechanized.
 */
export function collectTradeRates(actor) {
  let sell = BASE_SELL_PCT;
  let buy = BASE_BUY_PCT;
  let effects;
  try { effects = actor?.appliedEffects ?? []; } catch (_) { return { sell, buy }; }
  for (const effect of effects) {
    if (!effectGateOpen(actor, effect)) continue;
    for (const rule of effectRules(effect)) {
      if (rule?.type !== "trade") continue;
      if (!predicatePasses(rule.pred, actor, null)) continue;
      const pct = Math.round(Number(rule.pct) || 0);
      if (rule.target === "buy") buy += pct; else sell += pct;
    }
  }
  return { sell: Math.max(0, Math.min(100, sell)), buy: Math.max(0, Math.min(1000, buy)) };
}

/**
 * The conditions a USED item (weapon/skill) inflicts on a struck target — its OWN
 * effects' target-scope condition rules (skips disabled effects). The inflict lives on
 * the item that strikes, by design. Applied on hit by dice.mjs.
 * @returns {{id:string, label:string}[]}
 */
export function collectInflictedConditions(item, target = null) {
  const out = [];
  const actor = item?.actor ?? null;
  for (const effect of item?.effects ?? []) {
    if (effect.disabled) continue;
    // Respect a toggle on the weapon/skill effect (off → no inflict).
    if (actor && isToggleEffect(effect) && !toggleState(actor, effect)) continue;
    for (const rule of effectRules(effect)) {
      if (rule?.type === "condition" && rule.scope === "target" && rule.status) {
        if (!predicatePasses(rule.pred, actor, target)) continue;
        out.push({ id: rule.status, label: conditionLabelOf(rule.status) });
      }
    }
  }
  // A Hinder Skill's chosen Statuses are inflicted on the same hit (built-in, no authored effect needed).
  const seen = new Set(out.map((c) => c.id));
  for (const id of hinderStatusIds(item)) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: conditionLabelOf(id) });
  }
  // The Inflict Modifier's chosen Status (its Builder selector). Lingering is EXCLUDED here — it
  // routes through the dedicated path (dice.mjs inflictDecay) for its own timer/immunity handling.
  if (item?.type === "skill" && (item.system?.modifiers ?? []).includes("inflict")) {
    const id = item.system.inflictStatus;
    if (id && id !== "decay" && (PROJECTANIME.conditionKeys ?? []).includes(id) && !seen.has(id)) {
      seen.add(id);
      out.push({ id, label: conditionLabelOf(id) });
    }
  }
  // Inflict (Severe) 🔶 — Bound / Cursed / Exposed / Sealed (its own Builder selector).
  if (item?.type === "skill" && (item.system?.modifiers ?? []).includes("inflictSevere")) {
    const id = item.system.inflictSevereStatus;
    if (id && (PROJECTANIME.conditionKeys ?? []).includes(id) && !seen.has(id)) {
      out.push({ id, label: conditionLabelOf(id) });
    }
  }
  return out;
}

/**
 * The set of Status Effect ids the actor is currently IMMUNE to — gathered from every live `immunity`
 * rule on its applied effects (equip- + toggle- + gate-gated, exactly like the passive engine). An
 * immune creature shrugs off any attempt to inflict that status (see dice.mjs applyConditionFromItem /
 * inflictDecay). Self-only: immunity never reaches across to a target, so there's no scope field.
 * @returns {Set<string>}
 */
export function statusImmunities(actor) {
  const out = new Set();
  for (const effect of liveEffects(actor)) {
    for (const rule of effectRules(effect)) {
      if (rule?.type === "immunity" && rule.status) out.add(rule.status);
    }
  }
  // The Immunity Modifier (v0.03, status kind) on a PASSIVE Skill guards its bearer always-on —
  // active/aura deliveries ride applied copies (skillModifierRules), read by the loop above.
  for (const item of actor?.items ?? []) {
    if (item.type !== "skill" || item.system?.actionType !== "passive") continue;
    if (isEnemyAura(item)) continue;
    for (const rule of skillModifierRules(item)) {
      if (rule?.type === "immunity" && rule.status) out.add(rule.status);
    }
  }
  return out;
}

/**
 * The set of Status Effect ids the actor currently RESISTS (v0.03 Affinity (Status): the
 * duration of the chosen Status is HALVED when inflicted). Gathered exactly like
 * statusImmunities — live `statusResist` rules on applied effects, plus passive Skills
 * carrying the Affinity (Status) Modifier. Consulted at inflict time (dice.mjs).
 * @returns {Set<string>}
 */
export function statusResists(actor) {
  const out = new Set();
  for (const effect of liveEffects(actor)) {
    for (const rule of effectRules(effect)) {
      if (rule?.type === "statusResist" && rule.status) out.add(rule.status);
    }
  }
  for (const item of actor?.items ?? []) {
    if (item.type !== "skill" || item.system?.actionType !== "passive") continue;
    if (isEnemyAura(item)) continue;
    for (const rule of skillModifierRules(item)) {
      if (rule?.type === "statusResist" && rule.status) out.add(rule.status);
    }
  }
  return out;
}

/* -------------------------------------------- */
/*  Grant Item (event-driven — NOT a passive rule)*/
/* -------------------------------------------- */
/* A "grant" rule creates real embedded Items, which the pure prepare engine can't do
 * (it never persists). So grants are reconciled on document events (carrier create /
 * delete / effect change) by the helpers below, wired up in project-anime.mjs. */

/** Source UUIDs an item's ENABLED effects grant (from "grant" rules). May contain repeats. */
export function grantRefs(item) {
  const out = [];
  for (const effect of item?.effects ?? []) {
    if (effect.disabled) continue;
    for (const rule of effectRules(effect)) {
      if (rule?.type === "grant") for (const it of rule.items ?? []) if (it?.uuid) out.push(it.uuid);
    }
  }
  return out;
}

/** True if the item carries ANY grant rule (enabled or not) — i.e. it's a grant carrier
 *  worth reconciling, so disabling/removing a grant still cleans up its granted children. */
export function itemHasGrantRule(item) {
  for (const effect of item?.effects ?? [])
    for (const rule of effectRules(effect)) if (rule?.type === "grant") return true;
  return false;
}

/** Re-entrancy guard so a carrier's create + its embedded-effect create don't double-grant. */
const grantSyncing = new Set();

/**
 * Reconcile an owned carrier item's granted children against its current grant rules:
 * create the Items it should now grant (stamped free + provenance) and delete the ones it
 * no longer should. Idempotent. The `granted` flag means the grant never charges Skill
 * Points (free against the budget) — yet a granted Skill still counts toward the Total via
 * its spCost. Dynamic link: removing or disabling a grant removes its children. No-op
 * off-actor. Run only by the user who triggered the change (they own/can-edit the actor).
 */
export async function syncGrants(item) {
  const actor = item?.actor;
  if (!actor || grantSyncing.has(item.id)) return;
  grantSyncing.add(item.id);
  try {
    const desired = new Set(grantRefs(item));
    const children = actor.items.filter((i) => i.getFlag(FLAG_SCOPE, "grantedBy") === item.id);
    const present = new Set(children.map((c) => c.getFlag(FLAG_SCOPE, "grantSource")));

    const toDelete = children
      .filter((c) => !desired.has(c.getFlag(FLAG_SCOPE, "grantSource")))
      .map((c) => c.id);

    const toCreate = [];
    for (const uuid of desired) {
      if (present.has(uuid)) continue;
      let src = null;
      try { src = await fromUuid(uuid); } catch (_) { /* unresolved ref — skip */ }
      if (!src || src.documentName !== "Item") continue;
      const data = src.toObject();
      delete data._id;
      delete data.folder;
      foundry.utils.setProperty(data, `flags.${FLAG_SCOPE}.granted`, true);
      foundry.utils.setProperty(data, `flags.${FLAG_SCOPE}.grantedBy`, item.id);
      foundry.utils.setProperty(data, `flags.${FLAG_SCOPE}.grantSource`, uuid);
      stampCompendiumSource(data, src);
      toCreate.push(data);
    }

    if (toDelete.length) await actor.deleteEmbeddedDocuments("Item", toDelete);
    if (toCreate.length) await actor.createEmbeddedDocuments("Item", toCreate);
  } finally {
    grantSyncing.delete(item.id);
  }
}

/** Delete every Item on `actor` granted by the carrier with id `carrierId` (carrier removed). */
export async function removeGrants(actor, carrierId) {
  if (!actor?.items) return;
  const ids = actor.items.filter((i) => i.getFlag(FLAG_SCOPE, "grantedBy") === carrierId).map((i) => i.id);
  if (ids.length) await actor.deleteEmbeddedDocuments("Item", ids);
}

/* -------------------------------------------- */
/*  Human-readable summaries (for the sheets)   */
/* -------------------------------------------- */

const L = (k) => (k ? game.i18n.localize(k) : "");
const signed = (n) => { const v = Math.round(Number(n) || 0); return v >= 0 ? `+${v}` : `${v}`; };

/** Localized label for a `skillMod` rule's scope (`skill` or a Skill Modifier key). Tolerates the
 *  legacy weapon/unarmed scopes (still reachable on un-migrated stored rules) via the shared keys. */
function skillModScopeLabel(scope) {
  if (scope in SKILLMOD_SCOPES) return L(SKILLMOD_SCOPES[scope]);
  if (scope === "weapon" || scope === "unarmed") return L(`PROJECTANIME.Effect.modScope.${scope}`);
  return L(PROJECTANIME.skillModifiers[scope]) || scope;
}

/** Localized label for a `weaponMod` rule's scope — the typed weapon Type when scoped "By type". */
function weaponModScopeLabel(scope, typeName) {
  if (scope === "type") return String(typeName ?? "").trim() || L(WEAPONMOD_SCOPES.type);
  return L(WEAPONMOD_SCOPES[scope]) || scope;
}

/** A short, localized one-line summary of a single rule (for chips on the sheets). */
export function summarizeRule(rule) {
  switch (rule?.type) {
    case "attribute": {
      const attr = L(PROJECTANIME.attributes[rule.key]) || rule.key;
      const verb = L(ATTRIBUTE_MODES[rule.mode === "hinder" ? "hinder" : "bolster"]);
      const steps = Math.max(1, Math.round(Number(rule.steps) || 1));
      return steps > 1 ? `${verb} ${attr} (${steps})` : `${verb} ${attr}`;
    }
    case "stat":
      return `${signed(rule.value)} ${L(STAT_TARGETS[rule.key]) || rule.key}`;
    case "retaliation": {
      const n = Math.max(0, Math.round(Number(rule.value) || 0));
      const head = L("PROJECTANIME.Skill.modifier.retaliation");
      return `${head} ${n}`;
    }
    case "resource":
      return `${signed(rule.value)} ${L(RESOURCE_TARGETS[rule.target]) || rule.target}`;
    case "sustain":
      return `+${Math.max(0, Math.round(Number(rule.value) || 0))} ${L(SUSTAIN_POOLS[rule.pool]) || rule.pool}/${L("PROJECTANIME.Effect.turn")}`;
    case "roll":
      return `${signed(rule.value)} ${L(ROLL_SELECTORS[rule.selector]) || rule.selector}`;
    case "ncCheck": {
      const attr = L(PROJECTANIME.attributes[rule.key]) || rule.key;
      const v = Math.round(Number(rule.value) || 0);
      const tag = L("PROJECTANIME.Effect.ncCheckTag");
      if (rule.mode === "step") {
        const n = Math.abs(v);
        return `${attr} ${v >= 0 ? "+" : "−"}${n} ${n === 1 ? "step" : "steps"} · ${tag}`;
      }
      return `${signed(v)} ${attr} · ${tag}`;
    }
    case "luck": {
      const steps = Math.max(1, Math.round(Number(rule.steps) || 1));
      return `${L("PROJECTANIME.Effect.luckTune")}${steps}`;
    }
    case "trade":
      return `${signed(rule.pct)}% ${L(TRADE_TARGETS[rule.target === "buy" ? "buy" : "sell"])}`;
    case "condition":
      return rule.scope === "target"
        ? `${L("PROJECTANIME.Effect.inflict")} ${conditionLabelOf(rule.status)}`
        : conditionLabelOf(rule.status);
    case "immunity":
      return `${L("PROJECTANIME.Effect.immuneTo")} ${conditionLabelOf(rule.status)}`;
    case "reveal":
      return `${L(RULE_TYPES.reveal)} ${L(REVEAL_CATEGORIES[rule.category]) || rule.category}`;
    case "grant": {
      const items = Array.isArray(rule.items) ? rule.items : [];
      const names = items.map((i) => i?.name).filter(Boolean);
      const head = L("PROJECTANIME.Effect.grant");
      return names.length ? `${head}: ${names.join(", ")}` : head;
    }
    case "skillMod": {
      const parts = [];
      if (rule.damage) parts.push(`${signed(rule.damage)} ${L("PROJECTANIME.Effect.skillModDmg")}`);
      if (rule.energy) parts.push(`${signed(rule.energy)} ${L("PROJECTANIME.Effect.skillModEnergy")}`);
      const label = skillModScopeLabel(rule.scope);
      return parts.length ? `${label}: ${parts.join(" · ")}` : label;
    }
    case "weaponMod": {
      const parts = [];
      if (rule.attack) parts.push(`${signed(rule.attack)} ${L("PROJECTANIME.Effect.weaponModAtk")}`);
      if (rule.damage) parts.push(`${signed(rule.damage)} ${L("PROJECTANIME.Effect.weaponModDmg")}`);
      const label = weaponModScopeLabel(rule.scope, rule.typeName);
      return parts.length ? `${label}: ${parts.join(" · ")}` : label;
    }
    default:
      return "";
  }
}

/** All of an effect's rules summarized as short strings. */
export function summarizeRules(effect) {
  return effectRules(effect).map(summarizeRule).filter(Boolean);
}

/**
 * A NATURAL-LANGUAGE clause for one rule — verb-led, no subject, numbers left PLAIN (the Skill
 * auto-description colorizes them). Powers the flowing prose write-up in skill-description.mjs,
 * e.g. "raises Might by 1 step", "grants +2 Evasion", "grants Resist to Fire". Returns "" when a
 * rule has no phrasing. `condition` rules return "" — the caller frames self vs target statuses.
 */
export function narrateRule(rule) {
  switch (rule?.type) {
    case "attribute": {
      const a = L(PROJECTANIME.attributes[rule.key]) || rule.key;
      const steps = Math.max(1, Math.round(Number(rule.steps) || 1));
      return `${rule.mode === "hinder" ? "lowers" : "raises"} ${a} by ${steps} ${steps > 1 ? "steps" : "step"}`;
    }
    case "stat":
      return `grants ${signed(rule.value)} ${L(STAT_TARGETS[rule.key]) || rule.key}`;
    case "retaliation": {
      const n = Math.max(0, Math.round(Number(rule.value) || 0));
      return `makes foes that damage the target take ${n} damage`;
    }
    case "resource":
      return `grants ${signed(rule.value)} ${L(RESOURCE_TARGETS[rule.target]) || rule.target}`;
    case "sustain":
      return `regenerates ${Math.max(0, Math.round(Number(rule.value) || 0))} ${L(SUSTAIN_POOLS[rule.pool]) || rule.pool} at the start of each turn`;
    case "roll":
      return `grants ${signed(rule.value)} to ${L(ROLL_SELECTORS[rule.selector]) || rule.selector} rolls`;
    case "ncCheck": {
      const a = L(PROJECTANIME.attributes[rule.key]) || rule.key;
      const v = Math.round(Number(rule.value) || 0);
      if (rule.mode === "step") {
        const n = Math.abs(v);
        return `${v >= 0 ? "raises" : "lowers"} ${a} by ${n} ${n === 1 ? "step" : "steps"} on non-combat checks`;
      }
      return `grants ${signed(v)} to ${a} on non-combat checks`;
    }
    case "luck": {
      const steps = Math.max(1, Math.round(Number(rule.steps) || 1));
      return `lets you tune a restored Luck Die by ±${steps}`;
    }
    case "trade":
      return `shifts the ${L(TRADE_TARGETS[rule.target === "buy" ? "buy" : "sell"])} rate by ${signed(rule.pct)}%`;
    case "reveal":
      return `reveals ${L(REVEAL_CATEGORIES[rule.category]) || rule.category}`;
    case "immunity":
      return `grants immunity to ${conditionLabelOf(rule.status)}`;
    case "grant": {
      const names = (Array.isArray(rule.items) ? rule.items : []).map((i) => i?.name).filter(Boolean);
      return names.length ? `grants ${names.join(", ")}` : "";
    }
    case "skillMod": {
      const bits = [];
      if (rule.damage) bits.push(`${signed(rule.damage)} damage`);
      if (rule.energy) bits.push(`${signed(rule.energy)} Energy cost`);
      return bits.length ? `gives ${skillModScopeLabel(rule.scope)} Skills ${bits.join(" and ")}` : "";
    }
    case "weaponMod": {
      const bits = [];
      if (rule.attack) bits.push(`${signed(rule.attack)} Attack`);
      if (rule.damage) bits.push(`${signed(rule.damage)} damage`);
      if (!bits.length) return "";
      const subject = rule.scope === "unarmed" ? "the Unarmed strike"
        : rule.scope === "type" ? `${String(rule.typeName ?? "").trim() || "typed"} weapons`
        : "weapon attacks";
      return `gives ${subject} ${bits.join(" and ")}`;
    }
    default:
      return "";
  }
}

/** Order a {value:label} map alphabetically by label, with optional keys pinned first. */
function sortChoices(obj, pinned = []) {
  const pins = pinned.filter((k) => k in obj);
  const rest = Object.keys(obj).filter((k) => !pins.includes(k)).sort((a, b) => String(obj[a]).localeCompare(String(obj[b])));
  return Object.fromEntries([...pins, ...rest].map((k) => [k, obj[k]]));
}

/**
 * Localized {value:label} choice maps for the builder's dropdowns. Every menu is sorted
 * alphabetically by label so it's easy to scan — EXCEPT `attributes`, which keep their
 * canonical Might→Agility→Mind→Spirit→Charm order. The "none"/"always" default options
 * stay pinned to the top of their menus.
 */
export function ruleChoices() {
  const map = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, L(v)]));
  return {
    types: sortChoices(map(RULE_TYPES), ["none"]),
    modes: map(ATTRIBUTE_MODES),              // Step Up / Step Down — NOT alphabetized (Up first)
    attributes: map(PROJECTANIME.attributes), // canonical order — NOT alphabetized
    stats: sortChoices(map(STAT_TARGETS)),
    resources: sortChoices(map(RESOURCE_TARGETS)),
    sustainPools: sortChoices(map(SUSTAIN_POOLS), ["hp"]),
    tradeTargets: sortChoices(map(TRADE_TARGETS)),
    rollSelectors: sortChoices(map(ROLL_SELECTORS)),
    ncCheckModes: map(NCCHECK_MODES),         // Die Steps / Flat Bonus — NOT alphabetized (Steps first)
    // Skill-adjustment scopes: "Any Skill" pinned first, then every real Skill Modifier (sorted);
    // the free "None" marker isn't a targetable scope.
    modScopes: { ...map(SKILLMOD_SCOPES), ...sortChoices(map(Object.fromEntries(
      Object.entries(PROJECTANIME.skillModifiers).filter(([k]) => !(PROJECTANIME.freeModifiers ?? []).includes(k))
    ))) },
    // Weapon-adjustment scopes: Any weapon / Unarmed / By type (canonical order, not alphabetized).
    weaponModScopes: map(WEAPONMOD_SCOPES),
    conditionScopes: sortChoices(map(CONDITION_SCOPES)),
    conditions: sortChoices(Object.fromEntries((PROJECTANIME.statusConditions ?? []).map((c) => [c.id, L(c.name)]))),
    revealCategories: sortChoices(map(REVEAL_CATEGORIES)),
    predTypes: sortChoices(map(PRED_TYPES), ["always"]),
    durations: sortChoices(map(DURATION_UNITS), ["none"])
  };
}
