/**
 * Project: Anime — encounter-budget helpers for the Party sheet (v0.03 Threat model).
 *
 * The encounter budget is measured in THREAT: how much fight a party can take. The budget equals the
 * number of PCs, shifted by difficulty (Easy party−1 · Standard party · Hard party+1.5 · Climax party×2).
 * Each enemy costs its Role's Threat — Grunt 1 · Brute 1.5 · Skirmisher 1 · Caster 1 · Support 1 · Swarm
 * ½ · Elite 2 — a Rival is 3 (Elite + 1) and a Boss is the party size (+2 per Bar beyond the formula).
 * Swarms may not exceed half the budget. This retires the old PC-equivalent gauge (Minion/Standard/
 * Elite/Solo worth). Kept free of any ApplicationV2 import so the Party sheet, its data model, and the
 * Monster Creator can all read it.
 */
import { PROJECTANIME, enemyRoleThreat, bossThreat } from "./config.mjs";
import { skillPointLedger } from "./skill-points.mjs";
import { partyMembers, partyActors } from "./party-folder.mjs";

/** SP cost of one Attribute Step-Up, by the die size you're raising FROM (rules p.13). */
const STEP_COST = { 4: 1, 6: 2, 8: 3, 10: 4 };

/** HP/Energy over the ⟪×2⟫ baseline counts only LIGHTLY toward the build-strength rating (HP per 1 SP). */
const VITAL_DIVISOR = 6;

/**
 * Rate a Character's BUILD STRENGTH in Skill Points — attribute raises (at PC Step-Up prices) + each
 * Skill's SP cost + HP/Energy over the 6+⟪Might⟫×2 / 6+⟪Spirit⟫×2 baseline (lightly weighted). This is the
 * "Power" read on the Party roster tab so the GM can see how built-up each Character is (and match a
 * Rival's SP total to the party average — rules "Rivals"). NOT the encounter budget (that is Threat).
 */
export function monsterSPCost(actor) {
  if (!actor) return 0;
  const sys = actor.system ?? {};
  const steps = [];
  for (const key of PROJECTANIME.attributeKeys) {
    const base = sys.attributes?.[key]?.base ?? 4;
    for (let v = 4; v < base; v += 2) steps.push(STEP_COST[v] ?? 0);
  }
  steps.sort((a, b) => a - b);
  let cost = steps.reduce((sum, c) => sum + c, 0);
  const might = sys.attributes?.might?.base ?? 4;
  const spirit = sys.attributes?.spirit?.base ?? 4;
  cost += Math.max(0, Math.round(((sys.hp?.max ?? 0) - (6 + might * 2)) / VITAL_DIVISOR));
  cost += Math.max(0, Math.round(((sys.energy?.max ?? 0) - (6 + spirit * 2)) / VITAL_DIVISOR));
  for (const item of actor.items ?? []) {
    if (item.type === "skill") cost += Number(item.system?.spCost ?? item.system?.rank ?? 0) || 0;
  }
  return Math.max(0, Math.round(cost));
}

/** Resolve a stored actor reference (UUID) synchronously; null if it's gone. */
export function resolveActor(ref) {
  if (!ref) return null;
  try { return fromUuidSync(ref); } catch (_e) { return null; }
}

/** A single Character member's build-strength rating for the roster "Power" pill: their SP build cost
 *  + their UNSPENT Skill Points. Display only — the encounter budget is Threat, not this. */
export function memberPower(actor) {
  if (actor?.type !== "character") return 0;
  return monsterSPCost(actor) + (skillPointLedger(actor).spInfo.available ?? 0);
}

/** A party's total build-strength = the sum of its Character members' power. */
export function partyPower(party) {
  let total = 0;
  for (const m of partyMembers(party)) total += memberPower(m);
  return total;
}

/** The average build-strength (SP) across a party's Characters — the anchor a Rival's SP total should
 *  sit within 2 of (rules "Rivals"). 0 when the party is empty. */
export function partyAverageSP(party) {
  const members = partyMembers(party);
  if (!members.length) return 0;
  return Math.round(members.reduce((s, m) => s + monsterSPCost(m), 0) / members.length);
}

/** The effective player count for the budget: the typed count in manual-estimate mode, else the live
 *  roster size (never below 1). */
export function effectivePlayers(party) {
  const sys = party?.system ?? {};
  return Math.max(1, sys.encounterManual ? (sys.encounterPlayers ?? 1) : (partyMembers(party).length || 1));
}

/** Count of player-character combatants in a live Combat (min 1). */
export function combatPlayerCount(combat) {
  if (!combat) return 1;
  const pcs = combat.combatants.filter((c) => c.actor?.type === "character" && c.actor.hasPlayerOwner);
  return Math.max(1, pcs.length);
}

/**
 * The encounter budget in THREAT (v0.03): the party size shifted by difficulty. `offset` adds to the
 * size (Easy −1, Standard 0, Hard +1.5); `mult` multiplies it (Climax ×2). Floored at 0; may be
 * fractional (Hard). A party of 4 faces 3 / 4 / 5.5 / 8 Threat across Easy / Standard / Hard / Climax.
 */
export function encounterBudget(party, difficulty = party?.system?.difficulty) {
  const size = effectivePlayers(party);
  const d = PROJECTANIME.encounterDifficulty[difficulty] ?? PROJECTANIME.encounterDifficulty.standard;
  const raw = (d.mult != null) ? size * d.mult : size + (d.offset ?? 0);
  return Math.max(0, raw);
}

/**
 * One enemy's THREAT cost — the encounter-budget currency. A non-combat NPC (role "npc") is 0; a Boss
 * is the party size plus 2 per Bar beyond the formula (bossThreat); a Rival is 3 (Elite + 1); otherwise
 * its Role's Threat (an untiered Monster reads as 1). `players` is the party size (for the Boss).
 */
export function enemyThreat(actor, players = 1) {
  if (actor?.type !== "npc") return 0;
  if ((actor.system?.role ?? "monster") === "npc") return 0;
  if (actor.system?.boss?.enabled) return bossThreat(players, actor.system.boss.bars);
  if (actor.system?.rival) return 3;
  const role = actor.system?.enemyRole;
  return role ? enemyRoleThreat(role) : 1;
}

/**
 * Resolve a party's planned encounter into one structured LINE per fielded threat, each carrying its
 * Threat cost (`threat`) and Role/Tier labelling. A Boss / Rival badges as such; a Swarm is flagged so
 * the gauge can enforce the half-budget cap. A missing UUID becomes a flagged zero-cost placeholder.
 */
export function encounterLines(party) {
  const cfg = PROJECTANIME;
  const players = effectivePlayers(party);
  const L = (k) => game.i18n.localize(k);
  return (party?.system?.encounter ?? []).map((entry) => {
    const a = resolveActor(entry.uuid);
    if (!a) return { id: entry.id, uuid: entry.uuid, missing: true, threat: 0, name: "—", img: "icons/svg/mystery-man.svg", isSwarm: false };
    const role = a.system?.enemyRole || "";
    const roleCfg = role ? cfg.enemyRoles[role] : null;
    const boss = !!a.system?.boss?.enabled;
    const rival = !!a.system?.rival;
    const tier = Number(a.system?.enemyTier) || 0;
    const roleLabel = boss ? L("PROJECTANIME.Boss.badge")
      : rival ? L("PROJECTANIME.Rival.badge")
      : (roleCfg ? L(roleCfg.label) : "");
    return {
      id: entry.id,
      uuid: a.uuid,
      name: a.name,
      img: a.img,
      missing: false,
      role,
      boss,
      rival,
      roleLabel,
      tierNumeral: cfg.enemyTierNumerals[tier] ?? "",
      color: boss ? "#9c4f6c" : rival ? "#c08a3e" : (roleCfg?.color ?? "var(--pa-line)"),
      isSwarm: role === "swarm",
      threat: enemyThreat(a, players)
    };
  });
}

/** The total Threat the planned encounter spends (sum of every line's cost). */
export function encounterSpent(party) {
  return encounterLines(party).reduce((sum, l) => sum + (l.threat || 0), 0);
}

/** The Threat spent specifically on Swarms — for the "Swarms ≤ half the budget" cap. */
export function swarmSpent(party) {
  return encounterLines(party).filter((l) => l.isSwarm).reduce((sum, l) => sum + (l.threat || 0), 0);
}

/**
 * The party's Four-Rails reference stats — the lowest DEF, the lowest attacker (best of ATK / MATK per
 * PC, then the party minimum), and the slowest AS, across every Character in every Party folder. null
 * when there are no Character sheets (the Monster Creator then falls back to a Tempered tier row).
 */
export function partyRailStats() {
  const seen = new Set();
  const pcs = [];
  for (const p of partyActors()) {
    for (const m of partyMembers(p)) {
      if (m?.type === "character" && !seen.has(m.id)) { seen.add(m.id); pcs.push(m); }
    }
  }
  if (!pcs.length) return null;
  const atkOf = (a) => Math.max(Number(a.system?.atk?.value) || 0, Number(a.system?.matk?.value) || 0);
  return {
    size: pcs.length,
    lowestDef: Math.min(...pcs.map((a) => Number(a.system?.defense?.value) || 0)),
    lowestAtk: Math.min(...pcs.map(atkOf)),
    slowestAs: Math.min(...pcs.map((a) => Number(a.system?.as?.value) || 0))
  };
}
