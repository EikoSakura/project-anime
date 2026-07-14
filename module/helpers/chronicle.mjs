/**
 * Project: Anime — Chronicle quest-log data layer + reward distribution.
 *
 * Quests live in ONE world setting (GM-owned; everyone reads, only the GM writes), so the whole
 * table shares a single campaign quest log. Reward distribution on completion follows the table's
 * rules:
 *   • Gold         → +value to the party stash treasury (`party.system.gold`)
 *   • Items        → a copy of each dragged Item into the party stash
 *   • Unlock       → narrative only (shown, granted nothing mechanically)
 *
 * v0.03: "A quest never pays SP directly. SP flows only through Episodes, Arcs, Seasons, and
 * Train." — the `sp` reward type is retired from authoring; the Milestone tool (Codex Quests
 * header) pays Episode/Arc/Season SP instead. Legacy sp rewards on stored quests are skipped
 * (kept in data, logged, never paid).
 */
import { partyMembers, partyActors, partyCompanions, resolveParty } from "./party-folder.mjs";
import { stampCompendiumSource } from "./gear.mjs";
import { cardHTML } from "./dice.mjs";

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
/*  Party Tier (legacy scale for quest reward budgets)                        */
/* -------------------------------------------------------------------------- */

const TIER_NUMERALS = ["I", "I", "II", "III", "IV"];

/** A 1–4 campaign-scale dial for quest reward budgets (Ranks are gone in V2 — this is now just
 *  the GM's override on the party sheet, else 1 + Seasons concluded, max IV). */
export function partyTier() {
  const override = Number(game.settings.get("project-anime", PARTY_TIER_SETTING)) || 0;
  if (override >= 1) return Math.min(4, override);
  return partyTierAuto();
}

/** The auto-derived campaign scale (ignores the GM pin): 1 + Seasons concluded, max IV. */
export function partyTierAuto() {
  const seasons = Number(game.settings.get("project-anime", SEASON_COUNT_SETTING)) || 0;
  return Math.min(4, 1 + seasons);
}

/** Roman numeral for a Tier value (defaults to the current campaign scale). */
export function tierNumeral(tier = partyTier()) {
  return TIER_NUMERALS[Math.max(1, Math.min(4, Math.round(Number(tier) || 1)))];
}

/* -------------------------------------------------------------------------- */
/*  Milestone Advancements (V2)                                               */
/* -------------------------------------------------------------------------- */

/** The Milestone award dialog — the campaign's advancement faucet (rules: Advancement —
 *  Episode 2 · Arc 4 · Season 6; each milestone is picked on its own, no stacking implied by
 *  the doc's table). Awards the chosen milestones' advancements to every character in the
 *  party folder, posts one card, and advances the Season counter when a Season is included.
 *  GM only. */
export async function promptMilestoneAward() {
  const L = (k) => game.i18n.localize(k);
  const party = await resolveParty();
  const members = party ? partyMembers(party) : [];
  if (!members.length) return ui.notifications.warn(L("PROJECTANIME.Chronicle.milestoneNoParty"));

  const cfg = CONFIG.PROJECTANIME?.milestones ?? {};
  const row = (key) => `
    <label class="ms-row"><input type="checkbox" name="${key}" />
      <span>${L(`PROJECTANIME.Chronicle.milestones.${key}`)}</span><b>+${cfg[key]?.advancements ?? 0}</b></label>`;
  const res = await foundry.applications.api.DialogV2.wait({
    window: { title: L("PROJECTANIME.Chronicle.milestone"), icon: "fa-solid fa-flag-checkered" },
    classes: ["project-anime"],
    content: `<div class="project-anime roll-dialog pa-milestones">${row("episode")}${row("arc")}${row("season")}</div>`,
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

  const parts = [];
  for (const key of ["episode", "arc", "season"]) {
    if (res[key]) parts.push({ key, n: cfg[key]?.advancements ?? 0 });
  }
  if (!parts.length) return;
  const total = parts.reduce((n, p) => n + p.n, 0);

  // Companions advance with their bonders (rules: Companion Advancement — the Companion earns
  // 1 whenever you earn 1), so each earns the same total.
  const companions = partyCompanions(party);
  await Promise.all([...members, ...companions].map((m) =>
    m.update({ "system.advancement.value": (m.system.advancement?.value ?? 0) + total })
  ));

  let seasonLine = "";
  if (res.season) {
    const n = (Number(game.settings.get("project-anime", SEASON_COUNT_SETTING)) || 0) + 1;
    await game.settings.set("project-anime", SEASON_COUNT_SETTING, n);
    seasonLine = `<em class="muted">${game.i18n.format("PROJECTANIME.Chronicle.seasonAdvanced", { n })}</em>`;
  }
  const breakdown = parts.map((p) => `${L(`PROJECTANIME.Chronicle.milestones.${p.key}`)} +${p.n}`).join(" · ");
  const lines = [
    '<span class="card-rule"></span>',
    ...members.map((m) => ({ k: m.name, v: `+${total} ${L("PROJECTANIME.Advance.advancements")}`, cls: "good" })),
    ...companions.map((c) => ({ icon: "fa-paw", k: c.name, v: `+${total} ${L("PROJECTANIME.Advance.advancements")}`, cls: "good" }))
  ];
  if (seasonLine) lines.push(seasonLine);
  await ChatMessage.create({
    content: cardHTML({
      title: L("PROJECTANIME.Chronicle.milestone"),
      subtitle: breakdown,
      glyph: "fa-flag-checkered",
      accent: "var(--pac-gold)",
      lines
    })
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
      content: cardHTML({
        title: q.title,
        subtitle: game.i18n.localize("PROJECTANIME.Chronicle.expired"),
        glyph: "fa-hourglass-end",
        accent: "var(--pac-gold)",
        lines: q.consequence ? [esc(q.consequence)] : []
      })
    });
  }
  if (changed) await saveQuests(quests);
  return lines;
}

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
    scheduledAt: "", // optional real-world session date/time, epoch ms ("" = none) — Discord dynamic timestamp
    consequence: "", // printed with the Deadline — what happens when it expires (public)
    complication: "", // the hidden truth — GM eyes only
    objectives: [], // { id, text, done, hidden, optional }
    rewards: [], // { type, value?, uuid?, name?, img?, label? }
    granted: false,
    rewardsPosted: false, // #rewards receipt already posted to Discord (set only on a 2xx)
    participants: [], // actor ids frozen at distribution — the Discord credit roster
    receipt: null // exact payout snapshot { party, participants, stash, unlocks } for (re)posts
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
 * Grant a quest's rewards (GM only). Destinations resolve per reward: `assignments[i]` is
 * "stash" | "split" | an actor id (that person alone). Without `assignments`, the legacy
 * `goldItemsTo` applies to every gold/item reward ("stash" is the default and what Mark Complete
 * uses; "players" = split gold / copy items to everyone). `participants` (actor ids, chip order)
 * narrows splits and the Discord credit roster; omitted = the party folder roster. Pass `party`
 * to skip re-resolving (the Distribute dialog already prompted). Idempotent-ish: callers flag the
 * quest `granted` so it isn't paid twice. Returns a summary whose `receipt` is the exact
 * per-person payout the #rewards post reads, or null if a party was needed and none resolved.
 */
export async function grantRewards(quest, { goldItemsTo = "stash", participants = null, assignments = null, party = null } = {}) {
  if (!game.user.isGM) return null;
  const rewards = quest.rewards ?? [];
  const summary = { sp: 0, gold: 0, items: 0, members: 0, party: null, goldItemsTo, receipt: null };
  if (!rewards.length) return summary;

  const needsParty = rewards.some((r) => ["sp", "gold", "item"].includes(r.type));
  if (needsParty && !party) party = await resolveParty();

  const members = Array.isArray(participants)
    ? participants.map((id) => game.actors.get(id)).filter((a) => a?.type === "character")
    : (party ? partyMembers(party) : []);

  // Ledger — what each person and the stash actually receive; becomes the frozen receipt.
  const per = new Map(); // actor id → { actor, gold, itemObjs }
  const touch = (a) => {
    if (!per.has(a.id)) per.set(a.id, { actor: a, gold: 0, itemObjs: [] });
    return per.get(a.id);
  };
  members.forEach(touch); // every participant gets a receipt entry, even pure credit
  const stash = { gold: 0, itemObjs: [] };
  const unlocks = [];

  for (let i = 0; i < rewards.length; i++) {
    const r = rewards[i];
    // Legacy `sp` rewards (pre-v0.03 quests): never paid — SP flows only through Milestones/Train.
    if (r.type === "sp") { console.log(`Project: Anime | Quest sp reward skipped (v0.03): ${r.value}`); continue; }
    if (r.type === "unlock") { if (r.label) unlocks.push(r.label); continue; }
    if (r.type !== "gold" && r.type !== "item") continue;

    let dest = assignments ? (assignments[i] ?? "stash") : (goldItemsTo === "players" ? "split" : "stash");
    // A named assignee is paid even if their chip was left unticked; a deleted actor or an empty
    // participant list degrades to the stash so nothing is ever lost.
    const direct = dest !== "stash" && dest !== "split" ? game.actors.get(dest) : null;
    if (dest !== "stash" && dest !== "split" && !direct) dest = "stash";
    if (dest === "split" && !members.length) dest = "stash";

    if (r.type === "gold") {
      const n = Number(r.value) || 0;
      if (n <= 0) continue;
      if (dest === "stash") stash.gold += n;
      else if (dest === "split") {
        const base = Math.floor(n / members.length);
        const rem = n - base * members.length; // leftover coins to the first chips, mirroring the old split
        members.forEach((m, j) => { touch(m).gold += base + (j < rem ? 1 : 0); });
      } else touch(direct).gold += n;
      summary.gold += n;
      continue;
    }

    if (!r.uuid) continue;
    const item = await fromUuid(r.uuid).catch(() => null);
    if (!item?.toObject) continue;
    const obj = item.toObject();
    delete obj._id;
    stampCompendiumSource(obj, item);
    if (dest === "stash") stash.itemObjs.push(obj);
    else if (dest === "split") members.forEach((m) => touch(m).itemObjs.push(foundry.utils.deepClone(obj)));
    else touch(direct).itemObjs.push(obj);
    summary.items += 1;
  }

  // The stash IS the party actor — required only when something actually lands in it. Aborting
  // here is side-effect-free: the loop above only builds local state (plus read-only fromUuid).
  if (!party && (stash.gold > 0 || stash.itemObjs.length)) {
    ui.notifications.warn(game.i18n.localize("PROJECTANIME.Chronicle.noParty"));
    return null;
  }

  // Pay out the ledger.
  const goldUpdates = [...per.values()]
    .filter((e) => e.gold > 0)
    .map((e) => ({ _id: e.actor.id, "system.gold": (e.actor.system.gold ?? 0) + e.gold }));
  if (goldUpdates.length) await Actor.updateDocuments(goldUpdates);
  for (const e of per.values()) {
    if (e.itemObjs.length) await e.actor.createEmbeddedDocuments("Item", e.itemObjs);
  }
  if (stash.gold > 0 && party) await party.update({ "system.gold": (party.system.gold ?? 0) + stash.gold });
  if (stash.itemObjs.length && party) await party.createEmbeddedDocuments("Item", stash.itemObjs);

  summary.members = members.length;
  summary.party = party?.name ?? null;
  summary.receipt = {
    party: party?.name ?? "",
    participants: [...per.values()].map((e) => ({
      id: e.actor.id, name: e.actor.name, gold: e.gold, items: e.itemObjs.map((o) => o.name)
    })),
    stash: { gold: stash.gold, items: stash.itemObjs.map((o) => o.name) },
    unlocks
  };
  return summary;
}
