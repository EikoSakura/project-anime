/**
 * Project: Anime — the Technique build brain, shared by the Skill Builder wizard
 * (module/apps/skill-builder.mjs) and the item sheet's Technique tab
 * (module/sheets/item-sheet.mjs). One draft shape, one normalizer, one legality-checked
 * Modifier toggle, and one draft→system assembler — so a Technique edited ANYWHERE
 * round-trips through the same V2 rules and illegal combinations can't be saved.
 */
import { modifierBarredByType, isSelfCenteredArea, effectAttrCount } from "./config.mjs";

/** Sensible Target starting points per Effect — applied when the Effect CHANGES (the player
 *  re-picks freely afterwards via the free Target Modifiers). */
export const EFFECT_TARGET_DEFAULTS = {
  strike: "foe", hinder: "foe", steal: "foe", illusion: "foe",
  bolster: "ally", mend: "ally",
  transform: "self", vanish: "self", conjure: "self", companion: "self"
};

/** The Effects whose creation-time pick is "which Attributes change". */
export const ATTR_EFFECTS = ["bolster", "hinder", "transform"];

/** Default image for a freshly-built Technique. */
export const DEFAULT_TECHNIQUE_IMG = "icons/svg/upgrade.svg";

/** A fresh build draft seeded from the Technique model defaults. */
export function blankTechniqueDraft() {
  return {
    name: game.i18n.localize("PROJECTANIME.SkillBuilder.newSkillName"),
    img: DEFAULT_TECHNIQUE_IMG,
    description: "",
    actionType: "action",
    passiveMode: "sustained",
    trigger: "",
    // The Talent this Technique is built under ("" = the two-Attribute fallback).
    talentId: "",
    attrA: "might",
    attrB: "spirit",
    range: { scope: "weapon", tiles: 1 },
    effect: "strike",
    // Secondary Effect defaults to a real Effect (only used while its Modifier is selected).
    secondaryEffect: "strike",
    // Target (the free Target Modifiers) + intrinsic Duration; a Duration MODIFIER
    // (Channeled / Scene) overrides at commit.
    target: "foe",
    duration: "instant",
    effectDuration: null,
    // Control's element — free text, chosen at creation.
    controlElement: "",
    // Empower/Weaken/Transform — which Attributes change (chosen at creation).
    effectAttrs: [],
    // Heal clears a hit box or an energy box (chosen at creation); Drain mirrors the choice.
    damagePool: "hp",
    secondaryDamagePool: "hp",
    modifiers: [],
    potentCount: 1,
    potentPool: "",
    keenCount: 1,
    customModifierHeavy: false,
    inflictStatus: "",
    inflictSevereStatus: "",
    inflictPool: "hp",
    drainPool: "hp",
    analyzeCategory: "vitals",
    // Manifest: the owned Passive Technique this carrier wakes.
    manifestSkillId: "",
    // Companion: the 2-box lock lifts while it's left home.
    companionHome: false,
    // GM knob (edited on the Technique tab, carried through rebuilds).
    usesPerConflict: 0
  };
}

/** A build draft seeded from an existing Technique's system data — the inverse of the
 *  assembler's write. Name/img live on the Item, not here (the wizard layers them on). */
export function techniqueDraftFromSystem(s = {}) {
  return {
    description: s.description ?? "",
    actionType: s.actionType ?? "action",
    passiveMode: s.passiveMode ?? "sustained",
    trigger: s.trigger ?? "",
    talentId: s.talentId ?? "",
    attrA: s.attributes?.attrA ?? "might",
    attrB: s.attributes?.attrB ?? "spirit",
    range: { scope: s.range?.scope ?? "weapon", tiles: s.range?.tiles ?? 1 },
    effect: s.effect ?? "strike",
    secondaryEffect: s.secondaryEffect || "strike",
    target: s.target ?? "any",
    // The draft holds only the INTRINSIC duration (Instant/Standard); Channeled/Scene live
    // on the Modifier list and re-assert at commit.
    duration: s.duration === "instant" ? "instant" : "standard",
    effectDuration: s.effectDuration ?? null,
    controlElement: s.controlElement ?? "",
    effectAttrs: [...(s.effectAttrs ?? [])],
    // The legacy "none" marker means "no Modifiers" — the V2 list simply starts empty.
    modifiers: (s.modifiers ?? []).filter((m) => m !== "none"),
    potentCount: Math.clamp(Math.round(Number(s.potentCount) || 1), 1, 2),
    potentPool: ["hp", "energy"].includes(s.potentPool) ? s.potentPool : "",
    keenCount: Math.clamp(Math.round(Number(s.keenCount) || 1), 1, 2),
    customModifierHeavy: !!s.customModifierHeavy,
    inflictStatus: s.inflictStatus ?? "",
    inflictSevereStatus: s.inflictSevereStatus ?? "",
    inflictPool: s.inflictPool ?? "hp",
    drainPool: s.drainPool ?? "hp",
    analyzeCategory: s.analyzeCategory ?? "vitals",
    manifestSkillId: s.manifestSkillId ?? "",
    companionHome: !!s.companionHome,
    usesPerConflict: Number(s.usesPerConflict) || 0
  };
}

/** Effects this actor may not take at all: a raised Servant or bonded Companion (flagged by
 *  helpers/servants.mjs) can never carry the Companion Effect (or legacy Animate). */
export function barredTechniqueEffects(actor) {
  const flags = actor?.flags?.["project-anime"] ?? {};
  return (flags.servantOf || flags.companionOf) ? ["animate", "companion"] : [];
}

/** A new Effect re-seeds Target + Duration (+ an inherent range like Sense's 5 tiles):
 *  printed-Duration Effects open on Standard. Call ONLY when the Effect actually changed. */
export function reseedEffectDefaults(d) {
  const cfg = CONFIG.PROJECTANIME;
  d.target = EFFECT_TARGET_DEFAULTS[d.effect] ?? "any";
  d.duration = (cfg.durationEffects ?? []).includes(d.effect) ? "standard" : "instant";
  d.effectDuration = null;
  const inh = cfg.inherentRangeTiles ?? {};
  if (d.effect in inh) d.range = { scope: "tiles", tiles: inh[d.effect] };
}

/** The fallback pair must be two DIFFERENT Attributes — a collision shifts the one that
 *  DIDN'T just change to the next Attribute on the wheel. */
export function dedupeAttrPair(d, aChanged) {
  if (d.attrA !== d.attrB) return;
  const keys = CONFIG.PROJECTANIME.attributeKeys;
  if (aChanged) d.attrB = keys[(keys.indexOf(d.attrA) + 1) % keys.length];
  else d.attrA = keys[(keys.indexOf(d.attrB) + 1) % keys.length];
}

/**
 * Toggle a Modifier on the draft under the V2 legality rules: Companion/Animate host
 * nothing; a Passive can't take Channeled (or Manifest); area Modifiers are exclusive;
 * Channeled⇄Scene swap; dropping a Modifier clears its creation-time picks.
 * @returns {{ok: boolean, warn?: string}} warn = i18n key when the toggle is refused.
 */
export function toggleTechniqueModifier(d, key) {
  const cfg = CONFIG.PROJECTANIME;
  const at = d.modifiers.indexOf(key);
  if (at >= 0) {
    d.modifiers.splice(at, 1);
    // Dropping a Modifier clears its creation-time picks, so re-adding starts clean.
    if (key === "custom") d.customModifierHeavy = false;
    if (key === "potent") { d.potentCount = 1; d.potentPool = ""; }
    if (key === "keen") d.keenCount = 1;
    if (key === "inflict") d.inflictStatus = "";
    if (key === "inflictSevere") d.inflictSevereStatus = "";
    return { ok: true };
  }
  // Companion (and legacy Animate) take no Modifiers at all.
  if ((cfg.noModifierEffects ?? []).includes(d.effect)) {
    return { ok: false, warn: "PROJECTANIME.SkillBuilder.modIncompatible" };
  }
  // A Passive can't be Channeled; the "None" carrier can't host a Secondary Effect.
  if (modifierBarredByType(key, { actionType: d.effect === "companion" ? "passive" : d.actionType, effect: d.effect })) {
    return { ok: false, warn: "PROJECTANIME.SkillBuilder.passiveNoMod" };
  }
  // Area Modifiers don't stack (Aura / Burst / Line / Mass) — picking one releases the rest.
  if ((cfg.exclusiveAreaModifiers ?? []).includes(key)) {
    d.modifiers = d.modifiers.filter((m) => !(cfg.exclusiveAreaModifiers ?? []).includes(m));
  }
  // Channeled and Scene are mutually exclusive Duration Modifiers — a pick swaps.
  if (key === "channeled" || key === "scene") {
    const oi = d.modifiers.indexOf(key === "channeled" ? "scene" : "channeled");
    if (oi >= 0) d.modifiers.splice(oi, 1);
  }
  d.modifiers.push(key);
  // An Aura's field needs a real audience — a Self target collapses to Ally on pick.
  if (key === "aura" && d.target === "self") d.target = "ally";
  return { ok: true };
}

/** Normalize a draft to the V2 rules (the wizard applies this after every field sync; the
 *  Technique tab applies it before every save). Mutates and returns the draft. */
export function normalizeTechniqueDraft(d) {
  const cfg = CONFIG.PROJECTANIME;
  // Companion is always Passive and takes no Modifiers.
  if ((cfg.noModifierEffects ?? []).includes(d.effect)) {
    d.actionType = "passive";
    d.modifiers = [];
  }
  // A Passive sheds Channeled (it doesn't pay per turn).
  if (d.actionType === "passive") d.modifiers = d.modifiers.filter((m) => m !== "channeled");
  // The legacy "None" carrier can't host a Secondary Effect.
  if (d.effect === "passive") d.modifiers = d.modifiers.filter((m) => m !== "secondaryEffect");
  // Waypoint is Gate only.
  const hasSecondary = d.modifiers.includes("secondaryEffect");
  if (d.effect !== "gate" && !(hasSecondary && d.secondaryEffect === "gate")) {
    d.modifiers = d.modifiers.filter((m) => m !== "waypoint");
  }
  // An Aura's field needs a real audience; a self-centered Burst likewise.
  const auraOn = d.modifiers.includes("aura");
  const selfArea = isSelfCenteredArea({ range: d.range, modifiers: d.modifiers });
  if (!auraOn && !selfArea && d.range.scope === "self") d.target = "self";
  if (auraOn && d.target === "self") d.target = "ally";
  if (selfArea && d.target === "self") d.target = "any";
  // A multi-take Modifier's count (and Potent's aimed pool) only mean something while it's on.
  if (!d.modifiers.includes("potent")) { d.potentCount = 1; d.potentPool = ""; }
  if (!d.modifiers.includes("keen")) d.keenCount = 1;
  return d;
}

/** Commit-quality warnings (the wizard refuses these at Finish; the Technique tab surfaces
 *  them as toasts while the player fills the fields in): a React Technique needs a Trigger;
 *  an actor-bound Manifest must name the Passive it wakes. Returns i18n keys, [] when clean. */
export function techniqueCommitWarnings(d, actor) {
  const warns = [];
  if (d.effect !== "companion" && d.actionType === "react" && !d.trigger) warns.push("PROJECTANIME.Skill.reactNeedsTrigger");
  if (d.modifiers.includes("manifest") && actor && !actor.items.get(d.manifestSkillId)) warns.push("PROJECTANIME.SkillBuilder.needManifest");
  return warns;
}

/** The draft assembled into a V2 system shape — the single source the live cost readouts,
 *  the Modifier scaling hints, and every commit (wizard or Technique tab) read. */
export function assembleTechniqueSystem(d) {
  const cfg = CONFIG.PROJECTANIME;
  let mods = [...d.modifiers];

  // Companion is ALWAYS Passive and takes no Modifiers (rules: Companion).
  const noMods = (cfg.noModifierEffects ?? []).includes(d.effect);
  if (noMods) mods = [];
  // A Passive can't be Channeled; the legacy "None" carrier can't host a Secondary Effect.
  mods = mods.filter((m) => !modifierBarredByType(m, { actionType: d.actionType, effect: d.effect }));
  // Waypoint is Gate only.
  const hasSecondary = mods.includes("secondaryEffect")
    && d.secondaryEffect && d.secondaryEffect !== "companion" && d.secondaryEffect !== "animate";
  const effects = [d.effect, ...(hasSecondary ? [d.secondaryEffect] : [])];
  if (!effects.includes("gate")) mods = mods.filter((m) => m !== "waypoint");

  const actionType = d.effect === "companion" ? "passive" : d.actionType;

  // Target: an Aura — or a self-centered Burst — keeps a real audience; a non-area
  // Self-Range Technique lands on you.
  const valid = d.target in cfg.skillTargets;
  const selfArea = isSelfCenteredArea({ range: d.range, modifiers: mods });
  const target = mods.includes("aura")
    ? (valid && d.target !== "self" ? d.target : "ally")
    : selfArea
      ? (valid && d.target !== "self" ? d.target : "any")
      : d.range.scope === "self" ? "self" : (valid ? d.target : "any");

  // Which Effect owns the Attribute picks (primary wins).
  const attrEffect = ATTR_EFFECTS.find((e) => effects.includes(e));
  const effectAttrs = attrEffect
    ? (d.effectAttrs ?? []).filter((k) => k in cfg.attributes).slice(0, effectAttrCount(attrEffect))
    : [];

  return {
    description: d.description ?? "",
    actionType,
    passiveMode: d.passiveMode === "standing" ? "standing" : "sustained",
    trigger: actionType === "react" ? d.trigger : "",
    talentId: d.talentId ?? "",
    attributes: { attrA: d.attrA, attrB: d.attrB },
    range: { scope: d.range.scope, tiles: Math.max(0, Math.round(Number(d.range.tiles) || 0)) },
    effect: d.effect,
    secondaryEffect: hasSecondary ? d.secondaryEffect : "",
    target,
    // A Duration Modifier (Channeled / Scene) wins; otherwise the intrinsic choice.
    duration: mods.includes("channeled") ? "channeled"
      : mods.includes("scene") ? "scene"
      : (d.duration === "instant" ? "instant" : "standard"),
    effectDuration: d.effectDuration ?? null,
    // Control's element is kept while either Effect slot holds Control.
    controlElement: effects.includes("elementalControl") ? (d.controlElement ?? "").trim() : "",
    effectAttrs,
    damagePool: d.damagePool === "energy" ? "energy" : "hp",
    secondaryDamagePool: d.secondaryDamagePool === "energy" ? "energy" : "hp",
    modifiers: mods,
    potentCount: mods.includes("potent") ? Math.clamp(Math.round(Number(d.potentCount) || 1), 1, 2) : 1,
    potentPool: mods.includes("potent") && ["hp", "energy"].includes(d.potentPool) ? d.potentPool : "",
    keenCount: mods.includes("keen") ? Math.clamp(Math.round(Number(d.keenCount) || 1), 1, 2) : 1,
    customModifierHeavy: mods.includes("custom") ? !!d.customModifierHeavy : false,
    inflictStatus: mods.includes("inflict") && (cfg.inflictStatuses ?? []).includes(d.inflictStatus) ? d.inflictStatus : "",
    inflictSevereStatus: mods.includes("inflictSevere") && (cfg.inflictSevereStatuses ?? []).includes(d.inflictSevereStatus) ? d.inflictSevereStatus : "",
    inflictPool: d.inflictPool === "energy" ? "energy" : "hp",
    drainPool: d.drainPool === "energy" ? "energy" : "hp",
    analyzeCategory: d.analyzeCategory in cfg.analyzeCategories ? d.analyzeCategory : "vitals",
    manifestSkillId: mods.includes("manifest") ? (d.manifestSkillId ?? "") : "",
    companionHome: d.effect === "companion" ? !!d.companionHome : false,
    usesPerConflict: Math.max(0, Math.round(Number(d.usesPerConflict) || 0))
  };
}
