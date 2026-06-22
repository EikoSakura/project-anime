/**
 * Project: Anime — encounter-budget helpers for the Party sheet.
 *
 * Prices a monster (NPC) in Skill Points on the SAME scale the system uses to estimate a
 * Player Character's spent SP, sums a party's total SP, and derives the monster budget for a
 * fight (Budget = Party SP × difficulty). Kept free of any ApplicationV2 import so the Party
 * sheet, its data model, and anything else can read it.
 */
import { PROJECTANIME, starPowerValue } from "./config.mjs";
import { skillPointLedger } from "./skill-points.mjs";
import { partyMembers } from "./party-folder.mjs";
import { isMinionTier, isSquad, memberHp, squadSize, squadMembers, squadCost, tierBodies } from "./squad.mjs";

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
  // HP / Energy over the attribute×2 baseline — lightly weighted (tier durability is "free"). For a
  // Minion SQUAD, hp.max is the POOLED total (member × size); price ONE member here so squadCost can
  // apply the size multiplier once (otherwise size would be counted twice).
  const might = sys.attributes?.might?.base ?? 4;
  const spirit = sys.attributes?.spirit?.base ?? 4;
  const hpMax = isSquad(actor) ? memberHp(actor) : (sys.hp?.max ?? 0);
  cost += Math.max(0, Math.round((hpMax - might * 2) / VITAL_DIVISOR));
  cost += Math.max(0, Math.round(((sys.energy?.max ?? 0) - spirit * 2) / VITAL_DIVISOR));
  // Skills (each costs its Rank in SP) — the monster's abilities.
  for (const item of actor.items ?? []) {
    if (item.type === "skill") cost += Number(item.system?.spCost ?? item.system?.rank ?? 0) || 0;
  }
  return Math.max(0, Math.round(cost));
}

/**
 * Price a STAR-RATED monster for the encounter tally. A star-built NPC is costed by what it was
 * GRANTED — its star power × the Tier's spFactor (the SP budget the Monster Creator built it on),
 * plus the Tier's flat Eva/Def surcharge (`evaDefCost`, what a boss's untouchable +1/+1 or +2/+2 is
 * worth, since PCs can't buy it and monsterSPCost prices it at zero). We do NOT re-derive a star
 * NPC's cost from its sheet: the geometric star multiplier (up to ×22) would let monsterSPCost's
 * light HP weighting (÷6) and zero-priced Eva/Def under-count a beefy boss, so an under-built ★5
 * Solo could be smuggled into a fight cheap. Pricing from the grant keeps the creator and the tally
 * in agreement — a Solo costs its full threat whether or not the GM spent every point. UNRATED NPCs
 * (stars 0, or no Tier) keep the exact legacy monsterSPCost path → existing fights are unchanged.
 */
export function monsterStarCost(actor) {
  const sys = actor?.system ?? {};
  const power = starPowerValue(sys.stars);
  const tier = PROJECTANIME.monsterTiers?.[sys.tier];
  if (!power || !tier) return monsterSPCost(actor);
  const grant = Math.round(power * (tier.spFactor ?? 0));
  return Math.max(0, grant + (tier.evaDefCost ?? 0));
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

/** The effective player count for action-economy planning: the typed count in manual-estimate mode,
 *  else the live roster size (never below 1). */
export function effectivePlayers(party) {
  const sys = party?.system ?? {};
  return Math.max(1, sys.encounterManual ? (sys.encounterPlayers ?? 1) : (partyMembers(party).length || 1));
}

/**
 * Resolve a party's planned encounter into one structured LINE per fielded threat — the single
 * source the Party sheet renders and the budget sums. Each line carries its Skill-Point cost AND its
 * action-economy "bodies" (turns it occupies per round):
 *   • a MINION line is a SQUAD — its member count read from the NPC (system.squad.size), its cost the
 *     single minion's price scaled sub-linearly by size (squadCost), and it is ONE body (the squad
 *     concentrates into one initiative — that's the whole point, vs the old quantity that added a turn
 *     per head and wrecked action economy);
 *   • a SOLO occupies 2 bodies (3 at ★4+) — it literally acts that many times per round;
 *   • everyone else is one body at its flat monsterStarCost.
 * A missing UUID becomes a flagged zero-cost placeholder.
 */
export function encounterLines(party) {
  const cfg = PROJECTANIME;
  return (party?.system?.encounter ?? []).map((entry) => {
    const a = resolveActor(entry.uuid);
    if (!a) return { id: entry.id, uuid: entry.uuid, missing: true, cost: 0, bodies: 0, name: "—", img: "icons/svg/mystery-man.svg" };
    const tierKey = a.system?.tier || "";
    const tier = tierKey ? cfg.monsterTiers[tierKey] : null;
    const minion = isMinionTier(a);
    const each = monsterStarCost(a);
    const size = minion ? squadSize(a) : 1;
    return {
      id: entry.id,
      uuid: a.uuid,
      name: a.name,
      img: a.img,
      missing: false,
      tierKey,
      tierLabel: tier ? game.i18n.localize(tier.label) : "",
      tierColor: tier?.color ?? "var(--pa-line)",
      stars: Number(a.system?.stars) || 0,
      isMinion: minion,
      size,
      members: minion ? squadMembers(a) : 1,
      maxMembers: minion ? size : 1,
      each,
      cost: minion ? squadCost(each, size) : each,
      bodies: minion ? 1 : tierBodies(a)
    };
  });
}

/** The total Skill-Point threat the planned encounter spends (sum of every line's cost). */
export function encounterSpent(party) {
  return encounterLines(party).reduce((sum, l) => sum + (l.cost || 0), 0);
}

/**
 * The action-economy read for a planned fight — the companion gauge to the SP budget (a raw SP sum
 * can't see that turns, not points, decide who out-acts whom). Counts BODIES (turns/round) against the
 * player count and aims for roughly one body per player. A Minion squad is ONE body however many its
 * members; a Solo is 2–3. `tone` drives colour/wording.
 * @returns {{players:number, bodies:number, low:number, high:number, tone:"empty"|"light"|"ok"|"heavy"}}
 */
export function actionEconomy(party) {
  const players = effectivePlayers(party);
  let bodies = 0;
  for (const line of encounterLines(party)) bodies += (line.bodies || 0);
  const low = Math.max(1, Math.floor(players * 0.5));
  const high = Math.ceil(players * 1.5);
  let tone = "ok";
  if (bodies === 0) tone = "empty";
  else if (bodies > high) tone = "heavy"; // more turns than the party → they out-act it
  else if (bodies < low) tone = "light";  // few turns → leans on Elite/Solo threats
  return { players, bodies, low, high, tone };
}
