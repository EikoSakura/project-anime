/**
 * Project: Anime — Discord integration (Phase 1: outbound webhook).
 *
 * Posts a PLAYER-facing version of a quest to a Discord channel via an incoming webhook — a
 * one-way "mailbox slot" (no bot, no hosting). The player view reuses the Codex's own
 * visibility rules verbatim: hidden objectives / hidden rewards are dropped and the GM-only
 * `complication` is never included, so "what Discord sees" == "what a non-GM sees in the Codex".
 *
 * Sign-up in this phase is a native ✅ reaction (Discord tracks the roster) — nothing ever
 * returns to Foundry. Later phases swap the webhook POST for a bot call behind the same button.
 */

/** World setting (config:false; edited through the GM-only Discord menu) holding the channel webhook URL. */
export const DISCORD_WEBHOOK_SETTING = "discordWebhook";

/** Category → embed accent (decimal RGB), mirroring the Codex `--q-*` colors. */
const CATEGORY_COLOR = { main: 0xd8b257, side: 0xb79bf0, personal: 0x6fe0b0 };

/** Discord embed length caps (leave headroom; we ellipsize rather than let Discord reject the post). */
const CAP = { title: 256, desc: 4096, field: 1024 };

const clamp = (s, n) => {
  s = String(s ?? "");
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

/** Foundry-authored brief (ProseMirror HTML + `@UUID[…]{Label}` content links) → plain text. */
function htmlToText(html) {
  if (!html) return "";
  const s = String(html)
    .replace(/@\w+\[[^\]]+\]\{([^}]+)\}/g, "$1") // @UUID[…]{Label} → Label
    .replace(/@\w+\[[^\]]+\]/g, "");             // bare @UUID[…] → drop
  const doc = new DOMParser().parseFromString(s, "text/html");
  doc.body.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  doc.body.querySelectorAll("p, div, li, h1, h2, h3, h4, blockquote").forEach((el) => el.append("\n"));
  return (doc.body.textContent ?? "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** One player-visible reward → a text line. Legacy `sp` (never paid in V2) and unknowns are omitted. */
function rewardLine(r) {
  switch (r.type) {
    case "gold": return `⦿ ${r.value ?? 0} ${game.i18n.localize("PROJECTANIME.Chronicle.reward.gold")}`;
    case "item": return `❖ ${r.name || game.i18n.localize("PROJECTANIME.Chronicle.reward.item")}`;
    case "unlock": return `⚿ ${r.label || game.i18n.localize("PROJECTANIME.Chronicle.reward.unlock")}`;
    default: return null;
  }
}

/** Build the Discord webhook payload (one embed) for a quest's player view. */
export function buildQuestEmbed(quest) {
  const L = (k) => game.i18n.localize(k);
  const fields = [];

  // Meta line: giver · location · difficulty (only what's set).
  const meta = [];
  if (quest.giver?.name) meta.push(`**${L("PROJECTANIME.Chronicle.giver")}:** ${quest.giver.name}`);
  if (quest.location) meta.push(`**${L("PROJECTANIME.Chronicle.location")}:** ${quest.location}`);
  const lvl = Math.max(0, Math.min(5, Math.round(Number(quest.level) || 0)));
  if (lvl) meta.push(`**${L("PROJECTANIME.Chronicle.level")}:** ${"★".repeat(lvl)}`);
  const deadline = Number(quest.deadline);
  if (quest.status === "active" && Number.isFinite(deadline) && deadline > 0) {
    meta.push(`**${L("PROJECTANIME.Chronicle.deadline")}:** ${game.i18n.format(
      deadline === 1 ? "PROJECTANIME.Chronicle.deadlineOne" : "PROJECTANIME.Chronicle.deadlineMany", { n: deadline }
    )}`);
  }
  // Objectives — same player filter as the Codex (drop hidden), with an optional tag.
  const objectives = (quest.objectives ?? []).filter((o) => !o.hidden && String(o.text ?? "").trim());
  if (objectives.length) {
    const list = objectives.map((o) =>
      `${o.done ? "☑" : "☐"} ${o.text}${o.optional ? ` *(${L("PROJECTANIME.Chronicle.optionalObj")})*` : ""}`
    ).join("\n");
    fields.push({ name: L("PROJECTANIME.Chronicle.objectives"), value: clamp(list, CAP.field) });
  }

  // Rewards — same player filter as the Codex (drop hidden); sp rewards are omitted (never paid).
  const rewards = (quest.rewards ?? []).filter((r) => !r.hidden).map(rewardLine).filter(Boolean);
  if (rewards.length) {
    fields.push({ name: L("PROJECTANIME.Chronicle.rewards"), value: clamp(rewards.join("\n"), CAP.field) });
  }

  // Meta (giver/location/difficulty/deadline) leads the description, then the briefing text.
  const description = [meta.join("\n"), htmlToText(quest.brief)].filter(Boolean).join("\n\n");

  const embed = {
    title: clamp(quest.title || L("PROJECTANIME.Chronicle.untitled"), CAP.title),
    description: clamp(description, CAP.desc) || undefined,
    color: CATEGORY_COLOR[quest.category] ?? CATEGORY_COLOR.main,
    fields,
    footer: { text: L("PROJECTANIME.Chronicle.discordSignUp") }
  };

  return { embeds: [embed] };
}

/**
 * POST a quest's player embed to the configured Discord webhook. Returns { ok, reason?, error? }.
 * `reason: "no-url"` means the webhook hasn't been configured yet (caller points the GM at Settings).
 */
export async function postQuestToDiscord(quest) {
  const url = String(game.settings.get("project-anime", DISCORD_WEBHOOK_SETTING) || "").trim();
  if (!url) return { ok: false, reason: "no-url" };

  const payload = buildQuestEmbed(quest);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`Project: Anime | Discord webhook rejected (${res.status})`, body);
      return { ok: false, reason: "http", error: `${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    // Most likely CORS or a bad/blocked URL — surfaced to the console for the GM to diagnose.
    console.error("Project: Anime | Discord webhook POST failed", err);
    return { ok: false, reason: "network", error: String(err?.message ?? err) };
  }
}
