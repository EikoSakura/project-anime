/**
 * Project: Anime — encounter-budget helpers for the Party sheet.
 *
 * The encounter budget is measured in PARTY-EQUIVALENTS: how many Player Characters' worth of threat
 * a fight fields. Each NPC Tier is worth a fixed number of PCs (the Fabula-Ultima rank model) —
 * Minion 0.25 (four = one PC), Standard 1, Elite 2, Solo = the whole party — and the budget for a
 * fight is the player count shifted by the difficulty offset (Medium = on level). That single number
 * folds power AND action economy together (a Solo is worth the party and acts 2–3× per round to keep
 * up). The per-NPC ★ star rating is the orthogonal POWER/level dial — it sizes the statblock, not the
 * budget: build an NPC on-level for its ★ and its flat PC-worth holds. Kept free of any ApplicationV2
 * import so the Party sheet, its data model, and anything else can read it.
 */
import { PROJECTANIME } from "./config.mjs";
import { skillPointLedger } from "./skill-points.mjs";
import { partyMembers } from "./party-folder.mjs";
import { isMinionTier, squadSize, squadMembers } from "./squad.mjs";

/** SP cost of one Attribute Step-Up, by the die size you're raising FROM (rules p.13). */
const STEP_COST = { 4: 1, 6: 2, 8: 3, 10: 4 };

/** How many of a creature's cheapest Attribute Step-Ups are treated as "free frame" and not charged
 *  by the build-strength rating below. 0 = every Step-Up counts. */
const FREE_STEP_UPS = 0;

/** HP/Energy over the ⟪×2⟫ baseline counts only LIGHTLY toward the build-strength rating (HP per 1 SP). */
const VITAL_DIVISOR = 6;

/**
 * Rate an actor's BUILD STRENGTH in Skill Points — attribute raises (at PC Step-Up prices) + each
 * Skill's Rank + HP/Energy over the ⟪Might⟫×2 / ⟪Spirit⟫×2 baseline (lightly weighted). This is NOT
 * the encounter budget any more (that is Party-Equivalents); it survives only as the "Power" read on
 * the Party roster tab so the GM can see how built-up each Character is. Kept on the PC SP scale.
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
  // HP / Energy over the attribute×2 baseline — lightly weighted.
  const might = sys.attributes?.might?.base ?? 4;
  const spirit = sys.attributes?.spirit?.base ?? 4;
  cost += Math.max(0, Math.round(((sys.hp?.max ?? 0) - might * 2) / VITAL_DIVISOR));
  cost += Math.max(0, Math.round(((sys.energy?.max ?? 0) - spirit * 2) / VITAL_DIVISOR));
  // Skills (each costs its Rank in SP) — the build's abilities.
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
 *  (attributes + skills + light HP via monsterSPCost) + their UNSPENT Skill Points. Display only —
 *  the encounter budget is Party-Equivalents, not this. */
export function memberPower(actor) {
  if (actor?.type !== "character") return 0;
  return monsterSPCost(actor) + (skillPointLedger(actor).spInfo.available ?? 0);
}

/** A party's total build-strength = the sum of its Character members' power (its folder's Characters). */
export function partyPower(party) {
  let total = 0;
  for (const m of partyMembers(party)) total += memberPower(m);
  return total;
}

/** The effective player count for the budget: the typed count in manual-estimate mode, else the live
 *  roster size (never below 1). */
export function effectivePlayers(party) {
  const sys = party?.system ?? {};
  return Math.max(1, sys.encounterManual ? (sys.encounterPlayers ?? 1) : (partyMembers(party).length || 1));
}

/** Count of player-character combatants in a live Combat (min 1) — the action allotment a Boss/Solo
 *  matches each round (ENEMY-DESIGN Phase 0). Mirrors effectivePlayers but reads the ENCOUNTER, not the
 *  party roster: an allied NPC token the GM runs has no player owner, so it never inflates a boss's
 *  action count — only real PCs do. (Collection#filter returns an Array, hence `.length`.) */
export function combatPlayerCount(combat) {
  if (!combat) return 1;
  const pcs = combat.combatants.filter((c) => c.actor?.type === "character" && c.actor.hasPlayerOwner);
  return Math.max(1, pcs.length);
}

/** The Party-Equivalent offset for a difficulty key (defaults to Medium / on-level = 0). */
export function difficultyOffset(key) {
  return PROJECTANIME.encounterDifficulty[key]?.offset ?? 0;
}

/** The encounter budget in PARTY-EQUIVALENTS = player count + the difficulty offset (floored at 0). A
 *  party of 4 faces 2 / 4 / 6 / 8 equivalents across Easy / Medium / Hard / Extreme. */
export function encounterBudget(party, difficulty = party?.system?.difficulty) {
  return Math.max(0, effectivePlayers(party) + difficultyOffset(difficulty));
}

/**
 * One NPC's worth in PARTY-EQUIVALENTS — the encounter-budget currency. A non-combat NPC (role "npc")
 * is 0; a Solo is worth the whole party (`players`, a balanced 1-v-party boss); a Minion is 0.25 PER
 * MEMBER (four = one PC), so a squad scales linearly with its size; Standard 1, Elite 2. An untiered
 * Monster reads as Standard (1). The ★ power dial does NOT move this — build on-level and it holds.
 */
export function tierPcWorth(actor, players = 1) {
  if (actor?.type !== "npc") return 0;
  if ((actor.system?.role ?? "monster") === "npc") return 0;
  const tierKey = actor.system?.tier || "standard";
  if (tierKey === "solo") return Math.max(1, Math.round(Number(players) || 1));
  if (tierKey === "minion") return (PROJECTANIME.monsterTiers.minion.pcWorth ?? 0.25) * squadSize(actor);
  const worth = PROJECTANIME.monsterTiers[tierKey]?.pcWorth;
  return Number.isFinite(worth) ? worth : 1;
}

/**
 * Resolve a party's planned encounter into one structured LINE per fielded threat. Each line carries
 * its PARTY-EQUIVALENT worth (`equiv`) — what it spends from the budget:
 *   • a MINION line is a SQUAD: its member count read from the NPC (system.squad.size), worth 0.25
 *     each (four members = one PC), so equiv = 0.25 × size;
 *   • a SOLO is worth the whole party (the player count);
 *   • Standard 1, Elite 2; an untiered Monster reads as Standard.
 * A missing UUID becomes a flagged zero-worth placeholder.
 */
export function encounterLines(party) {
  const cfg = PROJECTANIME;
  const players = effectivePlayers(party);
  return (party?.system?.encounter ?? []).map((entry) => {
    const a = resolveActor(entry.uuid);
    if (!a) return { id: entry.id, uuid: entry.uuid, missing: true, equiv: 0, name: "—", img: "icons/svg/mystery-man.svg" };
    const tierKey = a.system?.tier || "";
    const tier = tierKey ? cfg.monsterTiers[tierKey] : null;
    const minion = isMinionTier(a);
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
      equiv: tierPcWorth(a, players)   // a Minion's worth already folds in its squad size
    };
  });
}

/** The total Party-Equivalent threat the planned encounter spends (sum of every line's worth). */
export function encounterSpent(party) {
  return encounterLines(party).reduce((sum, l) => sum + (l.equiv || 0), 0);
}
