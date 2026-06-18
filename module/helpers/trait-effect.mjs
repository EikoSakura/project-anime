/**
 * Project: Anime — Signature Trait + Traits projection.
 *
 * An NPC's **Signature Trait** (`system.trait`) and its **Traits** (`system.traits[]`) are skill-style
 * ability cards authored in the shared no-code Effect Builder and stored as plain data. This module
 * projects each one that carries rules onto the actor as its OWN flagged, always-on ActiveEffect, so it
 * actually affects play (its meaning rides `flags["project-anime"].rules`, applied by helpers/effects.mjs;
 * `hq` rules are read by the dispatch math in helpers/factions.mjs).
 *
 * Reconciled GM-side by content signature, mirroring helpers/hq-boons.mjs / helpers/aura.mjs so it's
 * idempotent and self-healing: an effect appears when its card gets rules, refreshes when edited, and is
 * purged when the card is cleared or removed. Each projection is keyed by `traitKey` — "sig" for the
 * Signature, the Trait's stable `id` for each Trait — so they reconcile independently. Driven by the
 * actor-update / create hooks + the ready pass (project-anime.mjs).
 */
import { normalizeRule } from "./effects.mjs";

const FLAG_SCOPE = "project-anime";

/** Build the WANT record for one card (Signature or a Trait), or null when it carries no live rules.
 *  `key` is the AE flag key ("sig" | trait id); `fallbackName` localizes an unnamed card. */
function cardWant(key, name, img, rules, fallbackName) {
  const norm = (rules ?? []).map(normalizeRule).filter(Boolean);
  if (!norm.length) return null;
  const nm = (name || "").trim() || fallbackName;
  const im = (img || "").trim() || "icons/svg/aura.svg";
  const sig = JSON.stringify({ key, nm, im, norm });
  return { key, name: nm, img: im, rules: norm, sig };
}

/** The ActiveEffect data for a card's projection (a direct, non-transferring, always-on actor effect). */
function cardEffectData(w) {
  return {
    name: w.name,
    img: w.img,
    disabled: false,
    transfer: false,
    flags: { [FLAG_SCOPE]: { traitKey: w.key, traitSig: w.sig, rules: { version: 1, list: w.rules } } }
  };
}

/** True if an ActiveEffect is a projected Signature/Trait effect (so we can find / refresh / purge it).
 *  Also matches the legacy slice-1 flag (`traitEffect`) so old projections self-heal into the new shape. */
export function isTraitEffect(effect) {
  const f = effect?.flags?.[FLAG_SCOPE];
  return !!(f?.traitKey || f?.traitEffect);
}

/**
 * Reconcile one actor's Signature Trait + Traits projections (GM only, single active GM to avoid races).
 * Each card with rules is created / refreshed (on signature change) / purged (when cleared or removed),
 * keyed independently by `traitKey`. Idempotent — a no-op when the projection already matches. Legacy
 * single-effect projections (flagged `traitEffect`) are folded onto the "sig" key.
 */
export async function reconcileTraits(actor) {
  if (!actor || game.users?.activeGM?.id !== game.user?.id) return;

  // WANT: traitKey -> { name, img, rules, sig }
  const want = new Map();
  const sigName = game.i18n.localize("PROJECTANIME.Talent.signature");
  const sig = cardWant("sig", actor.system?.trait?.name, actor.system?.trait?.img, actor.system?.trait?.rules, sigName);
  if (sig) want.set("sig", sig);
  for (const t of actor.system?.traits ?? []) {
    if (!t?.id) continue;
    const w = cardWant(t.id, t.name, t.img, t.rules, game.i18n.localize("PROJECTANIME.Talent.traitFallback"));
    if (w) want.set(t.id, w);
  }

  // HAVE: traitKey -> the FIRST effect with that key (legacy `traitEffect` flag folds onto "sig").
  // Any further effect sharing a key is a duplicate, purged in the removal pass below.
  const have = new Map();
  for (const eff of actor.effects ?? []) {
    const f = eff.flags?.[FLAG_SCOPE];
    const key = f?.traitKey ?? (f?.traitEffect ? "sig" : null);
    if (key && !have.has(key)) have.set(key, eff);
  }

  const toDelete = [];
  const toCreate = [];
  // Additions + refreshes.
  for (const [key, w] of want) {
    const eff = have.get(key);
    if (!eff) { toCreate.push(cardEffectData(w)); continue; }
    if (eff.flags?.[FLAG_SCOPE]?.traitSig !== w.sig) { toDelete.push(eff.id); toCreate.push(cardEffectData(w)); }
  }
  // Removals — purge any projected trait effect no longer wanted (cleared card / removed Trait / crash leftovers).
  for (const eff of actor.effects ?? []) {
    if (!isTraitEffect(eff)) continue;
    const f = eff.flags?.[FLAG_SCOPE];
    const key = f?.traitKey ?? "sig";
    const kept = have.get(key);
    if (!want.has(key) || (kept && kept.id !== eff.id)) toDelete.push(eff.id); // unwanted, or a duplicate of a kept key
  }

  const del = [...new Set(toDelete)];
  if (del.length) await actor.deleteEmbeddedDocuments("ActiveEffect", del);
  if (toCreate.length) await actor.createEmbeddedDocuments("ActiveEffect", toCreate);
}
