/**
 * Project: Anime — BONDS data layer (v0.03 paired relationships).
 *
 * A Bond (rules doc "Variant Rules: Bond") is shared between EXACTLY two characters and tracked
 * per-character on `system.bonds` (data/actor-models.mjs bondField). Two kinds:
 *   • Party Bond    — between two Player Characters. Stored on BOTH sheets and kept in sync
 *     (syncPartyBonds, GM-side). Grants the automated Party benefits (helpers/bond-effect.mjs).
 *   • Follower Bond — between a Player Character and an NPC (role "npc"). One-sided (NPCs keep no
 *     bond list). Grants the four Follower benefits (preset text shaped with the GM).
 *
 * A bond opens at rank C (index 0) with 0 Bond Points. It earns BP two ways — a Bond Scene at a rest
 * (1/rest) or Standing Together in a Conflict (1/Conflict) — and rises a rank only once BP clears the
 * next threshold AND the pair plays a Bond Scene (the scene gate; config bondThresholds). Charm's
 * half-score caps how many rank-B-or-higher bonds a character may hold.
 *
 * The CHRONICLE quest log can forge/deepen a Follower bond as a reward on every party member
 * (applyBondReward). Supersedes the old GM-authored NPC bond OFFER (per-rank abilities + rewards),
 * removed in v0.3.4.
 */

import { PROJECTANIME, bondEligibleRank, bondNextThreshold, halfScore } from "./config.mjs";
import { partyMembers } from "./party-folder.mjs";

/** Highest rank INDEX a bond can reach (S). Kept as a named export for callers. */
export const BOND_MAX_RANK = PROJECTANIME.bondMaxRank;

/* -------------------------------------------------------------------------- */
/*  Read / write (per actor)                                                  */
/* -------------------------------------------------------------------------- */

/** An actor's bond list (a safe deep copy you can mutate before saveBonds). */
export function getBonds(actor) {
  const raw = actor?.system?.bonds;
  return Array.isArray(raw) ? foundry.utils.deepClone(raw) : [];
}

/** Persist an actor's full bond list (requires permission to update the actor). `options` pass through
 *  to actor.update — e.g. `{ render: false }` so an inline edit doesn't re-render the sheet. */
export async function saveBonds(actor, bonds, options = {}) {
  return actor.update({ "system.bonds": bonds }, options);
}

export function bondById(id, bonds) {
  return (bonds ?? []).find((b) => b.id === id) ?? null;
}

/* -------------------------------------------------------------------------- */
/*  Rank / Bond-Point helpers (pure)                                          */
/* -------------------------------------------------------------------------- */

/** The display letter (C/B/A/S) for a stored rank index. */
export function rankLetter(rank) {
  return PROJECTANIME.bondRanks[Math.max(0, Math.min(BOND_MAX_RANK, Number(rank) || 0))];
}

/** The highest rank index this bond's Bond Points make it ELIGIBLE for (ignores the scene gate). */
export function bondEligible(bond) {
  return bondEligibleRank(bond?.bp ?? 0);
}

/** True when the bond has cleared the next threshold but hasn't yet played the rank-up Bond Scene. */
export function canRankUp(bond) {
  const rank = Number(bond?.rank) || 0;
  return rank < BOND_MAX_RANK && bondEligible(bond) > rank;
}

/** BP progress toward the next rank as { have, need, pct } (need null / pct 100 at max rank). */
export function bondProgress(bond) {
  const bp = Number(bond?.bp) || 0;
  const rank = Number(bond?.rank) || 0;
  const need = bondNextThreshold(rank);
  if (need == null) return { have: bp, need: null, pct: 100 };
  const floor = PROJECTANIME.bondThresholds[rank] || 0;
  const pct = Math.max(0, Math.min(100, Math.round(((bp - floor) / (need - floor)) * 100)));
  return { have: bp, need, pct };
}

/* -------------------------------------------------------------------------- */
/*  Charm capacity (rank B+ cap)                                              */
/* -------------------------------------------------------------------------- */

/** Rank-S Headquarters benefit ("Where Legends Gather"): +2 to the rank-B+ Bond capacity. Read straight
 *  off the `covenantHQ` world setting to avoid an import cycle (factions.mjs → bonds.mjs). */
function hqBondCapacityBonus() {
  try {
    const hq = game.settings.get("project-anime", "covenantHQ");
    return (hq?.established && hq?.rank === "S") ? 2 : 0;
  } catch { return 0; }
}

/** How many rank-B-or-higher bonds a character may hold: their ⟪Charm⟫ half-score (d4→2 … d12→6), plus
 *  the rank-S Headquarters bonus (+2). */
export function bondCapacity(actor) {
  return halfScore(actor?.system?.attributes?.charm?.value ?? 4) + hqBondCapacityBonus();
}

/** Capacity summary { cap, used, free } — `used` counts this actor's bonds already at rank B+ (≥1). */
export function capacityInfo(actor) {
  const cap = bondCapacity(actor);
  const used = getBonds(actor).filter((b) => (Number(b.rank) || 0) >= 1).length;
  return { cap, used, free: Math.max(0, cap - used) };
}

/** The token that identifies "this rest" for the 1/rest Bond Scene guard (the actor's last completed
 *  rest — apps/rest.mjs stamps flags.project-anime.lastRestAt). "none" before any rest. */
function restToken(actor) {
  const t = actor?.flags?.["project-anime"]?.lastRestAt;
  return t == null ? "none" : String(t);
}

/* -------------------------------------------------------------------------- */
/*  Blank / forge                                                             */
/* -------------------------------------------------------------------------- */

/** A fresh, empty bond (matches the data model's bondField shape). */
export function blankBond(overrides = {}) {
  return {
    id: foundry.utils.randomID(),
    kind: "follower",
    partnerUuid: "",
    name: game.i18n.localize("PROJECTANIME.Bond.newBondName"),
    img: "",
    title: "",
    quote: "",
    accent: "",
    rank: 0,
    bp: 0,
    aidChoice: "",
    notes: {},
    favoredFacility: "",
    favoredFacilityIcon: "",
    resides: false,
    unionSkillId: "",
    sceneRestId: "",
    standingCombatId: "",
    dualStrikeCombatId: "",
    ...overrides
  };
}

/** Seed a bond's cached identity from a partner actor. */
function identityFrom(partner) {
  return {
    partnerUuid: partner.uuid,
    name: partner.name,
    img: partner.img || "",
    accent: partner.prototypeToken?.texture?.tint || ""
  };
}

/**
 * Forge a bond on `pc` with `partner`. Kind is inferred from the partner (a Character → Party Bond,
 * an NPC → Follower Bond). Idempotent: an existing bond to the same partner is returned untouched.
 * For a Party Bond the partner's mirror is written too when this user can update it (GM / owner);
 * otherwise a GM's syncPartyBonds mirrors it later. Returns { bond, fresh }, or null on a bad target.
 */
export async function forgeBond(pc, partner) {
  if (!pc || pc.type !== "character" || !partner) return null;
  if (partner.uuid === pc.uuid) return null;                       // no self-bonds
  const kind = partner.type === "character" ? "party" : "follower";

  const bonds = getBonds(pc);
  const existing = bonds.find((b) => b.partnerUuid && b.partnerUuid === partner.uuid);
  if (existing) return { bond: existing, fresh: false };

  const bond = blankBond({ kind, ...identityFrom(partner) });
  bonds.unshift(bond);
  await saveBonds(pc, bonds);

  if (kind === "party") await mirrorPartyBond(pc, partner, bond);
  return { bond, fresh: true };
}

/** Ensure `partner` carries a matching mirror of a Party Bond `pc` holds (create if missing, sync
 *  rank/bp). No-op unless the current user can update the partner (GM or owner); a GM's
 *  syncPartyBonds fills the gap otherwise. */
async function mirrorPartyBond(pc, partner, bond) {
  if (!partner?.isOwner) return;
  const mBonds = getBonds(partner);
  let m = mBonds.find((b) => b.partnerUuid && b.partnerUuid === pc.uuid);
  if (!m) {
    m = blankBond({ kind: "party", ...identityFrom(pc), rank: bond.rank, bp: bond.bp, unionSkillId: bond.unionSkillId });
    mBonds.unshift(m);
    await saveBonds(partner, mBonds);
  }
}

/* -------------------------------------------------------------------------- */
/*  Earning Bond Points + ranking up                                          */
/* -------------------------------------------------------------------------- */

/** Result helper for the earn actions. */
function earnResult(ok, reason = "") { return { ok, reason }; }

/**
 * Grant +1 BP for a Bond Scene (a Downtime Activity — 1 per rest per pair). Guarded by the actor's
 * current rest token. Returns { ok, reason }; on success the caller persists via saveBonds (this
 * mutates `bond` in place within `bonds` and saves).
 */
export async function earnBondScene(pc, bond) {
  const token = restToken(pc);
  if (bond.sceneRestId && bond.sceneRestId === token) return earnResult(false, "scene");
  bond.bp = (Number(bond.bp) || 0) + 1;
  bond.sceneRestId = token;
  return earnResult(true);
}

/** Grant +1 BP for Standing Together (1 per Conflict per pair). Guarded by the active Combat's id. */
export async function earnStandingTogether(pc, bond) {
  const cid = game.combat?.id || "";
  if (!cid) return earnResult(false, "noCombat");
  if (bond.standingCombatId && bond.standingCombatId === cid) return earnResult(false, "standing");
  bond.bp = (Number(bond.bp) || 0) + 1;
  bond.standingCombatId = cid;
  return earnResult(true);
}

/** Manual BP adjust (GM tool — no once-per-window guard). `n` may be negative; BP floors at 0. */
export function adjustBondPoints(bond, n) {
  bond.bp = Math.max(0, (Number(bond.bp) || 0) + (Number(n) || 0));
}

/**
 * Play the rank-up Bond Scene: raise the bond ONE rank if it's eligible. Enforces the Charm capacity
 * cap when crossing into rank B+ (and, for a Party Bond, the partner's cap too). Mutates `bond`;
 * returns { ok, reason }. The caller persists.
 */
export function rankUpBond(pc, bond) {
  if (!canRankUp(bond)) return earnResult(false, "notReady");
  const nextRank = (Number(bond.rank) || 0) + 1;
  if (nextRank >= 1) {
    if (capacityInfo(pc).free <= 0) return earnResult(false, "capacitySelf");
    if (bond.kind === "party") {
      const partner = bond.partnerUuid ? fromUuidSync(bond.partnerUuid) : null;
      if (partner && capacityInfo(partner).free <= 0) return earnResult(false, "capacityPartner");
    }
  }
  bond.rank = nextRank;
  return earnResult(true);
}

/**
 * Break a bond: remove it from `pc`, and for a Party Bond remove the partner's mirror too (so it
 * can't be resurrected by sync). Requires the ability to update both actors for a Party Bond; returns
 * false (and notifies) when a GM is needed. Follower bonds are one-sided and always removable by the
 * owner.
 */
export async function breakBond(pc, bondId) {
  const bonds = getBonds(pc);
  const bond = bondById(bondId, bonds);
  if (!bond) return false;

  if (bond.kind === "party" && bond.partnerUuid) {
    const partner = fromUuidSync(bond.partnerUuid);
    if (partner) {
      if (!partner.isOwner && !game.user.isGM) {
        ui.notifications?.warn(game.i18n.localize("PROJECTANIME.Bond.breakNeedsGM"));
        return false;
      }
      if (partner.isOwner) {
        const mBonds = getBonds(partner).filter((b) => !(b.partnerUuid && b.partnerUuid === pc.uuid));
        await saveBonds(partner, mBonds);
      }
    }
  }
  await saveBonds(pc, bonds.filter((b) => b.id !== bondId));
  return true;
}

/* -------------------------------------------------------------------------- */
/*  Party-bond sync (GM-side)                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Keep the two sides of every Party Bond on `actor` consistent — run GM-side from the actor
 * update/create hooks (project-anime.mjs), like reconcileBonds. For each of `actor`'s party bonds it
 * resolves the partner Character and CONVERGES the pair: BP and rank take the higher of the two, the
 * Union Skill id fills from whichever has one, and a missing mirror is created. Only writes when
 * something changed, so the reciprocal hook it triggers on the partner finds them equal and stops.
 * Never deletes (breakBond handles two-sided removal).
 */
export async function syncPartyBonds(actor) {
  if (!actor || actor.type !== "character") return;
  if (game.users?.activeGM?.id !== game.user?.id) return;

  const mine = getBonds(actor);
  const partyBonds = mine.filter((b) => b.kind === "party" && b.partnerUuid);
  if (!partyBonds.length) return;

  let selfDirty = false;
  for (const b of partyBonds) {
    const partner = fromUuidSync(b.partnerUuid);
    if (!partner || partner.type !== "character") continue;

    const theirs = getBonds(partner);
    let m = theirs.find((x) => x.partnerUuid && x.partnerUuid === actor.uuid);

    const bp = Math.max(Number(b.bp) || 0, Number(m?.bp) || 0);
    const rank = Math.max(Number(b.rank) || 0, Number(m?.rank) || 0);
    const union = b.unionSkillId || m?.unionSkillId || "";

    // Converge my side.
    if ((Number(b.bp) || 0) !== bp || (Number(b.rank) || 0) !== rank || (b.unionSkillId || "") !== union) {
      b.bp = bp; b.rank = rank; b.unionSkillId = union; selfDirty = true;
    }
    // Converge / create their side.
    if (!m) {
      m = blankBond({ kind: "party", ...identityFrom(actor), rank, bp, unionSkillId: union });
      theirs.unshift(m);
      await saveBonds(partner, theirs);
    } else if ((Number(m.bp) || 0) !== bp || (Number(m.rank) || 0) !== rank || (m.unionSkillId || "") !== union) {
      m.bp = bp; m.rank = rank; m.unionSkillId = union;
      await saveBonds(partner, theirs);
    }
  }
  if (selfDirty) await saveBonds(actor, mine);
}

/* -------------------------------------------------------------------------- */
/*  CHRONICLE integration                                                     */
/* -------------------------------------------------------------------------- */

/** Every Player Character who belongs to a Party (the audience for a party-wide bond reward). Falls
 *  back to all player-owned Characters when no Party actor exists yet. */
function bondAudience() {
  const members = new Set();
  for (const p of game.actors) {
    if (p.type !== "party") continue;
    for (const m of partyMembers(p)) if (m?.type === "character") members.add(m);
  }
  if (!members.size) {
    for (const a of game.actors) if (a.type === "character" && a.hasPlayerOwner) members.add(a);
  }
  return [...members];
}

/**
 * Forge or deepen a FOLLOWER bond as a quest reward (GM only) on EVERY party member. On each member,
 * match an existing bond by linked partner UUID first, then by name; deepen it by `ranks` (direct,
 * bypassing the scene gate — GM authority) and pull its BP up to the new rank's threshold; if none
 * matches, forge a fresh follower bond at that rank. Returns a summary, or null when there's nothing
 * to bond with.
 */
export async function applyBondReward({ name, actorUuid, img, ranks } = {}) {
  if (!game.user.isGM) return null;
  const add = Math.max(1, Number(ranks) || 1);
  if (!name && !actorUuid) return null;

  const audience = bondAudience();
  if (!audience.length) return null;

  let forgedAny = false;
  let lastRank = 0;
  for (const member of audience) {
    const bonds = getBonds(member);
    let bond = actorUuid ? bonds.find((b) => b.partnerUuid && b.partnerUuid === actorUuid) : null;
    if (!bond && name) {
      const key = String(name).trim().toLowerCase();
      bond = bonds.find((b) => String(b.name ?? "").trim().toLowerCase() === key);
    }
    if (bond) {
      bond.rank = Math.min(BOND_MAX_RANK, (Number(bond.rank) || 0) + add);
    } else {
      bond = blankBond({
        kind: "follower",
        name: name || game.i18n.localize("PROJECTANIME.Bond.newBondName"),
        partnerUuid: actorUuid || "",
        img: img || "",
        rank: Math.min(BOND_MAX_RANK, add)
      });
      bonds.unshift(bond);
      forgedAny = true;
    }
    bond.bp = Math.max(Number(bond.bp) || 0, PROJECTANIME.bondThresholds[bond.rank] || 0);
    lastRank = bond.rank;
    await saveBonds(member, bonds);
  }

  const label = name || game.i18n.localize("PROJECTANIME.Bond.newBondName");
  ui.notifications?.info(
    game.i18n.format(forgedAny ? "PROJECTANIME.Bond.bondForged" : "PROJECTANIME.Bond.bondAdvanced", {
      name: label,
      rank: rankLetter(lastRank)
    })
  );
  return { name: label, rank: rankLetter(lastRank), members: audience.length };
}
