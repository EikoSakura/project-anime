/**
 * Project: Anime — Headquarters engine (rules doc "Variant Rules: Headquarters", v0.03).
 *
 * A Headquarters is the home the party owns. It grows on two things: Gold builds the rooms
 * (Facilities), People bring them to life (resident Followers who STEWARD a facility). Its whole state
 * is one world object — the `covenantHQ` setting, shared with the legacy layer via getHQ/saveHQ
 * (helpers/factions.mjs). This module owns the v0.03 fields on that object:
 *
 *   hq.established  — has the party been granted a base yet
 *   hq.rank         — "C" | "B" | "A" | "S"; rises at a rest here once Renown meets the threshold
 *   hq.built        — the built Facilities (catalog keys + up to 3 custom), each with a steward + upgrade
 *   hq.board        — the Mission Board (residents dispatched while the party adventures)
 *
 *   RENOWN   = built facilities + resident Followers (derived; never stored).
 *   RESIDENTS = the party's Follower Bonds flagged `resides` (data/actor-models.mjs `bonds[].resides`),
 *               deduped by partner. A resident STEWARDS one facility; while stewarding their FAVORED
 *               facility (`bonds[].favoredFacility`) that facility's Favor line applies.
 *
 * Rank / facility BENEFITS are wired where their mechanics live: rest.mjs (Town, slots, Work Gold,
 * once-per-rest grants, rank-up, Mission Board tick), shop.mjs (buy/sell rates), bonds.mjs (rank-S Bond
 * capacity). The Codex "Home" tab (apps/codex.mjs) is the manager surface.
 */
import { getHQ, saveHQ } from "./factions.mjs";
import { resolveParty, partyActors } from "./party-folder.mjs";
import { partyTier } from "./chronicle.mjs";

const PA = () => globalThis.CONFIG?.PROJECTANIME ?? {};

/* -------------------------------------------------------------------------- */
/*  Catalog helpers                                                            */
/* -------------------------------------------------------------------------- */

/** The 14 printed facility definitions, keyed (config.mjs `hqFacilities`). */
export function facilityCatalog() {
  return PA().hqFacilities ?? {};
}

/** One catalog facility definition, or null for a custom / unknown key. */
export function facilityDef(key) {
  return facilityCatalog()[key] ?? null;
}

/** Rank index (0–3) of a rank key. */
export function rankIndex(rankKey) {
  const keys = PA().hqRankKeys ?? ["C", "B", "A", "S"];
  const i = keys.indexOf(rankKey);
  return i < 0 ? 0 : i;
}

/** The rank data row ({ key, name, renown, cap }) for a rank index. */
export function rankData(idx) {
  const ranks = PA().hqRanks ?? [];
  return ranks[Math.max(0, Math.min(ranks.length - 1, idx))] ?? { key: "C", name: "Hideout", renown: 0, cap: 3 };
}

/* -------------------------------------------------------------------------- */
/*  Residents — derived from the party's Follower Bonds flagged `resides`      */
/* -------------------------------------------------------------------------- */

/**
 * Every resident of the base: a Follower Bond marked `resides` on any Player Character, deduped by the
 * partner NPC (a follower bonded to several PCs still counts once). Returns view rows sorted by name:
 *   { uuid, name, img, favoredFacility, favoredFacilityIcon, bondRank (max across holders), stewarding }
 * `stewarding` is filled from the HQ's built facilities (which facility, if any, this resident runs).
 */
export function hqResidents(hq = getHQ()) {
  const byPartner = new Map();
  for (const actor of (game.actors ?? [])) {
    if (actor.type !== "character") continue;
    const bonds = actor.system?.bonds;
    if (!Array.isArray(bonds)) continue;
    for (const b of bonds) {
      if (b?.kind !== "follower" || !b?.resides || !b?.partnerUuid) continue;
      const prev = byPartner.get(b.partnerUuid);
      const rank = Number(b.rank) || 0;
      if (prev) {
        prev.bondRank = Math.max(prev.bondRank, rank);
        if (!prev.favoredFacility && b.favoredFacility) {
          prev.favoredFacility = b.favoredFacility;
          prev.favoredFacilityIcon = b.favoredFacilityIcon || "";
        }
      } else {
        byPartner.set(b.partnerUuid, {
          uuid: b.partnerUuid,
          name: b.name || "",
          img: b.img || "",
          favoredFacility: b.favoredFacility || "",
          favoredFacilityIcon: b.favoredFacilityIcon || "",
          bondRank: rank,
          stewarding: ""
        });
      }
    }
  }
  const list = [...byPartner.values()];
  for (const f of (hq.built ?? [])) {
    if (f.stewardUuid && byPartner.has(f.stewardUuid)) byPartner.get(f.stewardUuid).stewarding = f.id;
  }
  list.sort((a, b) => a.name.localeCompare(b.name));
  return list;
}

/** A single resident view row by NPC uuid, or null. */
export function residentByUuid(uuid, hq = getHQ()) {
  return hqResidents(hq).find((r) => r.uuid === uuid) ?? null;
}

/** Candidate Followers who have NOT moved in yet — a Follower Bond on some PC whose partner isn't a
 *  resident. These are the people the party can recruit as residents (meet their Ask, then Move In).
 *  Deduped by partner; { uuid, name, img, bondRank }. */
export function hqCandidates(hq = getHQ()) {
  const residing = new Set(hqResidents(hq).map((r) => r.uuid));
  const byPartner = new Map();
  for (const actor of (game.actors ?? [])) {
    if (actor.type !== "character") continue;
    for (const b of (actor.system?.bonds ?? [])) {
      if (b?.kind !== "follower" || !b?.partnerUuid || b.resides || residing.has(b.partnerUuid)) continue;
      const rank = Number(b.rank) || 0;
      const prev = byPartner.get(b.partnerUuid);
      if (prev) prev.bondRank = Math.max(prev.bondRank, rank);
      else byPartner.set(b.partnerUuid, { uuid: b.partnerUuid, name: b.name || "", img: b.img || "", bondRank: rank });
    }
  }
  return [...byPartner.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Set a Follower's residency (`resides`) on EVERY PC that holds a Follower Bond with them, so the
 *  base's resident roster is consistent no matter which PC forged the bond. GM only. */
export async function setResidency(npcUuid, resides) {
  if (!npcUuid) return;
  for (const actor of (game.actors ?? [])) {
    if (actor.type !== "character") continue;
    const bonds = foundry.utils.deepClone(actor.system?.bonds ?? []);
    let touched = false;
    for (const b of bonds) if (b.kind === "follower" && b.partnerUuid === npcUuid && !!b.resides !== !!resides) { b.resides = !!resides; touched = true; }
    if (touched) await actor.update({ "system.bonds": bonds });
  }
  // Moving out vacates any post they stewarded.
  if (!resides) {
    const hq = getHQ();
    let changed = false;
    for (const f of (hq.built ?? [])) if (f.stewardUuid === npcUuid) { f.stewardUuid = ""; changed = true; }
    if (changed) await saveHQ(hq);
  }
}

/** Set a Follower's Favored Facility (name + icon) on every matching Follower Bond. GM only. */
export async function setFavoredFacility(npcUuid, name, icon = "") {
  if (!npcUuid) return;
  for (const actor of (game.actors ?? [])) {
    if (actor.type !== "character") continue;
    const bonds = foundry.utils.deepClone(actor.system?.bonds ?? []);
    let touched = false;
    for (const b of bonds) if (b.kind === "follower" && b.partnerUuid === npcUuid) { b.favoredFacility = name || ""; b.favoredFacilityIcon = icon || ""; touched = true; }
    if (touched) await actor.update({ "system.bonds": bonds });
  }
}

/* -------------------------------------------------------------------------- */
/*  Renown & rank                                                              */
/* -------------------------------------------------------------------------- */

/** Renown = built facilities + resident Followers. */
export function hqRenown(hq = getHQ(), residents = hqResidents(hq)) {
  return (hq.built?.length ?? 0) + residents.length;
}

/** The rank index the HQ currently QUALIFIES for from its Renown (may exceed the stored rank until a
 *  rest here ranks it up). */
export function eligibleRankIndex(hq = getHQ(), residents = hqResidents(hq)) {
  const renown = hqRenown(hq, residents);
  const ranks = PA().hqRanks ?? [];
  let r = 0;
  for (let i = 0; i < ranks.length; i++) if (renown >= ranks[i].renown) r = i;
  return r;
}

/** The Facility Cap at the HQ's stored rank. */
export function facilityCap(hq = getHQ()) {
  return rankData(rankIndex(hq.rank)).cap;
}

/** A rich summary for the header / rest logic. */
export function hqStatus(hq = getHQ(), residents = hqResidents(hq)) {
  const ri = rankIndex(hq.rank);
  const eligible = eligibleRankIndex(hq, residents);
  const ranks = PA().hqRanks ?? [];
  const renown = hqRenown(hq, residents);
  const next = ri < ranks.length - 1 ? ranks[ri + 1] : null;
  return {
    rankIndex: ri,
    rank: rankData(ri),
    renown,
    cap: rankData(ri).cap,
    residents: residents.length,
    facilities: hq.built?.length ?? 0,
    eligibleRankIndex: eligible,
    canRankUp: eligible > ri,
    nextRenown: next ? next.renown : null,
    missionBoardOpen: ri >= 1
  };
}

/* -------------------------------------------------------------------------- */
/*  Built-facility views                                                       */
/* -------------------------------------------------------------------------- */

/** The steward's live Follower-Bond rank across the party (0–3), or -1 if unstaffed. Reads residents so
 *  a bond rank-up immediately unlocks the Upgrade gate. */
export function stewardBondRank(facility, residents = hqResidents()) {
  if (!facility?.stewardUuid) return -1;
  const r = residents.find((x) => x.uuid === facility.stewardUuid);
  return r ? r.bondRank : -1;
}

/** A built facility merged with its catalog definition + live steward / favor / upgrade state, for the UI
 *  and the rest logic. Custom facilities carry their own printed lines. */
export function facilityView(facility, residents = hqResidents()) {
  const def = facility.custom ? null : facilityDef(facility.key);
  const steward = facility.stewardUuid ? residents.find((r) => r.uuid === facility.stewardUuid) : null;
  const name = facility.custom ? (facility.name || "Custom Facility") : (def?.name ?? facility.key);
  // Favor applies while a steward runs this AS their Favored Facility (matched by name).
  const favorActive = !!steward && !!steward.favoredFacility &&
    steward.favoredFacility.toLowerCase() === name.toLowerCase();
  const bondRank = steward ? steward.bondRank : -1;
  return {
    id: facility.id,
    key: facility.key,
    custom: !!facility.custom,
    name,
    img: facility.img || "",
    icon: facility.custom ? "fa-solid fa-star" : (def?.icon ?? "fa-solid fa-building"),
    rankReq: facility.custom ? (facility.rank || "C") : (def?.rank ?? "C"),
    stewardUuid: facility.stewardUuid || "",
    stewardName: steward?.name ?? "",
    stewardImg: steward?.img ?? "",
    stewarded: !!steward,
    favorActive,
    upgraded: !!facility.upgraded,
    canUpgrade: !!steward && bondRank >= 1 && !facility.upgraded, // steward's Follower Bond rank B+
    upgradeCost: facility.custom ? (Number(facility.upgradeCost) || 0) : (def?.upgradeCost ?? 0),
    gatherType: facility.gatherType || "",
    gatherType2: facility.gatherType2 || "",
    lines: {
      unstaffed: facility.custom ? (facility.unstaffed || "") : (def?.unstaffed ?? ""),
      staffed:   facility.custom ? (facility.staffed || "")   : (def?.staffed ?? ""),
      favor:     facility.custom ? (facility.favor || "")     : (def?.favor ?? ""),
      upgrade:   facility.custom ? (facility.upgrade || "")   : (def?.upgrade ?? "")
    }
  };
}

/** Which catalog keys the HQ can build right now: not already built, rank requirement met, cap free. */
export function buildableCatalog(hq = getHQ()) {
  const ri = rankIndex(hq.rank);
  const capFree = facilityCap(hq) - (hq.built?.length ?? 0);
  const builtKeys = new Set((hq.built ?? []).map((f) => f.key).filter(Boolean));
  const out = [];
  for (const [key, def] of Object.entries(facilityCatalog())) {
    if (builtKeys.has(key)) continue;
    out.push({
      key, name: def.name, icon: def.icon, cost: def.cost, rank: def.rank,
      canBuild: capFree > 0 && rankIndex(def.rank) <= ri,
      rankMet: rankIndex(def.rank) <= ri
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/*  Gold — the party treasury pays for builds                                  */
/* -------------------------------------------------------------------------- */

/** The party treasury Gold available for the affordability hint. Uses the first party — the one a
 *  single-party world's chargeGold (resolveParty) also picks — so the "affordable" badge matches. */
export function partyGold() {
  const p = partyActors()[0];
  return p ? (Number(p.system?.gold) || 0) : 0;
}

/** Charge `amount` Gold to the party treasury (GM only). Returns true on success, false if unaffordable
 *  or no party exists. Picks the party asked (resolveParty) so a multi-party world is unambiguous. */
async function chargeGold(amount) {
  const cost = Math.max(0, Math.round(Number(amount) || 0));
  const party = await resolveParty();
  if (!party) {
    ui.notifications?.warn(game.i18n.localize("PROJECTANIME.HQ.noParty"));
    return false;
  }
  const have = Number(party.system?.gold) || 0;
  if (have < cost) {
    ui.notifications?.warn(game.i18n.format("PROJECTANIME.HQ.tooPoor", { cost, have }));
    return false;
  }
  if (cost > 0) await party.update({ "system.gold": have - cost });
  return true;
}

/** Add `delta` Gold to the party treasury (GM); a negative delta removes it. Floors at 0. Returns the new
 *  total, or null if no party exists. Adjusts the same party chargeGold/partyGold use. */
export async function adjustTreasury(delta) {
  const party = await resolveParty();
  if (!party) {
    ui.notifications?.warn(game.i18n.localize("PROJECTANIME.HQ.noParty"));
    return null;
  }
  const have = Number(party.system?.gold) || 0;
  const next = Math.max(0, have + Math.round(Number(delta) || 0));
  await party.update({ "system.gold": next });
  return next;
}

/* -------------------------------------------------------------------------- */
/*  Building, stewarding, upgrading (GM mutations)                             */
/* -------------------------------------------------------------------------- */

/** Build a catalog facility by key. Validates rank + cap + Gold, deducts the cost, adds it to the HQ. */
export async function buildFacility(key) {
  const def = facilityDef(key);
  if (!def) return;
  const hq = getHQ();
  if ((hq.built ?? []).some((f) => f.key === key)) return; // built once
  if ((hq.built?.length ?? 0) >= facilityCap(hq)) {
    ui.notifications?.warn(game.i18n.localize("PROJECTANIME.HQ.capFull"));
    return;
  }
  if (rankIndex(def.rank) > rankIndex(hq.rank)) {
    ui.notifications?.warn(game.i18n.format("PROJECTANIME.HQ.rankLocked", { rank: def.rank }));
    return;
  }
  if (!(await chargeGold(def.cost))) return;
  hq.built.push({ id: foundry.utils.randomID(), key, custom: false, name: def.name, img: "", stewardUuid: "", upgraded: false, gatherType: "", gatherType2: "" });
  await saveHQ(hq);
  postHQCard(game.i18n.format("PROJECTANIME.HQ.builtCard", { name: def.name, cost: def.cost }), def.icon);
}

/** Build a custom facility (Four Rails; GM-shaped). `data` carries name/rank/cost/lines. */
export async function buildCustomFacility(data = {}) {
  const hq = getHQ();
  const customCount = (hq.built ?? []).filter((f) => f.custom).length;
  const maxCustom = PA().hqCustomRails?.maxSlots ?? 3;
  if (customCount >= maxCustom) {
    ui.notifications?.warn(game.i18n.format("PROJECTANIME.HQ.customFull", { max: maxCustom }));
    return;
  }
  if ((hq.built?.length ?? 0) >= facilityCap(hq)) {
    ui.notifications?.warn(game.i18n.localize("PROJECTANIME.HQ.capFull"));
    return;
  }
  const cost = Math.max(0, Math.round(Number(data.cost) || 0));
  if (!(await chargeGold(cost))) return;
  hq.built.push({
    id: foundry.utils.randomID(), key: "", custom: true,
    name: data.name || "Custom Facility", img: data.img || "", stewardUuid: "", upgraded: false,
    rank: PA().hqRankKeys?.includes(data.rank) ? data.rank : "C",
    cost, upgradeCost: Math.max(0, Math.round(Number(data.upgradeCost) || 0)),
    unstaffed: data.unstaffed || "", staffed: data.staffed || "", favor: data.favor || "", upgrade: data.upgrade || "",
    gatherType: "", gatherType2: ""
  });
  await saveHQ(hq);
  postHQCard(game.i18n.format("PROJECTANIME.HQ.builtCard", { name: data.name || "Custom Facility", cost }), "fa-solid fa-star");
}

/** Demolish a built facility (GM). No refund. */
export async function demolishFacility(id) {
  const hq = getHQ();
  const before = hq.built?.length ?? 0;
  hq.built = (hq.built ?? []).filter((f) => f.id !== id);
  if (hq.built.length !== before) await saveHQ(hq);
}

/** Assign (or clear, uuid="") the steward of a facility. A resident stewards ONE facility — assigning
 *  them here vacates any other post they held. */
export async function setFacilitySteward(id, uuid) {
  const hq = getHQ();
  const f = (hq.built ?? []).find((x) => x.id === id);
  if (!f) return;
  if (uuid) for (const other of hq.built) if (other.id !== id && other.stewardUuid === uuid) other.stewardUuid = "";
  f.stewardUuid = uuid || "";
  await saveHQ(hq);
}

/** Purchase a facility's one Upgrade. Requires a steward whose Follower Bond is rank B+ and the Gold. */
export async function upgradeFacility(id) {
  const hq = getHQ();
  const f = (hq.built ?? []).find((x) => x.id === id);
  if (!f || f.upgraded) return;
  const residents = hqResidents(hq);
  const view = facilityView(f, residents);
  if (!view.stewarded || stewardBondRank(f, residents) < 1) {
    ui.notifications?.warn(game.i18n.localize("PROJECTANIME.HQ.upgradeLocked"));
    return;
  }
  if (!(await chargeGold(view.upgradeCost))) return;
  f.upgraded = true;
  await saveHQ(hq);
  postHQCard(game.i18n.format("PROJECTANIME.HQ.upgradedCard", { name: view.name, cost: view.upgradeCost }), view.icon);
}

/** Set a Gathering Grounds chosen Common type (slot 1 or 2). */
export async function setFacilityGather(id, slot, type) {
  const hq = getHQ();
  const f = (hq.built ?? []).find((x) => x.id === id);
  if (!f) return;
  if (slot === 2) f.gatherType2 = String(type || "");
  else f.gatherType = String(type || "");
  await saveHQ(hq);
}

/** Mark the base established (a fresh Hideout) or edit identity fields. */
export async function establishHQ(patch = {}) {
  const hq = getHQ();
  hq.established = true;
  if (!hq.rank) hq.rank = "C";
  Object.assign(hq, patch);
  await saveHQ(hq);
}

/* -------------------------------------------------------------------------- */
/*  Mission Board                                                              */
/* -------------------------------------------------------------------------- */

/** A fresh Mission Board posting. */
export function blankBoardMission() {
  return {
    id: foundry.utils.randomID(), title: "", img: "",
    type: "scout", duration: 1, suited: [], hard: false, risk: "", reward: "",
    rewardGold: 0, rewardItems: [], team: [], status: "open", restsLeft: 0
  };
}

/** Post / update / delete a mission (GM). */
export async function saveMission(mission) {
  const hq = getHQ();
  const idx = (hq.board ?? []).findIndex((m) => m.id === mission.id);
  if (idx >= 0) hq.board[idx] = mission; else (hq.board ??= []).push(mission);
  await saveHQ(hq);
}
export async function deleteMission(id) {
  const hq = getHQ();
  hq.board = (hq.board ?? []).filter((m) => m.id !== id);
  await saveHQ(hq);
}

/** Assign a team (2–3 resident uuids) and dispatch: status → active, countdown = duration. A dispatched
 *  steward leaves their post (the facility runs unstaffed until they return). */
export async function assignMission(id, team) {
  const hq = getHQ();
  const m = (hq.board ?? []).find((x) => x.id === id);
  if (!m) return;
  const active = (hq.board ?? []).filter((x) => x.status === "active").length;
  const cap = (PA().hqMissionCap ?? {})[hq.rank] ?? 0;
  if (m.status !== "active" && active >= cap) {
    ui.notifications?.warn(game.i18n.format("PROJECTANIME.HQ.missionCapFull", { cap }));
    return;
  }
  m.team = (team ?? []).slice(0, 3);
  m.status = "active";
  m.restsLeft = Math.max(1, Math.round(Number(m.duration) || 1));
  // Dispatched stewards leave their posts.
  for (const f of (hq.built ?? [])) if (f.stewardUuid && m.team.includes(f.stewardUuid)) f.stewardUuid = "";
  await saveHQ(hq);
}

/** Recall an active mission before it resolves (status → open, team cleared). */
export async function recallMission(id) {
  const hq = getHQ();
  const m = (hq.board ?? []).find((x) => x.id === id);
  if (!m) return;
  m.status = "open"; m.team = []; m.restsLeft = 0;
  await saveHQ(hq);
}

/**
 * Tick the Mission Board one party rest (GM). Active missions count down; any that reach 0 RESOLVE:
 *   two d6, Stepping Up one die per Suited resident on the team, vs Normal 10 (Hard 13).
 *   Success → the reward (Gold × Tier auto-paid; alternatives narrated), + 1 BP to one dispatched
 *   follower. Failure → the reward is lost; a resident may return with a complication.
 * Mutates + saves the HQ, pays Gold to the party, and returns chat lines to fold into the rest card.
 */
export async function tickMissionBoard() {
  const hq = getHQ();
  const active = (hq.board ?? []).filter((m) => m.status === "active");
  if (!active.length) return [];
  const residents = hqResidents(hq);
  const tier = partyTier();
  const lines = [];
  let goldPaid = 0;
  for (const m of active) {
    m.restsLeft = Math.max(0, Math.round(Number(m.restsLeft) || 0) - 1);
    if (m.restsLeft > 0) continue;
    // Resolve.
    const suited = new Set((m.suited ?? []).map((s) => String(s).toLowerCase()));
    let steps = 0;
    for (const uuid of (m.team ?? [])) {
      const r = residents.find((x) => x.uuid === uuid);
      if (r && r.favoredFacility && suited.has(r.favoredFacility.toLowerCase())) steps++;
    }
    // Two d6, each Stepped Up (d6→d8→d10→d12, capped) once per suited member — apply steps to as many
    // dice as we have (spread across the two), matching "Step Up one die for each Suited resident".
    const faces = [6, 6];
    for (let i = 0; i < steps; i++) faces[i % 2] = stepFace(faces[i % 2]);
    const roll = await new Roll(`1d${faces[0]} + 1d${faces[1]}`).evaluate();
    const dc = m.hard ? 13 : 10;
    const success = roll.total >= dc;
    const title = m.title || game.i18n.localize("PROJECTANIME.HQ.mission");
    if (success) {
      const gold = (PA().missionRewards?.[m.duration]?.goldPerTier ?? 0) * tier + (Number(m.rewardGold) || 0);
      goldPaid += gold;
      // +1 BP to one dispatched follower (the first on the team, by the party's choice at the table).
      const bpTo = (m.team ?? [])[0];
      if (bpTo) await grantMissionBP(bpTo);
      const bpName = bpTo ? (residents.find((r) => r.uuid === bpTo)?.name ?? "") : "";
      lines.push(game.i18n.format("PROJECTANIME.HQ.missionWon", {
        title, roll: roll.total, dc, gold, bp: bpName
      }));
    } else {
      lines.push(game.i18n.format("PROJECTANIME.HQ.missionLost", { title, roll: roll.total, dc }));
    }
    m.status = "done"; m.result = success ? "success" : "failure"; m.team = [];
  }
  await saveHQ(hq);
  if (goldPaid > 0) {
    const party = await resolveParty();
    if (party) await party.update({ "system.gold": (Number(party.system?.gold) || 0) + goldPaid });
  }
  return lines;
}

/** Add 1 Bond Point to the highest-rank Follower Bond that points at `npcUuid`, across the party. */
async function grantMissionBP(npcUuid) {
  for (const actor of (game.actors ?? [])) {
    if (actor.type !== "character") continue;
    const bonds = foundry.utils.deepClone(actor.system?.bonds ?? []);
    const b = bonds.find((x) => x.kind === "follower" && x.partnerUuid === npcUuid);
    if (b) {
      b.bp = (Number(b.bp) || 0) + 1;
      await actor.update({ "system.bonds": bonds });
      return;
    }
  }
}

/** Step a d-face up one rung (6→8→10→12, capped at 12). */
function stepFace(f) {
  const ladder = [4, 6, 8, 10, 12];
  const i = ladder.indexOf(f);
  return i < 0 || i >= ladder.length - 1 ? f : ladder[i + 1];
}

/* -------------------------------------------------------------------------- */
/*  Rank benefits — consumed by rest.mjs, shop.mjs, bonds.mjs                   */
/* -------------------------------------------------------------------------- */

/** Rank-S benefit: +2 to a character's capacity for Bonds at rank B or higher (helpers/bonds.mjs). */
export function hqBondCapacityBonus() {
  try {
    const hq = getHQ();
    return hq.established && rankIndex(hq.rank) >= 3 ? 2 : 0;
  } catch { return 0; }
}

/**
 * Buy/sell rates and stock flags for the HQ Shop, given which vendor facility opened it
 * ("consumable" = Apothecary, "gear" = Forge). Combines the rank-B Open-Doors discount with the
 * facility's staffed / favor / upgrade lines. Returns multipliers on list price.
 */
export function hqShopRates(vendorKind, hq = getHQ()) {
  const ri = rankIndex(hq.rank);
  const residents = hqResidents(hq);
  const facility = (hq.built ?? []).map((f) => facilityView(f, residents))
    .find((v) => !v.custom && facilityDef(v.key)?.vendor === vendorKind);
  let buyMult = 1;
  let sellMult = ri >= 1 ? 0.6 : 0.5;                 // rank B: sell at 60%; base 50%
  if (ri >= 1) buyMult = 0.9;                          // rank B: buy at 10% off
  if (facility?.stewarded) buyMult = Math.min(buyMult, 0.9); // staffed vendor: 10% less
  if (facility?.favorActive) sellMult = Math.max(sellMult, 0.6);
  return {
    buyMult,
    sellMult,
    stocksAccessories: vendorKind === "gear" && !!facility?.upgraded,
    potionBonus: vendorKind === "consumable" && facility?.upgraded ? 2 : 0,
    facility: facility ?? null
  };
}

/**
 * The HQ rest context for rest.mjs — everything a rest AT THE HEADQUARTERS changes. Only meaningful when
 * the party rests at an established base; the caller passes `atHQ`.
 *   isTown         — rank C: an HQ rest always counts as a Town.
 *   slotBonus      — rank A: +1 Downtime Slot; maxSlots rises to 5.
 *   workGoldBonus  — rank B (+50) plus Garden staffed (+50) / upgraded (+100).
 *   grants         — once-per-rest staffed facility grants to surface / apply (freeCraft, freeConsumable…).
 *   rankUpTo       — the rank key this rest ranks the base up to, or null.
 */
export function hqRestContext(hq = getHQ()) {
  const residents = hqResidents(hq);
  const ri = rankIndex(hq.rank);
  const views = (hq.built ?? []).map((f) => facilityView(f, residents));
  const status = hqStatus(hq, residents);

  // Work Gold: rank-B Open Doors (+50) + Garden (staffed +50 / upgraded +100).
  let workGoldBonus = ri >= 1 ? 50 : 0;
  const garden = views.find((v) => v.key === "garden");
  if (garden?.stewarded) workGoldBonus += garden.upgraded ? 100 : 50;

  const grants = [];
  for (const v of views) {
    const def = v.custom ? null : facilityDef(v.key);
    if (!def?.restGrant || !v.stewarded) continue;
    grants.push({ id: v.id, key: v.key, name: v.name, kind: def.restGrant, favor: v.favorActive, upgraded: v.upgraded, gatherType: v.gatherType, gatherType2: v.gatherType2 });
  }
  // Shrine (staffed) steps up the Charm die for Luck Dice rolled here.
  const shrine = views.find((v) => v.key === "shrine");
  const luckStep = shrine?.stewarded ? 1 : 0;

  const rankUpTo = status.canRankUp ? rankData(status.eligibleRankIndex).key : null;
  return {
    established: !!hq.established,
    rankIndex: ri,
    isTown: true,
    slotBonus: ri >= 3 ? 1 : 0,
    maxSlots: ri >= 3 ? 5 : 4,
    workGoldBonus,
    grants,
    luckStep: Math.max(0, luckStep),
    rankUpTo,
    status
  };
}

/** Rank the base up one step at a rest (GM), if Renown qualifies. Returns the new rank key or null. */
export async function hqRankUpAtRest() {
  const hq = getHQ();
  if (!hq.established) return null;
  const status = hqStatus(hq);
  if (!status.canRankUp) return null;
  const nextKey = rankData(status.rankIndex + 1).key;
  hq.rank = nextKey;
  await saveHQ(hq);
  return nextKey;
}

/* -------------------------------------------------------------------------- */
/*  Chat                                                                       */
/* -------------------------------------------------------------------------- */

/** Post a one-line HQ chat card (GM speaker). */
export function postHQCard(text, icon = "fa-solid fa-fort-awesome") {
  const content = `<div class="project-anime chat-card">
    <header class="card-header">
      <span class="card-icon is-glyph"><i class="fas ${icon.replace(/^fa-solid /, "")}"></i></span>
      <div class="card-titles">
        <h3 class="card-title">${game.i18n.localize("PROJECTANIME.HQ.title")}</h3>
      </div>
    </header>
    <div class="card-lines"><div class="card-line">${text}</div></div>
  </div>`;
  ChatMessage.create({ speaker: ChatMessage.getSpeaker({ alias: game.i18n.localize("PROJECTANIME.HQ.title") }), content });
}
