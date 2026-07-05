/**
 * Project: Anime — automated PARTY BOND benefits (v0.03).
 *
 * A Party Bond (PC↔PC) grants cumulative, system-defined benefits as it deepens (config
 * PROJECTANIME.partyBondBenefits): Side by Side (+1 to hit) at rank C, Back to Back (+1 DEF / +1 RES)
 * at rank A, and Dual Strike at rank S. The first two carry Effect-Builder `rules`, so this module
 * projects each unlocked one onto the character as their OWN flagged ActiveEffect — keyed
 * `bondKey = "<bondId>:<benefitKey>"`, refreshed by content signature, and PURGED when the bond drops
 * below that benefit's rank. They are marked TOGGLEABLE (off by default): the boon only applies while
 * within 1 tile of the partner, so the player flips it on when adjacent (effects.mjs toggle gate).
 * Dual Strike is `tracked` (a 1/Conflict reaction surfaced in the Bonds book), not an effect.
 *
 * Follower Bonds grant qualitative benefits (preset text, shaped with the GM) and project nothing.
 *
 * Reconciled GM-side only (single active GM) so a player can't self-grant by editing their own bond;
 * driven by the actor update/create hooks + the ready pass (project-anime.mjs), exactly like the
 * faction/trait reconcilers. Supersedes the pre-v0.3.4 authored per-rank ability projection + grants.
 */
import { PROJECTANIME } from "./config.mjs";
import { normalizeRule } from "./effects.mjs";

const FLAG_SCOPE = "project-anime";

/** Build the WANT record for one unlocked Party benefit that carries effect rules, or null when it
 *  carries none (e.g. the tracked Dual Strike). Keyed `<bondId>:<benefitKey>` so each reconciles alone. */
function benefitWant(bond, benefit) {
  const rules = (benefit.rules ?? []).map(normalizeRule).filter(Boolean);
  if (!rules.length) return null;
  const key = `${bond.id}:${benefit.key}`;
  const nm = game.i18n.localize(`PROJECTANIME.Bond.benefit.${benefit.key}.name`);
  const im = (bond.img || "").trim() || "icons/svg/aura.svg";
  const toggle = benefit.toggle !== false;   // party positional boons default to a player toggle
  const sig = JSON.stringify({ key, nm, im, rules, toggle });
  return { key, name: nm, img: im, rules, toggle, sig };
}

/** The ActiveEffect data for a projected Party benefit (a direct, non-transferring effect). Carries
 *  the `toggle` flag so it's off until the player flips it on (effects.mjs gate) — the "within 1 tile"
 *  condition the player asserts by toggling. */
function bondEffectData(w) {
  return {
    name: w.name,
    img: w.img,
    disabled: false,   // a toggle effect stays live (enabled) so it's available to be flipped on
    transfer: false,
    flags: { [FLAG_SCOPE]: { bondKey: w.key, bondSig: w.sig, toggle: !!w.toggle, rules: { version: 1, list: w.rules } } }
  };
}

/** True if an ActiveEffect is a projected Party-benefit effect (so we can find / refresh / purge it). */
export function isBondEffect(effect) {
  return !!effect?.flags?.[FLAG_SCOPE]?.bondKey;
}

/**
 * Reconcile one character's Party-benefit effects (GM only, single active GM to avoid races):
 * project/refresh/purge the toggleable AE for every UNLOCKED benefit of every Party Bond the actor
 * holds. Idempotent — a no-op when nothing changed. Bonds live only on characters.
 */
export async function reconcileBonds(actor) {
  if (!actor || actor.type !== "character") return;
  if (game.users?.activeGM?.id !== game.user?.id) return;
  const bonds = actor.system?.bonds ?? [];

  // WANT: bondKey -> projection, for each unlocked Party benefit that carries rules.
  const want = new Map();
  for (const bond of bonds) {
    if (bond.kind !== "party") continue;                      // Follower benefits project nothing
    const rank = Number(bond.rank) || 0;
    for (const benefit of PROJECTANIME.partyBondBenefits) {
      if ((Number(benefit.rank) || 0) > rank) continue;       // benefit's rank not yet reached
      const w = benefitWant(bond, benefit);
      if (w) want.set(w.key, w);
    }
  }

  // HAVE: bondKey -> the first effect with that key (any extra sharing a key is a duplicate, purged).
  const have = new Map();
  for (const eff of actor.effects ?? []) {
    const key = eff.flags?.[FLAG_SCOPE]?.bondKey;
    if (key && !have.has(key)) have.set(key, eff);
  }

  const toDelete = [];
  const toCreate = [];
  for (const [key, w] of want) {
    const eff = have.get(key);
    if (!eff) { toCreate.push(bondEffectData(w)); continue; }
    if (eff.flags?.[FLAG_SCOPE]?.bondSig !== w.sig) { toDelete.push(eff.id); toCreate.push(bondEffectData(w)); }
  }
  // Purge any projected bond effect no longer wanted (rank dropped, bond removed, kind flipped, dupes).
  for (const eff of actor.effects ?? []) {
    if (!isBondEffect(eff)) continue;
    const key = eff.flags?.[FLAG_SCOPE]?.bondKey;
    const kept = have.get(key);
    if (!want.has(key) || (kept && kept.id !== eff.id)) toDelete.push(eff.id);
  }

  const del = [...new Set(toDelete)];
  if (del.length) await actor.deleteEmbeddedDocuments("ActiveEffect", del);
  if (toCreate.length) await actor.createEmbeddedDocuments("ActiveEffect", toCreate);
}
