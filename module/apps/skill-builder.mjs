/**
 * Project: Anime — in-game Skill Builder.
 *
 * A standalone ApplicationV2 opened from a character's Skills drawer. It has three
 * modes:
 *   • hub      — Skill-Point balance, a list of the character's Skills (each with an
 *                "Improve" button), and a "Build New Skill" button.
 *   • build    — a 6-step wizard (Concept → Rank → Roll & Effect → Range & Target → Modifiers →
 *                Review) that creates a new Skill and spends SP = its Rank (the rules'
 *                "Learning a Skill"). Blocks if the character can't afford it.
 *   • advance  — the rules' "Improving Skills": Raise Rank / Sharpen Accuracy / Lower
 *                Energy / Raise Range (each 1 SP) plus Add a Modifier (1 SP, within the
 *                Rank's budget).
 *
 * Mirrors the AdvancementApp pattern (registers in `actor.apps` for live SP refresh)
 * and the EffectBuilder working-copy pattern (the build draft survives interactive
 * re-renders; key selects re-render to reveal dependent fields).
 *
 * It can also bind to a STANDALONE Skill item (world/compendium — no actor) via
 * `openForItem`: the wizard opens straight on the item, Skill Points don't exist there
 * (no charge, no budget gate — SP costs show as info for whoever later learns it), and
 * Save/Cancel closes the window. Creating a Skill from the sidebar lands here.
 */
import { enhanceSelects } from "../helpers/select.mjs";
import { elementChoices } from "../helpers/elements.mjs";
import { rangeLabel, rangeHasTiles, skillNeedsAccuracy, isHeavyModifier, modifiersBudget, modifierTakes, modifierBarredByType, effectAttrCount, effectBaseRank, effectModifierCap, affinityModifierLevels, clampAffinityLevel, skillEvasionKeys, skillEvasionLabel, isSelfCenteredArea } from "../helpers/config.mjs";
import { EffectBuilder } from "./effect-builder.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** The build-wizard steps, in order. "roll" is the combined Roll & Effect step (the attack
 *  Attributes plus the Effect and its options); "range" is the Range & Target step that follows. */
const STEPS = ["concept", "rank", "roll", "range", "modifiers", "review"];

/** Sensible Target / Duration starting points per Effect — applied when the Effect CHANGES (the
 *  player can re-pick freely afterwards). Offensive Effects aim at a Foe; Transform, the Passive
 *  carrier, and the self-shrouding Effects (Vanish / Conjure / Companion) are yours; everything
 *  else stays open. Strikes and one-shot Effects resolve instantly; the lasting ones default to
 *  the Standard 2 turns. */
const EFFECT_TARGET_DEFAULTS = {
  strike: "foe", hinder: "foe", steal: "foe", illusion: "foe",
  transform: "self", passive: "self", vanish: "self", conjure: "self", companion: "self"
};
const EFFECT_DURATION_DEFAULTS = {
  strike: "instant", mend: "instant", custom: "instant",
  steal: "instant", elementalControl: "instant", animate: "instant", companion: "instant"
};

/** Default image for a freshly-built Skill. */
const DEFAULT_SKILL_IMG = "icons/svg/upgrade.svg";

export class SkillBuilderApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor, options = {}) {
    const item = options.standaloneItem ?? null;
    // The standalone id keys on the uuid (dash-safe) — a world and a compendium Skill can share ids.
    super({ ...options, id: item ? `pa-skill-builder-item-${item.uuid.replaceAll(".", "-")}` : `pa-skill-builder-${actor.id}` });
    this.actor = actor;
    /** Standalone (world/compendium) Skill this wizard edits directly — null when actor-bound. */
    this.item = item;
    if (item) this.#beginEditItem();
    // The Character Creator opens this straight into the build wizard.
    else if (options.startMode === "build") this.#beginBuild();
  }

  /** Open the Skill Builder for `actor`, reusing an already-open window. With `skillId`, jump
   *  straight into editing that Skill in the full wizard, pre-loaded with its current choices. */
  static open(actor, { skillId = null } = {}) {
    const existing = foundry.applications.instances.get(`pa-skill-builder-${actor.id}`);
    const app = existing ?? new SkillBuilderApp(actor);
    if (skillId) app.#beginEdit(skillId);
    if (existing) { app.render(); app.bringToFront(); }
    else app.render(true);
    return app;
  }

  /** Open the Skill Builder on a standalone (world/compendium) Skill item — no actor, no SP;
   *  the wizard IS the window: it opens on the item's current choices and Save/Cancel closes. */
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
      improveSkill: SkillBuilderApp.#onImproveSkill,
      editEffects: SkillBuilderApp.#onEditEffects,
      backToHub: SkillBuilderApp.#onBackToHub,
      gotoStep: SkillBuilderApp.#onGotoStep,
      stepBack: SkillBuilderApp.#onStepBack,
      stepNext: SkillBuilderApp.#onStepNext,
      pickRank: SkillBuilderApp.#onPickRank,
      toggleModifier: SkillBuilderApp.#onToggleModifier,
      toggleCustomHeavy: SkillBuilderApp.#onToggleCustomHeavy,
      toggleReequipHeavy: SkillBuilderApp.#onToggleReequipHeavy,
      addModifierTake: SkillBuilderApp.#onAddModifierTake,
      removeModifierTake: SkillBuilderApp.#onRemoveModifierTake,
      pickImage: SkillBuilderApp.#onPickImage,
      finishBuild: SkillBuilderApp.#onFinishBuild,
      raiseRank: SkillBuilderApp.#onRaiseRank,
      raiseRange: SkillBuilderApp.#onRaiseRange,
      lowerEnergy: SkillBuilderApp.#onLowerEnergy,
      sharpenAccuracy: SkillBuilderApp.#onSharpenAccuracy,
      sharpenDamage: SkillBuilderApp.#onSharpenDamage,
      addModifier: SkillBuilderApp.#onAddModifier,
      turnModifier: SkillBuilderApp.#onTurnModifier
    }
  };

  static PARTS = {
    body: { template: "systems/project-anime/templates/apps/skill-builder.hbs", scrollable: [""] }
  };

  /** "hub" | "build" | "advance". */
  #mode = "hub";
  /** Current build-wizard step index. */
  #step = 0;
  /** Working copy of the new Skill being built (build mode). */
  #draft = null;
  /** Id of the Skill being improved (advance mode). */
  #advanceId = null;
  /** Id of the Skill being edited in the build wizard (null = building a new Skill). */
  #editId = null;

  get title() {
    return `${game.i18n.localize("PROJECTANIME.SkillBuilder.title")} — ${(this.actor ?? this.item).name}`;
  }

  /** A fresh build draft seeded from the Skill model defaults. */
  #blankDraft() {
    return {
      name: game.i18n.localize("PROJECTANIME.SkillBuilder.newSkillName"),
      img: DEFAULT_SKILL_IMG,
      description: "",
      actionType: "action",
      rank: 1,
      attrA: "might",
      attrB: "spirit",
      attrC: "",
      damageAttr: "attrA",
      range: { scope: "near", tiles: CONFIG.PROJECTANIME.rangeTiles.near ?? 5 },
      effect: "strike",
      // Target + Duration (rules v0.01) — seeded with Strike's defaults (the blank draft's
      // Effect); switching the Effect re-seeds both (see #sync).
      target: "foe",
      duration: "instant",
      // Skill Evasion — the Attribute the DEFENDER swaps in for Agility ("" = normal Evasion).
      skillEvasion: "",
      damageType: "",
      // Elemental Control's element — free text, untied to the Damage Types.
      controlElement: "",
      damagePool: "hp",
      // Empower/Weaken/Transform targets — which Attributes are raised/lowered; chosen on the
      // Roll & Effect step, independent of the roll Attributes.
      effectAttrs: [],
      hinderStatuses: [],
      effectDuration: null,
      // Inflict Modifier — the chosen Status; Lingering additionally carries an element ("" =
      // untyped); Barrier/Regen carry the protected/restored pool.
      inflictStatus: "",
      decayType: "",
      inflictPool: "hp",
      // Retaliation Modifier — the damage type dealt back to a foe that strikes the target.
      retaliationType: "",
      // Affinity Modifiers — the Element (Rank-gated level) / the Status (always Immune).
      // Affinity Modifier takes — one entry per take (the doc lets both be selected more
      // than once); each take is an Element+level / a Status pick.
      affinityDamages: [],
      affinityStatusIds: [],
      // Analyze / Infuse Modifiers — what a hit reveals; what the weapons are imbued with.
      analyzeCategory: "vitals",
      infuseKind: "element",
      infuseElement: "",
      infuseStatus: "",
      secondaryEffect: "strike",
      secondaryDamageAttr: "attrA",
      secondaryDamagePool: "hp",
      secondaryDamageType: "",
      trigger: "",
      modifiers: [],
      customModifierHeavy: false,
      reequipHeavy: false
    };
  }

  /** Enter the build wizard for a brand-new Skill. */
  #beginBuild() {
    this.#mode = "build";
    this.#editId = null;
    this.#step = 0;
    this.#draft = this.#blankDraft();
  }

  /** Enter the wizard to edit an existing Skill: same steps, pre-loaded, commits back to it. */
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
    // Builder's Skill default instead, like every actor-built Skill.
    if (this.#draft.img === foundry.documents.BaseItem.DEFAULT_ICON) this.#draft.img = DEFAULT_SKILL_IMG;
  }

  /** A build draft seeded from an existing Skill — the inverse of #onFinishBuild's write. */
  #draftFromSkill(item) {
    const s = item.system ?? {};
    return {
      name: item.name,
      img: item.img,
      description: s.description ?? "",
      actionType: s.actionType ?? "action",
      rank: s.rank ?? 1,
      attrA: s.attributes?.attrA ?? "might",
      attrB: s.attributes?.attrB ?? "spirit",
      attrC: s.attributes?.attrC ?? "",
      damageAttr: s.damageAttr ?? "attrA",
      range: { scope: s.range?.scope ?? "near", tiles: s.range?.tiles ?? 0 },
      effect: s.effect ?? "strike",
      target: s.target ?? "any",
      // The draft holds only the INTRINSIC duration (Instant/Standard); Channeled/Scene live on
      // the modifier list. A grandfathered Scene skill (no modifier) re-seeds as Standard — the
      // full re-edit re-justifies the Scene slot, like every other rebuild reset.
      duration: s.duration === "instant" ? "instant" : "standard",
      skillEvasion: s.skillEvasion ?? "",
      damageType: s.damageType ?? "",
      controlElement: s.controlElement ?? "",
      damagePool: s.damagePool ?? "hp",
      effectAttrs: [...(s.effectAttrs ?? [])],
      hinderStatuses: [...(s.hinderStatuses ?? [])],
      effectDuration: s.effectDuration ?? null,
      inflictStatus: s.inflictStatus ?? "",
      decayType: s.decayType ?? "",
      inflictPool: s.inflictPool ?? "hp",
      retaliationType: s.retaliationType ?? "",
      affinityDamages: (s.affinityDamages ?? []).map((t) => ({ type: t?.type ?? "", level: t?.level ?? "resist" })),
      affinityStatusIds: [...(s.affinityStatusIds ?? [])],
      analyzeCategory: s.analyzeCategory ?? "vitals",
      infuseKind: s.infuseKind ?? "element",
      infuseElement: s.infuseElement ?? "",
      infuseStatus: s.infuseStatus ?? "",
      // Secondary Effect defaults to a real Effect (only used while its Modifier is selected).
      secondaryEffect: s.secondaryEffect || "strike",
      secondaryDamageAttr: s.secondaryDamageAttr ?? "attrA",
      secondaryDamagePool: s.secondaryDamagePool ?? "hp",
      secondaryDamageType: s.secondaryDamageType ?? "",
      trigger: s.trigger ?? "",
      modifiers: [...(s.modifiers ?? [])],
      customModifierHeavy: !!s.customModifierHeavy,
      reequipHeavy: !!s.reequipHeavy
    };
  }

  /** Effects this actor may not take at all: a raised Servant or bonded Companion (flagged by
   *  helpers/servants.mjs) can never carry Animate or Companion (rules v0.01). [] otherwise. */
  static barredEffects(actor) {
    const flags = actor?.flags?.["project-anime"] ?? {};
    return (flags.servantOf || flags.companionOf) ? ["animate", "companion"] : [];
  }

  /** Total SP logged against a Skill (its base "skill" entry plus any "improve" entries). */
  #loggedFor(id) {
    const log = this.actor?.system.skillPoints?.log ?? [];
    return log.filter((e) => e.ref === id).reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  }

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext() {
    const cfg = CONFIG.PROJECTANIME;
    const sp = this.actor?.system.skillPoints?.value ?? 0;
    const ctx = { sp, config: cfg };
    // Standalone-item mode: no actor, so no SP economy anywhere in the UI.
    ctx.isStandalone = !this.actor;

    // An advance target that vanished (deleted skill) falls back to the hub.
    if (this.#mode === "advance" && !this.#advanceSkill()) this.#mode = "hub";

    ctx.isHub = this.#mode === "hub";
    ctx.isBuild = this.#mode === "build";
    ctx.isAdvance = this.#mode === "advance";

    if (ctx.isHub) this.#prepareHub(ctx);
    else if (ctx.isBuild) this.#prepareBuild(ctx, sp);
    else if (ctx.isAdvance) this.#prepareAdvance(ctx, sp);
    return ctx;
  }

  #prepareHub(ctx) {
    const cfg = CONFIG.PROJECTANIME;
    const skills = this.actor.items
      .filter((i) => i.type === "skill")
      .sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name));
    ctx.skills = skills.map((i) => ({
      id: i.id,
      name: i.name,
      img: i.img,
      stars: cfg.skillRanks[i.system.rank]?.stars ?? "",
      actionLabel: game.i18n.localize(cfg.actionTypes[i.system.actionType] ?? ""),
      energyCost: i.system.energyCost ?? 0,
      passive: i.system.actionType === "passive"
    }));
  }

  #prepareBuild(ctx, sp) {
    const cfg = CONFIG.PROJECTANIME;
    const d = this.#draft;
    const stepKey = STEPS[this.#step];
    // When editing, the SP already spent on this Skill is returned before its new Rank cost is
    // charged, so it counts toward the budget (and the cost shown is the net change). A PC reads
    // that from the ledger; an NPC (no ledger) credits the Skill's current Rank cost — mirroring
    // #commitEdit. A standalone item has no SP economy — every Rank is open (costs show as info only).
    const editItem = this.#editId ? this.actor?.items.get(this.#editId) : null;
    const editedLogged = !this.#editId ? 0
      : Array.isArray(this.actor?.system.skillPoints?.log) ? this.#loggedFor(this.#editId)
        : (Number(editItem?.system.spCost) || 0);
    const budget = this.item ? Infinity : sp + editedLogged;

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
    ctx.onRank = stepKey === "rank";
    ctx.onRoll = stepKey === "roll";      // Roll & Effect (Attributes + the Effect and its options)
    ctx.onRange = stepKey === "range";    // Range & Target
    ctx.onModifiers = stepKey === "modifiers";
    ctx.onReview = stepKey === "review";

    ctx.actionTypeChoices = cfg.actionTypes;
    ctx.attributeChoices = cfg.attributes;
    ctx.rangeChoices = cfg.ranges;
    ctx.triggerChoices = cfg.triggers;
    // Effects gate by Base Rank (rules v0.01: the minimum Rank a Skill must be to take the
    // Effect) — the pickers list the WHOLE catalog, greying out what the chosen Rank can't take
    // yet; over-rank entries wear the Rank they need (· ★★). The CURRENT selection stays pickable
    // even when over (editing a grandfathered skill) — step-next/commit re-validate and walk the
    // player back. A raised Servant / bonded Companion can never take Animate or Companion
    // (rules v0.01) — those vanish from its pickers entirely.
    const servantBarred = SkillBuilderApp.barredEffects(this.actor);
    const effectOption = (k, label, current) => {
      const base = effectBaseRank(k);
      const overRank = base > d.rank;
      return {
        key: k,
        label: game.i18n.localize(label) + (overRank ? ` · ${cfg.skillRanks[base]?.stars ?? base}` : ""),
        gated: overRank && k !== current,
        selected: k === current
      };
    };
    ctx.effectChoices = Object.entries(cfg.skillEffects)
      .filter(([k]) => !servantBarred.includes(k))
      .map(([k, label]) => effectOption(k, label, d.effect));
    ctx.damagePoolChoices = cfg.damagePools;
    ctx.damageTypeChoices = elementChoices();
    // Status list — used by the Inflict / Infuse / Hinder pickers AND the Affinity (Status)
    // Modifier panel. Sorted alphabetically by label (order is display-only — the value is the id).
    ctx.conditionChoices = Object.fromEntries((cfg.statusConditions ?? [])
      .filter((c) => (cfg.conditionKeys ?? []).includes(c.id))
      .map((c) => [c.id, game.i18n.localize(c.name)])
      .sort((a, b) => a[1].localeCompare(b[1])));
    ctx.isReact = d.actionType === "react";
    ctx.isStrike = d.effect === "strike";
    // Damage Type only shows for Effects that use one (Strike / Affinity).
    ctx.showDamageType = cfg.damageEffects.includes(d.effect);
    // Elemental Control's element is FREE TEXT — type any element, untied to the Damage Types.
    ctx.showControlElement = d.effect === "elementalControl";
    // The damage/heal die choice shows for Strike / Mend.
    ctx.showDamageDie = cfg.dieEffects.includes(d.effect);
    // The HP/Energy pool field shows for Strike (which pool its damage hits).
    ctx.showDamagePool = cfg.poolEffects.includes(d.effect);
    ctx.poolLabel = "PROJECTANIME.Skill.field.damagePool";
    ctx.showEffectExtras = ctx.showDamageDie || ctx.showDamageType || ctx.showDamagePool || ctx.showControlElement;
    // Empower/Weaken/Transform: pick which Attributes change (rules v0.01 — ONE for
    // Empower/Weaken; Transform offers two slots: fill one for +2 steps, both for +1 each).
    // The slots are INDEPENDENT of the roll Attributes — you roll attrA+attrB to hit, then
    // change whatever was picked here.
    ctx.isAttrEffect = ["bolster", "hinder", "transform"].includes(d.effect);
    ctx.isHinder = d.effect === "hinder";
    if (ctx.isAttrEffect) {
      const attrSeed = d.effectAttrs ?? [];
      ctx.effectAttrPickers = Array.from({ length: effectAttrCount(d.effect) }, (_, i) => ({ index: i, value: attrSeed[i] ?? "" }));
    }
    // Target + Duration (rules v0.01) — every non-passive Skill carries both. A Self-Range Skill
    // (or the Passive carrier Effect) locks Target to Self — EXCEPT on an Aura, whose field needs
    // a real audience (Ally/Foe/Any; Self isn't offered, #sync collapses it to Ally). The
    // intrinsic Duration choices are Instant/Standard; a Duration MODIFIER (Channeled/Scene)
    // overrides — the select locks to it while the Modifier is on. Standard shows its turn count
    // (blank = the default 2).
    // "Always-on" behaviour (Target locks to Self, no Duration field) follows the ACTION TYPE, not
    // the Effect — a "None" Effect can be an Action/React Skill whose substance is its Modifiers.
    ctx.isPassiveCarrier = d.actionType === "passive";
    const auraOn = d.modifiers.includes("aura");
    // A self-centered Burst (Self Range + Burst) emanates from you and needs a real audience — like
    // an Aura, its Target (Foe/Ally/Any) stays free and Self isn't offered (it would hit only you).
    const selfArea = isSelfCenteredArea(d);
    ctx.targetChoices = (auraOn || selfArea)
      ? Object.fromEntries(Object.entries(cfg.skillTargets).filter(([k]) => k !== "self"))
      : cfg.skillTargets;
    ctx.targetLocked = !auraOn && !selfArea && (d.range.scope === "self" || ctx.isPassiveCarrier);
    // A passive Skill is always-on (no Duration) — but a passive AURA still needs its Target (the
    // field's audience), so the grid stays and only the Duration select hides.
    ctx.showDurationField = d.actionType !== "passive" && !ctx.isPassiveCarrier;
    ctx.showTargetDuration = ctx.showDurationField || auraOn;
    ctx.durationChoices = { instant: cfg.skillDurations.instant, standard: cfg.skillDurations.standard };
    ctx.durationLocked = d.modifiers.includes("channeled") ? game.i18n.localize(cfg.skillDurations.channeled)
      : d.modifiers.includes("scene") ? game.i18n.localize(cfg.skillDurations.scene) : "";
    ctx.showDurationTurns = ctx.showDurationField && !ctx.durationLocked && d.duration !== "instant";
    // Skill Evasion (Roll & Effect step) — the Effect's own defender swap (rules v0.01), never hand-
    // picked: when the Effect defines one (Disguise/Illusion → Mind or Charm, Telepathy/Vanish
    // → Mind or Spirit) two locked columns show the pair auto-filled; other Effects show nothing.
    const seKeys = skillEvasionKeys(cfg.effectSkillEvasion?.[d.effect] ?? "");
    ctx.skillEvasionPair = seKeys.length
      ? { a: skillEvasionLabel(seKeys[0]), b: seKeys[1] ? skillEvasionLabel(seKeys[1]) : "" }
      : null;
    ctx.damageDieChoices = {
      attrA: game.i18n.localize(cfg.attributes[d.attrA] ?? d.attrA),
      attrB: game.i18n.localize(cfg.attributes[d.attrB] ?? d.attrB)
    };
    ctx.damageDieLabel = d.effect === "mend" ? "PROJECTANIME.Skill.field.healDie" : "PROJECTANIME.Skill.field.damageDie";
    // Tile-based scopes (Melee/Near/Far) show an editable tile count + its cap.
    ctx.rangeHasTiles = rangeHasTiles(d.range.scope);
    ctx.rangeRec = cfg.rangeTiles[d.range.scope] ?? 0;

    ctx.rankCards = Object.entries(cfg.skillRanks).map(([k, v]) => {
      const rank = Number(k);
      return {
        rank,
        stars: v.stars,
        label: game.i18n.localize(v.label),
        sp: v.sp,
        energy: v.energy,
        maxModifiers: v.maxModifiers,
        selected: d.rank === rank,
        affordable: v.sp <= budget
      };
    });

    ctx.effectDesc = game.i18n.localize(`PROJECTANIME.Skill.effectDesc.${d.effect}`);

    const used = modifiersBudget(d.modifiers, d);
    // Animate / Companion allow NO Modifiers (rules v0.01) — their budget reads 0 / 0.
    const max = effectModifierCap(d.effect, d.rank);
    ctx.modUsed = used;
    ctx.modMax = max;
    ctx.modOver = used > max;
    ctx.modifierList = Object.entries(cfg.skillModifiers).map(([key, label]) => {
      const selected = d.modifiers.includes(key);
      const isCustom = key === "custom";
      const isReequip = key === "reequip";
      const cost = isHeavyModifier(key, d) ? 2 : 1;     // Custom's / Re-equip's weight follows its Heavy checkbox
      // An always-on Skill can't take Secondary Effect (rules v0.01) or a Duration Modifier, and a
      // "None" Effect can't take Secondary Effect on any Action Type (modifierBarredByType); an
      // Aura field can't be Channeled (its lifetime is its marker's). Channeled↔Scene swap freely
      // (mutually exclusive — toggling one releases the other), so neither blocks the other here.
      const incompatible = modifierBarredByType(key, d)
        || (key === "channeled" && d.modifiers.includes("aura"))
        || (key === "aura" && d.modifiers.includes("channeled"));
      const swapMate = key === "channeled" ? "scene" : key === "scene" ? "channeled" : null;
      const budgetAfterSwap = swapMate && d.modifiers.includes(swapMate) ? used - 1 : used;
      return {
        key,
        label: game.i18n.localize(label),
        desc: game.i18n.localize(`PROJECTANIME.Skill.modifierDesc.${key}`),
        heavy: cfg.heavyModifiers.includes(key),         // the fixed "Heavy" badge (Devour / Mass / Secondary Effect)
        isCustom,                                         // Custom shows an inline Heavy chip when selected
        customHeavy: isCustom && !!d.customModifierHeavy,
        isReequip,                                        // Re-equip's Heavy form swaps the whole loadout
        reequipHeavy: isReequip && !!d.reequipHeavy,
        selected,
        // A choose-able Modifier configures INSIDE its row once selected — its pickers (status /
        // element / category / kind) render right in the box; clicks there don't toggle the row.
        showInflict: selected && key === "inflict",
        showRetaliation: selected && key === "retaliation",
        showAffinityDamage: selected && key === "affinityDamage",
        showAffinityStatus: selected && key === "affinityStatus",
        showAnalyze: selected && key === "analyze",
        showInfuse: selected && key === "infuse",
        hasConfig: selected && ["inflict", "retaliation", "affinityDamage", "affinityStatus", "analyze", "infuse"].includes(key),
        // Multi-take Modifiers (rules: "can be selected more than once") render one pick row per
        // take plus a ＋ chip; each take weighs the Modifier's cost again. ✕ drops a single take
        // (never the last — un-tick the row for that).
        canTakeAgain: selected && (cfg.multiTakeModifiers ?? []).includes(key),
        affinityDamageTakes: (selected && key === "affinityDamage")
          ? (d.affinityDamages.length ? d.affinityDamages : [{ type: "", level: "resist" }])
              .map((t, i, arr) => ({ index: i, type: t.type, level: t.level, removable: arr.length > 1 }))
          : [],
        affinityStatusTakes: (selected && key === "affinityStatus")
          ? (d.affinityStatusIds.length ? d.affinityStatusIds : [""])
              .map((id, i, arr) => ({ index: i, id, removable: arr.length > 1 }))
          : [],
        blocked: !selected && (incompatible || budgetAfterSwap + cost > max)
      };
    });

    // "Secondary Effect" Modifier — when selected, the Modifiers step shows a second Effect picker
    // (mirroring the primary's die/type/pool extras). The draft defaults the secondary to a real
    // Effect, so it always resolves once the Modifier is on. Its picker gates by Base Rank like
    // the primary's, and never offers the Effects that can't ride along: the Passive carrier
    // (not a second effect to resolve) and the whole-subsystem Effects (Animate / Companion —
    // they take no Modifiers, so they can't BE one — plus Conjure / Gate, whose interactive
    // flows don't stack onto another Skill's resolution).
    const secActive = d.modifiers.includes("secondaryEffect");
    const secEffect = d.secondaryEffect || "strike";
    const noSecondary = ["passive", "animate", "companion", "conjure", "gate"];
    ctx.secondaryEffectChoices = Object.entries(cfg.skillEffects)
      .filter(([k]) => !noSecondary.includes(k) && !servantBarred.includes(k))
      .map(([k, label]) => effectOption(k, label, secEffect));
    ctx.secondaryActive = secActive;
    ctx.secondaryEffectDesc = game.i18n.localize(`PROJECTANIME.Skill.effectDesc.${secEffect}`);
    ctx.showSecondaryDie = cfg.dieEffects.includes(secEffect);
    ctx.showSecondaryType = cfg.damageEffects.includes(secEffect);
    ctx.showSecondaryPool = cfg.poolEffects.includes(secEffect);
    // A secondary Elemental Control shares the Skill's one free-text element field.
    ctx.showSecondaryControlElement = secEffect === "elementalControl";
    ctx.showSecondaryExtras = ctx.showSecondaryDie || ctx.showSecondaryType || ctx.showSecondaryPool || ctx.showSecondaryControlElement;
    ctx.secondaryDieLabel = secEffect === "mend" ? "PROJECTANIME.Skill.field.healDie" : "PROJECTANIME.Skill.field.damageDie";
    ctx.secondaryPoolLabel = "PROJECTANIME.Skill.field.damagePool";

    // Aura Modifier — its field's audience is the Skill's Target (the Range & Target step's picker); an
    // ACTIVE aura's lifetime follows the Duration there too. A passive aura is always-on.
    ctx.auraActive = auraOn;

    // Inflict Modifier — when selected, the step shows the Status picker; choosing Lingering
    // reveals an Element dropdown (the active game Elements) for its end-of-turn tick; choosing a
    // pool-choice Status (Barrier / Regen protect-or-restore a pool, Curse blocks a pool's
    // recovery) reveals the Hit Points / Energy choice (rules v0.01: "If a Status Effect has a
    // choice between Hit Points or Energy, you make the selection during Skill Creation").
    ctx.inflictActive = d.modifiers.includes("inflict");
    ctx.inflictLingering = ctx.inflictActive && d.inflictStatus === "decay";
    ctx.inflictHasPool = ctx.inflictActive && (cfg.poolChoiceStatuses ?? []).includes(d.inflictStatus);

    // Affinity Modifiers — Damage shows the Element picker plus the Rank-gated level (Resist;
    // ⭐⭐⭐ unlocks Immune; ⭐⭐⭐⭐⭐ unlocks Absorb); Status only grants Immune, so it's just
    // the Status picker.
    const levelChoices = Object.fromEntries(
      Object.entries(affinityModifierLevels(d.rank)).map(([k, v]) => [k, game.i18n.localize(v)])
    );
    ctx.affinityLevelChoices = levelChoices;
    ctx.affinityDamageActive = d.modifiers.includes("affinityDamage");
    ctx.affinityStatusActive = d.modifiers.includes("affinityStatus");

    // Analyze / Infuse Modifiers — their creation-time picks.
    ctx.analyzeActive = d.modifiers.includes("analyze");
    ctx.analyzeChoices = Object.fromEntries(
      Object.entries(cfg.analyzeCategories).map(([k, v]) => [k, game.i18n.localize(v)])
    );
    ctx.infuseActive = d.modifiers.includes("infuse");
    ctx.infuseKindChoices = Object.fromEntries(
      Object.entries(cfg.infuseKinds).map(([k, v]) => [k, game.i18n.localize(v)])
    );
    ctx.infuseIsStatus = d.infuseKind === "status";

    const rank = cfg.skillRanks[d.rank] ?? {};
    const dtLabels = elementChoices();
    // The EFFECTIVE Target/Duration the commit will write (locks + Aura audience + Duration
    // Modifiers applied; a plain passive Skill normalizes to Self — its effect rides the bearer).
    const effTarget = auraOn
      ? (d.target in cfg.skillTargets && d.target !== "self" ? d.target : "ally")
      : (ctx.targetLocked || d.actionType === "passive") ? "self"
        : (d.target in cfg.skillTargets ? d.target : "any");
    const effDuration = d.modifiers.includes("channeled") ? "channeled"
      : d.modifiers.includes("scene") ? "scene"
      : d.duration === "instant" ? "instant" : "standard";
    const durationText = effDuration === "standard"
      ? `${game.i18n.localize(cfg.skillDurations.standard)} · ${d.effectDuration ?? cfg.standardDurationTurns} ${game.i18n.localize("PROJECTANIME.Skill.turns")}`
      : game.i18n.localize(cfg.skillDurations[effDuration] ?? "");
    ctx.review = {
      name: (d.name || "").trim() || game.i18n.localize("PROJECTANIME.SkillBuilder.newSkillName"),
      img: d.img,
      stars: rank.stars ?? "",
      rankLabel: game.i18n.localize(rank.label ?? ""),
      actionType: game.i18n.localize(cfg.actionTypes[d.actionType] ?? ""),
      attrA: game.i18n.localize(cfg.attributes[d.attrA] ?? ""),
      attrB: game.i18n.localize(cfg.attributes[d.attrB] ?? ""),
      range: rangeLabel(d.range),
      effect: game.i18n.localize(cfg.skillEffects[d.effect] ?? ""),
      target: game.i18n.localize(cfg.skillTargets[effTarget] ?? ""),
      duration: d.actionType === "passive" || ctx.isPassiveCarrier ? "" : durationText,
      skillEvasion: (skillNeedsAccuracy({ ...d, target: effTarget }) && d.skillEvasion in cfg.skillEvasionAttrs)
        ? game.i18n.localize(cfg.skillEvasionAttrs[d.skillEvasion]) : "",
      // Empower/Weaken/Transform targets — exactly what was chosen (independent of the roll), localized.
      isHinder: ctx.isHinder,
      effectAttrs: ctx.isAttrEffect
        ? (d.effectAttrs ?? []).filter((k) => k in cfg.attributes).slice(0, effectAttrCount(d.effect))
            .map((k) => game.i18n.localize(cfg.attributes[k]))
        : [],
      secondaryEffect: secActive ? game.i18n.localize(cfg.skillEffects[secEffect] ?? "") : "",
      // Modifier-pick summaries: "Fire — Resist" / "Stunned — Immune" / the inflicted Status / ….
      affinityDamage: ctx.affinityDamageActive
        ? d.affinityDamages.filter((t) => t.type)
            .map((t) => `${dtLabels[t.type] ?? t.type} — ${levelChoices[t.level] ?? t.level}`).join(" · ") : "",
      affinityStatus: ctx.affinityStatusActive
        ? d.affinityStatusIds.filter(Boolean)
            .map((id) => `${ctx.conditionChoices[id] ?? id} — ${game.i18n.localize("PROJECTANIME.Affinity.immune")}`).join(" · ") : "",
      inflict: (ctx.inflictActive && d.inflictStatus)
        ? `${ctx.conditionChoices[d.inflictStatus] ?? d.inflictStatus}${ctx.inflictLingering && d.decayType ? ` · ${dtLabels[d.decayType] ?? d.decayType}` : ""}${ctx.inflictHasPool ? ` · ${game.i18n.localize(cfg.damagePools[d.inflictPool === "energy" ? "energy" : "hp"])}` : ""}` : "",
      retaliation: (d.modifiers.includes("retaliation") && d.retaliationType) ? (dtLabels[d.retaliationType] ?? d.retaliationType) : "",
      analyze: ctx.analyzeActive ? (ctx.analyzeChoices[d.analyzeCategory] ?? "") : "",
      infuse: ctx.infuseActive
        ? (ctx.infuseIsStatus
          ? (ctx.conditionChoices[d.infuseStatus] ?? "")
          : (dtLabels[d.infuseElement] ?? "")) : "",
      damageDie: ctx.showDamageDie ? game.i18n.localize(cfg.attributes[d[d.damageAttr]] ?? "") : "",
      damageType: (ctx.showDamageType && d.damageType) ? (dtLabels[d.damageType] ?? d.damageType) : "",
      controlElement: (ctx.showControlElement || (ctx.secondaryActive && ctx.showSecondaryControlElement)) ? (d.controlElement ?? "").trim() : "",
      damagePool: ctx.showDamagePool ? game.i18n.localize(cfg.damagePools[d.damagePool] ?? "") : "",
      trigger: ctx.isReact && d.trigger ? game.i18n.localize(cfg.triggers[d.trigger] ?? "") : "",
      modifiers: d.modifiers.map((m) => {
        const takes = modifierTakes(m, d);
        const label = game.i18n.localize(cfg.skillModifiers[m] ?? m) + (takes > 1 ? ` ×${takes}` : "");
        // Heavy reads as a clean suffix (the list rows carry the badge; no parentheses).
        return isHeavyModifier(m, d) ? `${label} · ${game.i18n.localize("PROJECTANIME.Skill.heavy")}` : label;
      }),
      spCost: rank.sp ?? d.rank,
      energyCost: d.actionType === "passive" ? 0 : (rank.energy ?? d.rank * 2),
      passive: d.actionType === "passive",
      passiveEnergyTax: d.actionType === "passive" ? Math.floor((rank.energy ?? d.rank * 2) / 2) : 0
    };
    const rankCost = rank.sp ?? d.rank;
    ctx.affordable = rankCost <= budget;
    // Edit mode swaps "Learn (cost)" for "Save Changes (net SP)" — the net is the new Rank
    // cost minus what's already logged (negative = a refund), blank when it nets to zero.
    ctx.isEditing = !!this.#editId;
    ctx.finishLabel = game.i18n.localize(this.#editId ? "PROJECTANIME.SkillBuilder.saveChanges" : "PROJECTANIME.SkillBuilder.learn");
    if (this.item) {
      ctx.netCostLabel = ""; // no SP changes hands on a standalone item
    } else if (this.#editId) {
      const net = rankCost - editedLogged;
      ctx.netCostLabel = net === 0 ? "" : (net > 0 ? `+${net}` : `-${Math.abs(net)}`);
    } else {
      ctx.netCostLabel = String(rankCost);
    }
  }

  #prepareAdvance(ctx, sp) {
    const cfg = CONFIG.PROJECTANIME;
    const item = this.#advanceSkill();
    const sys = item.system;
    const rank = cfg.skillRanks[sys.rank] ?? {};
    const used = sys.modifiersUsed ?? 0;
    const max = sys.maxModifiers ?? 0;
    const accuracy = sys.accuracyMod ?? 0;
    const damage = sys.damageMod ?? 0;
    const energy = sys.energyCost ?? 0;
    const minEnergy = sys.minEnergy ?? Math.ceil((rank.energy ?? 2) / 2);
    const scope = sys.range?.scope ?? "near";
    const rangeTiles = sys.range?.tiles ?? 0;
    const rangeTileScope = rangeHasTiles(scope);
    const canAfford = sp >= 1;

    ctx.skill = {
      id: item.id,
      name: item.name,
      img: item.img,
      stars: rank.stars ?? "",
      rankLabel: game.i18n.localize(rank.label ?? ""),
      actionLabel: game.i18n.localize(cfg.actionTypes[sys.actionType] ?? ""),
      effectLabel: game.i18n.localize(cfg.skillEffects[sys.effect] ?? ""),
      rangeLabel: rangeLabel(sys.range),
      attrA: game.i18n.localize(cfg.attributes[sys.attributes?.attrA] ?? ""),
      attrB: game.i18n.localize(cfg.attributes[sys.attributes?.attrB] ?? ""),
      energyCost: energy,
      passive: sys.actionType === "passive",
      passiveEnergyTax: sys.passiveEnergyTax ?? (sys.actionType === "passive" ? Math.floor((rank.energy ?? sys.rank * 2) / 2) : 0),
      accuracyMod: accuracy,
      modUsed: used,
      modMax: max,
      modifiers: (sys.modifiers ?? []).map((m) => {
        const takes = modifierTakes(m, sys);
        const label = game.i18n.localize(cfg.skillModifiers[m] ?? m) + (takes > 1 ? ` ×${takes}` : "");
        return isHeavyModifier(m, sys) ? `${label} · ${game.i18n.localize("PROJECTANIME.Skill.heavy")}` : label;
      })
    };

    ctx.improvements = {
      canAfford,
      raiseRank: {
        cost: 1,
        atMax: sys.rank >= 5,
        next: sys.rank < 5 ? (cfg.skillRanks[sys.rank + 1]?.stars ?? "") : "",
        disabled: sys.rank >= 5 || !canAfford
      },
      sharpenAccuracy: {
        cost: 1,
        cur: accuracy,
        next: accuracy + 1,
        atMax: accuracy >= 3,
        // Only Skills that make an Accuracy Check (target an enemy) can Sharpen it.
        applies: skillNeedsAccuracy(sys),
        disabled: accuracy >= 3 || !canAfford
      },
      // Sharpen Damage / Sharpen Healing — only for Skills that roll an output (Strike / Mend);
      // the label flips to "Healing" for a Mend.
      sharpenDamage: {
        cost: 1,
        cur: damage,
        next: damage + 1,
        atMax: damage >= 3,
        applies: cfg.dieEffects.includes(sys.effect),
        isHeal: sys.effect === "mend",
        disabled: damage >= 3 || !canAfford
      },
      lowerEnergy: {
        cost: 1,
        cur: energy,
        next: energy - 1,
        atMin: energy <= minEnergy,
        disabled: energy <= minEnergy || !canAfford
      },
      raiseRange: {
        cost: 1,
        hasTiles: rangeTileScope,
        cur: rangeTiles,
        next: rangeTiles + 1,
        // Self / Weapon / Very Far have no tile count to raise.
        disabled: !rangeTileScope || !canAfford
      },
      addModifier: { cost: 1, full: used >= max }
    };

    ctx.addableModifiers = Object.entries(cfg.skillModifiers)
      // A multi-take Modifier (Affinity Damage/Status) stays listed even when taken — Improve
      // can buy another take (the Element/Status is picked on the next wizard rebuild).
      .filter(([key]) => !(sys.modifiers ?? []).includes(key) || (cfg.multiTakeModifiers ?? []).includes(key))
      .map(([key, label]) => {
        const isHeavy = isHeavyModifier(key, sys);
        const cost = isHeavy ? 2 : 1;
        // The Builder's compatibility rules hold on Improve too: no Secondary Effect / Duration
        // Modifier on an always-on Skill, no Channeled Aura, and Channeled↔Scene stay exclusive
        // (Improve can't remove a Modifier, so the other one being present blocks outright).
        const mods = sys.modifiers ?? [];
        const incompatible = modifierBarredByType(key, sys)
          || (key === "channeled" && (mods.includes("aura") || mods.includes("scene")))
          || (key === "scene" && mods.includes("channeled"))
          || (key === "aura" && mods.includes("channeled"));
        return {
          key,
          label: game.i18n.localize(label),
          desc: game.i18n.localize(`PROJECTANIME.Skill.modifierDesc.${key}`),
          heavy: isHeavy,
          blocked: incompatible || used + cost > max,
          disabled: incompatible || used + cost > max || !canAfford
        };
      });

    // "Tune a Modifier" (rules): grow the numeric value of ANY Modifier the Skill already has that
    // carries a number (Aura/Burst radius, Chain targets, Push/Pull/Move tiles, Protection's
    // Defense…). 1 SP each, growth capped at +3 (config.mjs modifierGrowthMax). Only Modifiers in
    // growableModifiers qualify; a rank-based one (Push/Pull) starts at the Rank.
    const growable = cfg.growableModifiers ?? {};
    const growMax = cfg.modifierGrowthMax ?? 3;
    ctx.growableMods = (sys.modifiers ?? [])
      .filter((key) => growable[key])
      .map((key) => {
        const base = growable[key].rankBased ? (sys.rank ?? 1) : (growable[key].base ?? 0);
        const growth = Math.min(growMax, sys.modifierGrowth?.[key] ?? 0);
        const atMax = growth >= growMax;
        return {
          key,
          label: game.i18n.localize(cfg.skillModifiers[key] ?? key),
          unit: game.i18n.localize(growable[key].unit ?? ""),
          base,
          growth,
          current: base + growth,
          next: base + growth + 1,
          atMax,
          disabled: atMax || !canAfford
        };
      });
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
    // Re-render when a select that drives dependent fields changes (action type reveals the React
    // Trigger; effect changes its description / damage fields / Target+Duration defaults; a roll
    // Attribute relabels the damage-die picker that now shares the Roll & Effect step; range scope
    // reveals the tile count and can lock Target; the duration choice reveals the Standard turn
    // count; Inflict's Status reveals the Lingering element; Infuse's kind swaps its value picker).
    for (const sel of this.element.querySelectorAll('select[name="actionType"], select[name="effect"], select[name="secondaryEffect"], select[name="attrA"], select[name="attrB"], select[name="rangeScope"], select[name="duration"], select[name="inflictStatus"], select[name="infuseKind"]')) {
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
    const data = new foundry.applications.ux.FormDataExtended(this.element).object;
    const d = this.#draft;
    if (typeof data.name === "string") d.name = data.name;
    if (typeof data.description === "string") d.description = data.description;
    if (data.actionType) d.actionType = data.actionType;
    if (data.attrA) d.attrA = data.attrA;
    if (data.attrB) d.attrB = data.attrB;
    if (data.rangeScope) {
      const scopeChanged = data.rangeScope !== d.range.scope;
      d.range.scope = data.rangeScope;
      // Switching scope resets tiles to the new scope's recommendation (the tiles
      // input in the DOM is now stale); otherwise read the tiles field if shown.
      if (scopeChanged) d.range.tiles = CONFIG.PROJECTANIME.rangeTiles[data.rangeScope] ?? 0;
      else if (data.rangeTiles !== undefined && data.rangeTiles !== "") d.range.tiles = Math.max(0, Math.round(Number(data.rangeTiles) || 0));
    }
    let effectChanged = false;
    if (data.effect) {
      effectChanged = data.effect !== d.effect;
      d.effect = data.effect;
      // A new Effect re-seeds Target + Duration with its defaults. Those selects live on the next
      // (Range & Target) step, so they aren't in the DOM yet — they render fresh when advanced to.
      if (effectChanged) {
        d.target = EFFECT_TARGET_DEFAULTS[d.effect] ?? "any";
        d.duration = EFFECT_DURATION_DEFAULTS[d.effect] ?? "standard";
      }
    }
    if (!effectChanged) {
      if (data.target) d.target = data.target;
      if (data.duration) d.duration = data.duration === "instant" ? "instant" : "standard";
    }
    // Skill Evasion is the Effect's to define, never hand-picked (rules v0.01: Disguise/Illusion
    // → Mind-or-Charm, Telepathy/Vanish → Mind-or-Spirit, everything else none; the defender uses
    // the better of the pair) — derived every sync so the Effect step's locked A/B columns and
    // the stored value can't drift apart.
    d.skillEvasion = CONFIG.PROJECTANIME.effectSkillEvasion?.[d.effect] ?? "";
    if (data.damageAttr) d.damageAttr = data.damageAttr;
    if (data.damagePool) d.damagePool = data.damagePool;
    if ("damageType" in data) d.damageType = data.damageType ?? "";
    if ("controlElement" in data) d.controlElement = data.controlElement ?? "";
    // Empower/Weaken/Transform Attribute slots (effectAttr0..N) → effectAttrs. Rendered only on
    // the Roll & Effect step, so guard on slot 0. (Weaken's old Status slots are gone — rules v0.01
    // moved status riders to the Inflict Modifier.)
    if ("effectAttr0" in data) {
      const arr = [];
      for (let i = 0; i < effectAttrCount(d.effect); i++) { const v = data[`effectAttr${i}`]; if (v) arr.push(v); }
      d.effectAttrs = arr;
    }
    if ("effectDuration" in data) {
      const n = Math.round(Number(data.effectDuration));
      d.effectDuration = Number.isFinite(n) && n >= 1 ? n : null; // blank/invalid → the Standard default (2)
    }
    // Secondary Effect fields (only present on the Modifiers step while the Modifier is selected).
    if (data.secondaryEffect) d.secondaryEffect = data.secondaryEffect;
    if (data.secondaryDamageAttr) d.secondaryDamageAttr = data.secondaryDamageAttr;
    if (data.secondaryDamagePool) d.secondaryDamagePool = data.secondaryDamagePool;
    if ("secondaryDamageType" in data) d.secondaryDamageType = data.secondaryDamageType ?? "";
    if ("inflictStatus" in data) d.inflictStatus = data.inflictStatus ?? "";
    if ("decayType" in data) d.decayType = data.decayType ?? "";
    if ("retaliationType" in data) d.retaliationType = data.retaliationType ?? "";
    if (data.inflictPool) d.inflictPool = data.inflictPool;
    // Affinity Modifier takes (affinityType0..N / affinityStatusId0..N — one pick row per take,
    // rendered only inside the selected row's config; mirrors the effectAttr0..N pattern).
    if ("affinityType0" in data) {
      const takes = [];
      for (let i = 0; `affinityType${i}` in data; i++) {
        takes.push({ type: data[`affinityType${i}`] ?? "", level: data[`affinityLevel${i}`] || "resist" });
      }
      d.affinityDamages = takes;
    }
    if ("affinityStatusId0" in data) {
      const ids = [];
      for (let i = 0; `affinityStatusId${i}` in data; i++) ids.push(data[`affinityStatusId${i}`] ?? "");
      d.affinityStatusIds = ids;
    }
    if (data.analyzeCategory) d.analyzeCategory = data.analyzeCategory;
    if (data.infuseKind) d.infuseKind = data.infuseKind;
    if ("infuseElement" in data) d.infuseElement = data.infuseElement ?? "";
    if ("infuseStatus" in data) d.infuseStatus = data.infuseStatus ?? "";
    if ("trigger" in data) d.trigger = data.trigger ?? "";
    // Any passive-only Modifier locks the Skill to Passive — re-asserted on every sync so it
    // sticks even if the player goes back and changes the Action Type on the Concept step.
    if ((d.modifiers ?? []).some((m) => (CONFIG.PROJECTANIME.passiveOnlyModifiers ?? []).includes(m))) {
      d.actionType = "passive";
    }
    // An always-on (Passive Action Type) Skill rides the bearer, so a Self-Range Skill or any
    // passive one Targets Self — UNLESS it's an Aura: the field is centered on you, its Range/carrier
    // don't confine it to you, so the Target (the field's audience — Ally/Foe/Any) stays free and a
    // Self value collapses to Ally. A passive Skill also sheds the Modifiers it can't hold — Secondary
    // Effect and the Duration Modifiers (no duration to alter). The "None" Effect no longer forces
    // Passive: it can be an Action/React Skill, so these locks key off the Action Type, not the Effect.
    const auraOn = (d.modifiers ?? []).includes("aura");
    // A self-centered Burst (Self Range + Burst) emanates from you, so Self Range doesn't pin its
    // Target to Self — only a passive Skill still does (its effect rides the bearer). A leftover
    // Self target on such a Burst (it would hit only the caster) collapses to Any, like an Aura's.
    const selfArea = isSelfCenteredArea(d);
    if (!auraOn && ((d.range.scope === "self" && !selfArea) || d.actionType === "passive")) d.target = "self";
    if (auraOn && d.target === "self") d.target = "ally";
    if (selfArea && d.actionType !== "passive" && d.target === "self") d.target = "any";
    if (d.actionType === "passive") {
      d.modifiers = (d.modifiers ?? []).filter((m) => !["secondaryEffect", "channeled", "scene"].includes(m));
    }
    // A "None" Effect can never carry the Secondary Effect Modifier, whatever its Action Type — drop
    // a stale one left from before the Effect was switched to None.
    if (d.effect === "passive") d.modifiers = (d.modifiers ?? []).filter((m) => m !== "secondaryEffect");
    // Animate / Companion allow NO Modifiers (rules v0.01) — switching to one sheds them all.
    if ((CONFIG.PROJECTANIME.noModifierEffects ?? []).includes(d.effect)) d.modifiers = [];
  }

  /* -------------------------------------------- */
  /*  Mode / navigation actions                   */
  /* -------------------------------------------- */

  static #onFormSubmit() { /* navigation & commits are handled via the action buttons */ }

  static #onBuildNew() {
    this.#beginBuild();
    this.render();
  }

  static #onImproveSkill(event, target) {
    const id = target.closest("[data-skill-id]")?.dataset.skillId;
    if (!id) return;
    this.#mode = "advance";
    this.#advanceId = id;
    this.render();
  }

  /**
   * Open the no-code Effect Builder for a Skill so its mechanics (Bolster / Hinder / Affinity /
   * condition rider …) can be authored without leaving the Skill Builder. Opens the Skill's
   * first Active Effect, creating a transferring one if it has none. (Manage multiple effects
   * from the Skill's item sheet → Effects tab.) Mirrors the item-sheet #onAddEffect pattern.
   * Reached from the hub's per-skill rows (actor mode) and the wizard nav (standalone mode —
   * where the plain sheet's Effects tab isn't a surface anymore).
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

  /** Block leaving a step that isn't valid yet (a React Skill needs a Trigger; the Effect must
   *  meet its Base Rank — rules v0.01 — and a Servant/Companion can't take Animate/Companion).
   *  The Effect is chosen on the combined Roll & Effect step ("roll"), so its gates fire there. */
  #validateStep() {
    const d = this.#draft;
    if (STEPS[this.#step] === "concept" && d.actionType === "react" && !d.trigger) {
      ui.notifications.warn(game.i18n.localize("PROJECTANIME.Skill.reactNeedsTrigger"));
      return false;
    }
    if (STEPS[this.#step] === "roll" && effectBaseRank(d.effect) > d.rank) {
      ui.notifications.warn(game.i18n.format("PROJECTANIME.SkillBuilder.effectRankGate", {
        stars: CONFIG.PROJECTANIME.skillRanks[effectBaseRank(d.effect)]?.stars ?? effectBaseRank(d.effect)
      }));
      return false;
    }
    if (STEPS[this.#step] === "roll" && SkillBuilderApp.barredEffects(this.actor).includes(d.effect)) {
      ui.notifications.warn(game.i18n.localize("PROJECTANIME.SkillBuilder.servantNoEffect"));
      return false;
    }
    return true;
  }

  static #onPickRank(event, target) {
    this.#sync();
    const r = Number(target.dataset.rank);
    if (r >= 1 && r <= 5) this.#draft.rank = r;
    this.render();
  }

  static #onToggleModifier(event, target) {
    this.#sync();
    const key = target.closest("[data-modifier]")?.dataset.modifier;
    if (!key) return;
    // A row's inline option chips (Custom's Heavy) and in-row config pickers (Inflict's status,
    // Affinity's element, …) live inside the row. Ignore clicks on them here so making a choice
    // never also de-selects the Modifier — guards the case where a parent-row handler still fires
    // via bubbling (don't rely on the dispatcher only firing the innermost action).
    if (event.target.closest(".sb-mod-opts, .sb-mod-config")) return;
    const cfg = CONFIG.PROJECTANIME;
    const d = this.#draft;
    const mods = d.modifiers;
    const at = mods.indexOf(key);
    if (at >= 0) {
      mods.splice(at, 1);
      // Dropping Custom / Re-equip clears its Heavy flag, so re-adding it later starts un-Heavy.
      if (key === "custom") d.customModifierHeavy = false;
      if (key === "reequip") d.reequipHeavy = false;
      // Un-ticking a multi-take Modifier drops EVERY take.
      if (key === "affinityDamage") d.affinityDamages = [];
      if (key === "affinityStatus") d.affinityStatusIds = [];
    } else {
      // An always-on Skill can't take Secondary Effect (rules v0.01) or a Duration Modifier, and a
      // "None" Effect can't take Secondary Effect on any Action Type; an Aura field can't be
      // Channeled (its lifetime is its marker's, not an EP-fed channel).
      if (modifierBarredByType(key, d)) {
        return ui.notifications.warn(game.i18n.localize("PROJECTANIME.SkillBuilder.passiveNoMod"));
      }
      if ((key === "channeled" && mods.includes("aura")) || (key === "aura" && mods.includes("channeled"))) {
        return ui.notifications.warn(game.i18n.localize("PROJECTANIME.SkillBuilder.modIncompatible"));
      }
      // Channeled and Scene are mutually exclusive Duration Modifiers — picking one releases the
      // other FIRST, so a straight swap always fits the budget.
      if (key === "channeled" || key === "scene") {
        const oi = mods.indexOf(key === "channeled" ? "scene" : "channeled");
        if (oi >= 0) mods.splice(oi, 1);
      }
      const used = modifiersBudget(mods, d);
      const cost = isHeavyModifier(key, d) ? 2 : 1;
      const max = effectModifierCap(d.effect, d.rank);
      if (used + cost > max) return ui.notifications.warn(game.i18n.localize("PROJECTANIME.SkillBuilder.modBudgetFull"));
      mods.push(key);
      // Ticking a multi-take Modifier opens with one (blank) take row.
      if (key === "affinityDamage" && !d.affinityDamages.length) d.affinityDamages = [{ type: "", level: "resist" }];
      if (key === "affinityStatus" && !d.affinityStatusIds.length) d.affinityStatusIds = [""];
      // A passive-only Modifier (Aura) forces the Skill to Passive the moment it's picked.
      if ((cfg.passiveOnlyModifiers ?? []).includes(key)) d.actionType = "passive";
      // An Aura's field needs a real audience — a Self target collapses to Ally on pick.
      if (key === "aura" && d.target === "self") d.target = "ally";
    }
    this.render();
  }

  /** Take a multi-take Modifier (Affinity Damage / Status) one more time — a new blank pick row
   *  in its box. Every take costs the Modifier's weight again, so the budget gate mirrors
   *  #onToggleModifier's. */
  static #onAddModifierTake(event, target) {
    this.#sync();
    const d = this.#draft;
    const key = target.closest("[data-modifier]")?.dataset.modifier;
    if (!key || !(CONFIG.PROJECTANIME.multiTakeModifiers ?? []).includes(key) || !d.modifiers.includes(key)) return;
    const used = modifiersBudget(d.modifiers, d);
    const cost = isHeavyModifier(key, d) ? 2 : 1;
    if (used + cost > effectModifierCap(d.effect, d.rank)) {
      return ui.notifications.warn(game.i18n.localize("PROJECTANIME.SkillBuilder.modBudgetFull"));
    }
    if (key === "affinityDamage") d.affinityDamages.push({ type: "", level: "resist" });
    else if (key === "affinityStatus") d.affinityStatusIds.push("");
    this.render();
  }

  /** Drop ONE take of a multi-take Modifier (the pick row's ✕) — never the last; un-tick the
   *  row to drop the Modifier entirely. */
  static #onRemoveModifierTake(event, target) {
    this.#sync();
    const d = this.#draft;
    const key = target.closest("[data-modifier]")?.dataset.modifier;
    const i = Number(target.dataset.take);
    if (key === "affinityDamage" && d.affinityDamages.length > 1 && i >= 0 && i < d.affinityDamages.length) d.affinityDamages.splice(i, 1);
    else if (key === "affinityStatus" && d.affinityStatusIds.length > 1 && i >= 0 && i < d.affinityStatusIds.length) d.affinityStatusIds.splice(i, 1);
    this.render();
  }

  /** Flip the free-form "Custom" Modifier's Heavy flag (its end-of-row checkbox). Heavy makes it
   *  count as two Modifiers, re-rendering so the budget recomputes — blocked if turning it on would
   *  overflow the Rank's budget. */
  static #onToggleCustomHeavy() {
    this.#sync();
    const cfg = CONFIG.PROJECTANIME;
    const d = this.#draft;
    if (!d.modifiers.includes("custom")) return;
    if (!d.customModifierHeavy) {
      // Going Heavy adds a second point of weight; `used` already counts Custom once, so check +1.
      const used = modifiersBudget(d.modifiers, d);
      const max = cfg.skillRanks[d.rank]?.maxModifiers ?? d.rank;
      if (used + 1 > max) return ui.notifications.warn(game.i18n.localize("PROJECTANIME.SkillBuilder.modBudgetFull"));
    }
    d.customModifierHeavy = !d.customModifierHeavy;
    this.render();
  }

  /** Flip the Re-equip Modifier's Heavy flag (rules: the Heavy form swaps your ENTIRE loadout).
   *  Mirrors the Custom Heavy toggle — blocked if going Heavy would overflow the Rank's budget. */
  static #onToggleReequipHeavy() {
    this.#sync();
    const cfg = CONFIG.PROJECTANIME;
    const d = this.#draft;
    if (!d.modifiers.includes("reequip")) return;
    if (!d.reequipHeavy) {
      const used = modifiersBudget(d.modifiers, d);
      const max = cfg.skillRanks[d.rank]?.maxModifiers ?? d.rank;
      if (used + 1 > max) return ui.notifications.warn(game.i18n.localize("PROJECTANIME.SkillBuilder.modBudgetFull"));
    }
    d.reequipHeavy = !d.reequipHeavy;
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

  /** Commit the wizard: create a new Skill (spending SP = Rank), or save changes back to the
   *  Skill being edited (reconciling its SP to the new Rank cost). */
  static async #onFinishBuild() {
    this.#sync();
    const d = this.#draft;
    const cfg = CONFIG.PROJECTANIME;
    // Aura (and any passive-only Modifier) locks the Skill to Passive — enforce before validating /
    // writing, in case the Action Type was changed after the Modifier was picked.
    if (d.modifiers.some((m) => (cfg.passiveOnlyModifiers ?? []).includes(m))) d.actionType = "passive";
    // An always-on (Passive) Skill sheds the Modifiers it can't hold (mirrors #sync — re-asserted
    // here in case steps were jumped). A "None" Effect additionally sheds Secondary Effect on any
    // Action Type (it can never carry it). Animate / Companion shed every Modifier (rules v0.01).
    if (d.actionType === "passive") d.modifiers = d.modifiers.filter((m) => !["secondaryEffect", "channeled", "scene"].includes(m));
    if (d.effect === "passive") d.modifiers = d.modifiers.filter((m) => m !== "secondaryEffect");
    if ((cfg.noModifierEffects ?? []).includes(d.effect)) d.modifiers = [];
    // A React Skill must carry a Trigger (re-check in case steps were jumped).
    if (d.actionType === "react" && !d.trigger) {
      this.#step = STEPS.indexOf("concept");
      ui.notifications.warn(game.i18n.localize("PROJECTANIME.Skill.reactNeedsTrigger"));
      return this.render();
    }
    // A raised Servant / bonded Companion can never learn Animate or Companion (rules v0.01).
    if (SkillBuilderApp.barredEffects(this.actor).includes(d.effect)) {
      this.#step = STEPS.indexOf("effect");
      ui.notifications.warn(game.i18n.localize("PROJECTANIME.SkillBuilder.servantNoEffect"));
      return this.render();
    }
    // Both Effect slots must meet their Base Rank (rules v0.01) — walk back to the offending step.
    if (effectBaseRank(d.effect) > d.rank) {
      this.#step = STEPS.indexOf("effect");
      ui.notifications.warn(game.i18n.format("PROJECTANIME.SkillBuilder.effectRankGate", {
        stars: cfg.skillRanks[effectBaseRank(d.effect)]?.stars ?? effectBaseRank(d.effect)
      }));
      return this.render();
    }
    if (d.modifiers.includes("secondaryEffect") && effectBaseRank(d.secondaryEffect || "strike") > d.rank) {
      this.#step = STEPS.indexOf("modifiers");
      ui.notifications.warn(game.i18n.format("PROJECTANIME.SkillBuilder.effectRankGate", {
        stars: cfg.skillRanks[effectBaseRank(d.secondaryEffect || "strike")]?.stars ?? ""
      }));
      return this.render();
    }
    const name = (d.name || "").trim() || game.i18n.localize("PROJECTANIME.SkillBuilder.newSkillName");
    const rankCost = cfg.skillRanks[d.rank]?.sp ?? d.rank;
    // The Secondary Effect persists only while its Modifier is selected; otherwise it's cleared.
    const hasSecondary = d.modifiers.includes("secondaryEffect");
    // Empower/Weaken/Transform attribute picks — kept to valid keys and the Effect's allowance
    // (rules v0.01: one Attribute; Transform up to two); cleared on other Effects. Weaken no
    // longer authors status riders (the Inflict Modifier is the status path) — a rebuild clears
    // any legacy list, like every other rebuild reset.
    const isAttrEffect = ["bolster", "hinder", "transform"].includes(d.effect);
    const effectAttrs = isAttrEffect ? (d.effectAttrs ?? []).filter((k) => k in cfg.attributes).slice(0, effectAttrCount(d.effect)) : [];
    const hinderStatuses = [];
    const system = {
      description: d.description ?? "",
      rank: d.rank,
      actionType: d.actionType,
      attributes: { attrA: d.attrA, attrB: d.attrB, attrC: d.attrC ?? "" },
      effectAttrs,
      hinderStatuses,
      damageAttr: d.damageAttr,
      range: d.range,
      effect: d.effect,
      // Target (rules v0.01): an Aura — or a self-centered Burst (Self Range + Burst) — keeps a real
      // audience (Ally/Foe/Any; Self collapses to a sensible default since it would hit only the
      // caster). A Passive (always-on) Skill normalizes to Self FIRST (its effect rides the bearer,
      // ahead of any area read); otherwise a non-area Self-Range Skill is Self too. A "None" Effect
      // no longer forces this — an Action/React None keeps its chosen Target.
      target: d.modifiers.includes("aura")
        ? (d.target in cfg.skillTargets && d.target !== "self" ? d.target : "ally")
        : (d.actionType === "passive")
          ? "self"
          : isSelfCenteredArea(d)
            ? (d.target in cfg.skillTargets && d.target !== "self" ? d.target : "any")
            : (d.range.scope === "self" ? "self"
              : (d.target in cfg.skillTargets ? d.target : "any")),
      // Duration (rules v0.01): a Duration Modifier (Channeled/Scene) wins; otherwise the
      // intrinsic Instant/Standard choice. Standard's turn count stays in effectDuration.
      duration: d.modifiers.includes("channeled") ? "channeled"
        : d.modifiers.includes("scene") ? "scene"
        : (d.duration === "instant" ? "instant" : "standard"),
      // Only damage Effects (Strike / Affinity) keep a damage type. Elemental Control's element
      // is its own free-text field, kept while either Effect slot holds EC.
      damageType: cfg.damageEffects.includes(d.effect) ? (d.damageType ?? "") : "",
      controlElement: (d.effect === "elementalControl" || (hasSecondary && d.secondaryEffect === "elementalControl"))
        ? (d.controlElement ?? "").trim() : "",
      damagePool: d.damagePool,
      effectDuration: d.effectDuration ?? null,
      secondaryEffect: hasSecondary ? (d.secondaryEffect || "") : "",
      secondaryDamageAttr: d.secondaryDamageAttr,
      secondaryDamagePool: d.secondaryDamagePool,
      secondaryDamageType: hasSecondary && cfg.damageEffects.includes(d.secondaryEffect) ? (d.secondaryDamageType ?? "") : "",
      // Inflict's chosen Status persists only while the Modifier is selected (validated against
      // the condition list); the Lingering element only while Lingering is the chosen Status; the
      // pool choice only while a valued Status (Barrier / Regen) is chosen.
      inflictStatus: d.modifiers.includes("inflict") && (cfg.conditionKeys ?? []).includes(d.inflictStatus) ? d.inflictStatus : "",
      decayType: (d.modifiers.includes("inflict") && d.inflictStatus === "decay") ? (d.decayType ?? "") : "",
      // Retaliation's damage type persists only while its Modifier is selected.
      retaliationType: d.modifiers.includes("retaliation") ? (d.retaliationType ?? "") : "",
      inflictPool: d.inflictPool === "energy" ? "energy" : "hp",
      // Affinity takes persist only while their Modifier is selected; blank takes drop, and each
      // Damage take's level clamps to the Rank (the Status flavor is always Immune — no level).
      affinityDamages: d.modifiers.includes("affinityDamage")
        ? d.affinityDamages.filter((t) => t.type).map((t) => ({ type: t.type, level: clampAffinityLevel(t.level, d.rank) }))
        : [],
      affinityStatusIds: d.modifiers.includes("affinityStatus") ? d.affinityStatusIds.filter(Boolean) : [],
      // Analyze / Infuse picks (kind always persists; the unused value side is cleared).
      analyzeCategory: d.analyzeCategory in cfg.analyzeCategories ? d.analyzeCategory : "vitals",
      infuseKind: d.infuseKind === "status" ? "status" : "element",
      infuseElement: d.modifiers.includes("infuse") && d.infuseKind !== "status" ? (d.infuseElement ?? "") : "",
      infuseStatus: d.modifiers.includes("infuse") && d.infuseKind === "status" ? (d.infuseStatus ?? "") : "",
      trigger: d.actionType === "react" ? d.trigger : "",
      modifiers: [...d.modifiers],
      // Heavy only matters while its Modifier is selected; clear it otherwise.
      customModifierHeavy: d.modifiers.includes("custom") ? !!d.customModifierHeavy : false,
      reequipHeavy: d.modifiers.includes("reequip") ? !!d.reequipHeavy : false
    };
    // Skill Evasion persists only when the Skill actually makes an Accuracy Check — the assembled
    // system carries everything skillNeedsAccuracy reads (Effect slots, Modifiers, Target).
    system.skillEvasion = (skillNeedsAccuracy(system) && d.skillEvasion in cfg.skillEvasionAttrs) ? d.skillEvasion : "";
    if (this.#editId) await this.#commitEdit(name, system, rankCost);
    else await this.#commitNew(name, system, rankCost);
  }

  /** Create the Skill and spend SP = Rank (the rules' "Learning a Skill"), blocking if short. */
  async #commitNew(name, system, rankCost) {
    const sp = this.actor.system.skillPoints?.value ?? 0;
    if (rankCost > sp) {
      return ui.notifications.warn(game.i18n.format("PROJECTANIME.SkillBuilder.notEnoughSp", { cost: rankCost, sp }));
    }
    const [created] = await this.actor.createEmbeddedDocuments("Item", [{
      name, type: "skill", img: this.#draft.img || DEFAULT_SKILL_IMG, system
    }]);
    await this.actor.recordSkillPointSpend({ amount: rankCost, kind: "skill", ref: created?.id ?? "", label: name });
    ui.notifications.info(game.i18n.format("PROJECTANIME.SkillBuilder.learned", { name, cost: rankCost }));
    this.#mode = "hub";
    this.#draft = null;
    this.#editId = null;
    this.render();
  }

  /**
   * Save the wizard back onto the edited Skill and reconcile its Skill Points. A full re-edit
   * rebuilds the Skill in place: its whole ledger (base "skill" entry + any "improve" entries)
   * is replaced by one new Rank-cost entry — prior Improve upgrades are refunded, and the
   * advancement-only fields they bought (Sharpen / Lower Energy / Turn) reset to defaults.
   * Granted Skills are package-managed and free, so their fields are rewritten without SP changes.
   */
  async #commitEdit(name, system, rankCost) {
    const item = this.item ?? this.actor.items.get(this.#editId);
    if (!item) { this.#mode = "hub"; this.#draft = null; this.#editId = null; return this.render(); }

    // Rewrite the Skill (flattened so any removed Modifier-growth keys can be deleted cleanly).
    const update = foundry.utils.flattenObject({
      name, img: this.#draft.img || DEFAULT_SKILL_IMG,
      system: { ...system, accuracyMod: 0, damageMod: 0, energyReduction: 0 }
    });
    for (const key of Object.keys(item.system.modifierGrowth ?? {})) update[`system.modifierGrowth.-=${key}`] = null;

    // SP reconciliation is an actor concern — a standalone (world/compendium) Skill has no
    // ledger, and granted Skills are package-managed and free.
    if (this.actor && !item.getFlag("project-anime", "granted")) {
      const sp = this.actor.system.skillPoints ?? {};
      const value = sp.value ?? 0;
      if (Array.isArray(sp.log)) {
        // PC: log-based reconciliation — refund this Skill's prior entries (base + Improves), charge
        // the new Rank cost, and replace its entries with one fresh base-cost entry.
        const logged = this.#loggedFor(this.#editId);
        const newValue = value + logged - rankCost;
        if (newValue < 0) {
          return ui.notifications.warn(game.i18n.format("PROJECTANIME.SkillBuilder.notEnoughSp", { cost: rankCost - logged, sp: value }));
        }
        const log = sp.log.filter((e) => e.ref !== this.#editId);
        log.push({ id: foundry.utils.randomID(), label: name, amount: rankCost, kind: "skill", ref: this.#editId, data: {}, time: Date.now() });
        await this.actor.update({ "system.skillPoints.value": newValue, "system.skillPoints.log": log });
      } else {
        // NPC: no per-Skill ledger — reconcile by the Rank-cost DELTA (refund the Skill's current
        // cost, charge the new) and mirror it into the `spent` scalar. A rebuild also resets the
        // Skill's Improve fields; NPC Improve spends aren't separately refundable (no ledger).
        const oldCost = Number(item.system.spCost) || 0;
        const delta = rankCost - oldCost;
        const newValue = value - delta;
        if (newValue < 0) {
          return ui.notifications.warn(game.i18n.format("PROJECTANIME.SkillBuilder.notEnoughSp", { cost: delta, sp: value }));
        }
        await this.actor.update({
          "system.skillPoints.value": newValue,
          "system.skillPoints.spent": Math.max(0, (sp.spent ?? 0) + delta)
        });
      }
    }
    await item.update(update);

    ui.notifications.info(game.i18n.format("PROJECTANIME.SkillBuilder.updated", { name }));
    // A standalone item's wizard is its whole window — saving means done.
    if (this.item) return this.close();
    this.#mode = "hub";
    this.#draft = null;
    this.#editId = null;
    this.render();
  }

  /* -------------------------------------------- */
  /*  Advancement (Improving a Skill)             */
  /* -------------------------------------------- */

  /** The Skill currently being improved (null if missing / not a skill). */
  #advanceSkill() {
    const item = this.actor.items.get(this.#advanceId);
    return item && item.type === "skill" ? item : null;
  }

  /** Charge `cost` SP (blocking if short), run the change, log it for Refund, then re-render. */
  async #spend(cost, change, meta) {
    const sp = this.actor.system.skillPoints?.value ?? 0;
    if (sp < cost) {
      ui.notifications.warn(game.i18n.format("PROJECTANIME.SkillBuilder.notEnoughSp", { cost, sp }));
      return;
    }
    await change();
    await this.actor.recordSkillPointSpend({ amount: cost, ...meta });
    this.render();
  }

  /** Ledger metadata for an Improve-mode purchase on `item` (op drives how Refund reverses it). */
  #improveMeta(item, op, key = "") {
    const cfg = CONFIG.PROJECTANIME;
    let labelKey = { rank: "improveRank", range: "improveRange", energy: "improveEnergy", accuracy: "improveAccuracy", modifier: "improveModifier", growth: "improveGrowth" }[op];
    // Sharpen Damage and Sharpen Healing share the `damage` op (one field); the log names the
    // one that fits the Effect.
    if (op === "damage") labelKey = item.system.effect === "mend" ? "improveHealing" : "improveDamage";
    return {
      kind: "improve", ref: item.id, data: { op, key },
      label: game.i18n.format(`PROJECTANIME.SkillLog.entry.${labelKey}`, { skill: item.name, mod: key ? game.i18n.localize(cfg.skillModifiers[key] ?? key) : "" })
    };
  }

  static async #onRaiseRank() {
    const item = this.#advanceSkill();
    if (!item || item.system.rank >= 5) return;
    await this.#spend(1, () => item.update({ "system.rank": item.system.rank + 1 }), this.#improveMeta(item, "rank"));
  }

  static async #onRaiseRange() {
    const item = this.#advanceSkill();
    if (!item) return;
    const scope = item.system.range?.scope ?? "near";
    if (!rangeHasTiles(scope)) return; // Self / Weapon / Very Far have no tiles to raise
    await this.#spend(1, () => item.update({ "system.range.tiles": (item.system.range?.tiles ?? 0) + 1 }), this.#improveMeta(item, "range"));
  }

  static async #onLowerEnergy() {
    const item = this.#advanceSkill();
    if (!item || (item.system.energyCost ?? 0) <= (item.system.minEnergy ?? 0)) return;
    await this.#spend(1, () => item.update({ "system.energyReduction": (item.system.energyReduction ?? 0) + 1 }), this.#improveMeta(item, "energy"));
  }

  static async #onSharpenAccuracy() {
    const item = this.#advanceSkill();
    if (!item || (item.system.accuracyMod ?? 0) >= 3) return;
    await this.#spend(1, () => item.update({ "system.accuracyMod": (item.system.accuracyMod ?? 0) + 1 }), this.#improveMeta(item, "accuracy"));
  }

  /** "Sharpen Damage" / "Sharpen Healing": +1 to the Skill's rolled output, max +3 (1 SP). */
  static async #onSharpenDamage() {
    const item = this.#advanceSkill();
    if (!item || (item.system.damageMod ?? 0) >= 3) return;
    await this.#spend(1, () => item.update({ "system.damageMod": (item.system.damageMod ?? 0) + 1 }), this.#improveMeta(item, "damage"));
  }

  static async #onAddModifier(event, target) {
    const item = this.#advanceSkill();
    if (!item) return;
    const key = target.closest("[data-modifier]")?.dataset.modifier;
    if (!key) return;
    const mods = item.system.modifiers ?? [];
    const multiTake = (CONFIG.PROJECTANIME.multiTakeModifiers ?? []).includes(key);
    if (mods.includes(key) && !multiTake) return;
    // Compatibility (mirrors the build wizard): no Secondary Effect / Duration Modifier on an
    // always-on Skill; no Channeled Aura; Channeled↔Scene exclusive (Improve can't remove one).
    const sys = item.system;
    if (modifierBarredByType(key, sys)) {
      return ui.notifications.warn(game.i18n.localize("PROJECTANIME.SkillBuilder.passiveNoMod"));
    }
    if ((key === "channeled" && (mods.includes("aura") || mods.includes("scene")))
      || (key === "scene" && mods.includes("channeled"))
      || (key === "aura" && mods.includes("channeled"))) {
      return ui.notifications.warn(game.i18n.localize("PROJECTANIME.SkillBuilder.modIncompatible"));
    }
    const cost = isHeavyModifier(key, item.system) ? 2 : 1;
    if ((item.system.modifiersUsed ?? 0) + cost > (item.system.maxModifiers ?? 0)) {
      return ui.notifications.warn(game.i18n.localize("PROJECTANIME.SkillBuilder.modBudgetFull"));
    }
    // Adding a passive-only Modifier (Aura) flips the Skill to Passive so the field actually projects.
    const update = { "system.modifiers": mods.includes(key) ? mods : [...mods, key] };
    // A multi-take Modifier records its new (blank) take — it weighs on the budget immediately;
    // the Element/Status gets picked the next time the Skill is rebuilt in the wizard.
    if (key === "affinityDamage") update["system.affinityDamages"] = [...(sys.affinityDamages ?? []), { type: "", level: "resist" }];
    if (key === "affinityStatus") update["system.affinityStatusIds"] = [...(sys.affinityStatusIds ?? []), ""];
    if ((CONFIG.PROJECTANIME.passiveOnlyModifiers ?? []).includes(key)) update["system.actionType"] = "passive";
    await this.#spend(1, () => item.update(update), this.#improveMeta(item, "modifier", key));
  }

  /** "Tune a Modifier": grow a numeric Modifier's value by 1 (1 SP), capped at +3. */
  static async #onTurnModifier(event, target) {
    const item = this.#advanceSkill();
    if (!item) return;
    const key = target.closest("[data-modifier]")?.dataset.modifier;
    if (!key || !CONFIG.PROJECTANIME.growableModifiers?.[key]) return;
    if (!(item.system.modifiers ?? []).includes(key)) return;
    const cur = item.system.modifierGrowth?.[key] ?? 0;
    if (cur >= (CONFIG.PROJECTANIME.modifierGrowthMax ?? 3)) return;
    await this.#spend(1, () => item.update({ [`system.modifierGrowth.${key}`]: cur + 1 }), this.#improveMeta(item, "growth", key));
  }
}
