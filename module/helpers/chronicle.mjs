/**
 * Project: Anime — Chronicle quest-log data layer + reward distribution.
 *
 * Quests live in ONE world setting (GM-owned; everyone reads, only the GM writes), so the whole
 * table shares a single campaign quest log. Reward distribution on completion follows the table's
 * rules:
 *   • Skill Points → +value to EVERY member of the party folder (their spendable SP pool)
 *   • Gold         → +value to the party stash treasury (`party.system.gold`)
 *   • Items        → a copy of each dragged Item into the party stash
 *   • Reputation   → no-op for now (a faction system is coming; the value is stored + shown)
 *   • Unlock       → narrative only (shown, granted nothing mechanically)
 */
import { partyMembers, partyActors, resolveParty } from "./party-folder.mjs";
import { applyRepToFaction, factionById, unlockRecruits } from "./factions.mjs";
import { applyBondReward } from "./bonds.mjs";
import { stampCompendiumSource } from "./gear.mjs";

// `partyActors`/`resolveParty` moved to party-folder.mjs (shared with FACTION tier rewards); re-export
// them here so existing importers of the Chronicle module keep working.
export { partyActors, resolveParty };

export const QUESTS_SETTING = "quests";
export const TRACKED_SETTING = "chronicleTracked";
export const TRACKER_VISIBLE_SETTING = "chronicleTrackerVisible";

/** Quest categories → the accent CSS variable each uses. */
export const QUEST_CATEGORIES = {
  main: { color: "var(--q-main)" },
  side: { color: "var(--q-side)" },
  personal: { color: "var(--q-personal)" }
};

/** Reward types the Chronicle understands. `party` = distributed to the party on completion. */
export const REWARD_TYPES = ["sp", "gold", "rep", "bond", "item", "unlock", "recruit"];

/* -------------------------------------------------------------------------- */
/*  Read / write                                                              */
/* -------------------------------------------------------------------------- */

/** The full quest list (a safe deep copy you can mutate before saveQuests). */
export function getQuests() {
  const raw = game.settings.get("project-anime", QUESTS_SETTING);
  return Array.isArray(raw) ? foundry.utils.deepClone(raw) : [];
}

/** Persist the full quest list (GM only — the setting is world-scoped). */
export async function saveQuests(quests) {
  return game.settings.set("project-anime", QUESTS_SETTING, quests);
}

export function getQuest(id) {
  return getQuests().find((q) => q.id === id) ?? null;
}

/** A fresh, empty quest. */
export function blankQuest() {
  return {
    id: foundry.utils.randomID(),
    title: game.i18n.localize("PROJECTANIME.Chronicle.newQuest"),
    category: "main",
    status: "active",
    giver: null, // { uuid, name, img, role }
    banner: "", // optional banner image (hero background), via File Picker
    icon: "", // optional icon image (rail thumbnail + faint hero watermark), via File Picker
    location: "",
    level: "",
    brief: "",
    objectives: [], // { id, text, done, hidden, optional }
    rewards: [], // { type, value?, faction?, uuid?, name?, img?, label? }
    granted: false
  };
}

/** Objective progress, excluding hidden objectives. */
export function questProgress(quest) {
  const real = (quest.objectives ?? []).filter((o) => !o.hidden);
  const done = real.filter((o) => o.done).length;
  return { done, total: real.length, pct: real.length ? Math.round((done / real.length) * 100) : 0 };
}

/* -------------------------------------------------------------------------- */
/*  Reward distribution                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Grant a quest's rewards to the party (GM only). Idempotent-ish: callers should flag the quest
 * `granted` so it isn't paid out twice. Returns a summary object for the chat/notification, or
 * null if it needed a party and none could be resolved.
 */
export async function grantRewards(quest, { goldItemsTo = "stash" } = {}) {
  if (!game.user.isGM) return null;
  const rewards = quest.rewards ?? [];
  const summary = { sp: 0, gold: 0, items: 0, members: 0, rep: 0, bond: 0, recruits: 0, party: null, goldItemsTo };
  if (!rewards.length) return summary;

  const needsParty = rewards.some((r) => ["sp", "gold", "item"].includes(r.type));
  const party = needsParty ? await resolveParty() : null;
  if (needsParty && !party) {
    ui.notifications.warn(game.i18n.localize("PROJECTANIME.Chronicle.noParty"));
    return null;
  }

  const members = party ? partyMembers(party) : [];
  let sp = 0, gold = 0;
  const itemObjs = [];
  const repRewards = [];
  const bondRewards = [];
  const recruitIds = [];
  for (const r of rewards) {
    if (r.type === "sp") sp += Number(r.value) || 0;
    else if (r.type === "gold") gold += Number(r.value) || 0;
    else if (r.type === "rep") repRewards.push(r);
    else if (r.type === "bond") bondRewards.push(r);
    else if (r.type === "recruit" && r.recruitId) recruitIds.push(r.recruitId);
    else if (r.type === "item" && r.uuid) {
      const item = await fromUuid(r.uuid).catch(() => null);
      if (item?.toObject) {
        const obj = item.toObject();
        delete obj._id;
        stampCompendiumSource(obj, item);
        itemObjs.push(obj);
      }
    }
  }

  // Skill Points → every party member's spendable pool (always per-member).
  if (sp > 0 && members.length) {
    await Promise.all(
      members.map((m) => m.update({ "system.skillPoints.value": (m.system.skillPoints?.value ?? 0) + sp }))
    );
    summary.members = members.length;
  }
  summary.sp = sp;

  // Gold & Items route by the GM's choice on the Distribute screen: the shared party stash (default,
  // and what Mark Complete uses) or split/copied to each player. "players" needs members; with none
  // we fall back to the stash so nothing is lost.
  const toPlayers = goldItemsTo === "players" && members.length > 0;
  if (gold > 0) {
    if (toPlayers) {
      const base = Math.floor(gold / members.length);
      const rem = gold - base * members.length; // hand the leftover coins to the first few members
      await Promise.all(members.map((m, i) => {
        const share = base + (i < rem ? 1 : 0);
        return share > 0 ? m.update({ "system.gold": (m.system.gold ?? 0) + share }) : null;
      }).filter(Boolean));
    } else if (party) {
      await party.update({ "system.gold": (party.system.gold ?? 0) + gold });
    }
    summary.gold = gold;
  }
  if (itemObjs.length) {
    if (toPlayers) {
      await Promise.all(members.map((m) =>
        m.createEmbeddedDocuments("Item", itemObjs.map((o) => foundry.utils.deepClone(o)))
      ));
    } else if (party) {
      await party.createEmbeddedDocuments("Item", itemObjs);
    }
    summary.items = itemObjs.length;
  }

  // Reputation → bump the matching faction's standing, resolving by id first (the dropdown stores it)
  // and falling back to the snapshot name. No-op when nothing matches.
  for (const r of repRewards) {
    const name = (r.factionId ? factionById(r.factionId)?.name : null) ?? r.faction;
    await applyRepToFaction(name, r.value);
    summary.rep += 1;
  }

  // Bond → forge or deepen a bond with the target NPC (defaults to the quest giver) on every member.
  for (const r of bondRewards) {
    const name = r.name || quest.giver?.name || "";
    const actorUuid = r.uuid || quest.giver?.uuid || "";
    if (!name && !actorUuid) continue;
    await applyBondReward({ name, actorUuid, img: r.img || quest.giver?.img || "", ranks: r.value });
    summary.bond += 1;
  }

  // Recruit → unlock the referenced HQ recruit-pool entries so they become available to recruit.
  if (recruitIds.length) summary.recruits = (await unlockRecruits(recruitIds)).length;

  summary.party = party?.name ?? null;
  return summary;
}
