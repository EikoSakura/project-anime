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
 * the PC buy rate (÷2) let a tanky Tier (Raid ×4) dwarf everything else, so the budget tracked
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

/** The budget multiplier for a difficulty key (defaults to Standard ×1). */
export function difficultyMult(key) {
  return PROJECTANIME.encounterDifficulty[key]?.mult ?? 1;
}

/** The monster budget for a party at a difficulty = Party Power × difficulty multiplier. */
export function encounterBudget(party, difficulty = party?.system?.difficulty) {
  return Math.round(partyPower(party) * difficultyMult(difficulty));
}
