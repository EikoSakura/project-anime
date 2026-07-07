/**
 * Project: Anime — encounter-budget helpers for the Party sheet (V2 Threat model).
 *
 * The encounter budget is measured in THREAT: count the Player Characters, shift by difficulty
 * (Easy party−1 · Standard party · Hard party×1.5 · Climax party×2), then spend it on enemies.
 * Each enemy costs its Type's Threat — Minion ½ · Standard 1 · Bruiser 1½ · Skirmisher 1 ·
 * Support 1 · Elite 2 — a Rival is 2 and a Boss is the party size. Minions may not exceed half
 * the budget. Kept free of any ApplicationV2 import so the Party sheet, its data model, and the
 * Monster Creator can all read it.
 */
import { PROJECTANIME, enemyTypeThreat, bossThreat } from "./config.mjs";
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
 * The encounter budget in THREAT (rules: Encounter Budget): the party size shifted by difficulty.
 * `offset` adds to the size (Easy −1, Standard 0); `mult` multiplies it (Hard ×1.5, Climax ×2).
 * Floored at 0; may be fractional (Hard). A party of 4 faces 3 / 4 / 6 / 8 Threat across
 * Easy / Standard / Hard / Climax.
 */
export function encounterBudget(party, difficulty = party?.system?.difficulty) {
  const size = effectivePlayers(party);
  const d = PROJECTANIME.encounterDifficulty[difficulty] ?? PROJECTANIME.encounterDifficulty.standard;
  const raw = (d.mult != null) ? size * d.mult : size + (d.offset ?? 0);
  return Math.max(0, raw);
}

/**
 * One enemy's THREAT cost — the encounter-budget currency. A non-combat NPC (role "npc") is 0; a
 * Boss is the party size (bossThreat); a Rival is 2 (rivalThreat); otherwise its Type's Threat
 * (an untyped monster reads as 1). `players` is the party size (for the Boss).
 */
export function enemyThreat(actor, players = 1) {
  if (actor?.type !== "npc") return 0;
  if ((actor.system?.role ?? "monster") === "npc") return 0;
  if (actor.system?.boss?.enabled) return bossThreat(players);
  if (actor.system?.rival) return PROJECTANIME.rivalThreat;
  return enemyTypeThreat(actor.system?.npcType);
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
 * Resolve a party's planned encounter into one structured LINE per fielded enemy, each carrying its
 * Threat cost (`threat`) and Type labelling (label + icon + color from PROJECTANIME.enemyTypes). A
 * Boss / Rival badges as such; a Minion is flagged so the gauge can enforce the half-budget cap. A
 * missing UUID becomes a flagged zero-cost placeholder.
 */
export function encounterLines(party) {
  const cfg = PROJECTANIME;
  const players = effectivePlayers(party);
  const L = (k) => game.i18n.localize(k);
  return (party?.system?.encounter ?? []).map((entry) => {
    const a = resolveActor(entry.uuid);
    if (!a) return { id: entry.id, uuid: entry.uuid, missing: true, threat: 0, name: "—", img: "icons/svg/mystery-man.svg", isMinion: false };
    const type = a.system?.npcType || "";
    const typeCfg = type ? cfg.enemyTypes[type] : null;
    const boss = !!a.system?.boss?.enabled;
    const rival = !!a.system?.rival;
    const typeLabel = boss ? L("PROJECTANIME.Boss.badge")
      : rival ? L("PROJECTANIME.Rival.badge")
      : (typeCfg ? L(typeCfg.label) : "");
    return {
      id: entry.id,
      uuid: a.uuid,
      name: a.name,
      img: a.img,
      missing: false,
      type,
      boss,
      rival,
      typeLabel,
      icon: boss ? "fa-solid fa-crown" : rival ? "fa-solid fa-chess-king" : (typeCfg?.icon ?? ""),
      color: boss ? "#9c4f6c" : rival ? "#c08a3e" : (typeCfg?.color ?? "var(--pa-line)"),
      isMinion: type === "minion" && !boss && !rival,
      threat: enemyThreat(a, players)
    };
  });
}

/** The Threat spent specifically on Minions — for the "Minions ≤ half the budget" cap. */
export function minionSpent(party) {
  return encounterLines(party).filter((l) => l.isMinion).reduce((sum, l) => sum + (l.threat || 0), 0);
}
