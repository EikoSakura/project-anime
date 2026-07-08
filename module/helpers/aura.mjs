/**
 * Project: Anime — Aura Skill Modifier (continuous area field).
 *
 * A Skill carrying "Aura" becomes a field: it continuously grants its Effect(s) to its AUDIENCE
 * within its Aura radius (base = the Skill's Rank, grown per-skill by the "Tune a Modifier"
 * advancement — config.mjs modifierValue) of the bearer's token. The audience derives from the
 * Skill's explicit Target (config.mjs auraAudience — rules v0.01: area Modifiers affect "the type
 * the Skill can already affect"): Ally → same-side creatures plus the bearer; Foe → opposing
 * creatures only, never the bearer; Any → every creature in the field including the bearer. A
 * PASSIVE aura's bearer keeps the Effect through the normal passive path (effects.mjs applies a
 * Passive Skill's effects in-memory to its owner), so this engine projects OUTWARD copies.
 *
 * It works like PF2e auras: the projected buff is a REAL ActiveEffect document created on each
 * recipient's actor, stamped with `flags["project-anime"].aura` so it can be found, refreshed, and
 * removed. A single reconcile pass (`syncAuras`) is the source of truth — it computes who should be
 * affected right now and adds / refreshes / removes copies to match. It runs whenever the picture
 * could change (a token moves, a source is defeated, a Skill is edited…), wired in project-anime.mjs.
 *
 * GM-side only: the single active GM reconciles for the whole canvas (it can edit every actor, so no
 * permission relay is needed) — mirroring the rest of the system's GM-gated automation (defeat
 * marking, effect expiry, Sustain/Decay ticks). Like those, it's scene/canvas-based: it reconciles
 * the tokens on the GM's currently-viewed scene.
 */

import { PROJECTANIME, skillEffectKeys, auraAudience, modifierValue, valuedStatusValue } from "./config.mjs";
import {
  effectCopyData, effectRules, bolsterHinderRules, hasAuthoredAttributeEffect,
  skillModifierRules
} from "./effects.mjs";
import { tokensInRange } from "./templates.mjs";

const FLAG_SCOPE = "project-anime";

/* -------------------------------------------- */
/*  Readers                                     */
/* -------------------------------------------- */

/** The Aura Skills an actor carries (the "aura" Modifier) — any Action Type. A PASSIVE aura is
 *  always live; an ACTIVE/React aura is live only while its duration marker is running (auraIsLive). */
export function actorAuraSkills(actor) {
  return (actor?.items ?? []).filter(
    (i) => i.type === "skill" && (i.system?.modifiers ?? []).includes("aura")
  );
}

/** True if an ActiveEffect is a projected aura buff (so we can find / refresh / purge it). */
export function isAuraEffect(effect) {
  return !!effect?.flags?.[FLAG_SCOPE]?.aura;
}

/** Is this Skill's aura currently projecting from `token`? A PASSIVE aura always projects; an
 *  ACTIVE/React aura projects only while a non-expired duration marker (stamped on the bearer by
 *  dice.mjs resolveAura: `auraMarker` = the Skill id, with the aura's duration) is running. */
function auraIsLive(token, skill) {
  if (skill.system?.actionType === "passive") return true;
  const actor = token?.actor;
  if (!actor) return false;
  return (actor.effects ?? []).some((e) => {
    if (e.flags?.[FLAG_SCOPE]?.auraMarker !== skill.id) return false;
    if (e.duration?.expired === true) return false;   // v14 flags a run-out duration directly
    const rem = e.duration?.remaining;
    return !(Number.isFinite(rem) && rem <= 0);   // a marker that's run out isn't live yet-deleted
  });
}

/** The LIVE aura Skills a token is currently projecting — its "aura" Modifiers whose field is on
 *  right now (a PASSIVE aura always; an ACTIVE/React aura only while its duration marker runs). The
 *  single authority shared by the reconcile and the on-canvas ring overlay (apps/aura-field.mjs), so
 *  both agree on exactly which tokens have a field. */
export function liveAuraSkills(token) {
  const actor = token?.actor;
  if (!actor) return [];
  return actorAuraSkills(actor).filter((skill) => auraIsLive(token, skill));
}

/** True if `otherToken` is a valid recipient of an `audience` aura cast from `srcToken`: an
 *  "ally" aura reaches same-disposition creatures; a "foe" aura the opposing side
 *  (Friendly↔Hostile); an "any" aura every creature in the field regardless of side. The bearer
 *  is excluded here (handled separately in the reconcile). */
function isAuraRecipient(srcToken, otherToken, audience) {
  const a = srcToken?.document?.disposition;
  const b = otherToken?.document?.disposition;
  if (a == null || b == null || srcToken === otherToken) return false;
  if (audience === "any") return true;
  if (audience === "foe") {
    const D = CONST.TOKEN_DISPOSITIONS;
    return (a === D.FRIENDLY && b === D.HOSTILE) || (a === D.HOSTILE && b === D.FRIENDLY);
  }
  return a === b; // ally: same disposition
}

/* -------------------------------------------- */
/*  Building the projected effect data          */
/* -------------------------------------------- */

/** Stamp the aura bookkeeping onto a copied effect object: clear its duration (an aura lasts while
 *  you're in it, not for a timer), mark it a non-transferring direct actor effect, and rebuild its
 *  `project-anime` flags down to just the rules + aura identity (dropping any source-only flags such
 *  as `toggle`, so the projection is simply always-on while in range). */
function stampAura(data, { auraKey, sourceId, skillId, skillUuid, sig }) {
  const rules = foundry.utils.getProperty(data, `flags.${FLAG_SCOPE}.rules`) ?? null;
  delete data._id;
  data.duration = {};            // continuous — presence in the aura, not a countdown
  data.disabled = false;
  data.transfer = false;         // a direct actor effect, not an item→actor transfer
  data.origin = skillUuid;       // provenance: the Skill projecting it
  const pa = { aura: true, auraKey, auraSource: sourceId, auraSkill: skillId, auraSig: sig };
  if (rules) pa.rules = rules;
  foundry.utils.setProperty(data, `flags.${FLAG_SCOPE}`, pa);
  return data;
}

/**
 * The ActiveEffect data an Aura Skill projects onto a recipient, plus its identity. Mirrors exactly
 * what the bearer gets in-memory (effects.mjs): every authored, enabled effect that carries rules,
 * PLUS the auto Bolster/Hinder rules for a Bolster/Hinder Skill (unless it authored its own attribute
 * effect). Returns null when the Skill projects nothing.
 * @returns {{auraKey:string, sig:string, dataList:object[]}|null}
 */
function auraEffectDataFor(skill, sourceToken) {
  const raw = [];
  // 1) Authored, enabled effects that carry rules — copied (with icon inheritance) like the on-use path.
  for (const effect of skill.effects ?? []) {
    if (effect.disabled || !effectRules(effect).length) continue;
    raw.push(effectCopyData(effect, skill.img));
  }
  // 2) Auto Bolster/Hinder — the bearer gets these in-memory (effects.mjs applyStructuredRules); build
  //    the same rules into an effect so allies receive an identical buff. Skipped if the designer
  //    authored their own attribute effect (which is already copied above).
  if (!hasAuthoredAttributeEffect(skill)) {
    for (const mode of skillEffectKeys(skill.system)) {
      const list = bolsterHinderRules(skill, mode);
      if (!list.length) continue;
      raw.push({ name: skill.name, img: skill.img, flags: { [FLAG_SCOPE]: { rules: { version: 1, list } } } });
    }
  }
  // 3) Auto Modifier rules — Protection (+1 Defense) projects to the aura's
  //    recipients exactly as they apply to the bearer (effects.mjs skillModifierRules).
  {
    const list = skillModifierRules(skill);
    if (list.length) raw.push({ name: skill.name, img: skill.img, flags: { [FLAG_SCOPE]: { rules: { version: 1, list } } } });
  }
  // 4) The Inflict Modifier's Status — projected as its OWN aura entry (separate key/recipients) so a
  //    "Regen field" (or any inflicted condition aura) grants that status to its audience, AND reaches
  //    the bearer even for a PASSIVE aura (the in-memory passive path never grants an inflicted status,
  //    so the caster's own field wouldn't heal them otherwise). A valued Regen rides a `sustain` rule
  //    worth the Skill's Rank × 2 so collectSustain regenerates it each turn (Barrier's absorb isn't an
  //    aura yet — it needs the per-pool actor flag). Lingering keeps its own dedicated on-hit path.
  const statusRaw = [];
  const inflictSt = (skill.system?.modifiers ?? []).includes("inflict") ? skill.system.inflictStatus : "";
  if (inflictSt && inflictSt !== "decay" && (PROJECTANIME.conditionKeys ?? []).includes(inflictSt)) {
    const sd = { name: skill.name, img: skill.img, statuses: [inflictSt] };
    if (inflictSt === "regen") {
      const pool = skill.system?.inflictPool === "energy" ? "energy" : "hp";
      foundry.utils.setProperty(sd, `flags.${FLAG_SCOPE}.rules`,
        { version: 1, list: [{ type: "sustain", pool, value: valuedStatusValue(skill.system?.spCost, "regen") }] });
    }
    statusRaw.push(sd);
  }

  if (!raw.length && !statusRaw.length) return null;

  // Content signature — refreshes the projected copies whenever the Skill's content changes (its
  // rules, name, icon, native changes/statuses). Stored on each copy; compared on reconcile.
  const sigOf = (arr) => JSON.stringify(arr.map((d) => ({
    n: d.name ?? "",
    i: d.img ?? "",
    r: foundry.utils.getProperty(d, `flags.${FLAG_SCOPE}.rules`) ?? null,
    c: d.changes ?? null,
    s: d.statuses ?? null
  })));
  const auraKey = `${sourceToken.id}:${skill.id}`;
  const sig = sigOf(raw);
  const dataList = raw.map((d) => stampAura(d, { auraKey, sourceId: sourceToken.id, skillId: skill.id, skillUuid: skill.uuid, sig }));
  // The inflicted-status field is a sibling aura keyed `<auraKey>:status` — its own recipient set
  // (computed in reconcileCanvas) lets it include the bearer when the main effects don't.
  const statusKey = `${auraKey}:status`;
  const statusSig = sigOf(statusRaw);
  const statusList = statusRaw.map((d) => stampAura(d, { auraKey: statusKey, sourceId: sourceToken.id, skillId: skill.id, skillUuid: skill.uuid, sig: statusSig }));
  return { auraKey, sig, dataList, statusKey, statusSig, statusList };
}

/* -------------------------------------------- */
/*  Reconcile                                   */
/* -------------------------------------------- */

/** Group an actor's existing aura effects by their auraKey. */
function existingAuraEffects(actor) {
  const have = new Map();
  for (const e of actor.effects ?? []) {
    if (!isAuraEffect(e)) continue;
    const key = e.flags[FLAG_SCOPE].auraKey;
    if (!have.has(key)) have.set(key, []);
    have.get(key).push(e);
  }
  return have;
}

/** Add/refresh/remove one actor's aura effects so they match what's desired for it right now. */
async function reconcileActor(actor, want) {
  const have = existingAuraEffects(actor);
  const toDelete = [];
  const toCreate = [];

  // Additions + refreshes: a wanted aura that's absent is created; one whose content signature
  // changed (the Skill was edited) is replaced.
  for (const [key, { sig, dataList }] of want) {
    const present = have.get(key);
    if (!present) { toCreate.push(...dataList); continue; }
    if (present[0]?.flags?.[FLAG_SCOPE]?.auraSig !== sig) {
      toDelete.push(...present.map((e) => e.id));
      toCreate.push(...dataList);
    }
  }
  // Removals: an aura present on the actor that's no longer wanted (moved out of range, the source
  // died / was deleted, the Skill was removed) is purged. This also cleans up any stale copies left
  // behind by a crash or a GM-offline window — every reconcile drops what isn't currently desired.
  for (const [key, effects] of have) {
    if (!want.has(key)) toDelete.push(...effects.map((e) => e.id));
  }

  if (toDelete.length) await actor.deleteEmbeddedDocuments("ActiveEffect", toDelete);
  if (toCreate.length) {
    // Clone per creation — the same source dataList is shared across every recipient of that aura.
    await actor.createEmbeddedDocuments("ActiveEffect", toCreate.map((d) => foundry.utils.deepClone(d)));
  }
}

/** Single in-flight guard: coalesce overlapping reconciles (the trailing call re-runs once). */
let auraSyncing = false;
let auraDirty = false;

/**
 * Reconcile every aura on the current canvas. GM-side only. Builds the desired set (each live aura
 * source → its allied recipients in range), then makes each affected actor's aura effects match.
 * Idempotent and self-healing: stale copies are always purged.
 */
export async function syncAuras() {
  if (game.users?.activeGM?.id !== game.user?.id) return;
  if (!canvas?.ready) return;
  if (auraSyncing) { auraDirty = true; return; }
  auraSyncing = true;
  try {
    do {
      auraDirty = false;
      await reconcileCanvas();
    } while (auraDirty);
  } finally {
    auraSyncing = false;
  }
}

/** One reconcile pass over the canvas (see syncAuras). */
async function reconcileCanvas() {
  const tokens = canvas.tokens?.placeables ?? [];

  // desired: Map<Actor, Map<auraKey, {sig, dataList}>>
  const desired = new Map();
  const addDesired = (actor, auraKey, sig, dataList) => {
    let m = desired.get(actor);
    if (!m) desired.set(actor, (m = new Map()));
    m.set(auraKey, { sig, dataList });
  };

  for (const src of tokens) {
    if (src.document.hidden) continue;                       // a hidden source isn't projecting
    const actor = src.actor;
    if (!actor || (actor.system?.hp?.value ?? 1) <= 0) continue; // defeated bearers project nothing
    const skills = liveAuraSkills(src);
    if (!skills.length) continue;

    for (const skill of skills) {
      const built = auraEffectDataFor(skill, src);
      if (!built) continue;
      // A footprint-aware CIRCLE (euclidean, edge-to-edge) — the round field reaches this Skill's
      // Aura radius (base = the Skill's Rank + any Tune growth, per-skill) out from the source's
      // BODY, a larger source or target counting its size, matching the ring drawn on canvas
      // (apps/aura-field.mjs). Other area reach (Mass/Chain) keeps the grid measurement.
      const tiles = modifierValue(skill, "aura");
      const inRange = tokensInRange(src, tiles, { euclidean: true }).filter((r) => r.actor && !r.document.hidden && r.actor !== actor);
      // The audience within range (the Skill's Target — config.mjs auraAudience). Ally and Any
      // auras ALSO apply to the bearer (you stand in your own field): a PASSIVE one covers the
      // bearer in-memory, so project to the bearer only when ACTIVE (its effect is dormant on the
      // carrier until used). A FOE aura never touches the bearer (suppressed in-memory by
      // effects.mjs isEnemyAura; not projected here).
      const audience = auraAudience(skill.system);
      const recips = inRange.filter((r) => isAuraRecipient(src, r, audience)).map((r) => r.actor);
      // Main effects (Bolster/Hinder/Protection/…): allies in range, plus the bearer only for an
      // ACTIVE ally/any aura — a PASSIVE bearer already gets these in-memory (effects.mjs).
      if (built.dataList.length) {
        const mainRecips = audience !== "foe" && skill.system?.actionType !== "passive" ? [...recips, actor] : recips;
        for (const ra of mainRecips) addDesired(ra, built.auraKey, built.sig, built.dataList);
      }
      // Inflicted status (e.g. Regen): allies in range, plus the bearer for ANY ally/any aura —
      // passive OR active — since the in-memory path never grants an inflicted status to the bearer.
      if (built.statusList?.length) {
        const stRecips = audience !== "foe" ? [...recips, actor] : recips;
        for (const ra of stRecips) addDesired(ra, built.statusKey, built.statusSig, built.statusList);
      }
    }
  }

  // Reconcile every candidate: the desired recipients PLUS any actor that currently carries an aura
  // effect (so a recipient that walked off-canvas, or a linked actor whose token was removed, still
  // gets its now-stale copies purged).
  const candidates = new Set(desired.keys());
  for (const t of tokens) if (t.actor?.effects?.some(isAuraEffect)) candidates.add(t.actor);
  for (const a of game.actors ?? []) if (a.effects?.some(isAuraEffect)) candidates.add(a);

  for (const actor of candidates) {
    await reconcileActor(actor, desired.get(actor) ?? new Map());
  }
}

/** Remove EVERY projected aura effect from every reachable actor (canvas + world). GM-side. Used as a
 *  hard reset (e.g. could be called from a macro) — normal lifecycle is handled by syncAuras. */
export async function clearAllAuras() {
  if (game.users?.activeGM?.id !== game.user?.id) return;
  const actors = new Set(game.actors ?? []);
  for (const t of canvas?.tokens?.placeables ?? []) if (t.actor) actors.add(t.actor);
  for (const actor of actors) {
    const ids = (actor.effects ?? []).filter(isAuraEffect).map((e) => e.id);
    if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  }
}
