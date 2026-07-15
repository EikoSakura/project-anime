/**
 * Project: Anime — encounter-budget helpers for the Party sheet (Tier × EXP Threat model).
 *
 * The encounter budget is measured in THREAT: count the Player Characters, multiply by the
 * difficulty (Easy ½ · Standard 1 · Hard ×2 · Climax ×3), then spend it on enemies. Each enemy
 * costs its Tier's Threat — Minion 1 · Standard 2 · Elite 3 · Champion 4 — while a Villain
 * costs the FULL budget and its Retinue (every other enemy fielded beside it) costs nothing.
 * Minions may not exceed half the budget. Kept free of any ApplicationV2 import so the Party
 * sheet, its data model, and the Monster Creator can all read it.
 */
import { PROJECTANIME, enemyTierThreat, villainThreat } from "./config.mjs";
import { partyMembers } from "./party-folder.mjs";

/** Resolve a stored actor reference (UUID) synchronously; null if it's gone. */
export function resolveActor(ref) {
  if (!ref) return null;
  try { return fromUuidSync(ref); } catch (_e) { return null; }
}

/** The effective player count for the budget: the typed count in manual-estimate mode, else the live
 *  roster size (never below 1). */
export function effectivePlayers(party) {
  const sys = party?.system ?? {};
  return Math.max(1, sys.encounterManual ? (sys.encounterPlayers ?? 1) : (partyMembers(party).length || 1));
}

/**
 * The encounter budget in THREAT (rules: Encounter Budget → Adjust to Difficulty): the party
 * size × the difficulty multiplier. Floored at 0; may be fractional (Easy with an odd party).
 * A party of 4 faces 2 / 4 / 8 / 12 Threat across Easy / Standard / Hard / Climax.
 */
export function encounterBudget(party, difficulty = party?.system?.difficulty) {
  const size = effectivePlayers(party);
  const d = PROJECTANIME.encounterDifficulty[difficulty] ?? PROJECTANIME.encounterDifficulty.standard;
  return Math.max(0, size * (d.mult ?? 1));
}

/**
 * One enemy's THREAT cost — the encounter-budget currency. A Companion is 0; a Villain costs
 * the FULL budget (pass the live `budget` when one is known, else the Standard fallback =
 * `players`); otherwise its Tier's Threat (an untyped monster reads as 1).
 */
export function enemyThreat(actor, players = 1, budget = null) {
  if (actor?.type !== "npc") return 0;
  const tier = actor.system?.npcType || "";
  if (tier === "companion") return 0;
  if (tier === "villain") return villainThreat(players, budget);
  const t = enemyTierThreat(tier);
  return t == null ? villainThreat(players, budget) : t;
}

/** Format a Threat value with the printed half-fractions: 0.5 → "½", 1.5 → "1½", 2 → "2". */
export function formatThreat(n) {
  const v = Number(n) || 0;
  const whole = Math.floor(v);
  const frac = v - whole;
  if (Math.abs(frac - 0.5) < 0.001) return whole ? `${whole}½` : "½";
  return parseFloat(v.toFixed(2)).toString();
}

/**
 * Resolve a party's planned encounter into one structured LINE per fielded enemy, each carrying
 * its Threat cost (`threat`) and Tier labelling (label + icon + color from
 * PROJECTANIME.enemyTiers). When a Villain is fielded it costs the full budget and every OTHER
 * enemy becomes its free Retinue (`retinue: true`, threat 0). A Minion is flagged so the gauge
 * can enforce the half-budget cap. A missing UUID becomes a flagged zero-cost placeholder.
 */
export function encounterLines(party) {
  const cfg = PROJECTANIME;
  const players = effectivePlayers(party);
  const budget = encounterBudget(party);
  const L = (k) => game.i18n.localize(k);
  const lines = (party?.system?.encounter ?? []).map((entry) => {
    const a = resolveActor(entry.uuid);
    if (!a) return { id: entry.id, uuid: entry.uuid, missing: true, threat: 0, name: "—", img: "icons/svg/mystery-man.svg", isMinion: false, villain: false, retinue: false };
    const tier = a.system?.npcType || "";
    const tierCfg = tier ? cfg.enemyTiers[tier] : null;
    const villain = tier === "villain";
    return {
      id: entry.id,
      uuid: a.uuid,
      name: a.name,
      img: a.img,
      missing: false,
      tier,
      villain,
      retinue: false,
      tierLabel: tierCfg ? L(tierCfg.label) : "",
      icon: tierCfg?.icon ?? "",
      color: tierCfg?.color ?? "var(--pa-line)",
      isMinion: tier === "minion",
      threat: enemyThreat(a, players, budget)
    };
  });
  // A Villain's Retinue does not cost additional Threat (rules: Encounter Budget).
  if (lines.some((l) => l.villain)) {
    for (const l of lines) {
      if (!l.villain && !l.missing) { l.retinue = true; l.threat = 0; l.isMinion = false; }
    }
  }
  return lines;
}

/** The Threat spent specifically on Minions — for the "Minions ≤ half the budget" cap. */
export function minionSpent(party) {
  return encounterLines(party).filter((l) => l.isMinion).reduce((sum, l) => sum + (l.threat || 0), 0);
}
