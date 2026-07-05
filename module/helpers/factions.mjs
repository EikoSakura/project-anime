/**
 * Project: Anime — FACTIONS data layer (the world's factions & standing).
 *
 * One world setting (`covenantFactions`), shared by the whole table (GM writes, everyone reads),
 * mirroring CHRONICLE. A faction is a heraldic crest with a 0–100 standing meter and per-tier perks.
 * Surfaced on the PARTY SHEET's Factions tab (GM-gated by a Party-Sheet setting); the standalone
 * "Covenant" window that used to host this is gone, and Bonds moved onto each character's own sheet
 * (helpers/bonds.mjs). The CHRONICLE quest log feeds standing: a quest's Reputation reward bumps the
 * matching faction on completion (see applyRepToFaction, called from helpers/chronicle.mjs).
 *
 * The setting key keeps its original `covenantFactions` id so existing worlds' faction data carries
 * over untouched — only the surface that shows it changed.
 *
 * Standing now PAYS OUT: each tier carries optional rewards (gold / SP / item snapshots) the GM
 * authors on the Factions tab, and crossing a tier upward delivers them to the party once — tracked
 * per-faction in `rewardedTiers` so dropping and re-climbing standing never double-pays.
 */

import { partyMembers, resolveParty } from "./party-folder.mjs";
import { collectHQOutputs, collectGather } from "./effects.mjs";
import { materialCategoryLabel, isImageIcon } from "./materials.mjs";
import { cardHTML } from "./dice.mjs";

export const FACTIONS_SETTING = "covenantFactions";

/**
 * Faction standing runs 0–100 across six tiers. `min` is the inclusive threshold; `color` is the
 * CSS custom property (defined in the .pa-factions CSS) used to tint the tier.
 */
export const STANDING_TIERS = [
  { key: "hostile", min: 0, color: "--st-hostile" },
  { key: "wary", min: 17, color: "--st-wary" },
  { key: "neutral", min: 34, color: "--st-neutral" },
  { key: "friendly", min: 50, color: "--st-friendly" },
  { key: "honored", min: 67, color: "--st-honored" },
  { key: "allied", min: 84, color: "--st-allied" }
];

/** The tier a standing value currently sits in. */
export function tierForStanding(value) {
  const v = clampStanding(value);
  let tier = STANDING_TIERS[0];
  for (const t of STANDING_TIERS) if (v >= t.min) tier = t;
  return tier;
}

/** Clamp a standing value to the 0–100 track. */
export function clampStanding(v) {
  return Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
}

/* -------------------------------------------------------------------------- */
/*  Relationships (Layer 4) — the faction web                                  */
/* -------------------------------------------------------------------------- */
/* Factions are tied to one another by SYMMETRIC ally / rival edges (neutral = no edge stored). Each
 * faction carries its own `relations[]` and both sides are written together (setFactionRelation), so a
 * faction's web reads straight off its own record. The web is purely a relationship MAP — a visual of
 * who is allied with or rival to whom; it carries no mechanical force on a faction's standing. */

/** The two non-neutral stances an edge can hold. A neutral relation is simply the absence of an edge. */
export const RELATION_STANCES = ["ally", "rival"];


/** Validate a faction's relation edges (idempotent): keep only well-formed {factionId, stance} rows
 *  with a known stance, drop self-edges (ownId) and duplicates (last write per neighbour wins). */
function normalizeRelations(rels, ownId) {
  if (!Array.isArray(rels)) return [];
  const out = new Map();
  for (const r of rels) {
    const fid = r?.factionId;
    if (!fid || fid === ownId || !RELATION_STANCES.includes(r.stance)) continue;
    out.set(fid, { factionId: fid, stance: r.stance });
  }
  return [...out.values()];
}

/** Validate a pinned web position: a {x,y} pair of finite 0–1 fractions, else null (auto-layout). */
function normalizeWebPos(p) {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  return { x: Math.max(0, Math.min(1, p.x)), y: Math.max(0, Math.min(1, p.y)) };
}

/* -------------------------------------------------------------------------- */
/*  Read / write                                                              */
/* -------------------------------------------------------------------------- */

/** The full faction list (a safe deep copy you can mutate before saveFactions). Every faction is
 *  normalized so older worlds gain the tier-reward fields without a migration step. */
export function getFactions() {
  const raw = game.settings.get("project-anime", FACTIONS_SETTING);
  return Array.isArray(raw) ? foundry.utils.deepClone(raw).map(normalizeFaction) : [];
}

/** Backfill a faction's tier-reward shape in place (idempotent): each perk gains the reward fields,
 *  and a legacy faction with no `rewardedTiers` seeds it to the tiers its CURRENT standing already
 *  covers — so turning this feature on never retroactively pays out a faction's existing standing. */
export function normalizeFaction(f) {
  if (!f || typeof f !== "object") return f;
  const perks = Array.isArray(f.perks) ? f.perks : STANDING_TIERS.map((t) => ({ tier: t.key, req: t.min, text: "" }));
  f.perks = perks.map((p) => ({
    ...p,
    text: p.text ?? "",
    rewardGold: Number(p.rewardGold) || 0,
    rewardSP: Number(p.rewardSP) || 0,
    rewardItems: Array.isArray(p.rewardItems) ? p.rewardItems : []
  }));
  if (!Array.isArray(f.rewardedTiers)) {
    const s = clampStanding(f.standing);
    f.rewardedTiers = STANDING_TIERS.filter((t) => s >= t.min).map((t) => t.key);
  }
  // Identity + the Layer-4 relationship web. `crest` is an emblem IMAGE (the dashed text `sigil` glyph
  // is retired; the hex crest falls back to the name initial), `relations` the symmetric ally/rival edges.
  f.crest = f.crest ?? "";
  f.relations = normalizeRelations(f.relations, f.id);
  // Optional GM-pinned node position on the interactive relationship WEB, stored normalized (0–1 of the
  // stage in each axis). Absent / malformed → null, and the web falls back to an auto circular layout.
  f.webPos = normalizeWebPos(f.webPos);
  // The autonomous Faction Turn + reactive ripple were removed — shed their per-faction fields so a saved
  // faction drops them. A faction is now a standing record + the relationship-web map.
  delete f.frozen;
  delete f.agendaTarget;
  delete f.agendaStep;
  // Recruitment + the HQ moved off the individual faction onto ONE party-wide headquarters
  // (HQ_SETTING below): a faction is now purely a reputation record. Shed the obsolete per-faction
  // `roster` / `buildable` so saving a faction drops them (migrateRostersToHQ folds any existing
  // roster into the HQ pool first — see the ready hook).
  delete f.roster;
  delete f.buildable;
  return f;
}

/** Persist the full faction list (GM only — the setting is world-scoped). */
export async function saveFactions(factions) {
  return game.settings.set("project-anime", FACTIONS_SETTING, factions);
}

export function factionById(id, factions = getFactions()) {
  return factions.find((f) => f.id === id) ?? null;
}

/* -------------------------------------------------------------------------- */
/*  Blanks                                                                     */
/* -------------------------------------------------------------------------- */

/** A fresh faction, with one perk slot (ability text + optional gold/SP/item rewards) per standing
 *  tier. `rewardedTiers` starts covering the tiers the seed standing already sits in, so the first
 *  tier that pays out is the next one the party climbs into. */
export function blankFaction(overrides = {}) {
  const standing = clampStanding(overrides.standing ?? 25);
  return {
    id: foundry.utils.randomID(),
    name: game.i18n.localize("PROJECTANIME.Covenant.newFactionName"),
    crest: "", // heraldic emblem image (hex crest; falls back to the name initial)
    accent: "#d8b257", // crest / standing colour
    motto: "",
    banner: "", // optional hero background
    standing,
    lore: "", // rich write-up (HTML)
    relations: [], // symmetric ally/rival edges to other factions (the relationship-web map)
    webPos: null, // GM-pinned node position on the relationship web (normalized 0–1); null → auto-layout
    perks: STANDING_TIERS.map((t) => ({ tier: t.key, req: t.min, text: "", rewardGold: 0, rewardSP: 0, rewardItems: [] })),
    rewardedTiers: STANDING_TIERS.filter((t) => standing >= t.min).map((t) => t.key),
    ...overrides
  };
}

/* -------------------------------------------------------------------------- */
/*  THE HQ — the party's own built faction + its recruit pool                 */
/* -------------------------------------------------------------------------- */
/* One world setting, like the faction list: the party founds a single headquarters (its own crest,
 * name, motto) and fills it from a shared recruit POOL. Recruitment used to hang off each world
 * faction (gated by a `buildable` flag); it now lives here, surfaced on the Codex's Home tab as
 * flip-cards. A recruited non-`party` member staffs an HQ facility; a `party`-role recruit files
 * into the party folder. A `repTier` recruit can still gate on a world faction's standing — it
 * remembers which faction by id (`condition.factionId`). */

export const HQ_SETTING = "covenantHQ";

/** How many HQ turns a dispatch agent is out of action after a failed mission. */
const WOUND_TURNS = 2;

/** Variant rule (gated by DEATH_STRIKES_SETTING, default on): an agent who rolls a natural 1 on this
 *  many dispatch missions — cumulatively, across their career — is lost for good. Failing a mission
 *  only ever WOUNDS; death is decoupled from the mission and earned through bad luck over time. */
const DEATH_STRIKES = 3;

/** World setting (config, default true) gating the death-by-three-1s variant. Off → dispatch agents
 *  only ever come back wounded, never die, and natural-1 strikes aren't tallied. */
export const DEATH_STRIKES_SETTING = "hqDeathStrikes";

/** Is the death-by-three-1s variant active? Defaults on if the setting isn't registered yet. */
const deathStrikesEnabled = () => {
  try { return game.settings.get("project-anime", DEATH_STRIKES_SETTING) !== false; }
  catch { return true; }
};

/** World setting (config, default true): when on, a Workshop recipe's `requires[]` facility prerequisites
 *  are enforced; off → recipes gate on the Workshop's own tier + resource cost only (pure tier-gating). */
export const CRAFT_REQUIRE_SETTING = "craftRequireFacilities";

/** Are recipe facility-requirements enforced? Defaults on if the setting isn't registered yet. */
const craftRequireFacilities = () => {
  try { return game.settings.get("project-anime", CRAFT_REQUIRE_SETTING) !== false; }
  catch { return true; }
};

/* -------------------------------------------------------------------------- */
/*  Dispatch stat resolution — Talents / Attributes drive mission rolls       */
/* -------------------------------------------------------------------------- */
/* A dispatch mission posts a STAT + a DIFFICULTY (target number). Each sent agent rolls their backing
 * NPC's die for that stat (a Talent work-die for downtime jobs, or an Attribute statblock die for a
 * combat job) plus their Trait Bonuses; the squad's totals sum into one team check vs the difficulty
 * (the "Sum" combine rule — more / stronger members directly raise the total). These helpers are shared
 * by advanceHQTurn (the live roll) and the Codex's send-time odds preview (helpers/codex statistics). */

/** Resolve a mission stat key on a sent agent's backing actor into a die. `stat` is "talent.<k>"
 *  (a work die: base 4–12 → d{base}) or "attr.<k>" (the Monster statblock die string, e.g. "d8").
 *  Falls back to a d4 floor when the actor or the keyed value is missing, so a sent agent always
 *  contributes a roll (and can still roll the natural 1 that counts toward the death variant). */
export function statDieFor(actor, stat) {
  const [kind, key] = String(stat || "").split(".");
  let faces = 4;
  if (actor && kind === "talent") {
    // The CURRENT die (`value`) — seeded from base, then Bolstered/Hindered by any `talent` effect
    // (e.g. a signature Trait). Falls back to `base` for legacy data prepared before `value` existed.
    const tal = actor.system?.talents?.[key];
    const b = Number(tal?.value ?? tal?.base);
    if (b >= 1) faces = b;
  } else if (actor && kind === "attr") {
    const f = Number(String(actor.system?.attributes?.[key]?.die || "").replace(/^d/i, ""));
    if (f >= 1) faces = f;
  }
  faces = Math.max(1, Math.round(faces));
  return { faces, formula: `1d${faces}` };
}

/** The flat bonus a backing actor adds to a mission roll for `stat`: every Trait Bonus whose target is
 *  exactly this stat, plus any generic `hq.success` Trait Bonus (which lifts EVERY mission roll). */
export function statBonusFor(actor, stat) {
  const rows = Array.isArray(actor?.system?.traitBonuses) ? actor.system.traitBonuses : [];
  let total = 0;
  for (const b of rows) if (b?.target === stat || b?.target === "hq.success") total += Math.round(Number(b.value) || 0);
  // PLUS any `hq` effect rule's Mission-success bonus (a Signature Trait / Trait / gear effect).
  total += collectHQOutputs(actor).success;
  return total;
}

/** A backing actor's Trait Bonus to an HQ reward output ("gold" | "sp") — added to a WON mission's
 *  payout (never negative). The `hq.success` output instead feeds the roll (see statBonusFor). */
export function hqRewardBonus(actor, key) {
  const rows = Array.isArray(actor?.system?.traitBonuses) ? actor.system.traitBonuses : [];
  let total = 0;
  for (const b of rows) if (b?.target === `hq.${key}`) total += Math.round(Number(b.value) || 0);
  // PLUS any `hq` effect rule's matching reward bonus (Gold / SP) from a Trait / Signature / gear effect.
  total += Math.round(Number(collectHQOutputs(actor)[key]) || 0);
  return Math.max(0, total);
}

/** A backing actor's total Mission-haste — HQ turns this agent shaves off a dispatch's duration. Mirrors
 *  hqRewardBonus: every `hq.haste` Trait Bonus row PLUS any `hq` effect rule's haste output (from a Trait
 *  / Signature Trait / gear effect, via collectHQOutputs). Never negative. */
export function hqHasteBonus(actor) {
  const rows = Array.isArray(actor?.system?.traitBonuses) ? actor.system.traitBonuses : [];
  let total = 0;
  for (const b of rows) if (b?.target === "hq.haste") total += Math.round(Number(b.value) || 0);
  total += Math.round(Number(collectHQOutputs(actor).haste) || 0);
  return Math.max(0, total);
}

/** The effective dispatch duration for `mission` given the squad of backing actors being sent — the
 *  posted `durationTurns` shaved by the squad's COMBINED Mission-haste (sum of hqHasteBonus), floored at
 *  1 (a mission always takes at least one HQ turn). So a hastening agent (e.g. a Trait granting hq.haste)
 *  brings the WHOLE squad home earlier. `agents` may contain nulls (a missing backing actor adds 0). */
export function effectiveMissionDuration(mission, agents) {
  const base = Math.max(1, Math.round(Number(mission?.durationTurns) || 1));
  let haste = 0;
  for (const a of (agents ?? [])) haste += hqHasteBonus(a);
  return Math.max(1, base - Math.max(0, Math.round(haste)));
}

/** Localized label for a mission stat key ("talent.<k>" | "attr.<k>"). */
export function statLabelFor(stat) {
  const C = globalThis.CONFIG?.PROJECTANIME ?? {};
  const [kind, key] = String(stat || "").split(".");
  if (kind === "talent") return game.i18n.localize(C.talents?.[key] ?? `PROJECTANIME.Talent.${key}.long`);
  if (kind === "attr") return game.i18n.localize(C.attributes?.[key] ?? `PROJECTANIME.Attribute.${key}.long`);
  return String(stat || "");
}

/** Sanitize the HQ resource stockpile to a `{ key: non-negative-int }` map (Civ-style number pools).
 *  Keys are the GM-configured Resource Types (helpers/materials.mjs); unknown/blank keys are dropped. */
function normalizeResources(src) {
  const out = {};
  if (src && typeof src === "object") {
    for (const [k, v] of Object.entries(src)) {
      const key = String(k).trim();
      if (key) out[key] = Math.max(0, Math.round(Number(v) || 0));
    }
  }
  return out;
}

/** A fresh dispatch mission (a job people can be sent on). Posts a STAT to test + a DIFFICULTY (target
 *  number); the sent squad rolls that stat vs the difficulty when they return. Defaults to the
 *  dispatch-canonical Exploration Talent so a fresh mission is immediately runnable. */
export function blankMission() {
  return { id: foundry.utils.randomID(), title: "", img: "", tier: 1, durationTurns: 1, stat: "talent.exploration", difficulty: 8, rewardGold: 0, rewardSP: 0, rewardItems: [] };
}

/** The recruit vocations that, once recruited, raise (staff) a standing HQ FACILITY. `party`
 *  (mercenary — fights with the group) and `dispatch` (a mission agent) are people, not buildings. */
const FACILITY_ROLES = ["service", "vendor", "passive", "upgrade", "workshop"];

/** A facility's id is derived deterministically from its founding person's id, so the legacy split
 *  (splitLegacyRecruits) is stable across reads even before migrateHQModel persists it. */
const facilityIdFor = (personId) => `f${personId}`;

/** Normalize one recruit-pool entry (idempotent). */
function normalizeRecruit(e) {
  return {
    id: e.id || foundry.utils.randomID(),
    npcUuid: e.npcUuid || "",
    name: e.name || "",
    img: e.img || "",
    role: e.role || "party",
    condition: {
      type: e.condition?.type || "auto",
      factionId: e.condition?.factionId || "", // repTier: which world faction's standing gates this
      tier: e.condition?.tier || "",
      level: Math.max(0, Math.round(Number(e.condition?.level) || 0)), // hqLevel: required HQ level
      label: e.condition?.label || ""
    },
    effect: e.effect || "",                                       // HQ facility: what it provides (GM-authored flavor)
    facilityTier: Math.min(3, Math.max(1, Number(e.facilityTier) || 1)), // HQ facility: 1–3
    // Per-turn facility output, resolved on Advance HQ Turn and scaled by facilityTier. Any non-party
    // facility can carry a generic gold/SP/item yield; a `service` facility also restores party vitals.
    yieldGold: Math.max(0, Math.round(Number(e.yieldGold) || 0)),
    yieldSP: Math.max(0, Math.round(Number(e.yieldSP) || 0)),
    yieldItems: Array.isArray(e.yieldItems) ? e.yieldItems : [],  // self-contained Item snapshots
    serviceKind: e.serviceKind || "",                             // service role: restoreHP|restoreEnergy|fullRest|cleanse
    // vendor role: a buy/sell Shop. `stock` = GM-authored item snapshots; `drawFromShop` also offers
    // the Character-Creator compendium catalogue; rateBuy/rateSell shift prices by ± percentage points.
    stock: Array.isArray(e.stock) ? e.stock : [],
    drawFromShop: !!e.drawFromShop,
    rateBuy: Math.round(Number(e.rateBuy) || 0),
    rateSell: Math.round(Number(e.rateSell) || 0),
    // dispatch role: mission assignment state (set while on a mission / recovering).
    status: ["away", "wounded"].includes(e.status) ? e.status : "",
    assignedMissionId: e.assignedMissionId || "",
    returnsTurn: Math.max(0, Math.round(Number(e.returnsTurn) || 0)),
    woundedUntil: Math.max(0, Math.round(Number(e.woundedUntil) || 0)),
    // passive role: an always-on party boon (attribute bonuses) projected as a flagged Active Effect.
    boonChanges: Array.isArray(e.boonChanges) ? e.boonChanges.map((c) => ({ attr: c.attr || "", value: Math.round(Number(c.value) || 0) })) : [],
    // upgrade role: the facility this one raises a tier each HQ Turn (target facility id).
    upgradeTarget: e.upgradeTarget || "",
    recruited: !!e.recruited,
    unlocked: !!e.unlocked
  };
}

/** Normalize one PERSON — a recruit candidate or a Roster member (idempotent). People hold the
 *  recruitment gate, roster flavour, and dispatch state; the building they staff is a separate
 *  Facility referenced by `facilityId`. */
function normalizePerson(e) {
  return {
    id: e.id || foundry.utils.randomID(),
    npcUuid: e.npcUuid || "",
    name: e.name || "",
    img: e.img || "",
    // People are a single kind now — every recruit can be dispatched, staff a facility, etc. The legacy
    // "dispatch" role folds into "party"; the old Mercenary/Dispatch split is gone.
    role: (e.role === "dispatch" || !e.role) ? "party" : e.role,
    condition: {
      type: e.condition?.type || "auto",
      factionId: e.condition?.factionId || "",
      tier: e.condition?.tier || "",
      level: Math.max(0, Math.round(Number(e.condition?.level) || 0)),
      questId: e.condition?.questId || "",                          // quest gate: which Chronicle quest unlocks this on completion
      label: e.condition?.label || ""
    },
    effect: e.effect || "",                                        // roster flavour text
    facilityId: e.facilityId || "",                                // the facility this person staffs (if any)
    recruited: !!e.recruited,
    unlocked: !!e.unlocked,
    hidden: !!e.hidden,                                            // GM-only "hide from players entirely" toggle

    // dispatch transient state (set while away on a mission / recovering)
    status: ["away", "wounded"].includes(e.status) ? e.status : "",
    assignedMissionId: e.assignedMissionId || "",
    returnsTurn: Math.max(0, Math.round(Number(e.returnsTurn) || 0)),
    woundedUntil: Math.max(0, Math.round(Number(e.woundedUntil) || 0)),
    // Death-by-three-1s variant: cumulative count of natural 1s this agent has rolled on missions.
    deathStrikes: Math.max(0, Math.round(Number(e.deathStrikes) || 0))
  };
}

/** Normalize one FACILITY — a standing building (idempotent). `role` is its kind; `staffIds` are the
 *  residents posted here (capacity = tier). All per-turn output / vendor / boon / upgrade config lives here. */
function normalizeFacility(e) {
  return {
    id: e.id || foundry.utils.randomID(),
    // Residents staffing this facility (Phase-2 multi-staff). Capacity = tier. Migrates a legacy single
    // `ownerId` into the list on read, so old saves keep their staffer.
    staffIds: Array.isArray(e.staffIds) ? e.staffIds.filter(Boolean) : (e.ownerId ? [e.ownerId] : []),
    // Resource-type keys this facility gathers (Phase-3): a resident's `gather` trait-output is credited
    // only when its resource is in this list (the "fit"). GM-toggled in the Structures window.
    accepts: Array.isArray(e.accepts) ? e.accepts.filter(Boolean) : [],
    npcUuid: e.npcUuid || "",                                      // for "open sheet"
    name: e.name || "",
    img: e.img || "",
    role: FACILITY_ROLES.includes(e.role) ? e.role : "service",    // kind
    // Resource build cost per tier (the merged-in Structures layer); cost to reach tier N = base × N.
    cost: normalizeResources(e.cost),
    // Tier 0 = a planned blueprint (free to sketch, produces nothing); Build spends resources to raise
    // it 0→1→…→3. Legacy facilities (saved at tier ≥1) keep their tier and read as already built.
    facilityTier: Math.min(3, Math.max(0, Math.round(Number(e.facilityTier ?? e.tier) || 0))),
    // A GM-"Unlocked" facility is offered to players to build (the player relay is a later slice; the
    // flag already surfaces which builds are available). `buildTime` = HQ turns a build/upgrade takes
    // (0 = instant); `building`/`buildLeft` track an in-progress construction that completes on the turn.
    unlocked: !!e.unlocked,
    buildTime: Math.max(0, Math.round(Number(e.buildTime) || 0)),
    building: !!e.building,
    buildLeft: Math.max(0, Math.round(Number(e.buildLeft) || 0)),
    yieldGold: Math.max(0, Math.round(Number(e.yieldGold) || 0)),
    yieldSP: Math.max(0, Math.round(Number(e.yieldSP) || 0)),
    yieldItems: Array.isArray(e.yieldItems) ? e.yieldItems : [],
    serviceKind: e.serviceKind || "",                              // service: restoreHP|restoreEnergy|fullRest|cleanse
    stock: Array.isArray(e.stock) ? e.stock : [],                  // vendor: shop stock snapshots
    drawFromShop: !!e.drawFromShop,
    rateBuy: Math.round(Number(e.rateBuy) || 0),
    rateSell: Math.round(Number(e.rateSell) || 0),
    recipes: Array.isArray(e.recipes) ? e.recipes.map(normalizeRecipe) : [], // workshop: craft recipes (resource → item)
    boonChanges: Array.isArray(e.boonChanges) ? e.boonChanges.map((c) => ({ attr: c.attr || "", value: Math.round(Number(c.value) || 0) })) : [], // legacy attribute-only boon
    boonRules: Array.isArray(e.boonRules) ? e.boonRules : [],       // passive boon: full Effect-Builder rule list (the rich boon)
    upgradeTarget: e.upgradeTarget || ""                           // upgrade: the facility id it raises each turn
  };
}

/** A fresh standalone FACILITY (GM-built). Facilities are their own first-class thing — the GM raises
 *  one directly and configures its kind/tier/output in the facility book; they are NOT spawned by
 *  recruiting a person. Defaults to a `service` kind, owner-less (staffing is a later, optional link). */
export function blankFacility() {
  return normalizeFacility({ role: "service" });
}

/** Split a legacy fused `recruits[]` (each = person + facility) into separate people + facilities.
 *  Every recruit becomes a Person; a recruited facility-vocation recruit also spawns a Facility it
 *  staffs (deterministic id). Legacy upgrade targets (a recruit id) are remapped to the new facility id. */
function splitLegacyRecruits(recruits) {
  const people = [];
  const facilities = [];
  for (const raw of recruits) {
    const r = normalizeRecruit(raw);
    const makesFacility = r.recruited && FACILITY_ROLES.includes(r.role);
    const fid = makesFacility ? facilityIdFor(r.id) : "";
    people.push(normalizePerson({
      id: r.id, npcUuid: r.npcUuid, name: r.name, img: r.img, role: r.role,
      condition: r.condition, effect: r.effect, recruited: r.recruited, unlocked: r.unlocked, facilityId: fid,
      status: r.status, assignedMissionId: r.assignedMissionId, returnsTurn: r.returnsTurn, woundedUntil: r.woundedUntil
    }));
    if (makesFacility) {
      facilities.push(normalizeFacility({
        id: fid, staffIds: [r.id], npcUuid: r.npcUuid, name: r.name, img: r.img, role: r.role,
        facilityTier: r.facilityTier, yieldGold: r.yieldGold, yieldSP: r.yieldSP, yieldItems: r.yieldItems,
        serviceKind: r.serviceKind, stock: r.stock, drawFromShop: r.drawFromShop,
        rateBuy: r.rateBuy, rateSell: r.rateSell, boonChanges: r.boonChanges, upgradeTarget: r.upgradeTarget
      }));
    }
  }
  // Legacy upgradeTarget referenced the target's RECRUIT id → remap to that target's new facility id.
  for (const f of facilities) {
    if (f.role === "upgrade" && f.upgradeTarget) {
      const t = facilities.find((x) => Array.isArray(x.staffIds) && x.staffIds.includes(f.upgradeTarget));
      f.upgradeTarget = t ? t.id : "";
    }
  }
  return { people, facilities };
}

/** Normalize one dispatch mission (idempotent). A mission tests a STAT vs a DIFFICULTY rather than a
 *  flat success %, so legacy missions (which only had `successChance`) convert on read to the
 *  dispatch-canonical Exploration Talent at a mid difficulty — re-tune as needed. The old
 *  `successChance` / `permadeath` keys are simply not copied, so saving sheds them. */
function normalizeMission(m) {
  return {
    id: m.id || foundry.utils.randomID(),
    title: m.title || "",
    img: m.img || "",
    tier: Math.min(5, Math.max(1, Number(m.tier) || 1)),
    durationTurns: Math.max(1, Math.round(Number(m.durationTurns) || 1)),
    stat: m.stat || "talent.exploration",                      // which Talent/Attribute the squad rolls
    difficulty: Math.max(1, Math.round(Number(m.difficulty) || 8)), // target number the team total must clear
    rewardGold: Math.max(0, Math.round(Number(m.rewardGold) || 0)),
    rewardSP: Math.max(0, Math.round(Number(m.rewardSP) || 0)),
    rewardItems: Array.isArray(m.rewardItems) ? m.rewardItems : []
  };
}

/** Normalize one WORKSHOP recipe (idempotent). A recipe turns a resource cost into one output item (a
 *  dropped snapshot), gated by the workshop's own built tier (`minTier`) and, optionally, prerequisite
 *  facilities (`requires` — each {facilityId, tier}). `craftTime` = HQ turns the craft takes (min 1;
 *  crafting is downtime work that resolves on the HQ Turn). The output rides the same item-snapshot
 *  pipeline as quest rewards / facility yields, so a finished craft lands in the party stash. */
function normalizeRecipe(r) {
  const e = r && typeof r === "object" ? r : {};
  return {
    id: e.id || foundry.utils.randomID(),
    name: e.name || "",
    img: e.img || "",
    cost: normalizeResources(e.cost),                                       // {resourceKey: amount} from the HQ pool
    output: (e.output && typeof e.output === "object") ? e.output : null,    // item snapshot (item.toObject())
    minTier: Math.min(3, Math.max(0, Math.round(Number(e.minTier) || 0))),   // the Workshop's own tier this needs
    requires: Array.isArray(e.requires)                                      // other facilities that must be built
      ? e.requires.map((q) => ({ facilityId: q?.facilityId || "", tier: Math.min(3, Math.max(1, Math.round(Number(q?.tier) || 1))) })).filter((q) => q.facilityId)
      : [],
    craftTime: Math.max(1, Math.round(Number(e.craftTime) || 1))             // HQ turns to finish
  };
}

/** A fresh recipe (the GM authors it in the Workshop window). */
export function blankRecipe() {
  return normalizeRecipe({});
}

/** Normalize one in-progress CRAFT JOB (idempotent). Each job carries its OWN self-contained output
 *  snapshot + display info, so editing or deleting the source recipe mid-craft never corrupts a queued
 *  job. `turnsLeft` counts down on the HQ Turn; at 0 the output is delivered to the party stash. */
function normalizeCraftJob(j) {
  const e = j && typeof j === "object" ? j : {};
  return {
    id: e.id || foundry.utils.randomID(),
    facilityId: e.facilityId || "",
    name: e.name || "",
    img: e.img || "",
    output: (e.output && typeof e.output === "object") ? e.output : null,
    turnsLeft: Math.max(0, Math.round(Number(e.turnsLeft) || 0))
  };
}

/** Normalize one v0.03 BUILT FACILITY (idempotent) — a catalog facility (or custom, up to 3) built once
 *  with Gold, run by a resident steward. The engine + UI live in helpers/hq.mjs; this just keeps the
 *  shape stable on the shared `covenantHQ` object. */
function normalizeBuiltFacility(f) {
  const e = f && typeof f === "object" ? f : {};
  const rankKeys = globalThis.CONFIG?.PROJECTANIME?.hqRankKeys ?? ["C", "B", "A", "S"];
  return {
    id: e.id || foundry.utils.randomID(),
    key: e.custom ? "" : (e.key || ""),                              // catalog key, or "" for custom
    custom: !!e.custom,
    name: e.name || "",
    img: e.img || "",
    stewardUuid: e.stewardUuid || "",                               // NPC uuid of the resident stewarding
    upgraded: !!e.upgraded,
    gatherType: e.gatherType || "",                                 // Gathering Grounds chosen Common type(s)
    gatherType2: e.gatherType2 || "",
    // custom-only Four-Rails fields (printed lines the GM authors):
    rank: rankKeys.includes(e.rank) ? e.rank : "C",
    cost: Math.max(0, Math.round(Number(e.cost) || 0)),
    upgradeCost: Math.max(0, Math.round(Number(e.upgradeCost) || 0)),
    unstaffed: e.unstaffed || "", staffed: e.staffed || "", favor: e.favor || "", upgrade: e.upgrade || ""
  };
}

/** Normalize one v0.03 MISSION BOARD posting (idempotent). Residents dispatched while the party is away;
 *  resolves on a party rest via a 2d6 Check (helpers/hq.mjs). */
function normalizeBoardMission(m) {
  const e = m && typeof m === "object" ? m : {};
  const types = globalThis.CONFIG?.PROJECTANIME?.missionTypes ?? {};
  return {
    id: e.id || foundry.utils.randomID(),
    title: e.title || "",
    img: e.img || "",
    type: types[e.type] ? e.type : "scout",
    duration: Math.min(3, Math.max(1, Math.round(Number(e.duration) || 1))),
    suited: Array.isArray(e.suited) ? e.suited.filter(Boolean).slice(0, 2) : [],
    hard: !!e.hard,
    risk: e.risk || "",
    reward: e.reward || "",
    rewardGold: Math.max(0, Math.round(Number(e.rewardGold) || 0)),
    rewardItems: Array.isArray(e.rewardItems) ? e.rewardItems : [],
    team: Array.isArray(e.team) ? e.team.filter(Boolean).slice(0, 3) : [],
    status: ["open", "active", "done", "failed"].includes(e.status) ? e.status : "open",
    result: e.result || "",
    restsLeft: Math.max(0, Math.round(Number(e.restsLeft) || 0))
  };
}

/** Normalize the HQ (idempotent; tolerates a never-saved {}). Carries the legacy People/Facilities layer
 *  (unsurfaced since v0.3.5 — pools/dispatch retired) alongside the v0.03 fields the doc's HQ runs on
 *  (`established`, `rank`, `built`, `board`; engine in helpers/hq.mjs). A pre-split world stores the old
 *  layer fused in `recruits[]` — still derived on read so nothing throws. */
export function normalizeHQ(hq) {
  const h = hq && typeof hq === "object" ? hq : {};
  let people, facilities;
  if (Array.isArray(h.people) || Array.isArray(h.facilities)) {
    people = (Array.isArray(h.people) ? h.people : []).map(normalizePerson);
    facilities = (Array.isArray(h.facilities) ? h.facilities : []).map(normalizeFacility);
  } else {
    ({ people, facilities } = splitLegacyRecruits(Array.isArray(h.recruits) ? h.recruits : []));
  }
  return {
    name: h.name ?? "",
    crest: h.crest ?? "",                                            // crest emblem image (was a text glyph)
    accent: h.accent || "#d8b257",
    motto: h.motto ?? "",
    banner: h.banner ?? "",
    bannerPos: {                                                     // hero-banner focal point (drag to reposition), % offsets
      x: Number.isFinite(h.bannerPos?.x) ? Math.max(0, Math.min(100, h.bannerPos.x)) : 50,
      y: Number.isFinite(h.bannerPos?.y) ? Math.max(0, Math.min(100, h.bannerPos.y)) : 50
    },
    turn: Math.max(0, Math.round(Number(h.turn) || 0)),             // the HQ downtime clock (Advance HQ Turn)
    levelAdjust: Math.round(Number(h.levelAdjust) || 0),            // GM manual nudge to the HQ Level (offset off the facility-tier sum; see hqLevel)
    resources: normalizeResources(h.resources),                     // Civ-style resource stockpile {key:amount}
    people,
    facilities,
    missions: (Array.isArray(h.missions) ? h.missions : []).map(normalizeMission),
    crafting: (Array.isArray(h.crafting) ? h.crafting : []).map(normalizeCraftJob), // in-progress craft jobs (Workshop)

    // v0.03 Headquarters (the doc's model; engine in helpers/hq.mjs). Additive so the legacy layer above
    // keeps loading; the Home tab and rest/shop wiring read only these.
    established: !!h.established,
    rank: (globalThis.CONFIG?.PROJECTANIME?.hqRankKeys ?? ["C", "B", "A", "S"]).includes(h.rank) ? h.rank : "C",
    built: (Array.isArray(h.built) ? h.built : []).map(normalizeBuiltFacility),
    board: (Array.isArray(h.board) ? h.board : []).map(normalizeBoardMission)
  };
}

/** The party HQ (a safe, normalized deep copy you can mutate before saveHQ). */
export function getHQ() {
  return normalizeHQ(foundry.utils.deepClone(game.settings.get("project-anime", HQ_SETTING) ?? {}));
}

/** The HQ's effective LEVEL: the sum of built facility tiers (each 0–3) plus the GM's manual nudge
 *  (`levelAdjust`, which may be negative), floored at 0. The single source of truth for the header
 *  badge AND the `hqLevel` recruit gate, so they never drift. Building a facility raises it; the GM's
 *  ± offset rides on top. */
export function hqLevel(hq) {
  const base = (hq?.facilities ?? []).reduce((n, f) => n + Math.min(3, Math.max(0, Number(f.facilityTier) || 0)), 0);
  return Math.max(0, base + Math.round(Number(hq?.levelAdjust) || 0));
}

/** Persist the HQ (GM only — world-scoped). */
export async function saveHQ(hq) {
  return game.settings.set("project-anime", HQ_SETTING, hq);
}

/* -------------------------------------------------------------------------- */
/*  Tier rewards & standing changes                                           */
/* -------------------------------------------------------------------------- */

/**
 * Deliver a set of tiers' authored rewards to the party (GM only), mirroring the CHRONICLE pipeline:
 * Gold → the party treasury, SP → every party member's pool, Items → snapshot copies in the party
 * stash. Posts one summary chat card. Returns the totals, or null when there's nothing to pay or no
 * party to receive it (the caller then leaves those tiers unmarked so a later change retries).
 */
async function deliverTierRewards(faction, tierKeys) {
  const keys = new Set(tierKeys);
  let gold = 0, sp = 0;
  const itemObjs = [];
  for (const p of faction.perks ?? []) {
    if (!keys.has(p.tier)) continue;
    gold += Number(p.rewardGold) || 0;
    sp += Number(p.rewardSP) || 0;
    for (const snap of p.rewardItems ?? []) {
      const obj = foundry.utils.deepClone(snap);
      delete obj._id;
      itemObjs.push(obj);
    }
  }
  if (gold <= 0 && sp <= 0 && !itemObjs.length) return null;

  const party = await resolveParty();
  if (!party) { ui.notifications?.warn(game.i18n.localize("PROJECTANIME.Chronicle.noParty")); return null; }
  const members = partyMembers(party);

  if (sp > 0 && members.length) {
    await Promise.all(
      members.map((m) => m.update({ "system.skillPoints.value": (m.system.skillPoints?.value ?? 0) + sp }))
    );
  }
  if (gold > 0) await party.update({ "system.gold": (party.system.gold ?? 0) + gold });
  if (itemObjs.length) await party.createEmbeddedDocuments("Item", itemObjs);

  const parts = [];
  if (gold > 0) parts.push(`${gold} ${game.i18n.localize("PROJECTANIME.Bond.gold")}`);
  if (sp > 0) parts.push(`${sp} ${game.i18n.localize("PROJECTANIME.Bond.sp")}`);
  if (itemObjs.length) parts.push(itemObjs.map((o) => o.name).join(", "));
  const tierLabel = game.i18n.localize(`PROJECTANIME.Covenant.tier.${tierForStanding(faction.standing).key}`);
  ChatMessage.create({
    speaker: { alias: faction.name },
    content: cardHTML({
      icon: isImageIcon(faction.crest) ? faction.crest : "",
      glyph: isImageIcon(faction.crest) ? "" : "fa-award",
      title: faction.name,
      subtitle: tierLabel,
      lines: [game.i18n.format("PROJECTANIME.Covenant.tierRewardGranted", { tier: tierLabel, rewards: parts.join(" · ") })]
    })
  });
  return { gold, sp, items: itemObjs.length, party: party.name };
}

/**
 * Set a faction's standing to an absolute value (GM only) and pay out any tiers newly crossed upward.
 * Tier payouts are sticky: a tier in `rewardedTiers` never pays again, so lowering then re-raising
 * standing can't double-dip. Tiers with no authored reward are simply acknowledged; a tier WITH a
 * reward is marked only once its delivery actually lands (so a missing party retries later).
 * Persisting re-renders every open Codex (see the setting's onChange). Returns
 * `{ before, standing, crossed, delivered }`, or null for a non-GM / unknown faction.
 */
export async function setFactionStanding(factionId, value) {
  if (!game.user.isGM) return null;
  const factions = getFactions();
  const f = factionById(factionId, factions);
  if (!f) return null;
  const before = clampStanding(f.standing);
  f.standing = clampStanding(value);

  const rewarded = new Set(f.rewardedTiers ?? []);
  const crossed = STANDING_TIERS.filter((t) => f.standing >= t.min && !rewarded.has(t.key)).map((t) => t.key);

  let delivered = null;
  if (crossed.length) {
    const perkByTier = Object.fromEntries((f.perks ?? []).map((p) => [p.tier, p]));
    const paid = (k) => {
      const p = perkByTier[k];
      return !!p && ((Number(p.rewardGold) || 0) > 0 || (Number(p.rewardSP) || 0) > 0 || (p.rewardItems?.length > 0));
    };
    const payTiers = crossed.filter(paid);
    for (const k of crossed) if (!payTiers.includes(k)) rewarded.add(k); // empty tiers: acknowledge
    if (payTiers.length) {
      delivered = await deliverTierRewards(f, payTiers);
      if (delivered) for (const k of payTiers) rewarded.add(k);          // mark only once delivered
    }
    f.rewardedTiers = [...rewarded];
  }
  await saveFactions(factions);
  return { before, standing: f.standing, crossed, delivered };
}

/**
 * Set the SYMMETRIC relationship between two factions (GM only). `stance` is "ally", "rival", or "" /
 * any other value for neutral (the edge is removed from both sides). One persist re-renders the Codex.
 * Returns the stance actually stored, or null for a non-GM / bad pair.
 */
export async function setFactionRelation(aId, bId, stance) {
  if (!game.user.isGM || !aId || !bId || aId === bId) return null;
  const factions = getFactions();
  const a = factionById(aId, factions);
  const b = factionById(bId, factions);
  if (!a || !b) return null;
  const valid = RELATION_STANCES.includes(stance) ? stance : "";
  const setEdge = (f, otherId) => {
    f.relations = (f.relations ?? []).filter((r) => r.factionId !== otherId);
    if (valid) f.relations.push({ factionId: otherId, stance: valid });
  };
  setEdge(a, bId);
  setEdge(b, aId);
  await saveFactions(factions);
  return { stance: valid };
}

/* -------------------------------------------------------------------------- */
/*  Recruitment (the HQ recruit pool)                                          */
/* -------------------------------------------------------------------------- */

/** Is an HQ recruit available? `auto` always; `repTier` once its referenced world faction reaches
 *  the tier (the Layer-2 tie-in); `manual` only via the `unlocked` override. `recruited`/`unlocked` are
 *  universal overrides: a GM manual unlock OR a completed quest that lists this recruit as a reward
 *  (CHRONICLE → unlockRecruits) opens it regardless of its base condition. */
export function recruitAvailable(entry) {
  if (!entry) return false;
  if (entry.recruited || entry.unlocked) return true;
  const c = entry.condition ?? {};
  if (c.type === "repTier") {
    const f = factionById(c.factionId);
    const t = STANDING_TIERS.find((x) => x.key === c.tier);
    return clampStanding(f?.standing) >= (t?.min ?? 0);
  }
  if (c.type === "hqLevel") {
    return hqLevel(getHQ()) >= (Number(c.level) || 0);
  }
  if (c.type === "quest") {
    // Tied to a Chronicle quest: opens when that quest is marked complete ("done"). Read the world
    // setting directly to avoid importing the chronicle layer (which already imports this module).
    if (!c.questId) return false;
    const quests = game.settings.get("project-anime", "quests") ?? [];
    return (Array.isArray(quests) ? quests : []).some((q) => q.id === c.questId && q.status === "done");
  }
  if (c.type === "manual") return false; // opened only via the `unlocked` override above
  return true; // auto
}

/** A short recruit chat line under the HQ's name. */
function recruitCard(hq, entry) {
  const role = game.i18n.localize(`PROJECTANIME.Covenant.role.${entry.role}`);
  const alias = hq.name || game.i18n.localize("PROJECTANIME.HQ.title");
  return ChatMessage.create({
    speaker: { alias },
    content: cardHTML({
      icon: isImageIcon(entry.img) ? entry.img : "",
      glyph: isImageIcon(entry.img) ? "" : "fa-user-plus",
      title: entry.name || alias,
      subtitle: role,
      lines: [game.i18n.format("PROJECTANIME.Covenant.recruitedCard", { name: entry.name, role })]
    })
  });
}

/**
 * Recruit an HQ pool member (GM only) once its condition is met — marks it recruited and posts a chat
 * card. Recruiting is purely about PEOPLE (one kind of recruit, all dispatch-capable); facilities are
 * their own first-class thing the GM builds directly, so recruiting never raises one.
 */
export async function recruitMember(entryId) {
  if (!game.user.isGM) return null;
  const hq = getHQ();
  const person = hq.people.find((e) => e.id === entryId);
  if (!person || person.recruited || !recruitAvailable(person)) return null;
  person.recruited = true;
  await saveHQ(hq);
  recruitCard(hq, person);
  return { name: person.name, role: person.role };
}

/* -------------------------------------------------------------------------- */
/*  Facility construction (resource-gated, tiered — the merged Structures layer) */
/* -------------------------------------------------------------------------- */

/** Facility tier cap (shared with the pips + clamps). */
const FACILITY_MAX_TIER = 3;

/** A chat line under the HQ's name — either "built X to Tier N" (instant) or "construction of X
 *  begun — Tier N in M turns" (timed) — listing the resources spent. */
function facilityBuildCard(hq, f, spent, { started, tier, turns }) {
  const alias = hq.name || game.i18n.localize("PROJECTANIME.HQ.title");
  const name = f.name || game.i18n.localize("PROJECTANIME.HQ.newFacility");
  const msg = started
    ? game.i18n.format("PROJECTANIME.HQ.buildStarted", { name, tier, turns })
    : game.i18n.format("PROJECTANIME.HQ.facilityBuiltCard", { name, tier });
  const meta = Object.entries(spent).map(([k, v]) => `−${v} ${materialCategoryLabel(k)}`);
  return ChatMessage.create({
    speaker: { alias },
    content: cardHTML({
      icon: isImageIcon(f.img) ? f.img : "",
      glyph: isImageIcon(f.img) ? "" : "fa-helmet-safety",
      title: name,
      subtitle: alias,
      meta,
      lines: [msg]
    })
  });
}

/**
 * Build or upgrade a Facility one tier — the resource transaction (GM-executed; player requests relay
 * to the GM in a later slice). The cost to reach the next tier is the facility's BASE cost × that tier
 * (escalating; 0→1 costs base ×1, 1→2 costs ×2, …). Verifies the HQ stockpile covers it and deducts it,
 * then EITHER raises the tier immediately (buildTime 0) or queues a timed construction that completes on
 * the HQ Turn (sets `building`/`buildLeft`). Returns null (with a warning) if it's already under
 * construction, at the tier cap, or resources fall short — nothing is spent on a failed build.
 */
export async function buildFacility(facilityId) {
  if (!game.user.isGM) return null;
  const hq = getHQ();
  const f = hq.facilities.find((e) => e.id === facilityId);
  if (!f) return null;
  const label = f.name || game.i18n.localize("PROJECTANIME.HQ.newFacility");
  if (f.building) { ui.notifications.warn(game.i18n.format("PROJECTANIME.HQ.alreadyBuilding", { name: label })); return null; }
  if (f.facilityTier >= FACILITY_MAX_TIER) { ui.notifications.warn(game.i18n.format("PROJECTANIME.HQ.facilityMaxed", { name: label })); return null; }
  const nextTier = f.facilityTier + 1;
  const need = {};
  for (const [k, v] of Object.entries(f.cost ?? {})) { const amt = Math.max(0, Math.round(Number(v) || 0)) * nextTier; if (amt > 0) need[k] = amt; }
  const short = Object.entries(need).find(([k, v]) => Math.max(0, Math.round(Number(hq.resources[k]) || 0)) < v);
  if (short) { ui.notifications.warn(game.i18n.format("PROJECTANIME.HQ.facilityCantAfford", { name: label })); return null; }
  for (const [k, v] of Object.entries(need)) hq.resources[k] = Math.max(0, (Number(hq.resources[k]) || 0) - v);
  const time = Math.max(0, Math.round(Number(f.buildTime) || 0));
  if (time <= 0) {
    f.facilityTier = nextTier;
    await saveHQ(hq);
    facilityBuildCard(hq, f, need, { started: false, tier: nextTier });
    return { name: f.name, tier: nextTier };
  }
  f.building = true;
  f.buildLeft = time;
  await saveHQ(hq);
  facilityBuildCard(hq, f, need, { started: true, tier: nextTier, turns: time });
  return { name: f.name, building: true, turns: time };
}

/**
 * Unlock one or more recruit-pool entries by id (GM only) — the CHRONICLE calls this when a quest that
 * lists a "recruit" reward is completed. Sets the universal `unlocked` override so the recruit becomes
 * available in the pool regardless of its base condition. Idempotent; returns the names actually opened.
 */
export async function unlockRecruits(ids = []) {
  if (!game.user.isGM || !ids.length) return [];
  const hq = getHQ();
  const opened = [];
  for (const id of ids) {
    const e = hq.people.find((x) => x.id === id);
    if (e && !e.recruited && !e.unlocked) { e.unlocked = true; opened.push(e.name || "—"); }
  }
  if (opened.length) await saveHQ(hq);
  return opened;
}

/* -------------------------------------------------------------------------- */
/*  The HQ Turn — the downtime tick that pays out facility output             */
/* -------------------------------------------------------------------------- */

/** Minimal HTML escape for GM-authored names dropped into a chat card. */
const escHQ = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* -------------------------------------------------------------------------- */
/*  Staffing — station Residents at a Facility (Phase 2, multiple by tier)     */
/* -------------------------------------------------------------------------- */

/** A facility's resident CAPACITY = its built tier (Lv.1 → 1 slot, Lv.2 → 2, Lv.3 → 3; an unbuilt
 *  tier-0 blueprint holds none). */
export function facilityStaffCap(facility) {
  return Math.min(FACILITY_MAX_TIER, Math.max(0, Math.round(Number(facility?.facilityTier) || 0)));
}

/**
 * Station a Roster person at a facility (GM UI helper): adds them to its residents (up to the tier
 * capacity) and points their `facilityId` here, vacating any facility they previously staffed. No-op if
 * the facility is full or they're already a resident. Mutates the passed hq in place; the caller saves.
 */
export function assignStaff(hq, facilityId, personId) {
  const f = hq.facilities.find((x) => x.id === facilityId);
  const person = hq.people.find((p) => p.id === personId);
  if (!f || !person) return;
  f.staffIds = Array.isArray(f.staffIds) ? f.staffIds : [];
  if (f.staffIds.includes(personId)) return;
  if (f.staffIds.length >= facilityStaffCap(f)) return;            // full for its tier
  // A person staffs one facility at a time — vacate their previous post first.
  if (person.facilityId && person.facilityId !== facilityId) {
    const g = hq.facilities.find((x) => x.id === person.facilityId);
    if (g) g.staffIds = (g.staffIds || []).filter((id) => id !== personId);
  }
  f.staffIds.push(personId);
  person.facilityId = facilityId;
}

/** Remove a person from whichever facility they staff (GM UI helper). Mutates the passed hq; caller saves. */
export function unassignStaff(hq, personId) {
  for (const f of hq.facilities) if (Array.isArray(f.staffIds)) f.staffIds = f.staffIds.filter((id) => id !== personId);
  const person = hq.people.find((p) => p.id === personId);
  if (person) person.facilityId = "";
}

/**
 * Advance the HQ by one downtime turn (GM only). In a single pass it: collects every staffed facility's
 * per-turn output (a generic gold / SP / item yield scaled by tier, plus a `service` facility's
 * restoration of party vitals); resolves each DISPATCH mission whose squad returns this turn — every
 * sent agent rolls their backing NPC's die for the mission's stat (a Talent or an Attribute) plus their
 * Trait Bonuses, and the squad's totals SUM into one team check vs the mission difficulty (success →
 * the mission rewards, boosted by the squad's hq.gold/hq.sp Trait Bonuses; failure → the whole squad
 * wounded). A natural 1 on an agent's die adds a death-strike, and three strikes claims them (the
 * opt-in variant) even on a winning mission. Wounded agents return once recovered; the accumulated
 * payout is delivered the way faction-tier rewards are (gold → treasury, SP → each member, items →
 * stash); the turn counter bumps; and ONE digest chat card is posted.
 *
 * Advancing IS the payout, so it's inherently idempotent: clicking again is the NEXT turn, never a
 * re-pay of the current one. Mercenary-role recruits fight alongside the group (no facility) and agents
 * away on a mission produce nothing while gone. Returns the digest, or null for a non-GM (or when a
 * payout is pending but no party can receive it — the turn is then left unspent so nothing is lost).
 */
export async function advanceHQTurn() {
  if (!game.user.isGM) return null;
  const hq = getHQ();
  const newTurn = (Number(hq.turn) || 0) + 1;

  const facilities = hq.facilities;
  let gold = 0, sp = 0;
  const itemObjs = [];
  const resGained = {};                                               // resourceKey → total gathered this turn
  const lines = []; // digest lines: { name, summary }
  for (const e of facilities) {
    const tier = Math.min(3, Math.max(0, Number(e.facilityTier) || 0));
    if (tier <= 0) continue;                                          // unbuilt blueprint — produces nothing
    const fGold = (Number(e.yieldGold) || 0) * tier;                  // the facility's base floor (no staff boost)
    const fSP = (Number(e.yieldSP) || 0) * tier;
    const fItems = [];
    for (const snap of e.yieldItems ?? []) {
      const obj = foundry.utils.deepClone(snap);
      delete obj._id;
      fItems.push(obj);
    }
    gold += fGold; sp += fSP; itemObjs.push(...fItems);

    // Trait-driven gathering (Phase 3): each PRESENT resident gathers an HQ resource via their `gather`
    // trait-rules, but only the resources this facility ACCEPTS are credited (the "fit"). No fit → nothing.
    const accepts = new Set(Array.isArray(e.accepts) ? e.accepts : []);
    const fGather = {};                                               // resourceKey → amount, this facility (digest)
    if (accepts.size) {
      for (const pid of e.staffIds ?? []) {
        const p = hq.people.find((x) => x.id === pid);
        if (!p || !p.recruited || p.status === "away") continue;
        const npc = p.npcUuid ? await fromUuid(p.npcUuid).catch(() => null) : null;
        if (!npc) continue;
        for (const [k, v] of Object.entries(collectGather(npc))) {
          if (!accepts.has(k) || !(v > 0)) continue;
          fGather[k] = (fGather[k] || 0) + v;
          resGained[k] = (resGained[k] || 0) + v;
        }
      }
    }

    const parts = [];
    if (fGold) parts.push(`${fGold} ${game.i18n.localize("PROJECTANIME.Bond.gold")}`);
    if (fSP) parts.push(`${fSP} ${game.i18n.localize("PROJECTANIME.Bond.sp")}`);
    if (fItems.length) parts.push(fItems.map((o) => o.name).join(", "));
    for (const [k, v] of Object.entries(fGather)) parts.push(`${v} ${materialCategoryLabel(k)}`);
    if (e.role === "service" && e.serviceKind) parts.push(game.i18n.localize(`PROJECTANIME.HQ.serviceKind.${e.serviceKind}`));
    if (parts.length) lines.push({ name: e.name, summary: parts.join(" · ") });
  }

  // Recover the wounded (per-agent; independent of any mission).
  for (const e of hq.people) {
    if (e.status === "wounded" && (Number(e.woundedUntil) || 0) <= newTurn) {
      e.status = ""; e.woundedUntil = 0;
      lines.push({ name: e.name, summary: game.i18n.localize("PROJECTANIME.HQ.recovered") });
    }
  }

  // Resolve returning dispatch squads — group the returning agents by mission so a squad rolls ONE
  // team check (the Sum rule): each member rolls their stat die + Trait Bonuses, the totals sum vs the
  // mission difficulty. A natural 1 adds a death-strike (variant); three strikes is fatal, even on a
  // win. State changes only persist if the turn actually commits below.
  const killed = [];
  const strikeOn = deathStrikesEnabled();
  const byMission = new Map();
  for (const e of hq.people) {
    if (e.status === "away" && (Number(e.returnsTurn) || 0) <= newTurn) {
      const list = byMission.get(e.assignedMissionId) || [];
      list.push(e);
      byMission.set(e.assignedMissionId, list);
    }
  }
  for (const [mid, squad] of byMission) {
    for (const e of squad) { e.assignedMissionId = ""; e.returnsTurn = 0; }
    const m = (hq.missions ?? []).find((x) => x.id === mid);
    if (!m) { for (const e of squad) e.status = ""; continue; } // mission deleted mid-flight → just come home
    const mTitle = m.title || game.i18n.localize("PROJECTANIME.HQ.missionUntitled");
    const dc = Math.max(1, Math.round(Number(m.difficulty) || 1));

    // Roll each member: their stat die + Trait Bonuses; accrue the team total + reward boosts + strikes.
    let teamTotal = 0, goldBoost = 0, spBoost = 0;
    const rolls = [];
    for (const e of squad) {
      const npc = e.npcUuid ? await fromUuid(e.npcUuid).catch(() => null) : null;
      const { formula, faces } = statDieFor(npc, m.stat);
      const bonus = statBonusFor(npc, m.stat);
      const roll = await new Roll(formula).evaluate();
      const nat = Number(roll.dice?.[0]?.results?.[0]?.result ?? roll.total) || 0;
      teamTotal += (Number(roll.total) || 0) + bonus;
      goldBoost += hqRewardBonus(npc, "gold");
      spBoost += hqRewardBonus(npc, "sp");
      const bstr = bonus ? (bonus > 0 ? `+${bonus}` : `${bonus}`) : "";
      rolls.push(`${e.name} d${faces}→${nat}${bstr}`); // summary is escHQ'd whole at render — keep raw here
      if (strikeOn && nat === 1) {
        e.deathStrikes = (Number(e.deathStrikes) || 0) + 1;
        if (e.deathStrikes >= DEATH_STRIKES) killed.push(e.id);
      }
    }
    const success = teamTotal >= dc;
    const statLabel = statLabelFor(m.stat);
    const rollStr = rolls.join(", ");

    if (success) {
      const mGold = Math.max(0, Math.round(Number(m.rewardGold) || 0)) + goldBoost;
      const mSP = Math.max(0, Math.round(Number(m.rewardSP) || 0)) + spBoost;
      const mItems = [];
      for (const snap of m.rewardItems ?? []) { const o = foundry.utils.deepClone(snap); delete o._id; mItems.push(o); }
      gold += mGold; sp += mSP; itemObjs.push(...mItems);
      for (const e of squad) if (!killed.includes(e.id)) e.status = "";
      const rparts = [];
      if (mGold) rparts.push(`${mGold} ${game.i18n.localize("PROJECTANIME.Bond.gold")}`);
      if (mSP) rparts.push(`${mSP} ${game.i18n.localize("PROJECTANIME.Bond.sp")}`);
      if (mItems.length) rparts.push(mItems.map((o) => o.name).join(", "));
      lines.push({ name: mTitle, summary: game.i18n.format("PROJECTANIME.HQ.missionWonRoll", {
        stat: statLabel, dc, rolls: rollStr, total: teamTotal,
        rewards: rparts.join(" · ") || game.i18n.localize("PROJECTANIME.HQ.missionNoReward")
      }) });
    } else {
      for (const e of squad) if (!killed.includes(e.id)) { e.status = "wounded"; e.woundedUntil = newTurn + WOUND_TURNS; }
      lines.push({ name: mTitle, summary: game.i18n.format("PROJECTANIME.HQ.missionLostRoll", {
        stat: statLabel, dc, rolls: rollStr, total: teamTotal
      }) });
    }
    for (const e of squad) if (killed.includes(e.id)) lines.push({ name: e.name, summary: game.i18n.localize("PROJECTANIME.HQ.agentDied") });
  }
  if (killed.length) hq.people = hq.people.filter((e) => !killed.includes(e.id));

  // Upgrade facilities raise their target facility's tier by 1 (cap 3) each turn. The bump applies
  // NEXT turn (this turn's yields were already collected at the old tier).
  for (const e of hq.facilities) {
    if (e.role !== "upgrade" || !e.upgradeTarget) continue;
    if ((Number(e.facilityTier) || 0) <= 0) continue;                // an unbuilt upgrader does nothing
    const t = hq.facilities.find((x) => x.id === e.upgradeTarget);
    if (!t) continue;
    const cur = Math.min(3, Math.max(1, Number(t.facilityTier) || 1));
    if (cur >= 3) continue;
    t.facilityTier = cur + 1;
    lines.push({ name: e.name, summary: game.i18n.format("PROJECTANIME.HQ.upgraded", { target: t.name || game.i18n.localize("PROJECTANIME.HQ.facility"), tier: t.facilityTier }) });
  }

  // Resolve in-progress timed construction: tick each building facility down; on completion raise its
  // tier (it begins producing next turn). Persists with the turn below.
  for (const e of hq.facilities) {
    if (!e.building) continue;
    e.buildLeft = Math.max(0, (Number(e.buildLeft) || 0) - 1);
    const who = e.name || game.i18n.localize("PROJECTANIME.HQ.facility");
    if (e.buildLeft <= 0) {
      e.building = false;
      e.facilityTier = Math.min(FACILITY_MAX_TIER, (Number(e.facilityTier) || 0) + 1);
      lines.push({ name: who, summary: game.i18n.format("PROJECTANIME.HQ.buildComplete", { tier: e.facilityTier }) });
    } else {
      lines.push({ name: who, summary: game.i18n.format("PROJECTANIME.HQ.buildProgress", { n: e.buildLeft }) });
    }
  }

  // Resolve in-progress CRAFTING: tick each queued job down; a finished craft pushes its output into the
  // shared itemObjs payout below (so it's delivered to the party stash, and the no-party abort equally
  // protects an undelivered craft — the decrement is discarded with the unspent turn).
  if (Array.isArray(hq.crafting) && hq.crafting.length) {
    const stillCrafting = [];
    for (const job of hq.crafting) {
      const left = Math.max(0, (Number(job.turnsLeft) || 0) - 1);
      const who = job.name || game.i18n.localize("PROJECTANIME.Workshop.recipeUntitled");
      if (left <= 0) {
        if (job.output) { const o = foundry.utils.deepClone(job.output); delete o._id; itemObjs.push(o); }
        lines.push({ name: who, summary: game.i18n.localize("PROJECTANIME.Workshop.crafted") });
      } else {
        job.turnsLeft = left;
        stillCrafting.push(job);
        lines.push({ name: who, summary: game.i18n.format("PROJECTANIME.Workshop.crafting", { n: left }) });
      }
    }
    hq.crafting = stillCrafting;
  }

  const svc = facilities.filter((e) => e.role === "service" && e.serviceKind && (Number(e.facilityTier) || 0) > 0);
  const hasPayout = gold > 0 || sp > 0 || itemObjs.length > 0 || svc.length > 0;

  const party = await resolveParty();
  const members = party ? partyMembers(party) : [];
  if (hasPayout && !party) {
    ui.notifications?.warn(game.i18n.localize("PROJECTANIME.Chronicle.noParty"));
    return null; // leave the turn unspent so nothing is lost
  }

  // Service restores: take the strongest outcome across all service facilities, one update per member.
  if (svc.length && members.length) {
    const kinds = new Set(svc.map((e) => e.serviceKind));
    const full = kinds.has("fullRest");
    await Promise.all(members.map((m) => {
      const sys = m.system;
      const upd = {};
      if (full || kinds.has("restoreHP")) {
        const cur = sys.hp?.value ?? 0, max = sys.hp?.max ?? 0;
        upd["system.hp.value"] = full ? max : Math.min(max, cur + Math.floor(max / 2));
      }
      if (full || kinds.has("restoreEnergy")) {
        const cur = sys.energy?.value ?? 0, max = sys.energy?.max ?? 0;
        upd["system.energy.value"] = full ? max : Math.min(max, cur + Math.floor(max / 2));
      }
      const jobs = [];
      if (Object.keys(upd).length) jobs.push(m.update(upd));
      if (kinds.has("cleanse")) for (const st of [...(m.statuses ?? [])]) jobs.push(m.toggleStatusEffect(st, { active: false }));
      return Promise.all(jobs);
    }));
  }

  if (sp > 0 && members.length) {
    await Promise.all(members.map((m) => m.update({ "system.skillPoints.value": (m.system.skillPoints?.value ?? 0) + sp })));
  }
  if (gold > 0 && party) await party.update({ "system.gold": (party.system.gold ?? 0) + gold });
  if (itemObjs.length && party) await party.createEmbeddedDocuments("Item", itemObjs);

  // Credit trait-gathered resources to the HQ stockpile (GM-owned; needs no party).
  for (const [k, v] of Object.entries(resGained)) hq.resources[k] = Math.max(0, (Number(hq.resources[k]) || 0) + Math.round(Number(v) || 0));

  hq.turn = newTurn;
  await saveHQ(hq);

  const head = hq.name || game.i18n.localize("PROJECTANIME.HQ.title");
  const digestLines = lines.length
    ? lines.map((l) => `<strong>${escHQ(l.name)}</strong> — <span class="muted">${escHQ(l.summary)}</span>`)
    : [`<em class="muted">${game.i18n.localize("PROJECTANIME.HQ.turnNothing")}</em>`];
  const meta = [];
  if (gold > 0) meta.push(`<i class="fas fa-coins"></i> +${gold} ${game.i18n.localize("PROJECTANIME.Bond.gold")}`);
  if (sp > 0) meta.push(`<i class="fas fa-star"></i> +${sp} ${game.i18n.localize("PROJECTANIME.Bond.sp")}`);
  if (itemObjs.length) meta.push(`<i class="fas fa-box-open"></i> ${itemObjs.length}`);
  ChatMessage.create({
    speaker: { alias: head },
    content: cardHTML({
      icon: isImageIcon(hq.crest) ? hq.crest : "",
      glyph: isImageIcon(hq.crest) ? "" : "fa-chess-rook",
      title: head,
      subtitle: game.i18n.format("PROJECTANIME.HQ.turnLabel", { n: newTurn }),
      meta,
      lines: digestLines
    })
  });
  return { turn: newTurn, gold, sp, items: itemObjs.length, lines: lines.length };
}

/* -------------------------------------------------------------------------- */
/*  Crafting — a Workshop facility turns HQ resources into items (timed)       */
/* -------------------------------------------------------------------------- */

/** The resource cost to craft one unit of `recipe`, as a `{ key: amount }` map (positive entries only). */
export function recipeCost(recipe) {
  const out = {};
  for (const [k, v] of Object.entries(recipe?.cost ?? {})) { const amt = Math.max(0, Math.round(Number(v) || 0)); if (amt > 0) out[k] = amt; }
  return out;
}

/** Can `recipe` be crafted at workshop `facility` right now? Returns { ok, reason } — `reason` is a
 *  localized blocker ("" when ok). Shared by craftRecipe (enforcement) and the Workshop window (greying
 *  out a recipe + explaining why). Affordability is checked against the HQ stockpile (`hq.resources`).
 *  Facility prerequisites are honored only while the CRAFT_REQUIRE_SETTING is on. */
export function recipeCraftable(hq, facility, recipe) {
  const tier = Math.min(3, Math.max(0, Number(facility?.facilityTier) || 0));
  if (tier <= 0) return { ok: false, reason: game.i18n.localize("PROJECTANIME.Workshop.needBuilt") };
  if (tier < (Number(recipe?.minTier) || 0)) return { ok: false, reason: game.i18n.format("PROJECTANIME.Workshop.needTier", { tier: recipe.minTier }) };
  if (craftRequireFacilities()) {
    for (const q of recipe?.requires ?? []) {
      const t = hq.facilities.find((x) => x.id === q.facilityId);
      const tt = Math.min(3, Math.max(0, Number(t?.facilityTier) || 0));
      if (!t || tt < q.tier) {
        const nm = t?.name || game.i18n.localize("PROJECTANIME.HQ.facility");
        return { ok: false, reason: game.i18n.format("PROJECTANIME.Workshop.needFacility", { name: nm, tier: q.tier }) };
      }
    }
  }
  const need = recipeCost(recipe);
  const short = Object.entries(need).find(([k, v]) => Math.max(0, Math.round(Number(hq.resources[k]) || 0)) < v);
  if (short) return { ok: false, reason: game.i18n.localize("PROJECTANIME.Workshop.cantAfford") };
  return { ok: true, reason: "" };
}

/** A chat line under the HQ's name: "began crafting X — ready in N turns", listing the resources spent. */
function craftStartCard(hq, recipe, spent, turns) {
  const alias = hq.name || game.i18n.localize("PROJECTANIME.HQ.title");
  const name = recipe.name || game.i18n.localize("PROJECTANIME.Workshop.recipeUntitled");
  const img = recipe.img || recipe.output?.img || "";
  const meta = Object.entries(spent).map(([k, v]) => `−${v} ${materialCategoryLabel(k)}`);
  meta.push(`<i class="fas fa-hourglass-half"></i> ${game.i18n.format("PROJECTANIME.Workshop.readyIn", { n: turns })}`);
  return ChatMessage.create({
    speaker: { alias },
    content: cardHTML({
      icon: isImageIcon(img) ? img : "",
      glyph: isImageIcon(img) ? "" : "fa-screwdriver-wrench",
      title: name,
      subtitle: game.i18n.localize("PROJECTANIME.Workshop.title"),
      meta
    })
  });
}

/**
 * Craft one unit of a Workshop recipe (GM-executed; the player request relays to the GM, mirroring
 * buildFacility). Validates craftability (workshop built + tier, facility prerequisites, resource cost),
 * deducts the cost from the HQ stockpile, and QUEUES a timed job that delivers the output item to the
 * party stash on a later HQ Turn (craftTime turns out). Returns null (with a warning; nothing spent) if
 * the recipe can't be crafted right now.
 */
export async function craftRecipe(facilityId, recipeId) {
  if (!game.user.isGM) return null;
  const hq = getHQ();
  const f = hq.facilities.find((e) => e.id === facilityId);
  if (!f || f.role !== "workshop") return null;
  const recipe = (f.recipes ?? []).find((r) => r.id === recipeId);
  if (!recipe) return null;
  const label = recipe.name || game.i18n.localize("PROJECTANIME.Workshop.recipeUntitled");
  if (!recipe.output) { ui.notifications.warn(game.i18n.format("PROJECTANIME.Workshop.noOutput", { name: label })); return null; }
  const { ok, reason } = recipeCraftable(hq, f, recipe);
  if (!ok) { ui.notifications.warn(reason || game.i18n.format("PROJECTANIME.Workshop.cantCraft", { name: label })); return null; }
  const need = recipeCost(recipe);
  for (const [k, v] of Object.entries(need)) hq.resources[k] = Math.max(0, (Number(hq.resources[k]) || 0) - v);
  const out = foundry.utils.deepClone(recipe.output); delete out._id;
  const turns = Math.max(1, Math.round(Number(recipe.craftTime) || 1));
  hq.crafting.push(normalizeCraftJob({ facilityId, name: label, img: recipe.img || out.img || "", output: out, turnsLeft: turns }));
  await saveHQ(hq);
  craftStartCard(hq, recipe, need, turns);
  return { name: label, turns };
}


/**
 * One-time (GM): fold any legacy per-faction `roster` entries into the single HQ recruit pool, then
 * shed the obsolete `roster` / `buildable` fields off every faction. Idempotent — a no-op once no
 * faction carries either field. A `repTier` recruit keeps its source faction (its standing gate) by
 * stamping `condition.factionId`. Runs from the ready hook so legacy recruits survive the redesign.
 */
export async function migrateRostersToHQ() {
  if (!game.user.isGM) return;
  const raw = game.settings.get("project-anime", FACTIONS_SETTING);
  if (!Array.isArray(raw)) return;
  const dirty = raw.some((f) => f && (("roster" in f) || ("buildable" in f)));
  if (!dirty) return;

  // Append any legacy per-faction roster into the HQ's legacy recruits[] (migrateHQModel then splits
  // it into people/facilities). Read RAW so we touch the legacy array directly, not the new shape.
  const rawHq = game.settings.get("project-anime", HQ_SETTING);
  const hq = (rawHq && typeof rawHq === "object") ? foundry.utils.deepClone(rawHq) : {};
  const alreadySplit = Array.isArray(hq.people) || Array.isArray(hq.facilities);
  if (!alreadySplit) {
    if (!Array.isArray(hq.recruits)) hq.recruits = [];
    if (!hq.recruits.length) {
      for (const f of raw) {
        for (const e of (Array.isArray(f?.roster) ? f.roster : [])) {
          const r = normalizeRecruit(e);
          if (r.condition.type === "repTier") r.condition.factionId = f.id; // remember the gating faction
          hq.recruits.push(r);
        }
      }
      if (hq.recruits.length) await saveHQ(hq);
    }
  }
  // getFactions() normalizes each faction, which now deletes roster/buildable → saving sheds them.
  await saveFactions(getFactions());
}

/**
 * One-time (GM): split the legacy fused `recruits[]` into the People/Facilities model and persist it.
 * normalizeHQ already derives the new shape on read; this just saves it (dropping the old `recruits`
 * key) so the split is permanent. Idempotent — a no-op once no legacy `recruits[]` remains. Runs from
 * the ready hook, AFTER migrateRostersToHQ has folded any legacy faction rosters into recruits[].
 */
export async function migrateHQModel() {
  if (!game.user.isGM) return;
  const raw = game.settings.get("project-anime", HQ_SETTING);
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.recruits)) return; // already split / nothing to do
  await saveHQ(getHQ()); // getHQ() returns the new people/facilities shape; saving it drops `recruits`
}

/* -------------------------------------------------------------------------- */
/*  CHRONICLE integration                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Apply a quest's Reputation reward to the matching faction's standing (GM only). Matches the
 * free-text faction name (case-insensitive) to a faction, then routes through setFactionStanding so
 * any tier the bump crosses pays out. Returns the new standing info if a faction matched, else null.
 */
export async function applyRepToFaction(name, delta) {
  if (!game.user.isGM) return null;
  const key = String(name ?? "").trim().toLowerCase();
  if (!key) return null;
  const f = getFactions().find((x) => String(x.name ?? "").trim().toLowerCase() === key);
  if (!f) return null;
  const before = clampStanding(f.standing);
  const res = await setFactionStanding(f.id, before + (Number(delta) || 0));
  const standing = res?.standing ?? before;
  const tier = tierForStanding(standing);
  ui.notifications?.info(
    game.i18n.format("PROJECTANIME.Covenant.repApplied", {
      name: f.name,
      standing,
      tier: game.i18n.localize(`PROJECTANIME.Covenant.tier.${tier.key}`)
    })
  );
  return { name: f.name, before, standing, tier: tier.key };
}
