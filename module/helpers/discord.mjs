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

/** World setting (config:false) holding a role id to @-ping when a quest posts ("" = no ping). */
export const DISCORD_ROLE_SETTING = "discordRoleId";

/** World setting (config:false) holding the #rewards channel webhook URL ("" = rewards posting off). */
export const DISCORD_REWARDS_WEBHOOK_SETTING = "discordRewardsWebhook";

/** The role id to @-ping on a quest post (accepts a raw id or a pasted `<@&id>` mention); "" = no ping. */
function pingRoleId() {
  const raw = String(game.settings.get("project-anime", DISCORD_ROLE_SETTING) || "");
  const m = raw.match(/\d{5,}/);
  return m ? m[0] : "";
}

/** Extract a Discord user-id snowflake from pasted text (a raw id or a copied `<@id>` mention); "" = none. */
export function extractSnowflake(raw) {
  const m = String(raw ?? "").match(/\d{15,}/);
  return m ? m[0] : "";
}

/** The player who "is" this character: the user whose assigned character it is, else its first
 *  non-GM owner. Null for GM-run or orphaned actors. */
export function characterOwner(actor) {
  if (!actor) return null;
  return game.users.find((u) => !u.isGM && u.character?.id === actor.id)
    ?? game.users.find((u) => !u.isGM && actor.testUserPermission(u, "OWNER"))
    ?? null;
}

/** The Discord user id linked to a character (`flags.project-anime.discordId`); "" = unlinked. */
export function actorDiscordId(actor) {
  return extractSnowflake(actor?.getFlag?.("project-anime", "discordId"));
}

/** Category → embed accent (decimal RGB), mirroring the Codex `--q-*` colors. */
const CATEGORY_COLOR = { main: 0xd8b257, side: 0xb79bf0, personal: 0x6fe0b0 };

/** Category → a plain-text badge glyph for the author eyebrow (emoji render there; markdown does not). */
const CATEGORY_BADGE = { main: "★", side: "◈", personal: "✦" };

/**
 * True only for a public http(s) URL Discord's servers can fetch. Local Foundry banners/avatars are
 * localhost/LAN/relative URLs Discord can't reach (it drops them silently), so every image field is
 * gated behind this — the embed is designed to be complete with zero images.
 */
function isPublicHttp(u) {
  if (typeof u !== "string" || !u) return false;
  let url;
  try { url = new URL(u); } catch { return false; }
  if (!/^https?:$/i.test(url.protocol)) return false;
  const h = url.hostname.toLowerCase();
  if (h === "localhost" || h === "0.0.0.0" || h === "::1" || h.endsWith(".local")) return false;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
  return true;
}

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
  // Drop GM-only secret blocks so the post matches the non-GM Codex view (which enriches with
  // secrets:false). Revealed secrets stay — players see those too. Without this, secret text leaks.
  doc.body.querySelectorAll("section.secret:not(.revealed)").forEach((el) => el.remove());
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

  // Meta grid — Giver / Location / Difficulty pack into one desktop row (inline, no thumbnail).
  if (quest.giver?.name) {
    fields.push({ name: `👤 ${L("PROJECTANIME.Chronicle.giver")}`, value: clamp(quest.giver.name, CAP.field), inline: true });
  }
  if (quest.location) {
    fields.push({ name: `📍 ${L("PROJECTANIME.Chronicle.location")}`, value: clamp(quest.location, CAP.field), inline: true });
  }
  const lvl = Math.max(0, Math.min(5, Math.round(Number(quest.level) || 0)));
  if (lvl >= 1) {
    fields.push({ name: `⚔️ ${L("PROJECTANIME.Chronicle.level")}`, value: "★".repeat(lvl) + "☆".repeat(5 - lvl), inline: true });
  }

  // Scheduled real-world time → Discord DYNAMIC TIMESTAMP. Unix SECONDS (floored — not ms), so every
  // viewer sees it in their own timezone; :F = exact long date/time, :R = live relative countdown.
  // Full width so the long localized string doesn't wrap. Omitted entirely when unset (never <t::F>).
  const sms = Number(quest.scheduledAt);
  if (Number.isFinite(sms) && sms > 0) {
    const U = Math.floor(sms / 1000);
    fields.push({ name: `🗓️ ${L("PROJECTANIME.Chronicle.scheduled")}`, value: `<t:${U}:F>\n*<t:${U}:R>*`, inline: false });
  }

  // In-game rest Deadline (a rest COUNTER, not a real date — kept distinct from the Scheduled time).
  const deadline = Number(quest.deadline);
  if (quest.status === "active" && Number.isFinite(deadline) && deadline > 0) {
    fields.push({
      name: `⏳ ${L("PROJECTANIME.Chronicle.deadline")}`,
      value: game.i18n.format(deadline === 1 ? "PROJECTANIME.Chronicle.deadlineOne" : "PROJECTANIME.Chronicle.deadlineMany", { n: deadline }),
      inline: false
    });
  }

  // Objectives — same player filter as the Codex (drop hidden), with an optional tag.
  const objectives = (quest.objectives ?? []).filter((o) => !o.hidden && String(o.text ?? "").trim());
  if (objectives.length) {
    const list = objectives.map((o) =>
      `${o.done ? "☑" : "☐"} ${o.text}${o.optional ? ` *(${L("PROJECTANIME.Chronicle.optionalObj")})*` : ""}`
    ).join("\n");
    fields.push({ name: `🎯 ${L("PROJECTANIME.Chronicle.objectives")}`, value: clamp(list, CAP.field), inline: false });
  }

  // Rewards — same player filter as the Codex (drop hidden); sp rewards are omitted (never paid).
  const rewards = (quest.rewards ?? []).filter((r) => !r.hidden).map(rewardLine).filter(Boolean);
  if (rewards.length) {
    fields.push({ name: `💰 ${L("PROJECTANIME.Chronicle.rewards")}`, value: clamp(rewards.join("\n"), CAP.field), inline: false });
  }

  // Brief only, as a blockquote (the "briefing scroll"). Meta now lives in the fields above.
  const briefText = htmlToText(quest.brief);
  const description = briefText ? clamp(`>>> ${briefText}`, CAP.desc) : undefined;

  // Author eyebrow = category badge + the existing category label (Title Case, reused). Giver avatar
  // attaches only if it's a public URL Discord can fetch (never for a local Foundry).
  const author = { name: `${CATEGORY_BADGE[quest.category] ?? "◆"} ${L(`PROJECTANIME.Chronicle.cat.${quest.category}`)}` };
  if (isPublicHttp(quest.giver?.img)) author.icon_url = quest.giver.img;

  const embed = {
    author,
    title: clamp(quest.title || L("PROJECTANIME.Chronicle.untitled"), CAP.title),
    description,
    color: CATEGORY_COLOR[quest.category] ?? CATEGORY_COLOR.main,
    fields,
    footer: { text: L("PROJECTANIME.Chronicle.discordSignUp") },
    timestamp: new Date().toISOString() // static localized "posted at" on the footer line
  };
  // Banner as the bottom image only if publicly reachable (does not affect the meta grid columns).
  if (isPublicHttp(quest.banner)) embed.image = { url: quest.banner };

  const payload = { embeds: [embed] };
  // Optional role @-ping. Only a message `content` mention notifies (a mention inside an embed never
  // does); allowed_mentions whitelists just this role so nothing else in the post can accidentally ping.
  const roleId = pingRoleId();
  if (roleId) {
    payload.content = `<@&${roleId}>`;
    payload.allowed_mentions = { roles: [roleId] };
  }
  return payload;
}

/** Discord Polls cap out at 32 days (768h). Sign-up window runs to the scheduled time, else a default. */
const POLL_MAX_HOURS = 768;
const POLL_DEFAULT_HOURS = 336; // 14 days when the quest has no scheduled real-world time

/** Whole hours the sign-up poll stays open — until `scheduledAt` if set, otherwise the default window. */
function signupPollHours(quest) {
  const sms = Number(quest.scheduledAt);
  if (Number.isFinite(sms) && sms > 0) {
    const hrs = Math.ceil((sms - Date.now()) / 3_600_000);
    return Math.min(POLL_MAX_HOURS, Math.max(1, hrs));
  }
  return POLL_DEFAULT_HOURS;
}

/**
 * Build a native Discord POLL that doubles as a named sign-up roster. A standard incoming webhook can
 * create polls (unlike buttons, which need a registered app), and poll voters are visible by name — so
 * a single-answer poll IS the roster: everyone who picks "I'm In" is listed, with a live count and an
 * auto-close. Posted as its OWN message because a poll suppresses embeds when combined into one message.
 */
export function buildSignupPoll(quest) {
  const L = (k) => game.i18n.localize(k);
  const title = quest.title || L("PROJECTANIME.Chronicle.untitled");
  return {
    poll: {
      question: { text: clamp(game.i18n.format("PROJECTANIME.Chronicle.discordPollQuestion", { name: title }), 300) },
      answers: [{ poll_media: { text: clamp(L("PROJECTANIME.Chronicle.discordPollJoin"), 55), emoji: { name: "✋" } } }],
      duration: signupPollHours(quest),
      allow_multiselect: false
    }
  };
}

/** POST one JSON payload to the webhook. Returns { ok, reason?, error? }. */
async function postToWebhook(url, payload) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      // A hung webhook host must never stall the calling flow (payout guards save before this,
      // but an unbounded await still freezes the GM's click for minutes).
      signal: AbortSignal.timeout(15_000)
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

/**
 * Post a quest's player view to the configured Discord webhook: first the rich embed, then a native
 * sign-up POLL as a follow-up message (the poll is the named roster — see buildSignupPoll). Returns
 * { ok, reason?, error?, pollOk? }. `reason: "no-url"` means the webhook isn't configured yet;
 * `pollOk: false` means the embed posted but the sign-up poll didn't.
 */
export async function postQuestToDiscord(quest) {
  const url = String(game.settings.get("project-anime", DISCORD_WEBHOOK_SETTING) || "").trim();
  if (!url) return { ok: false, reason: "no-url" };

  const embedRes = await postToWebhook(url, buildQuestEmbed(quest));
  if (!embedRes.ok) return embedRes;

  // Best-effort: a failed sign-up poll must not undo the already-posted quest — flag it instead.
  const pollRes = await postToWebhook(url, buildSignupPoll(quest));
  return pollRes.ok ? { ok: true } : { ok: true, pollOk: false, error: pollRes.error };
}

/* -------------------------------------------------------------------------- */
/*  Rewards channel                                                           */
/* -------------------------------------------------------------------------- */

/** Every rewards post wears gold — #rewards scrolls as one trophy wall; category stays in the eyebrow. */
const REWARDS_COLOR = 0xd8b257;

/** Discord caps an embed at 25 fields; participants keep 23 so Stash/Unlocks always fit. */
const MAX_PARTICIPANT_FIELDS = 23;

/** True when a receipt has anything worth posting (loot, stash, or unlocks — not just credit). */
export function receiptHasLoot(receipt) {
  if (!receipt) return false;
  return (receipt.stash?.gold ?? 0) > 0 || (receipt.stash?.items?.length ?? 0) > 0
    || (receipt.unlocks?.length ?? 0) > 0
    || (receipt.participants ?? []).some((p) => (p.gold ?? 0) > 0 || (p.items?.length ?? 0) > 0);
}

/** One participant's field value: mention line (embed mentions render but never ping) + their exact
 *  loot lines. Discord rejects empty field values, so pure credit with no link renders an em dash. */
function participantValue(p, mention) {
  const lines = [];
  if (mention) lines.push(mention);
  if ((p.gold ?? 0) > 0) lines.push(`⦿ ${p.gold} ${game.i18n.localize("PROJECTANIME.Chronicle.reward.gold")}`);
  for (const name of p.items ?? []) lines.push(`❖ ${name}`);
  return clamp(lines.join("\n") || "—", CAP.field);
}

/**
 * Build the #rewards webhook payload from a payout receipt — the numbers grantRewards actually
 * paid, never recomputed. Mentions resolve LIVE from each character's `discordId` flag (so a
 * delayed retry picks up links fixed in between); unlinked characters show name-only and are
 * omitted from the ping line. Only the message `content` notifies, whitelisted to exactly the
 * linked participants via allowed_mentions.
 */
export function buildRewardsEmbed(quest, receipt) {
  const L = (k) => game.i18n.localize(k);
  const stash = receipt?.stash ?? { gold: 0, items: [] };
  const unlocks = receipt?.unlocks ?? [];
  const participants = (receipt?.participants ?? []).map((p) => {
    const discordId = actorDiscordId(game.actors.get(p.id));
    return { ...p, discordId, mention: discordId ? `<@${discordId}>` : "" };
  });

  // Description totals strip — the whole payout scannable in a notification preview.
  const totalGold = (stash.gold ?? 0) + participants.reduce((n, p) => n + (p.gold ?? 0), 0);
  const totalItems = (stash.items?.length ?? 0) + participants.reduce((n, p) => n + (p.items?.length ?? 0), 0);
  const totals = [];
  if (totalGold > 0) totals.push(`⦿ ${totalGold}`);
  if (totalItems > 0) totals.push(`❖ ${totalItems}`);
  if (unlocks.length) totals.push(`⚿ ${unlocks.length}`);

  // Scalar embed parts first — their lengths feed the 6000-char total-embed budget below.
  const author = { name: `${CATEGORY_BADGE[quest.category] ?? "◆"} ${L(`PROJECTANIME.Chronicle.cat.${quest.category}`)}` };
  if (isPublicHttp(quest.giver?.img)) author.icon_url = quest.giver.img;
  const title = clamp(quest.title || L("PROJECTANIME.Chronicle.untitled"), CAP.title);
  const footer = { text: clamp([L("PROJECTANIME.Chronicle.completed"), receipt?.party].filter(Boolean).join(" · "), 2048) };
  const description = totals.length ? totals.join(" · ") : "";

  let stashField = null;
  if ((stash.gold ?? 0) > 0 || stash.items?.length) {
    const lines = [];
    if (stash.gold > 0) lines.push(`⦿ ${stash.gold} ${L("PROJECTANIME.Chronicle.reward.gold")}`);
    for (const name of stash.items ?? []) lines.push(`❖ ${name}`);
    stashField = { name: `💰 ${L("PROJECTANIME.Chronicle.discordStash")}`, value: clamp(lines.join("\n"), CAP.field), inline: false };
  }
  const unlocksField = unlocks.length
    ? { name: `⚿ ${L("PROJECTANIME.Chronicle.discordUnlocks")}`, value: clamp(unlocks.join("\n"), CAP.field), inline: false }
    : null;

  // Per-field caps alone don't bound the AGGREGATE — Discord rejects an embed whose combined
  // title/description/author/footer/field text tops 6000 chars. Measure the participant grid
  // against the real remaining budget and demote to the one-line roster when it doesn't fit
  // (the roster layout is bounded well under the cap by its own clamps).
  const fieldLen = (f) => (f ? f.name.length + String(f.value).length : 0);
  const baseLen = title.length + description.length + author.name.length + footer.text.length
    + fieldLen(stashField) + fieldLen(unlocksField);
  const fields = [];
  let perPlayer = participants.length > 0 && participants.length <= MAX_PARTICIPANT_FIELDS;
  if (perPlayer) {
    const grid = participants.map((p) => ({ name: clamp(`◆ ${p.name}`, 256), value: participantValue(p, p.mention), inline: true }));
    if (baseLen + grid.reduce((n, f) => n + fieldLen(f), 0) > 5800) perPlayer = false;
    else fields.push(...grid);
  }
  if (stashField) fields.push(stashField);
  // A demoted/oversized roster collapses to one line — credit survives every layout.
  if (!perPlayer && participants.length) {
    const roster = participants.map((p) => p.mention || `**${p.name}**`).join(" · ");
    fields.push({ name: `👥 ${L("PROJECTANIME.Chronicle.participants")}`, value: clamp(roster, CAP.field), inline: false });
  }
  if (unlocksField) fields.push(unlocksField);

  const embed = { author, title, color: REWARDS_COLOR, fields, footer, timestamp: new Date().toISOString() };
  if (description) embed.description = description;

  const payload = { embeds: [embed] };
  const ids = [...new Set(participants.map((p) => p.discordId).filter(Boolean))];
  if (ids.length) {
    // Message content caps at 2000 chars and allowed_mentions.users at 100 ids — ping as many
    // as fit; the embed still names everyone.
    const pinged = [];
    let len = 0;
    for (const id of ids.slice(0, 100)) {
      const add = id.length + 3 + (pinged.length ? 1 : 0); // "<@id>" plus a separator space
      if (len + add > 2000) break;
      pinged.push(id);
      len += add;
    }
    payload.content = pinged.map((id) => `<@${id}>`).join(" ");
    payload.allowed_mentions = { users: pinged };
  }
  return payload;
}

/** Post a payout receipt to the #rewards webhook. `reason: "no-url"` = webhook not configured. */
export async function postRewardsToDiscord(quest, receipt) {
  const url = String(game.settings.get("project-anime", DISCORD_REWARDS_WEBHOOK_SETTING) || "").trim();
  if (!url) return { ok: false, reason: "no-url" };
  return postToWebhook(url, buildRewardsEmbed(quest, receipt));
}
