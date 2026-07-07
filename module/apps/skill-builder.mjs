/**
 * Project: Anime — in-game Technique Builder (rules doc Version 2).
 *
 * A standalone ApplicationV2 opened from a character's Techniques drawer. Two modes:
 *   • hub   — the character's Techniques (each with an "Effects" button into the no-code
 *             Effect Builder) and a "Build New Technique" button.
 *   • build — a 5-step wizard (Concept → Roll & Effect → Range & Duration → Modifiers →
 *             Review) that assembles a V2 Technique. Building is FREE here — the
 *             Advancement dialog owns the "Create a Technique" slot ledger, and Energy
 *             is paid at use time (or locked, for a Passive). The Builder just builds.
 *
 * Mirrors the EffectBuilder working-copy pattern (the build draft survives interactive
 * re-renders; key selects re-render to reveal dependent fields) and registers in
 * `actor.apps` for live refresh.
 *
 * It can also bind to a STANDALONE Technique item (world/compendium — no actor) via
 * `openForItem`: the wizard opens straight on the item and Save/Cancel closes the window.
 * Creating a Technique from the sidebar lands here.
 */
import { enhanceSelects } from "../helpers/select.mjs";
import {
  rangeLabel, rangeHasTiles, techniqueEnergyCost, modifierCost, modifierTakes,
  modifierBarredByType, effectAttrCount, effectCost, isSelfCenteredArea, modifierValue,
  actorTalents
} from "../helpers/config.mjs";
import { EffectBuilder } from "./effect-builder.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** The build-wizard steps, in order. "roll" is the combined Roll & Effect step (the Talent —
 *  or two-Attribute fallback — plus the Effect and its creation-time picks). */
const STEPS = ["concept", "roll", "range", "modifiers", "review"];

/** Sensible Target starting points per Effect — applied when the Effect CHANGES (the player
 *  re-picks freely afterwards via the free Target Modifiers). */
const EFFECT_TARGET_DEFAULTS = {
  strike: "foe", hinder: "foe", steal: "foe", illusion: "foe",
  bolster: "ally", mend: "ally",
  transform: "self", vanish: "self", conjure: "self", companion: "self"
};

/** The Effects whose creation-time pick is "which Attributes change". */
const ATTR_EFFECTS = ["bolster", "hinder", "transform"];

/** Default image for a freshly-built Technique. */
const DEFAULT_SKILL_IMG = "icons/svg/upgrade.svg";

export class SkillBuilderApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor, options = {}) {
    const item = options.standaloneItem ?? null;
    // The standalone id keys on the uuid (dash-safe) — a world and a compendium Technique can share ids.
    super({ ...options, id: item ? `pa-skill-builder-item-${item.uuid.replaceAll(".", "-")}` : `pa-skill-builder-${actor.id}` });
    this.actor = actor;
    /** Standalone (world/compendium) Technique this wizard edits directly — null when actor-bound. */
    this.item = item;
    if (item) this.#beginEditItem();
    // The Character Creator opens this straight into the build wizard.
    else if (options.startMode === "build") this.#beginBuild();
  }

  /** Open the Technique Builder for `actor`, reusing an already-open window. With `skillId`,
   *  jump straight into editing that Technique in the full wizard, pre-loaded with its choices. */
  static open(actor, { skillId = null } = {}) {
    const existing = foundry.applications.instances.get(`pa-skill-builder-${actor.id}`);
    const app = existing ?? new SkillBuilderApp(actor);
    if (skillId) app.#beginEdit(skillId);
    if (existing) { app.render(); app.bringToFront(); }
    else app.render(true);
    return app;
  }

  /** Open the Builder on a standalone (world/compendium) Technique item — no actor; the wizard
   *  IS the window: it opens on the item's current choices and Save/Cancel closes. */
  static openForItem(item) {
    const existing = foundry.applications.instances.get(`pa-skill-builder-item-${item.uuid.replaceAll(".", "-")}`);
    if (existing) { existing.render(); existing.bringToFront(); return existing; }
    const app = new SkillBuilderApp(null, { standaloneItem: item });
    app.render(true);
    return app;
  }

  static DEFAULT_OPTIONS = {
    classes: ["project-anime", "skill-builder-app"],
    tag: "form",
    position: { width: 560, height: "auto" },
    window: { title: "PROJECTANIME.SkillBuilder.title", icon: "fa-solid fa-wand-sparkles" },
    // No real submit — navigation and commits are driven by the actions below.
    form: { handler: SkillBuilderApp.#onFormSubmit, submitOnChange: false, closeOnSubmit: false },
    actions: {
      buildNew: SkillBuilderApp.#onBuildNew,
      editEffects: SkillBuilderApp.#onEditEffects,
      backToHub: SkillBuilderApp.#onBackToHub,
      gotoStep: SkillBuilderApp.#onGotoStep,
      stepBack: SkillBuilderApp.#onStepBack,
      stepNext: SkillBuilderApp.#onStepNext,
      toggleModifier: SkillBuilderApp.#onToggleModifier,
      toggleCustomHeavy: SkillBuilderApp.#onToggleCustomHeavy,
      addModifierTake: SkillBuilderApp.#onAddModifierTake,
      removeModifierTake: SkillBuilderApp.#onRemoveModifierTake,
      pickImage: SkillBuilderApp.#onPickImage,
      finishBuild: SkillBuilderApp.#onFinishBuild
    }
  };

  static PARTS = {
    body: { template: "systems/project-anime/templates/apps/skill-builder.hbs", scrollable: [""] }
  };

  /** "hub" | "build". */
  #mode = "hub";
  /** Current build-wizard step index. */
  #step = 0;
  /** Working copy of the Technique being built (build mode). */
  #draft = null;
  /** Id of the Technique being edited in the wizard (null = building a new one). */
  #editId = null;

  get title() {
    return `${game.i18n.localize("PROJECTANIME.SkillBuilder.title")} — ${(this.actor ?? this.item).name}`;
  }

  /** A fresh build draft seeded from the Technique model defaults. */
  #blankDraft() {
    return {
      name: game.i18n.localize("PROJECTANIME.SkillBuilder.newSkillName"),
      img: DEFAULT_SKILL_IMG,
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
      customModifierHeavy: false,
      inflictStatus: "",
      inflictSevereStatus: "",
      inflictPool: "hp",
      drainPool: "hp",
      analyzeCategory: "vitals",
      // Companion: the 2-box lock lifts while it's left home.
      companionHome: false,
      // GM knob (edited on the item sheet, carried through rebuilds).
      usesPerConflict: 0
    };
  }

  /** Enter the build wizard for a brand-new Technique. */
  #beginBuild() {
    this.#mode = "build";
    this.#editId = null;
    this.#step = 0;
    this.#draft = this.#blankDraft();
  }

  /** Enter the wizard to edit an existing Technique: same steps, pre-loaded, commits back to it. */
  #beginEdit(id) {
    const item = this.actor.items.get(id);
    if (!item || item.type !== "skill") return;
    this.#mode = "build";
    this.#editId = id;
    this.#step = 0;
    this.#draft = this.#draftFromSkill(item);
  }

  /** Enter the wizard on the bound standalone item — its current values are the draft. */
  #beginEditItem() {
    this.#mode = "build";
    this.#editId = this.item.id;
    this.#step = 0;
    this.#draft = this.#draftFromSkill(this.item);
    // A freshly-created sidebar Item wears the core default icon — start the draft on the
    // Builder's Technique default instead, like every actor-built one.
    if (this.#draft.img === foundry.documents.BaseItem.DEFAULT_ICON) this.#draft.img = DEFAULT_SKILL_IMG;
  }

  /** A build draft seeded from an existing Technique — the inverse of the commit write. */
  #draftFromSkill(item) {
    const s = item.system ?? {};
    return {
      name: item.name,
      img: item.img,
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
      damagePool: s.damagePool ?? "hp",
      secondaryDamagePool: s.secondaryDamagePool ?? "hp",
      // The legacy "none" marker means "no Modifiers" — the V2 list simply starts empty.
      modifiers: (s.modifiers ?? []).filter((m) => m !== "none"),
      potentCount: Math.clamp(Math.round(Number(s.potentCount) || 1), 1, 2),
      customModifierHeavy: !!s.customModifierHeavy,
      inflictStatus: s.inflictStatus ?? "",
      inflictSevereStatus: s.inflictSevereStatus ?? "",
      inflictPool: s.inflictPool ?? "hp",
      drainPool: s.drainPool ?? "hp",
      analyzeCategory: s.analyzeCategory ?? "vitals",
      companionHome: !!s.companionHome,
      usesPerConflict: Number(s.usesPerConflict) || 0
    };
  }

  /** Effects this actor may not take at all: a raised Servant or bonded Companion (flagged by
   *  helpers/servants.mjs) can never carry the Companion Effect (or legacy Animate). */
  static barredEffects(actor) {
    const flags = actor?.flags?.["project-anime"] ?? {};
    return (flags.servantOf || flags.companionOf) ? ["animate", "companion"] : [];
  }

  /** The actor's embedded Talents (the roll-step picker). */
  #talents() {
    return actorTalents(this.actor);
  }

  /** The draft assembled into a V2 system shape — the single source the live cost readout,
   *  the Modifier scaling hints, and the commit all read. */
  #assembleSystem() {
    const cfg = CONFIG.PROJECTANIME;
    const d = this.#draft;
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
      customModifierHeavy: mods.includes("custom") ? !!d.customModifierHeavy : false,
      inflictStatus: mods.includes("inflict") && (cfg.inflictStatuses ?? []).includes(d.inflictStatus) ? d.inflictStatus : "",
      inflictSevereStatus: mods.includes("inflictSevere") && (cfg.inflictSevereStatuses ?? []).includes(d.inflictSevereStatus) ? d.inflictSevereStatus : "",
      inflictPool: d.inflictPool === "energy" ? "energy" : "hp",
      drainPool: d.drainPool === "energy" ? "energy" : "hp",
      analyzeCategory: d.analyzeCategory in cfg.analyzeCategories ? d.analyzeCategory : "vitals",
      companionHome: d.effect === "companion" ? !!d.companionHome : false,
      usesPerConflict: Math.max(0, Math.round(Number(d.usesPerConflict) || 0))
    };
  }

  /** An item-shaped wrapper for the config scaling helpers (modifierValue / techniqueDie). */
  #scaleProxy(system) {
    return { actor: this.actor, system };
  }

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext() {
    const ctx = { config: CONFIG.PROJECTANIME };
    ctx.isStandalone = !this.actor;
    ctx.isHub = this.#mode === "hub";
    ctx.isBuild = this.#mode === "build";
    if (ctx.isHub) this.#prepareHub(ctx);
    else if (ctx.isBuild) this.#prepareBuild(ctx);
    return ctx;
  }

  #prepareHub(ctx) {
    const cfg = CONFIG.PROJECTANIME;
    const skills = this.actor.items
      .filter((i) => i.type === "skill")
      .sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name));
    ctx.skills = skills.map((i) => {
      const s = i.system;
      const passive = s.actionType === "passive" || s.effect === "companion";
      return {
        id: i.id,
        name: i.name,
        img: i.img,
        actionLabel: game.i18n.localize(cfg.actionTypes[s.actionType] ?? ""),
        effectLabel: game.i18n.localize(cfg.skillEffects[s.effect] ?? ""),
        energyCost: s.energyCost ?? 0,
        passive,
        lock: s.passiveEnergyTax ?? 0
      };
    });
  }

  #prepareBuild(ctx) {
    const cfg = CONFIG.PROJECTANIME;
    const d = this.#draft;
    const stepKey = STEPS[this.#step];
    const sysShape = this.#assembleSystem();
    const proxy = this.#scaleProxy(sysShape);

    ctx.draft = d;
    ctx.steps = STEPS.map((k, i) => ({
      key: k,
      num: i + 1,
      label: game.i18n.localize(`PROJECTANIME.SkillBuilder.step.${k}`),
      index: i,
      active: i === this.#step,
      done: i < this.#step
    }));
    ctx.stepLabel = game.i18n.format("PROJECTANIME.SkillBuilder.stepOf", { n: this.#step + 1, total: STEPS.length });
    ctx.stepTitle = game.i18n.localize(`PROJECTANIME.SkillBuilder.step.${stepKey}`);
    ctx.isFirst = this.#step === 0;
    ctx.isLast = this.#step === STEPS.length - 1;
    ctx.onConcept = stepKey === "concept";
    ctx.onRoll = stepKey === "roll";
    ctx.onRange = stepKey === "range";
    ctx.onModifiers = stepKey === "modifiers";
    ctx.onReview = stepKey === "review";

    const isCompanion = d.effect === "companion";
    // ---- Concept ----
    ctx.actionTypeChoices = cfg.actionTypes;
    ctx.actionTypeLocked = isCompanion;   // Companion is always Passive
    ctx.isReact = !isCompanion && d.actionType === "react";
    ctx.isPassive = isCompanion || d.actionType === "passive";
    // Companion doesn't pick a Passive mode — its rules are its own.
    ctx.showPassiveMode = ctx.isPassive && !isCompanion;
    ctx.passiveModeChoices = cfg.passiveModes;
    ctx.triggerChoices = cfg.triggers;

    // ---- Roll & Effect ----
    const talents = this.#talents();
    ctx.hasTalents = talents.length > 0;
    const talent = talents.find((t) => t.id === d.talentId) ?? null;
    ctx.talentChoices = Object.fromEntries(talents.map((t) => [
      t.id,
      `${t.name} · d${t.die} ${game.i18n.localize(cfg.attributes[t.attribute] ?? "")}`
    ]));
    ctx.hasTalentSelected = !!talent;
    // The live roll: Talent die + its Primary Attribute die + 1, or the two-Attribute fallback.
    if (talent) {
      const attrDie = Number(this.actor?.system?.attributes?.[talent.attribute]?.value) || 0;
      const attrName = game.i18n.localize(cfg.attributes[talent.attribute] ?? talent.attribute);
      ctx.rollLine = `${talent.name} d${talent.die} + ${attrName}${attrDie ? ` d${attrDie}` : ""} + 1`;
    }
    ctx.attributeChoices = cfg.attributes;

    // Effects list: the V2 printing minus retired entries (unless one IS the current selection);
    // a raised Servant / bonded Companion can never take the Companion Effect.
    const servantBarred = SkillBuilderApp.barredEffects(this.actor);
    const retired = cfg.retiredEffects ?? [];
    const effectOption = (k, label, current) => ({
      key: k,
      label: effectCost(k) ? `${game.i18n.localize(label)} · ${effectCost(k)}` : game.i18n.localize(label),
      selected: k === current
    });
    ctx.effectChoices = Object.entries(cfg.skillEffects)
      .filter(([k]) => !servantBarred.includes(k) && (!retired.includes(k) || k === d.effect))
      .map(([k, label]) => effectOption(k, label, d.effect));
    ctx.effectDesc = game.i18n.localize(`PROJECTANIME.Skill.effectDesc.${d.effect}`);
    ctx.showControlElement = d.effect === "elementalControl";
    ctx.showDamagePool = (cfg.poolEffects ?? []).includes(d.effect);
    ctx.poolLabel = "PROJECTANIME.Skill.field.healPool";
    ctx.damagePoolChoices = cfg.damagePools;
    ctx.isCompanion = isCompanion;
    ctx.isAttrEffect = ATTR_EFFECTS.includes(d.effect);
    ctx.isHinder = d.effect === "hinder";
    if (ctx.isAttrEffect) {
      const attrSeed = d.effectAttrs ?? [];
      ctx.effectAttrPickers = Array.from({ length: effectAttrCount(d.effect) }, (_, i) => ({ index: i, value: attrSeed[i] ?? "" }));
    }
    ctx.showEffectExtras = ctx.showControlElement || ctx.showDamagePool;

    // ---- Range & Duration ----
    ctx.rangeChoices = cfg.ranges;
    ctx.rangeHasTiles = rangeHasTiles(d.range.scope);
    // The Strike damage-mode note (rules: Technique Damage).
    ctx.strikeNote = sysShape.effect === "strike" || sysShape.secondaryEffect === "strike";
    ctx.durationChoices = { instant: cfg.skillDurations.instant, standard: cfg.skillDurations.standard };
    ctx.durationLocked = d.modifiers.includes("channeled") ? game.i18n.localize(cfg.skillDurations.channeled)
      : d.modifiers.includes("scene") ? game.i18n.localize(cfg.skillDurations.scene)
      : (cfg.sceneEffects ?? []).includes(d.effect) ? game.i18n.localize(cfg.skillDurations.scene) : "";
    ctx.showDurationTurns = !ctx.durationLocked && d.duration !== "instant";

    // ---- Modifiers ----
    const noMods = (cfg.noModifierEffects ?? []).includes(d.effect);
    const auraOn = d.modifiers.includes("aura");
    const selfArea = isSelfCenteredArea({ range: d.range, modifiers: d.modifiers });
    ctx.targetChoices = (auraOn || selfArea)
      ? Object.fromEntries(Object.entries(cfg.skillTargets).filter(([k]) => k !== "self"))
      : cfg.skillTargets;
    ctx.targetLocked = !auraOn && !selfArea && d.range.scope === "self";
    ctx.liveEnergy = techniqueEnergyCost(sysShape);
    ctx.isPassiveCost = sysShape.actionType === "passive" || isCompanion;

    const gateBuilt = sysShape.effect === "gate" || sysShape.secondaryEffect === "gate";
    const conditionLabel = (id) => {
      const c = (cfg.statusConditions ?? []).find((x) => x.id === id);
      return c ? game.i18n.localize(c.name) : id;
    };
    ctx.inflictChoices = Object.fromEntries((cfg.inflictStatuses ?? []).map((id) => [id, conditionLabel(id)]));
    ctx.inflictSevereChoices = Object.fromEntries((cfg.inflictSevereStatuses ?? []).map((id) => [id, conditionLabel(id)]));
    ctx.inflictSevereHasPool = d.modifiers.includes("inflictSevere") && (cfg.poolChoiceStatuses ?? []).includes(d.inflictSevereStatus);
    ctx.analyzeChoices = Object.fromEntries(Object.entries(cfg.analyzeCategories).map(([k, v]) => [k, game.i18n.localize(v)]));

    const modRow = (key) => {
      const selected = d.modifiers.includes(key);
      const isCustom = key === "custom";
      const isPotent = key === "potent";
      const takes = isPotent ? Math.clamp(Math.round(Number(d.potentCount) || 1), 1, 2) : 1;
      const blocked = !selected && (noMods || modifierBarredByType(key, { actionType: sysShape.actionType, effect: d.effect }));
      // Scaled Modifiers (Aura/Burst/Chain/Move/Reposition) show their live die/2 value.
      const scaled = key in (cfg.scaledModifiers ?? {})
        ? `${modifierValue(proxy, key)} ${game.i18n.localize("PROJECTANIME.Skill.tiles")}` : "";
      return {
        key,
        label: game.i18n.localize(cfg.skillModifiers[key] ?? key),
        desc: game.i18n.localize(`PROJECTANIME.Skill.modifierDesc.${key}`),
        scaled,
        selected,
        blocked,
        isCustom,
        customHeavy: isCustom && !!d.customModifierHeavy,
        isPotent: selected && isPotent,
        potentTakes: takes,
        canTakeAgain: selected && isPotent && takes < 2,
        canDropTake: selected && isPotent && takes > 1,
        showInflict: selected && key === "inflict",
        showInflictSevere: selected && key === "inflictSevere",
        showDrain: selected && key === "drain",
        showAnalyze: selected && key === "analyze",
        hasConfig: selected && ["inflict", "inflictSevere", "drain", "analyze"].includes(key)
      };
    };
    // Grouped by cost tier (rules: Modifiers): Standard +1 · Heavy 🔶 +2 · Extreme +3.
    // Waypoint (Gate only) lists only while a Gate is built (or it's already selected).
    const allKeys = Object.keys(cfg.skillModifiers)
      .filter((k) => !(cfg.freeModifiers ?? []).includes(k))
      .filter((k) => k !== "waypoint" || gateBuilt || d.modifiers.includes("waypoint"));
    const tierOf = (k) => (cfg.extremeModifiers.includes(k) ? "extreme" : cfg.heavyModifiers.includes(k) ? "heavy" : "standard");
    const byLabel = (a, b) => a.label.localeCompare(b.label);
    ctx.modGroups = ["standard", "heavy", "extreme"].map((tier) => ({
      label: game.i18n.localize(`PROJECTANIME.SkillBuilder.modGroup.${tier}`),
      mods: allKeys.filter((k) => tierOf(k) === tier).map(modRow).sort(byLabel)
    })).filter((g) => g.mods.length);

    // "Secondary Effect" Modifier — a second Effect picker (Companion / Animate can't ride along:
    // they take no Modifiers, so they can't BE one).
    const secActive = d.modifiers.includes("secondaryEffect");
    const secEffect = d.secondaryEffect || "strike";
    const noSecondary = ["passive", "animate", "companion"];
    ctx.secondaryEffectChoices = Object.entries(cfg.skillEffects)
      .filter(([k]) => !noSecondary.includes(k) && !servantBarred.includes(k) && (!retired.includes(k) || k === secEffect))
      .map(([k, label]) => effectOption(k, label, secEffect));
    ctx.secondaryActive = secActive;
    ctx.secondaryEffectDesc = game.i18n.localize(`PROJECTANIME.Skill.effectDesc.${secEffect}`);
    ctx.showSecondaryPool = (cfg.poolEffects ?? []).includes(secEffect);
    ctx.showSecondaryControlElement = secEffect === "elementalControl" && !ctx.showControlElement;
    // A secondary Empower/Weaken/Transform picks its Attributes here — only when the primary
    // doesn't already own the picks.
    ctx.secondaryIsAttrEffect = ATTR_EFFECTS.includes(secEffect) && !ctx.isAttrEffect;
    if (ctx.secondaryIsAttrEffect) {
      const attrSeed = d.effectAttrs ?? [];
      ctx.secondaryAttrPickers = Array.from({ length: effectAttrCount(secEffect) }, (_, i) => ({ index: i, value: attrSeed[i] ?? "" }));
    }
    ctx.showSecondaryExtras = ctx.showSecondaryPool || ctx.showSecondaryControlElement || ctx.secondaryIsAttrEffect;
    ctx.secondaryIsHinder = secEffect === "hinder";

    // ---- Review ----
    const durationText = sysShape.duration === "standard"
      ? `${game.i18n.localize(cfg.skillDurations.standard)} · ${d.effectDuration ?? cfg.standardDurationTurns} ${game.i18n.localize("PROJECTANIME.Skill.turns")}`
      : game.i18n.localize(cfg.skillDurations[sysShape.duration] ?? "");
    const passiveBuild = sysShape.actionType === "passive" || isCompanion;
    const lock = passiveBuild && !(isCompanion && sysShape.companionHome) ? ctx.liveEnergy : 0;
    ctx.review = {
      name: (d.name || "").trim() || game.i18n.localize("PROJECTANIME.SkillBuilder.newSkillName"),
      img: d.img,
      actionType: game.i18n.localize(cfg.actionTypes[sysShape.actionType] ?? ""),
      passiveMode: (passiveBuild && !isCompanion) ? game.i18n.localize(cfg.passiveModes[sysShape.passiveMode] ?? "") : "",
      roll: talent ? ctx.rollLine
        : `${game.i18n.localize(cfg.attributes[d.attrA] ?? "")} + ${game.i18n.localize(cfg.attributes[d.attrB] ?? "")}`,
      range: rangeLabel(sysShape.range),
      effect: game.i18n.localize(cfg.skillEffects[sysShape.effect] ?? ""),
      secondaryEffect: sysShape.secondaryEffect ? game.i18n.localize(cfg.skillEffects[sysShape.secondaryEffect] ?? "") : "",
      target: game.i18n.localize(cfg.skillTargets[sysShape.target] ?? ""),
      duration: passiveBuild && sysShape.passiveMode === "standing" ? "" : durationText,
      controlElement: sysShape.controlElement,
      isHinder: ATTR_EFFECTS.find((e) => [sysShape.effect, sysShape.secondaryEffect].includes(e)) === "hinder",
      effectAttrs: sysShape.effectAttrs.map((k) => game.i18n.localize(cfg.attributes[k] ?? "")),
      damagePool: [sysShape.effect, sysShape.secondaryEffect].includes("mend")
        ? game.i18n.localize(cfg.damagePools[sysShape.effect === "mend" ? sysShape.damagePool : sysShape.secondaryDamagePool] ?? "") : "",
      inflict: sysShape.inflictStatus ? conditionLabel(sysShape.inflictStatus) : "",
      inflictSevere: sysShape.inflictSevereStatus
        ? `${conditionLabel(sysShape.inflictSevereStatus)}${(cfg.poolChoiceStatuses ?? []).includes(sysShape.inflictSevereStatus)
          ? ` · ${game.i18n.localize(cfg.damagePools[sysShape.inflictPool] ?? "")}` : ""}` : "",
      drain: sysShape.modifiers.includes("drain") ? game.i18n.localize(cfg.damagePools[sysShape.drainPool] ?? "") : "",
      analyze: sysShape.modifiers.includes("analyze") ? (ctx.analyzeChoices[sysShape.analyzeCategory] ?? "") : "",
      trigger: sysShape.trigger ? game.i18n.localize(cfg.triggers[sysShape.trigger] ?? sysShape.trigger) : "",
      companionHome: isCompanion && sysShape.companionHome,
      modifiers: sysShape.modifiers.map((m) => {
        const takes = modifierTakes(m, sysShape);
        const cost = modifierCost(m, sysShape) * takes;
        const label = game.i18n.localize(cfg.skillModifiers[m] ?? m) + (takes > 1 ? ` ×${takes}` : "");
        return `${label} +${cost}`;
      }),
      energyCost: passiveBuild ? 0 : ctx.liveEnergy,
      passive: passiveBuild,
      lock
    };
    ctx.isEditing = !!this.#editId;
    ctx.finishLabel = game.i18n.localize(this.#editId ? "PROJECTANIME.SkillBuilder.saveChanges" : "PROJECTANIME.SkillBuilder.learn");
  }

  /* -------------------------------------------- */
  /*  Render                                      */
  /* -------------------------------------------- */

  /** @override — live-refresh on actor changes; theme + wire build-mode selects. */
  async _onRender(context, options) {
    await super._onRender(context, options);
    // Standalone mode registers on the item instead — mainly so deleting it closes the wizard.
    (this.actor ?? this.item).apps[this.id] = this;
    if (this.#mode !== "build") return;
    enhanceSelects(this.element);
    // Re-render when a select that drives dependent fields changes (action type reveals the
    // Passive mode / React Trigger; the Talent pick swaps the Attribute pair in and out; the
    // Effect changes its description / picks / Target+Duration defaults; range scope reveals
    // the tile count and can lock Target; the duration choice reveals the round count; a
    // Severe pick of Cursed reveals the pool choice).
    const names = ["actionType", "talentId", "effect", "secondaryEffect", "attrA", "attrB", "rangeScope", "duration", "inflictSevereStatus"];
    for (const sel of this.element.querySelectorAll(names.map((n) => `select[name="${n}"]`).join(", "))) {
      sel.addEventListener("change", () => { this.#sync(); this.render(); });
    }
  }

  _onClose(options) {
    delete (this.actor ?? this.item).apps[this.id];
    super._onClose?.(options);
  }

  /** Pull the current step's form fields into the build draft (merge, don't replace —
   *  only fields rendered on this step are present, so earlier steps survive). */
  #sync() {
    if (this.#mode !== "build" || !this.element) return;
    const cfg = CONFIG.PROJECTANIME;
    const data = new foundry.applications.ux.FormDataExtended(this.element).object;
    const d = this.#draft;
    if (typeof data.name === "string") d.name = data.name;
    if (typeof data.description === "string") d.description = data.description;
    if (data.actionType) d.actionType = data.actionType;
    if (data.passiveMode) d.passiveMode = data.passiveMode === "standing" ? "standing" : "sustained";
    if ("trigger" in data) d.trigger = data.trigger ?? "";
    // The Talent pick — validated against the actor's embedded Talents ("" = the Attribute pair).
    if ("talentId" in data) {
      d.talentId = this.actor?.system?.talents?.[data.talentId ?? ""] ? data.talentId : "";
    }
    // The fallback pair must be two DIFFERENT Attributes — changing one to collide shifts the other.
    if (data.attrA && data.attrB) {
      const aChanged = data.attrA !== d.attrA;
      d.attrA = data.attrA;
      d.attrB = data.attrB;
      if (d.attrA === d.attrB) {
        const keys = cfg.attributeKeys;
        if (aChanged) d.attrB = keys[(keys.indexOf(d.attrA) + 1) % keys.length];
        else d.attrA = keys[(keys.indexOf(d.attrB) + 1) % keys.length];
      }
    }
    if (data.rangeScope) {
      const scopeChanged = data.rangeScope !== d.range.scope;
      d.range.scope = data.rangeScope;
      // Switching scope resets tiles to the new scope's default (the tiles input in the DOM
      // is now stale); otherwise read the tiles field if shown.
      if (scopeChanged) d.range.tiles = cfg.rangeTiles[data.rangeScope] ?? 1;
      else if (data.rangeTiles !== undefined && data.rangeTiles !== "") d.range.tiles = Math.max(0, Math.round(Number(data.rangeTiles) || 0));
    }
    let effectChanged = false;
    if (data.effect) {
      effectChanged = data.effect !== d.effect;
      d.effect = data.effect;
      if (effectChanged) {
        // A new Effect re-seeds Target + Duration: printed-Duration Effects open on Standard.
        d.target = EFFECT_TARGET_DEFAULTS[d.effect] ?? "any";
        d.duration = (cfg.durationEffects ?? []).includes(d.effect) ? "standard" : "instant";
        d.effectDuration = null;
        // An inherent-range Effect (Sense — 5 tiles) seeds its natural reach.
        const inh = cfg.inherentRangeTiles ?? {};
        if (d.effect in inh) d.range = { scope: "tiles", tiles: inh[d.effect] };
      }
    }
    if (!effectChanged) {
      if (data.target) d.target = data.target;
      if (data.duration) d.duration = data.duration === "instant" ? "instant" : "standard";
    }
    if ("controlElement" in data) d.controlElement = data.controlElement ?? "";
    if (data.damagePool) d.damagePool = data.damagePool;
    if (data.secondaryDamagePool) d.secondaryDamagePool = data.secondaryDamagePool;
    // Empower/Weaken/Transform Attribute slots (effectAttr0..N) → effectAttrs.
    if ("effectAttr0" in data) {
      const owner = ATTR_EFFECTS.includes(d.effect) ? d.effect : d.secondaryEffect;
      const arr = [];
      for (let i = 0; i < effectAttrCount(owner); i++) { const v = data[`effectAttr${i}`]; if (v) arr.push(v); }
      d.effectAttrs = arr;
    }
    if ("effectDuration" in data) {
      const n = Math.round(Number(data.effectDuration));
      d.effectDuration = Number.isFinite(n) && n >= 1 ? n : null; // blank/invalid → the printed default (2)
    }
    if (data.secondaryEffect) d.secondaryEffect = data.secondaryEffect;
    if ("inflictStatus" in data) d.inflictStatus = data.inflictStatus ?? "";
    if ("inflictSevereStatus" in data) d.inflictSevereStatus = data.inflictSevereStatus ?? "";
    if (data.inflictPool) d.inflictPool = data.inflictPool;
    if (data.drainPool) d.drainPool = data.drainPool;
    if (data.analyzeCategory) d.analyzeCategory = data.analyzeCategory;
    if ("companionHome" in data) d.companionHome = !!data.companionHome;

    // ---- Normalize (V2) ----
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
    // Potent's take count only means something while Potent is on.
    if (!d.modifiers.includes("potent")) d.potentCount = 1;
  }

  /* -------------------------------------------- */
  /*  Mode / navigation actions                   */
  /* -------------------------------------------- */

  static #onFormSubmit() { /* navigation & commits are handled via the action buttons */ }

  static #onBuildNew() {
    this.#beginBuild();
    this.render();
  }

  /**
   * Open the no-code Effect Builder for a Technique so its mechanics (attribute steps,
   * condition riders, …) can be authored without leaving the Builder. Opens the Technique's
   * first Active Effect, creating a transferring one if it has none. Reached from the hub's
   * rows (actor mode) and the wizard nav (standalone mode).
   */
  static async #onEditEffects(event, target) {
    const id = target.closest("[data-skill-id]")?.dataset.skillId;
    const item = this.item ?? this.actor.items.get(id);
    if (!item) return;
    let effect = item.effects.find((e) => !e.disabled) ?? item.effects.contents[0];
    if (!effect) {
      [effect] = await item.createEmbeddedDocuments("ActiveEffect", [{
        name: game.i18n.localize("PROJECTANIME.Effect.newEffect"),
        img: "icons/svg/aura.svg",
        transfer: true,
        disabled: false
      }]);
    }
    if (!effect) return;
    const existing = foundry.applications.instances.get(`pa-effect-builder-${effect.id}`);
    if (existing) return existing.bringToFront();
    new EffectBuilder(effect).render(true);
  }

  static #onBackToHub() {
    // A standalone item's wizard has no hub behind it — Cancel just closes.
    if (this.item) return this.close();
    this.#mode = "hub";
    this.#draft = null;
    this.#editId = null;
    this.render();
  }

  static #onGotoStep(event, target) {
    this.#sync();
    const i = Number(target.dataset.step);
    if (i >= 0 && i < STEPS.length) this.#step = i;
    this.render();
  }

  static #onStepBack() {
    this.#sync();
    if (this.#step > 0) this.#step -= 1;
    this.render();
  }

  static #onStepNext() {
    this.#sync();
    if (!this.#validateStep()) return;
    if (this.#step < STEPS.length - 1) this.#step += 1;
    this.render();
  }

  /** Block leaving a step that isn't valid yet (a React Technique needs a Trigger; a
   *  Servant/Companion can't take the Companion Effect). */
  #validateStep() {
    const d = this.#draft;
    if (STEPS[this.#step] === "concept" && d.actionType === "react" && !d.trigger) {
      ui.notifications.warn(game.i18n.localize("PROJECTANIME.Skill.reactNeedsTrigger"));
      return false;
    }
    if (STEPS[this.#step] === "roll" && SkillBuilderApp.barredEffects(this.actor).includes(d.effect)) {
      ui.notifications.warn(game.i18n.localize("PROJECTANIME.SkillBuilder.servantNoEffect"));
      return false;
    }
    return true;
  }

  static #onToggleModifier(event, target) {
    this.#sync();
    const key = target.closest("[data-modifier]")?.dataset.modifier;
    if (!key) return;
    // A row's inline option chips (Custom's Heavy, Potent's takes) and in-row config pickers
    // live inside the row — ignore clicks on them so making a choice never de-selects it.
    if (event.target.closest(".sb-mod-opts, .sb-mod-config")) return;
    const cfg = CONFIG.PROJECTANIME;
    const d = this.#draft;
    const mods = d.modifiers;
    const at = mods.indexOf(key);
    if (at >= 0) {
      mods.splice(at, 1);
      // Dropping a Modifier clears its creation-time picks, so re-adding starts clean.
      if (key === "custom") d.customModifierHeavy = false;
      if (key === "potent") d.potentCount = 1;
      if (key === "inflict") d.inflictStatus = "";
      if (key === "inflictSevere") d.inflictSevereStatus = "";
    } else {
      // Companion (and legacy Animate) take no Modifiers at all.
      if ((cfg.noModifierEffects ?? []).includes(d.effect)) {
        return ui.notifications.warn(game.i18n.localize("PROJECTANIME.SkillBuilder.modIncompatible"));
      }
      // A Passive can't be Channeled; the "None" carrier can't host a Secondary Effect.
      if (modifierBarredByType(key, { actionType: d.effect === "companion" ? "passive" : d.actionType, effect: d.effect })) {
        return ui.notifications.warn(game.i18n.localize("PROJECTANIME.SkillBuilder.passiveNoMod"));
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
    }
    this.render();
  }

  /** Take Potent a second time (rules: "Can be taken twice") — its cost counts per take. */
  static #onAddModifierTake(event, target) {
    this.#sync();
    const d = this.#draft;
    const key = target.closest("[data-modifier]")?.dataset.modifier;
    if (key !== "potent" || !d.modifiers.includes("potent")) return;
    d.potentCount = Math.min(2, (Number(d.potentCount) || 1) + 1);
    this.render();
  }

  /** Drop one Potent take (never the last — un-tick the row for that). */
  static #onRemoveModifierTake(event, target) {
    this.#sync();
    const d = this.#draft;
    const key = target.closest("[data-modifier]")?.dataset.modifier;
    if (key !== "potent") return;
    d.potentCount = Math.max(1, (Number(d.potentCount) || 1) - 1);
    this.render();
  }

  /** Flip the free-form "Custom" Modifier's Heavy flag (its end-of-row chip): +1 ⇄ +2 Energy. */
  static #onToggleCustomHeavy() {
    this.#sync();
    const d = this.#draft;
    if (!d.modifiers.includes("custom")) return;
    d.customModifierHeavy = !d.customModifierHeavy;
    this.render();
  }

  static async #onPickImage() {
    this.#sync();
    const FP = foundry.applications.apps.FilePicker?.implementation
      ?? foundry.applications.apps.FilePicker
      ?? globalThis.FilePicker;
    const fp = new FP({
      type: "image",
      current: this.#draft.img || "",
      callback: (path) => { this.#draft.img = path; this.render(); }
    });
    return fp.browse();
  }

  /** Commit the wizard: create the Technique, or save changes back to the one being edited.
   *  Building is FREE — the Advancement dialog owns the slot ledger, not the Builder. */
  static async #onFinishBuild() {
    this.#sync();
    const d = this.#draft;
    // A React Technique must carry a Trigger (re-check in case steps were jumped).
    if (d.effect !== "companion" && d.actionType === "react" && !d.trigger) {
      this.#step = STEPS.indexOf("concept");
      ui.notifications.warn(game.i18n.localize("PROJECTANIME.Skill.reactNeedsTrigger"));
      return this.render();
    }
    // A raised Servant / bonded Companion can never learn the Companion Effect.
    if (SkillBuilderApp.barredEffects(this.actor).includes(d.effect)) {
      this.#step = STEPS.indexOf("roll");
      ui.notifications.warn(game.i18n.localize("PROJECTANIME.SkillBuilder.servantNoEffect"));
      return this.render();
    }
    const name = (d.name || "").trim() || game.i18n.localize("PROJECTANIME.SkillBuilder.newSkillName");
    const system = this.#assembleSystem();
    if (this.#editId) await this.#commitEdit(name, system);
    else await this.#commitNew(name, system);
  }

  /** Create the Technique on the actor. */
  async #commitNew(name, system) {
    await this.actor.createEmbeddedDocuments("Item", [{
      name, type: "skill", img: this.#draft.img || DEFAULT_SKILL_IMG, system
    }]);
    ui.notifications.info(game.i18n.format("PROJECTANIME.SkillBuilder.learned", { name }));
    this.#mode = "hub";
    this.#draft = null;
    this.#editId = null;
    this.render();
  }

  /** Save the wizard back onto the edited Technique. */
  async #commitEdit(name, system) {
    const item = this.item ?? this.actor.items.get(this.#editId);
    if (!item) { this.#mode = "hub"; this.#draft = null; this.#editId = null; return this.render(); }
    await item.update({ name, img: this.#draft.img || DEFAULT_SKILL_IMG, system });
    ui.notifications.info(game.i18n.format("PROJECTANIME.SkillBuilder.updated", { name }));
    // A standalone item's wizard is its whole window — saving means done.
    if (this.item) return this.close();
    this.#mode = "hub";
    this.#draft = null;
    this.#editId = null;
    this.render();
  }
}
