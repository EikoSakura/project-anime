/**
 * Project: Anime — encounter-budget helpers for the Party sheet.
 *
 * Prices a monster (NPC) in Skill Points on the SAME scale the system uses to estimate a
 * Player Character's spent SP, sums a party's total SP, and derives the monster budget for a
 * fight (Budget = Party SP × difficulty). Kept free of any ApplicationV2 import so the Party
 * sheet, its data model, and anything else can read it.
 */
import { PROJECTANIME } from "./config.mjs";
import { skillPointLedger } from "./skill-points.mjs";
import { partyMembers } from "./party-folder.mjs";

/** SP cost of one Attribute Step-Up, by the die size you're raising FROM (rules p.13). */
const STEP_COST = { 4: 1, 6: 2, 8: 3, 10: 4 };

/** How many of a monster's cheapest Attribute Step-Ups are treated as "free frame" and not
 *  charged. 0 = every Step-Up counts (so attribute investment always shows in the cost, at
 *  every Tier — Minions/Elites included). Raise this to hand monsters a free allowance like a
 *  starting PC's creation Step-Ups (5), at the cost of making low-Tier attributes read as free. */
const FREE_STEP_UPS = 0;

/**
 * HP/Energy over the ⟪×2⟫ baseline counts only LIGHTLY toward a monster's cost (HP points per
 * 1 SP). A Tier's HP multiplier is free "frame" durability, not bought power — pricing it at
 * the PC buy rate (÷2) let a tanky Tier (Solo ×3) dwarf everything else, so the budget tracked
 * HP bloat instead of threat. At ÷6 a monster's price is driven by what it can DO (its
 * attributes + skills); raise this to count HP even less, or set it very high to ignore HP.
 */
const VITAL_DIVISOR = 6;

/**
 * Price an NPC ("monster") in Skill Points by its ACTIVE threat — what it can do:
 *   • Attribute raises beyond the free creation Step-Ups, at PC Step-Up prices (its offense:
 *     bigger dice → more Accuracy / Damage).
 *   • Each Skill's SP cost (= its Rank) — its abilities.
 *   • HP / Energy over the ⟪Might⟫×2 / ⟪Spirit⟫×2 baseline, counted only LIGHTLY (see
 *     VITAL_DIVISOR) so a Tier's free durability nudges the cost without dominating it.
 * Flat Evasion/Defense isn't priced (PCs can't buy those either). Kept on the same SP scale
 * the party is measured on, so the encounter budget compares like with like.
 */
export function monsterSPCost(actor) {
  if (!actor) return 0;
  const sys = actor.system ?? {};
  // Attributes — every Step-Up above d4, then drop the (cheapest) free creation steps.
  const steps = [];
  for (const key of PROJECTANIME.attributeKeys) {
    const base = sys.attributes?.[key]?.base ?? 4;
    for (let v = 4; v < base; v += 2) steps.push(STEP_COST[v] ?? 0);
  }
  steps.sort((a, b) => a - b);
  let cost = steps.slice(FREE_STEP_UPS).reduce((sum, c) => sum + c, 0);
  // HP / Energy over the attribute×2 baseline — lightly weighted (tier durability is "free").
  const might = sys.attributes?.might?.base ?? 4;
  const spirit = sys.attributes?.spirit?.base ?? 4;
  cost += Math.max(0, Math.round(((sys.hp?.max ?? 0) - might * 2) / VITAL_DIVISOR));
  cost += Math.max(0, Math.round(((sys.energy?.max ?? 0) - spirit * 2) / VITAL_DIVISOR));
  // Skills (each costs its Rank in SP) — the monster's abilities.
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

/** A single Character member's power, measured the SAME way a monster is costed so the budget
 *  is apples-to-apples: their build cost (attributes + skills + light HP via monsterSPCost) +
 *  their UNSPENT Skill Points (growth they can still bank). Using monsterSPCost for both sides
 *  is what makes attributes count equally for the party and for monsters; unspent SP is added
 *  on top (it's the party's real, un-built potential) and is NOT double-counted because
 *  monsterSPCost reads only built skills, not the unspent pool. */
export function memberPower(actor) {
  if (actor?.type !== "character") return 0;
  return monsterSPCost(actor) + (skillPointLedger(actor).spInfo.available ?? 0);
}

/** A party's total power = the sum of its Character members' power (its folder's Characters). */
export function partyPower(party) {
  let total = 0;
  for (const m of partyMembers(party)) total += memberPower(m);
  return total;
}

/**
 * A party's EFFECTIVE planning power — what the budget is actually built from. In manual-estimate
 * mode (plan a fight before any character exists) that's the typed party total Skill Points;
 * otherwise it's the live roster's summed power. One chokepoint so `encounterBudget` and the sheet
 * agree on which side of the toggle is in force.
 */
export function effectivePartyPower(party) {
  const sys = party?.system ?? {};
  if (sys.encounterManual) return Math.max(0, Math.round(sys.encounterSP ?? 0));
  return partyPower(party);
}

/** The budget multiplier for a difficulty key (defaults to Standard ×1). */
export function difficultyMult(key) {
  return PROJECTANIME.encounterDifficulty[key]?.mult ?? 1;
}

/** The monster budget for a party at a difficulty = effective Party Power × difficulty multiplier
 *  (effective = typed SP in manual mode, else the roster's summed power). */
export function encounterBudget(party, difficulty = party?.system?.difficulty) {
  return Math.round(effectivePartyPower(party) * difficultyMult(difficulty));
}

/**
 * The action-economy read for a planned fight — the companion to the SP budget. A raw SP sum
 * can't see that many small monsters out-act one brute, so this compares the tally's monster
 * head-count to the player count and aims for roughly one monster per player (a little more is
 * fine). Players = the typed count in manual mode, else the live roster size. Pure and
 * tier-agnostic; `tone` drives the colour/wording, `monsters` is the summed quantity.
 * @returns {{players:number, monsters:number, low:number, high:number, tone:"empty"|"light"|"ok"|"heavy"}}
 */
export function actionEconomy(party) {
  const sys = party?.system ?? {};
  const players = Math.max(1, sys.encounterManual
    ? (sys.encounterPlayers ?? 1)
    : (partyMembers(party).length || 1));
  let monsters = 0;
  for (const e of sys.encounter ?? []) monsters += Math.max(1, e.qty ?? 1);
  const low = Math.max(1, Math.floor(players * 0.5));
  const high = Math.ceil(players * 1.5);
  let tone = "ok";
  if (monsters === 0) tone = "empty";
  else if (monsters > high) tone = "heavy"; // outnumber the party → they get far more actions
  else if (monsters < low) tone = "light";  // few bodies → leans on Elite/Solo threats
  return { players, monsters, low, high, tone };
}
