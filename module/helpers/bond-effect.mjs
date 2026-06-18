/**
 * Project: Anime — BOND rank effects projection + grant delivery.
 *
 * A character's Bonds (system.bonds — helpers/bonds.mjs) each carry per-rank ability boons. Beyond
 * flavour text, a rank can now hold a no-code Effect (the same Effect-Builder `rules` a Signature
 * Trait uses), authored by the GM on the offering NPC and copied onto the player's bond when forged.
 *
 * This module turns those rules into play as the bond DEEPENS, mirroring helpers/trait-effect.mjs:
 *   • PASSIVE boons (attribute / stat / roll / affinity / sustain / skillMod / …) of every UNLOCKED
 *     rank (rank ≤ the bond's current rank) project onto the actor as their OWN flagged, always-on
 *     ActiveEffect — keyed `bondKey = "<bondId>:<rank>"`, refreshed by content signature, and PURGED
 *     when the bond drops below that rank or the rules change ("boons toggle with rank").
 *   • GRANT rules (Grant Items / Skills) of every unlocked rank deliver real Item copies ONCE, stamped
 *     with provenance flags so a re-reconcile never double-grants — and are NEVER revoked on a rank
 *     drop ("gifts stick"). Grants can't ride the projected AE (the grant engine only fires for
 *     item-carried effects), so they're delivered here directly.
 *
 * Reconciled GM-side only (single active GM) so a player can't self-grant by editing their own bond —
 * the projection/delivery happens on the GM's client when the bonds array changes. Driven by the
 * actor update/create hooks + the ready pass (project-anime.mjs), exactly like reconcileTraits.
 */
import { normalizeRule } from "./effects.mjs";

const FLAG_SCOPE = "project-anime";

/** Build the WANT record for one unlocked ability's PASSIVE rules (grants excluded — delivered
 *  separately), or null when it carries none. Keyed `<bondId>:<rank>` so each reconciles alone. */
function abilityWant(bond, ability) {
  const rules = (ability.rules ?? []).map(normalizeRule).filter(Boolean).filter((r) => r.type !== "grant");
  if (!rules.length) return null;
  const key = `${bond.id}:${ability.rank}`;
  const nm = (ability.name || "").trim() || game.i18n.format("PROJECTANIME.Covenant.abilityUnnamed", { rank: ability.rank });
  const im = (bond.img || "").trim() || "icons/svg/aura.svg";
  const sig = JSON.stringify({ key, nm, im, rules });
  return { key, name: nm, img: im, rules, sig };
}

/** The ActiveEffect data for a bond ability's projection (a direct, non-transferring, always-on effect). */
function bondEffectData(w) {
  return {
    name: w.name,
    img: w.img,
    disabled: false,
    transfer: false,
    flags: { [FLAG_SCOPE]: { bondKey: w.key, bondSig: w.sig, rules: { version: 1, list: w.rules } } }
  };
}

/** True if an ActiveEffect is a projected bond-ability effect (so we can find / refresh / purge it). */
export function isBondEffect(effect) {
  return !!effect?.flags?.[FLAG_SCOPE]?.bondKey;
}

/**
 * Reconcile one character's bond-ability effects (GM only, single active GM to avoid races):
 *   1. project/refresh/purge the always-on AE for every UNLOCKED rank's passive rules;
 *   2. deliver every unlocked rank's Grant Items/Skills once (sticky).
 * Idempotent — a no-op when nothing changed. Bonds live only on characters.
 */
export async function reconcileBonds(actor) {
  if (!actor || actor.type !== "character") return;
  if (game.users?.activeGM?.id !== game.user?.id) return;
  const bonds = actor.system?.bonds ?? [];

  // WANT: bondKey -> projection (unlocked ranks with passive rules) + a flat list of grant refs.
  const want = new Map();
  const grantWants = [];
  for (const bond of bonds) {
    const rank = Number(bond.rank) || 0;
    for (const ability of bond.abilities ?? []) {
      if ((Number(ability.rank) || 99) > rank) continue;     // rank not yet unlocked
      const w = abilityWant(bond, ability);
      if (w) want.set(w.key, w);
      for (const rule of ability.rules ?? []) {
        if (rule?.type === "grant")
          for (const it of rule.items ?? []) if (it?.uuid) grantWants.push({ bondId: bond.id, rank: Number(ability.rank) || 0, uuid: it.uuid });
      }
    }
  }

  // ---- AE projection: add / refresh / purge ----------------------------------------------------
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
  // Purge any projected bond effect no longer wanted (rank dropped, rules cleared, bond removed, dupes).
  for (const eff of actor.effects ?? []) {
    if (!isBondEffect(eff)) continue;
    const key = eff.flags?.[FLAG_SCOPE]?.bondKey;
    const kept = have.get(key);
    if (!want.has(key) || (kept && kept.id !== eff.id)) toDelete.push(eff.id);
  }

  const del = [...new Set(toDelete)];
  if (del.length) await actor.deleteEmbeddedDocuments("ActiveEffect", del);
  if (toCreate.length) await actor.createEmbeddedDocuments("ActiveEffect", toCreate);

  // ---- Grant delivery (one-time, sticky) -------------------------------------------------------
  await deliverBondGrants(actor, grantWants);
}

/**
 * Create the Item copies a bond's unlocked ranks Grant, skipping any already delivered (provenance:
 * flags bondGrant=<bondId>, bondGrantRank, grantSource=<uuid>). Each copy is stamped `granted` so a
 * granted Skill is free against the SP budget (mirrors the grant engine). Never deletes — a rank that
 * later locks keeps its gift. No-op when nothing is owed.
 */
async function deliverBondGrants(actor, grantWants) {
  if (!grantWants?.length) return;
  const present = new Set(
    actor.items
      .filter((i) => i.getFlag(FLAG_SCOPE, "bondGrant"))
      .map((i) => `${i.getFlag(FLAG_SCOPE, "bondGrant")}:${i.getFlag(FLAG_SCOPE, "bondGrantRank")}:${i.getFlag(FLAG_SCOPE, "grantSource")}`)
  );
  const seen = new Set();
  const toCreate = [];
  for (const g of grantWants) {
    const tag = `${g.bondId}:${g.rank}:${g.uuid}`;
    if (present.has(tag) || seen.has(tag)) continue;
    seen.add(tag);
    let src = null;
    try { src = await fromUuid(g.uuid); } catch (_) { /* unresolved ref — skip */ }
    if (!src || src.documentName !== "Item") continue;
    const data = src.toObject();
    delete data._id;
    delete data.folder;
    delete data.sort;
    // Shed an owner's transient flags, then stamp bond provenance + free-grant marker.
    const paf = data.flags?.[FLAG_SCOPE];
    if (paf) for (const f of ["grantedBy", "grantSource", "natural", "readied", "bondReward", "bondRewardRank"]) delete paf[f];
    foundry.utils.setProperty(data, `flags.${FLAG_SCOPE}.granted`, true);
    foundry.utils.setProperty(data, `flags.${FLAG_SCOPE}.bondGrant`, g.bondId);
    foundry.utils.setProperty(data, `flags.${FLAG_SCOPE}.bondGrantRank`, g.rank);
    foundry.utils.setProperty(data, `flags.${FLAG_SCOPE}.grantSource`, g.uuid);
    toCreate.push(data);
  }
  if (toCreate.length) await actor.createEmbeddedDocuments("Item", toCreate);
}
