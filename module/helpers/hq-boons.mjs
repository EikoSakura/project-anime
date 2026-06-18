/**
 * Project: Anime — HQ passive boons.
 *
 * A `passive`-role HQ facility (Codex Home tab) grants an always-on party buff: while it's staffed, a
 * flagged ActiveEffect carrying its effect is projected onto every party-folder member. The boon is
 * authored in the shared no-code Effect Builder, so it can be the FULL vocabulary (attributes, talents,
 * stats, sustain, trade, affinity, HQ outputs, …) — its meaning rides `flags["project-anime"].rules`,
 * applied by helpers/effects.mjs exactly as for a Trait or an aura. (Legacy attribute-only boons stored
 * as `boonChanges` still ride along as native AE changes.) Every numeric magnitude scales by the
 * facility's tier (scaleRuleByTier), so levelling a facility strengthens its boon.
 *
 * Reconciled GM-side by facility id + content signature (mirroring helpers/aura.mjs): the effect appears
 * when the facility is recruited, refreshes when the boon is edited or the facility levels up, and is
 * purged when the facility is removed, un-staffed, or stops being passive — with no churn when nothing
 * changed. Driven by the covenantHQ setting's onChange + party-membership hooks.
 */
import { getHQ } from "./factions.mjs";
import { partyActors, partyMembers } from "./party-folder.mjs";
import { normalizeRule, scaleRuleByTier } from "./effects.mjs";

const FLAG_SCOPE = "project-anime";
const BOON_ATTRS = new Set(["might", "agility", "mind", "spirit", "charm"]);

/** Legacy attribute-only boon as native AE changes (attribute `.value` ADD, ×tier), dropping blanks. */
function legacyChanges(entry, tier) {
  const ADD = CONST.ACTIVE_EFFECT_MODES.ADD;
  return (entry.boonChanges ?? [])
    .filter((c) => BOON_ATTRS.has(c.attr) && Math.round(Number(c.value) || 0) !== 0)
    .map((c) => ({ key: `system.attributes.${c.attr}.value`, mode: ADD, value: String(Math.round(Number(c.value)) * tier) }));
}

/** The Effect-Builder boon rules, normalized and tier-scaled. */
function boonRuleList(entry, tier) {
  return (entry.boonRules ?? []).map((r) => normalizeRule(r)).filter(Boolean).map((r) => scaleRuleByTier(r, tier));
}

/** Every distinct party-folder CHARACTER across all parties (HQ boons buff the whole party). */
function allPartyMembers() {
  const seen = new Map();
  for (const p of partyActors()) for (const m of partyMembers(p)) seen.set(m.id, m);
  return [...seen.values()];
}

/** The ActiveEffect data for a facility's boon (a direct, non-transferring, always-on actor effect). */
function boonEffectData(fid, w) {
  const flags = { hqBoon: fid, hqBoonSig: w.sig };
  if (w.rules.length) flags.rules = { version: 1, list: w.rules };
  return { name: w.name, img: w.img, changes: w.changes, disabled: false, transfer: false, flags: { [FLAG_SCOPE]: flags } };
}

/**
 * Reconcile HQ passive-facility boons onto every party member (GM only). Idempotent: a wanted boon
 * that's absent is created, one whose signature changed is replaced, and any hqBoon effect no longer
 * wanted (facility removed / un-staffed / no longer passive) is purged.
 */
export async function reconcileHQBoons() {
  if (!game.user.isGM) return;
  const hq = getHQ();

  // WANT: facilityId -> { name, img, changes, rules, sig }
  const want = new Map();
  for (const e of hq.facilities) {
    // Any facility may carry a projected effect (boonRules / legacy boonChanges) — not just `passive`.
    // A tier-0 (unbuilt) facility projects nothing — it has to be built first.
    const tier = Math.min(3, Math.max(0, Number(e.facilityTier) || 0));
    if (tier <= 0) continue;
    const changes = legacyChanges(e, tier);
    const rules = boonRuleList(e, tier);
    if (!changes.length && !rules.length) continue;
    const name = e.name || game.i18n.localize("PROJECTANIME.HQ.boonDefault");
    const img = e.img || "icons/svg/aura.svg";
    const sig = JSON.stringify({ name, img, changes, rules });
    want.set(e.id, { name, img, changes, rules, sig });
  }

  for (const actor of allPartyMembers()) {
    const have = new Map();
    for (const eff of actor.effects ?? []) {
      const fid = eff.flags?.[FLAG_SCOPE]?.hqBoon;
      if (fid) have.set(fid, eff);
    }
    const toDelete = [];
    const toCreate = [];
    // Additions + refreshes.
    for (const [fid, w] of want) {
      const eff = have.get(fid);
      if (!eff) { toCreate.push(boonEffectData(fid, w)); continue; }
      if (eff.flags?.[FLAG_SCOPE]?.hqBoonSig !== w.sig) { toDelete.push(eff.id); toCreate.push(boonEffectData(fid, w)); }
    }
    // Removals — purge any hqBoon effect that's no longer wanted (also self-heals crash leftovers).
    for (const [fid, eff] of have) if (!want.has(fid)) toDelete.push(eff.id);

    if (toDelete.length) await actor.deleteEmbeddedDocuments("ActiveEffect", toDelete);
    if (toCreate.length) await actor.createEmbeddedDocuments("ActiveEffect", toCreate);
  }
}
