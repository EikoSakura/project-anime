/**
 * Project: Anime — Minion Squad helpers (pooled-unit hordes).
 *
 * A MINION-Tier NPC fields as a SQUAD: one token, one initiative, one POOLED HP bar whose max is
 * the per-member HP × the squad size. Damage (single-target or area) just lowers that shared pool,
 * so a squad "spills over" and AoE clears chaff automatically — and the number of LIVING members is
 * read back from the pool: members = ceil(hp.value / per-member-HP). A Basic Attack is the squad's
 * ONE shared action — a single group to-hit whose damage sums every living member (dice.mjs
 * rollSquadStrike), so both durability and output scale with the count. This is the 13th-Age mob /
 * Draw-Steel squad / Genesys minion-group model, and it replaces the Encounter Builder's old per-row
 * "× quantity" multiplier.
 *
 * Squad behaviour engages ONLY at size ≥ 2 (a size-1 minion is an ordinary single creature with its
 * authored HP — fully backward-compatible). Standard / Elite / Solo never squad. Kept dependency-free
 * (only config) so the actor data model, dice, the Monster Creator, and the Party sheet can all share it.
 */
import { PROJECTANIME } from "./config.mjs";

/** True for a Monster-role NPC stamped with the Minion Tier (the only Tier that squads). */
export function isMinionTier(actor) {
  return actor?.type === "npc" && actor?.system?.tier === "minion";
}

/** The configured squad size on an actor (≥ 1; 1 = a lone minion / not yet a squad). */
export function squadSize(actor) {
  return Math.max(1, Math.floor(Number(actor?.system?.squad?.size) || 1));
}

/** True when this actor is an ACTIVE squad — a Minion fielded in numbers (size ≥ 2). */
export function isSquad(actor) {
  return isMinionTier(actor) && squadSize(actor) >= 2;
}

/** The per-member HP pool: the stored `squad.memberHp` once a squad has been formed, else the
 *  actor's (single-member) max HP. Floored at 1 so member math never divides by zero. */
export function memberHp(actor) {
  const stored = Number(actor?.system?.squad?.memberHp) || 0;
  return Math.max(1, stored || Number(actor?.system?.hp?.max) || 1);
}

/** Living members remaining = ceil(current HP / per-member HP), clamped to the squad size. Reads the
 *  value the data model derived when present (squad.members), else recomputes from the pool. */
export function squadMembers(actor) {
  const derived = actor?.system?.squad?.members;
  if (Number.isFinite(derived)) return Math.max(0, derived);
  if (!isSquad(actor)) return (Number(actor?.system?.hp?.value) || 0) > 0 ? 1 : 0;
  const per = memberHp(actor);
  const hp = Math.max(0, Number(actor?.system?.hp?.value) || 0);
  return Math.min(squadSize(actor), Math.ceil(hp / per));
}

/**
 * Resize a Minion's squad (the single source of truth for its pooled HP). Records the per-member HP
 * the first time the unit becomes a squad (from its current max), writes the new size, and refills
 * the pool to full — `hp.max` itself is DERIVED (data model: memberHp × size), so we never write it
 * directly. Clamped to [1, squadMaxSize]. A no-op outside the Minion Tier. GM/owner only.
 */
export async function setSquadSize(actor, size) {
  if (!actor || !isMinionTier(actor)) return;
  const n = Math.clamp(Math.floor(Number(size) || 1), 1, PROJECTANIME.squadMaxSize ?? 12);
  // Per-member pool: keep an already-recorded value; otherwise the present (single-member) max HP.
  const per = Number(actor.system?.squad?.memberHp) || Number(actor.system?.hp?.max) || 1;
  await actor.update({
    "system.squad.size": n,
    "system.squad.memberHp": Math.max(1, per),
    "system.hp.value": Math.max(1, per) * n   // refill the pooled bar; hp.max derives to the same
  });
}
