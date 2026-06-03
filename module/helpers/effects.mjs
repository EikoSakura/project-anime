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
 *   • affinity   → system.affinities.<element>
 * Writing a DERIVED field (evasion.value, attribute.die, system.conditions, …) is
 * silently clobbered by prepareDerivedData and does nothing. The engine must stay a
 * PURE in-memory transform — never call update()/setFlag() from here (infinite loop).
 */

import { PROJECTANIME } from "./config.mjs";
import { elementChoices, elementLabel } from "./elements.mjs";

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
  affinity: "PROJECTANIME.Effect.type.affinity",
  roll: "PROJECTANIME.Effect.type.roll",
  condition: "PROJECTANIME.Effect.type.condition",
  luck: "PROJECTANIME.Effect.type.luck",
  trade: "PROJECTANIME.Effect.type.trade",
  reveal: "PROJECTANIME.Effect.type.reveal",
  grant: "PROJECTANIME.Effect.type.grant"
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
  targetCondition: "PROJECTANIME.Effect.pred.targetCondition",
  targetAffinity: "PROJECTANIME.Effect.pred.targetAffinity"
};

/** Effect duration units offered in the builder (mapped onto core effect.duration). */
export const DURATION_UNITS = {
  none: "PROJECTANIME.Effect.dur.none",
  rounds: "PROJECTANIME.Effect.dur.rounds",
  turns: "PROJECTANIME.Effect.dur.turns",
  minutes: "PROJECTANIME.Effect.dur.minutes"
};

/** Bolster (step the die up) / Hinder (step it down). */
export const ATTRIBUTE_MODES = {
  bolster: "PROJECTANIME.Effect.mode.bolster",
  hinder: "PROJECTANIME.Effect.mode.hinder"
};

/** Derived stats an effect can flat-modify (all carry a `.bonus` field). */
export const STAT_TARGETS = {
  evasion: "PROJECTANIME.Stat.evasion",
  movement: "PROJECTANIME.Stat.movement",
  defense: "PROJECTANIME.Stat.defense",
  carryingCapacity: "PROJECTANIME.Stat.carryingCapacity"
};

/** Resource maximums an effect can flat-modify. */
export const RESOURCE_TARGETS = {
  hp: "PROJECTANIME.Effect.maxHp",
  energy: "PROJECTANIME.Effect.maxEnergy"
};

/** Which trade rate a `trade` rule shifts: what you recover on sale, or what you pay to buy. */
export const TRADE_TARGETS = {
  sell: "PROJECTANIME.Effect.trade.sell",
  buy: "PROJECTANIME.Effect.trade.buy"
};

/** What a `reveal` rule unlocks for the VIEWER who carries it (a Scouter) — surfaced in a
 *  token's hover panel / right-click dossier. Each category is gated independently. */
export const REVEAL_CATEGORIES = {
  skillPoints: "PROJECTANIME.Effect.reveal.skillPoints",
  attributes: "PROJECTANIME.Effect.reveal.attributes",
  combatStats: "PROJECTANIME.Effect.reveal.combatStats",
  skills: "PROJECTANIME.Effect.reveal.skills",
  affinities: "PROJECTANIME.Effect.reveal.affinities"
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
    case "targetAffinity": return {
      type: "targetAffinity",
      element: String(raw.element ?? "").trim(),
      level: raw.level in PROJECTANIME.affinityLevels ? raw.level : "none"
    };
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
    case "stat":
      rule = { type: "stat", key: raw.key in STAT_TARGETS ? raw.key : "evasion", value: Math.round(Number(raw.value) || 0) };
      break;
    case "resource":
      rule = { type: "resource", target: raw.target in RESOURCE_TARGETS ? raw.target : "hp", value: Math.round(Number(raw.value) || 0) };
      break;
    case "affinity":
      rule = { type: "affinity", element: String(raw.element ?? "").trim(), level: raw.level in PROJECTANIME.affinityLevels ? raw.level : "none" };
      break;
    case "roll":
      rule = { type: "roll", selector: raw.selector in ROLL_SELECTORS ? raw.selector : "check", value: Math.round(Number(raw.value) || 0) };
      break;
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
    case "reveal":
      rule = { type: "reveal", category: raw.category in REVEAL_CATEGORIES ? raw.category : "attributes" };
      break;
    case "grant": {
      // The dragged-in Item references this effect grants when its carrier lands on an
      // actor. NOT a passive in-memory rule — applied event-driven by syncGrants (below).
      const items = Object.values(raw.items ?? {})
        .map((it) => ({
          uuid: String(it?.uuid ?? "").trim(),
          name: String(it?.name ?? "").trim(),
          img: String(it?.img ?? "").trim()
        }))
        .filter((it) => it.uuid);
      rule = { type: "grant", items };
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

/** Localized display name of a status-condition id (e.g. "slowed" → "Slowed"). */
function conditionLabelOf(id) {
  const c = (PROJECTANIME.statusConditions ?? []).find((x) => x.id === id);
  return c ? game.i18n.localize(c.name) : id;
}

/** True if this effect's rules should currently apply to its actor (equip + Action-Type gating). */
function effectIsLive(effect) {
  const parent = effect?.parent;
  if (typeof Item !== "undefined" && parent instanceof Item) {
    // An effect owned by an equippable item only applies while that item is equipped.
    if (EQUIP_GATED.has(parent.type)) return !!parent.system?.equipped;
    // A Skill's effect applies passively (always-on) ONLY if the Skill is a Passive.
    // Action / React Skill effects stay dormant here — they're applied ON USE as a copy
    // on the recipient (see dice.mjs). That copy is parented to the actor, not this Skill,
    // so it isn't re-gated by this branch.
    if (parent.type === "skill") return parent.system?.actionType === "passive";
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
    out.push({ id: effect.id, label: effect.name, img: effect.img, on: toggleState(actor, effect) });
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

/**
 * Build a duration-stamped copy object of an effect: its `_id` stripped and any duration
 * restarted from now (world-time + combat round/turn) so it counts down from application.
 * Shared by drag-on (applyEffectCopy) and the on-use Skill-effect application in dice.mjs
 * (which may relay the object to the GM to create on an unowned target).
 */
export function effectCopyData(effect) {
  const obj = effect.toObject();
  delete obj._id;
  const d = obj.duration;
  if (d && (d.rounds || d.turns || d.seconds)) {
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
    case "affinity": {
      if (rule.element && system.affinities) system.affinities[rule.element] = rule.level || "none";
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
    case "targetAffinity": return (target?.system?.affinities?.[pred.element] ?? "none") === pred.level;
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
 * Total Luck-die step-ups an actor's live effects grant (e.g. a Lucky Pendant). Read at
 * Luck-Dice roll time to Step Up the Charm die. Equip-gated + toggle-gated like the other
 * collectors; self-predicates apply (target predicates can't — there's no target).
 */
export function collectLuckSteps(actor) {
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
      if (rule?.type !== "reveal" || !(rule.category in REVEAL_CATEGORIES)) continue;
      if (!predicatePasses(rule.pred, actor, null)) continue;
      set.add(rule.category);
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
    case "resource":
      return `${signed(rule.value)} ${L(RESOURCE_TARGETS[rule.target]) || rule.target}`;
    case "affinity":
      return `${elementLabel(rule.element) || rule.element} → ${L(PROJECTANIME.affinityLevels[rule.level]) || rule.level}`;
    case "roll":
      return `${signed(rule.value)} ${L(ROLL_SELECTORS[rule.selector]) || rule.selector}`;
    case "luck": {
      const steps = Math.max(1, Math.round(Number(rule.steps) || 1));
      const base = L("PROJECTANIME.Effect.luckStepUp");
      return steps > 1 ? `${base} (${steps})` : base;
    }
    case "trade":
      return `${signed(rule.pct)}% ${L(TRADE_TARGETS[rule.target === "buy" ? "buy" : "sell"])}`;
    case "condition":
      return rule.scope === "target"
        ? `${L("PROJECTANIME.Effect.inflict")} ${conditionLabelOf(rule.status)}`
        : conditionLabelOf(rule.status);
    case "reveal":
      return `${L(RULE_TYPES.reveal)} ${L(REVEAL_CATEGORIES[rule.category]) || rule.category}`;
    case "grant": {
      const items = Array.isArray(rule.items) ? rule.items : [];
      const names = items.map((i) => i?.name).filter(Boolean);
      const head = L("PROJECTANIME.Effect.grant");
      return names.length ? `${head}: ${names.join(", ")}` : head;
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
    case "resource":
      return `grants ${signed(rule.value)} ${L(RESOURCE_TARGETS[rule.target]) || rule.target}`;
    case "affinity":
      return rule.level && rule.level !== "none"
        ? `grants ${L(PROJECTANIME.affinityLevels[rule.level]) || rule.level} to ${elementLabel(rule.element) || rule.element}`
        : "";
    case "roll":
      return `grants ${signed(rule.value)} to ${L(ROLL_SELECTORS[rule.selector]) || rule.selector} rolls`;
    case "luck": {
      const steps = Math.max(1, Math.round(Number(rule.steps) || 1));
      return steps > 1 ? `steps up the Luck die by ${steps}` : "steps up the Luck die";
    }
    case "trade":
      return `shifts the ${L(TRADE_TARGETS[rule.target === "buy" ? "buy" : "sell"])} rate by ${signed(rule.pct)}%`;
    case "reveal":
      return `reveals ${L(REVEAL_CATEGORIES[rule.category]) || rule.category}`;
    case "grant": {
      const names = (Array.isArray(rule.items) ? rule.items : []).map((i) => i?.name).filter(Boolean);
      return names.length ? `grants ${names.join(", ")}` : "";
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
    modes: sortChoices(map(ATTRIBUTE_MODES)),
    attributes: map(PROJECTANIME.attributes), // canonical order — NOT alphabetized
    stats: sortChoices(map(STAT_TARGETS)),
    resources: sortChoices(map(RESOURCE_TARGETS)),
    tradeTargets: sortChoices(map(TRADE_TARGETS)),
    elements: elementChoices(), // already sorted by label at its source
    levels: sortChoices(map(PROJECTANIME.affinityLevels), ["none"]),
    rollSelectors: sortChoices(map(ROLL_SELECTORS)),
    conditionScopes: sortChoices(map(CONDITION_SCOPES)),
    conditions: sortChoices(Object.fromEntries((PROJECTANIME.statusConditions ?? []).map((c) => [c.id, L(c.name)]))),
    revealCategories: sortChoices(map(REVEAL_CATEGORIES)),
    predTypes: sortChoices(map(PRED_TYPES), ["always"]),
    durations: sortChoices(map(DURATION_UNITS), ["none"])
  };
}
