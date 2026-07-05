/**
 * Project: Anime — Chronicle quest-log data layer + reward distribution.
 *
 * Quests live in ONE world setting (GM-owned; everyone reads, only the GM writes), so the whole
 * table shares a single campaign quest log. Reward distribution on completion follows the table's
 * rules:
 *   • Gold         → +value to the party stash treasury (`party.system.gold`)
 *   • Items        → a copy of each dragged Item into the party stash
 *   • Reputation   → no-op for now (a faction system is coming; the value is stored + shown)
 *   • Unlock       → narrative only (shown, granted nothing mechanically)
 *
 * v0.03: "A quest never pays SP directly. SP flows only through Episodes, Arcs, Seasons, and
 * Train." — the `sp` reward type is retired from authoring; the Milestone tool (Codex Quests
 * header) pays Episode/Arc/Season SP instead. Legacy sp rewards on stored quests are skipped
 * (kept in data, logged, never paid).
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

/** Hidden world counter: Seasons concluded (the Milestone tool advances it; the party's Tier and
 *  once-per-Season recharges will read it — v0.03 campaign spine). */
export const SEASON_COUNT_SETTING = "seasonCount";

/** GM override for the party's Tier (0 = auto from Seasons). Set from the party sheet. */
export const PARTY_TIER_SETTING = "partyTierOverride";

/** Escape GM-authored text before injecting into chat HTML. */
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* -------------------------------------------------------------------------- */
/*  Party Tier (v0.03)                                                        */
/* -------------------------------------------------------------------------- */

const TIER_NUMERALS = ["I", "I", "II", "III", "IV"];

/** The party's Tier, 1–4. Auto = 1 + Seasons concluded (max IV); a GM override on the party
 *  sheet wins. Work pay, Posting budgets, material prices, and Temper caps read this. */
export function partyTier() {
  const override = Number(game.settings.get("project-anime", PARTY_TIER_SETTING)) || 0;
  if (override >= 1) return Math.min(4, override);
  const seasons = Number(game.settings.get("project-anime", SEASON_COUNT_SETTING)) || 0;
  return Math.min(4, 1 + seasons);
}

/** Roman numeral for a Tier value (defaults to the current party Tier). */
export function tierNumeral(tier = partyTier()) {
  return TIER_NUMERALS[Math.max(1, Math.min(4, Math.round(Number(tier) || 1)))];
}

/* -------------------------------------------------------------------------- */
/*  Milestone SP (v0.03)                                                      */
/* -------------------------------------------------------------------------- */

/** The Milestone award dialog — the campaign's SP faucet (v0.03: "SP flows only through
 *  Episodes, Arcs, Seasons, and Train"). Episode +2, Arc +3, Season +5; rewards STACK: an Arc's
 *  climax is also an Episode and pays both, a Season's conclusion pays all three. Awards the sum
 *  to every character in the party folder, posts one card, and advances the Season counter when
 *  a Season is included. GM only. */
export async function promptMilestoneAward() {
  const L = (k) => game.i18n.localize(k);
  const party = resolveParty();
  const members = party ? partyMembers(party) : [];
  if (!members.length) return ui.notifications.warn(L("PROJECTANIME.Chronicle.milestoneNoParty"));

  const row = (key, sp) => `
    <label class="ms-row"><input type="checkbox" name="${key}" />
      <span>${L(`PROJECTANIME.Chronicle.milestones.${key}`)}</span><b>+${sp} SP</b></label>`;
  const res = await foundry.applications.api.DialogV2.wait({
    window: { title: L("PROJECTANIME.Chronicle.milestone"), icon: "fa-solid fa-flag-checkered" },
    classes: ["project-anime"],
    content: `<div class="project-anime roll-dialog pa-milestones">${row("episode", 2)}${row("arc", 3)}${row("season", 5)}</div>`,
    buttons: [
      {
        action: "award", label: L("PROJECTANIME.Chronicle.award"), icon: "fa-solid fa-medal", default: true,
        callback: (event, button) => ({
          episode: !!button.form.elements.episode?.checked,
          arc: !!button.form.elements.arc?.checked,
          season: !!button.form.elements.season?.checked
        })
      },
      { action: "cancel", label: L("Cancel"), icon: "fa-solid fa-times" }
    ],
    rejectClose: false
  });
  if (!res || res === "cancel") return;

  // Stacking: a Season concludes an Arc, an Arc's climax is also an Episode — the doc pays both.
  const season = res.season;
  const arc = res.arc || season;
  const episode = res.episode || arc;
  if (!episode) return;
  const parts = [];
  if (episode) parts.push({ key: "episode", sp: 2 });
  if (arc) parts.push({ key: "arc", sp: 3 });
  if (season) parts.push({ key: "season", sp: 5 });
  const total = parts.reduce((n, p) => n + p.sp, 0);

  await Promise.all(members.map((m) =>
    m.update({ "system.skillPoints.value": (m.system.skillPoints?.value ?? 0) + total })
  ));

  let seasonLine = "";
  if (season) {
    const n = (Number(game.settings.get("project-anime", SEASON_COUNT_SETTING)) || 0) + 1;
    await game.settings.set("project-anime", SEASON_COUNT_SETTING, n);
    seasonLine = `<p class="muted">${game.i18n.format("PROJECTANIME.Chronicle.seasonAdvanced", { n })}</p>`;
  }
  const breakdown = parts.map((p) => `${L(`PROJECTANIME.Chronicle.milestones.${p.key}`)} +${p.sp}`).join(" · ");
  await ChatMessage.create({
    content: `
      <div class="project-anime chat-card">
        <header class="card-title"><i class="fa-solid fa-flag-checkered"></i> ${L("PROJECTANIME.Chronicle.milestone")}</header>
        <p><strong>+${total} SP</strong> — ${breakdown}</p>
        <p class="muted">${members.map((m) => m.name).join(", ")}</p>
        ${seasonLine}
      </div>`
  });
}

/** Quest categories → the accent CSS variable each uses. */
export const QUEST_CATEGORIES = {
  main: { color: "var(--q-main)" },
  side: { color: "var(--q-side)" },
  personal: { color: "var(--q-personal)" }
};

/** Posting Sizes (v0.03) — the reward-budget axis. Categories stay the journal's display colors. */
export const QUEST_SIZES = ["job", "request", "commission"];

/** The 9 Objective types a Posting is built from (v0.03). */
export const OBJECTIVE_TYPES = ["clear", "deliver", "duel", "escort", "hunt", "protect", "recover", "scout", "survive"];

/** Reward Budget in Gold: Job 100G × Tier · Request 100G × Tier per character ·
 *  Commission 200G × Tier per character (paid at the climax). */
export function postingBudget(size, tier, members = 1) {
  const t = Math.max(1, Math.min(4, Number(tier) || 1));
  const n = Math.max(1, Number(members) || 1);
  if (size === "job") return 100 * t;
  if (size === "request") return 100 * t * n;
  if (size === "commission") return 200 * t * n;
  return 0;
}

/** Tick every active Posting's Deadline down one rest — the party-wide Rest action calls this
 *  (GM-side). At 0 the Posting expires: it fails, pays nothing, and the printed consequence goes
 *  to chat. Returns one summary line per ticked/expired quest for the rest card. */
export async function tickQuestDeadlines() {
  if (!game.user.isGM) return [];
  const quests = getQuests();
  const lines = [];
  let changed = false;
  for (const q of quests) {
    if (q.status !== "active") continue;
    const left = Number(q.deadline);
    if (!Number.isFinite(left) || left <= 0) continue;
    q.deadline = left - 1;
    changed = true;
    if (q.deadline > 0) {
      lines.push(game.i18n.format("PROJECTANIME.Chronicle.deadlineTick", { title: q.title, n: q.deadline }));
      continue;
    }
    q.status = "failed";
    lines.push(game.i18n.format("PROJECTANIME.Chronicle.deadlineExpired", { title: q.title }));
    await ChatMessage.create({
      content: `
        <div class="project-anime chat-card">
          <header class="card-header">
            <span class="card-icon is-glyph"><i class="fas fa-hourglass-end"></i></span>
            <div class="card-titles">
              <h3 class="card-title">${esc(q.title)}</h3>
              <span class="card-type">${game.i18n.localize("PROJECTANIME.Chronicle.expired")}</span>
            </div>
          </header>
          ${q.consequence ? `<div class="card-lines"><div class="card-line">${esc(q.consequence)}</div></div>` : ""}
        </div>`
    });
  }
  if (changed) await saveQuests(quests);
  return lines;
}

/** Reward types the Chronicle understands. `party` = distributed to the party on completion.
 *  (`sp` retired v0.03 — quests never pay SP; see the Milestone tool.) */
export const REWARD_TYPES = ["gold", "rep", "bond", "item", "unlock", "recruit"];

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
    size: "job", // Posting Size (v0.03): job | request | commission
    giver: null, // { uuid, name, img, role }
    banner: "", // optional banner image (hero background), via File Picker
    icon: "", // optional icon image (rail thumbnail + faint hero watermark), via File Picker
    location: "",
    level: "",
    brief: "",
    deadline: "", // rests remaining ("" = none); ticks down on party rests, expires at 0
    consequence: "", // printed with the Deadline — what happens when it expires (public)
    complication: "", // the hidden truth — GM eyes only
    objectives: [], // { id, type, text, done, hidden, optional }
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
  let gold = 0;
  const itemObjs = [];
  const repRewards = [];
  const bondRewards = [];
  const recruitIds = [];
  for (const r of rewards) {
    // Legacy `sp` rewards (pre-v0.03 quests): never paid — SP flows only through Milestones/Train.
    if (r.type === "sp") { console.log(`Project: Anime | Quest sp reward skipped (v0.03): ${r.value}`); continue; }
    if (r.type === "gold") gold += Number(r.value) || 0;
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
