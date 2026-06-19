/**
 * Project: Anime — BONDS data layer (per-character relationship cards).
 *
 * Bonds live on each Character (system.bonds — see data/actor-models.mjs bondField), so every
 * player keeps their own. A bond is a tarot-style card: rank 0–5, per-rank ability boons, a
 * dossier, vitals, and a quote. The owner authors and ranks them freely from the "Bonds" drawer
 * on their sheet (apps surface in sheets/actor-sheet.mjs). A bond may reference a world Faction by
 * id (helpers/factions.mjs), shown on the Party sheet.
 *
 * This was once the GM-only, world-level "Covenant" bond codex; it moved onto the sheet so it's
 * personal. The CHRONICLE quest log can still forge/deepen a bond as a reward — now applied to
 * every party member (applyBondReward).
 */

import { partyMembers } from "./party-folder.mjs";

/** Bonds top out at Rank 5 — consistent with the system's 1–5 skill-star vocabulary. */
export const BOND_MAX_RANK = 5;

/* -------------------------------------------------------------------------- */
/*  Read / write (per actor)                                                  */
/* -------------------------------------------------------------------------- */

/** An actor's bond list (a safe deep copy you can mutate before saveBonds). */
export function getBonds(actor) {
  const raw = actor?.system?.bonds;
  return Array.isArray(raw) ? foundry.utils.deepClone(raw) : [];
}

/** Persist an actor's full bond list (requires permission to update the actor). `options` pass
 *  through to actor.update — e.g. `{ render: false }` so an inline edit doesn't re-render the sheet
 *  (and reset the drawer's scroll). */
export async function saveBonds(actor, bonds, options = {}) {
  return actor.update({ "system.bonds": bonds }, options);
}

export function bondById(id, bonds) {
  return (bonds ?? []).find((b) => b.id === id) ?? null;
}

/* -------------------------------------------------------------------------- */
/*  Blank                                                                      */
/* -------------------------------------------------------------------------- */

/** A fresh, empty bond (matches the data model's bondField shape). */
export function blankBond(overrides = {}) {
  return {
    id: foundry.utils.randomID(),
    name: game.i18n.localize("PROJECTANIME.Covenant.newBondName"),
    faction: "", // faction id this bond belongs to (world Factions — helpers/factions.mjs)
    actorUuid: "", // optional linked Actor (open sheet / drag-to-fill)
    img: "", // portrait (auto-filled from a linked actor, or a File Picker pick)
    banner: "", // optional hero background
    accent: "", // optional color override; defaults to the faction colour at render
    title: "", // role / epithet under the name
    rank: 0,
    prog: 0, // 0–100 toward the next rank
    locked: false, // "claim not yet begun" styling
    rewardedRank: 0, // highest rank whose linked-NPC rewards were delivered (re-drag idempotency)
    vitals: [], // { id, k, v }
    dossier: "", // rich write-up (HTML)
    quote: "",
    abilities: Array.from({ length: BOND_MAX_RANK }, (_v, i) => ({ rank: i + 1, name: "", desc: "", rules: [], toggle: false })),
    ...overrides
  };
}

/* -------------------------------------------------------------------------- */
/*  NPC bond offers (a social NPC's bond + per-rank rewards)                   */
/* -------------------------------------------------------------------------- */

/** The Bond an NPC OFFERS, or null (only NPCs in the "npc" role offer one — see data/actor-models.mjs).
 *  Returns the live system data; callers clone what they keep. */
export function npcBond(npc) {
  if (!npc || npc.type !== "npc" || npc.system?.role !== "npc") return null;
  return npc.system.bond ?? null;
}

/** An NPC bond offer's five rank rows, normalized to exactly ranks 1–5 (missing rows filled blank):
 *  each {rank, abilityName, abilityDesc, rewardGold, rewardSP, rewardItems[]}. */
export function npcBondRanks(npc) {
  const stored = npcBond(npc)?.ranks ?? [];
  return [1, 2, 3, 4, 5].map((rank) => {
    const r = stored.find((x) => Number(x?.rank) === rank) ?? {};
    return {
      rank,
      abilityName: r.abilityName ?? "",
      abilityDesc: r.abilityDesc ?? "",
      rewardGold: Number(r.rewardGold) || 0,
      rewardSP: Number(r.rewardSP) || 0,
      rewardItems: Array.isArray(r.rewardItems) ? r.rewardItems : [],
      rules: Array.isArray(r.rules) ? r.rules : [],
      toggle: !!r.toggle
    };
  });
}

/** Seed (or refresh) a PC bond object from an NPC's offer: copies the identity + per-rank abilities
 *  and links the NPC's UUID, preserving the player's own progression (rank/prog/rewardedRank/id) when
 *  `existing` is given. */
function bondFromNpc(npc, existing = null) {
  const def = npc.system.bond ?? {};
  const abilities = npcBondRanks(npc).map((r) => ({
    rank: r.rank,
    name: r.abilityName,
    desc: r.abilityDesc,
    rules: foundry.utils.deepClone(r.rules ?? []),   // the rank's mechanical Effect rides onto the PC bond
    toggle: !!r.toggle                                // ...and whether it's a player toggle
  }));
  const base = existing ? { ...existing } : blankBond();
  base.name = npc.name;
  base.img = npc.img || base.img;
  base.title = def.title ?? base.title;
  base.banner = def.banner ?? base.banner;
  base.accent = def.accent ?? base.accent;
  base.faction = def.faction ?? base.faction;
  base.dossier = def.dossier ?? base.dossier;
  base.quote = def.quote ?? base.quote;
  base.vitals = (def.vitals ?? []).map((v) => ({ id: v.id || foundry.utils.randomID(), k: v.k ?? "", v: v.v ?? "" }));
  base.abilities = abilities;
  base.actorUuid = npc.uuid;
  if (!existing) { base.rank = 1; base.prog = 20; base.locked = false; base.rewardedRank = 0; }
  return base;
}

/** A short themed reward chat line on the PC. */
function rewardCard(pc, text) {
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: pc }),
    content: `<div class="project-anime chat-card"><div class="card-line"><em class="muted">${text}</em></div></div>`
  });
}

/**
 * Forge or re-sync a bond on `pc` from `npc`'s offer, then deliver any not-yet-granted rank rewards
 * up to the bond's current rank. Re-drag safe: matches an existing bond by the NPC's UUID (or
 * `bondId`), refreshes identity + abilities, preserves the player's rank, and grants rewards only
 * for ranks above the bond's `rewardedRank`. Reward delivery is GM / NPC-owner gated so a player
 * can't self-grant loot from an NPC they don't control. Returns a summary, or null if no offer.
 */
export async function forgeBondFromNpc(pc, npc, { bondId = null } = {}) {
  if (!pc || !npcBond(npc)) return null;
  const bonds = getBonds(pc);
  let entry = bondId
    ? bonds.find((b) => b.id === bondId)
    : bonds.find((b) => b.actorUuid && b.actorUuid === npc.uuid);
  const fresh = !entry;
  const seeded = bondFromNpc(npc, entry ?? null);
  if (fresh) { bonds.unshift(seeded); entry = seeded; }
  else Object.assign(entry, seeded);

  // Deliver rewards for ranks (rewardedRank, rank] — GM / NPC owner only.
  let rewarded = null;
  if (game.user.isGM || npc.isOwner) rewarded = await deliverBondRewards(pc, entry, npc);

  await saveBonds(pc, bonds);
  return { name: entry.name, rank: entry.rank, fresh, rewarded };
}

/**
 * Grant `pc` every reward (gold / SP / item copies) for `entry`'s ranks above its `rewardedRank` up
 * to its current `rank`, then advance rewardedRank. Items carry a provenance flag (bondReward = NPC
 * uuid, bondRewardRank), so even a stale rewardedRank (e.g. a deleted-then-reforged bond) can't
 * re-grant a rank's items. Mutates `entry` (the caller persists the bonds array); applies gold/SP via
 * actor.update + posts a reward chat card. Returns the totals, or null when nothing is owed.
 */
export async function deliverBondRewards(pc, entry, npc) {
  const from = Number(entry.rewardedRank) || 0;
  const to = Number(entry.rank) || 0;
  if (to <= from) return null;

  // Ranks whose items were already delivered (provenance) — never re-grant those items.
  const grantedRanks = new Set(
    pc.items
      .filter((i) => i.getFlag("project-anime", "bondReward") === npc.uuid)
      .map((i) => Number(i.getFlag("project-anime", "bondRewardRank")))
  );

  let gold = 0, sp = 0;
  const itemObjs = [];
  for (const r of npcBondRanks(npc)) {
    if (r.rank <= from || r.rank > to) continue;
    gold += r.rewardGold;
    sp += r.rewardSP;
    if (grantedRanks.has(r.rank)) continue;
    for (const snap of r.rewardItems) {
      const obj = foundry.utils.deepClone(snap);
      delete obj._id;
      foundry.utils.setProperty(obj, "flags.project-anime.bondReward", npc.uuid);
      foundry.utils.setProperty(obj, "flags.project-anime.bondRewardRank", r.rank);
      itemObjs.push(obj);
    }
  }
  entry.rewardedRank = to;

  const updates = {};
  if (gold > 0) updates["system.gold"] = (pc.system.gold ?? 0) + gold;
  if (sp > 0) updates["system.skillPoints.value"] = (pc.system.skillPoints?.value ?? 0) + sp;
  if (Object.keys(updates).length) await pc.update(updates);
  if (itemObjs.length) await pc.createEmbeddedDocuments("Item", itemObjs);

  const parts = [];
  if (gold > 0) parts.push(`${gold} ${game.i18n.localize("PROJECTANIME.Bond.gold")}`);
  if (sp > 0) parts.push(`${sp} ${game.i18n.localize("PROJECTANIME.Bond.sp")}`);
  if (itemObjs.length) parts.push(itemObjs.map((o) => o.name).join(", "));
  if (parts.length) {
    rewardCard(pc, game.i18n.format("PROJECTANIME.Bond.rewardGranted", { name: pc.name, bond: entry.name, rewards: parts.join(" · ") }));
  }
  return { gold, sp, items: itemObjs.length };
}

/** Every Player Character who belongs to a Party (the audience for a party-wide bond reward).
 *  Falls back to all player-owned Characters when no Party actor exists yet. */
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

/* -------------------------------------------------------------------------- */
/*  CHRONICLE integration                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Forge or deepen a bond as a quest reward (GM only). Bonds are per-character now, so a reward
 * applies to EVERY party member: on each, match an existing bond by linked actor UUID first, then
 * by name (case-insensitive), and deepen it by `ranks` (default 1); if none matches, forge a fresh
 * bond (linked to the actor if given). Returns a summary, or null if there was no one/nothing to
 * bond with.
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
    let bond = actorUuid ? bonds.find((b) => b.actorUuid && b.actorUuid === actorUuid) : null;
    if (!bond && name) {
      const key = String(name).trim().toLowerCase();
      bond = bonds.find((b) => String(b.name ?? "").trim().toLowerCase() === key);
    }
    if (bond) {
      bond.rank = Math.min(BOND_MAX_RANK, (bond.rank || 0) + add);
      bond.prog = bond.rank >= BOND_MAX_RANK ? 100 : 20;
      bond.locked = false;
    } else {
      const startRank = Math.min(BOND_MAX_RANK, add);
      bond = blankBond({
        name: name || game.i18n.localize("PROJECTANIME.Covenant.newBondName"),
        actorUuid: actorUuid || "",
        img: img || "",
        rank: startRank,
        prog: startRank >= BOND_MAX_RANK ? 100 : 20
      });
      bonds.unshift(bond);
      forgedAny = true;
    }
    lastRank = bond.rank;
    await saveBonds(member, bonds);
  }

  const label = name || game.i18n.localize("PROJECTANIME.Covenant.newBondName");
  ui.notifications?.info(
    game.i18n.format(forgedAny ? "PROJECTANIME.Covenant.bondForged" : "PROJECTANIME.Covenant.bondAdvanced", {
      name: label,
      rank: lastRank
    })
  );
  return { name: label, rank: lastRank, members: audience.length };
}
