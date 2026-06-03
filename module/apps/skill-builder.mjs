/**
 * Project: Anime — in-game Skill Builder.
 *
 * A standalone ApplicationV2 opened from a character's Skills drawer. It has three
 * modes:
 *   • hub      — Skill-Point balance, a list of the character's Skills (each with an
 *                "Improve" button), and a "Build New Skill" button.
 *   • build    — a 6-step wizard (Concept → Rank → Roll & Range → Effect → Modifiers →
 *                Review) that creates a new Skill and spends SP = its Rank (the rules'
 *                "Learning a Skill"). Blocks if the character can't afford it.
 *   • advance  — the rules' "Improving Skills": Raise Rank / Sharpen Accuracy / Lower
 *                Energy / Raise Range (each 1 SP) plus Add a Modifier (1 SP, within the
 *                Rank's budget).
 *
 * Mirrors the AdvancementApp pattern (registers in `actor.apps` for live SP refresh)
 * and the EffectBuilder working-copy pattern (the build draft survives interactive
 * re-renders; key selects re-render to reveal dependent fields).
 */
import { enhanceSelects } from "../helpers/select.mjs";
import { elementChoices } from "../helpers/elements.mjs";
import { rangeLabel, rangeHasTiles, skillNeedsAccuracy } from "../helpers/config.mjs";
import { EffectBuilder } from "./effect-builder.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** The build-wizard steps, in order. */
const STEPS = ["concept", "rank", "roll", "effect", "modifiers", "review"];

/** Default image for a freshly-built Skill. */
const DEFAULT_SKILL_IMG = "icons/svg/upgrade.svg";

export class SkillBuilderApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor, options = {}) {
    super({ ...options, id: `pa-skill-builder-${actor.id}` });
    this.actor = actor;
    // The Character Creator opens this straight into the build wizard.
    if (options.startMode === "build") this.#beginBuild();
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
    return `${game.i18n.localize("PROJECTANIME.SkillBuilder.title")} — ${this.actor.name}`;
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
      damageType: "",
      damagePool: "hp",
      effectDuration: null,
      secondaryEffect: "strike",
      secondaryDamageAttr: "attrA",
      secondaryDamagePool: "hp",
      secondaryDamageType: "",
      trigger: "",
      modifiers: []
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
      damageType: s.damageType ?? "",
      damagePool: s.damagePool ?? "hp",
      effectDuration: s.effectDuration ?? null,
      // Secondary Effect defaults to a real Effect (only used while its Modifier is selected).
      secondaryEffect: s.secondaryEffect || "strike",
      secondaryDamageAttr: s.secondaryDamageAttr ?? "attrA",
      secondaryDamagePool: s.secondaryDamagePool ?? "hp",
      secondaryDamageType: s.secondaryDamageType ?? "",
      trigger: s.trigger ?? "",
      modifiers: [...(s.modifiers ?? [])]
    };
  }

  /** Total SP logged against a Skill (its base "skill" entry plus any "improve" entries). */
  #loggedFor(id) {
    const log = this.actor.system.skillPoints?.log ?? [];
    return log.filter((e) => e.ref === id).reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  }

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext() {
    const cfg = CONFIG.PROJECTANIME;
    const sp = this.actor.system.skillPoints?.value ?? 0;
    const ctx = { sp, config: cfg };

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
    // When editing, the SP already logged against this Skill is returned before its new Rank
    // cost is charged, so it counts toward the budget (and the cost shown is the net change).
    const editedLogged = this.#editId ? this.#loggedFor(this.#editId) : 0;
    const budget = sp + editedLogged;

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
    ctx.onRoll = stepKey === "roll";
    ctx.onEffect = stepKey === "effect";
    ctx.onModifiers = stepKey === "modifiers";
    ctx.onReview = stepKey === "review";

    ctx.actionTypeChoices = cfg.actionTypes;
    ctx.attributeChoices = cfg.attributes;
    ctx.rangeChoices = cfg.ranges;
    ctx.triggerChoices = cfg.triggers;
    ctx.effectChoices = cfg.skillEffects;
    ctx.damagePoolChoices = cfg.damagePools;
    ctx.damageTypeChoices = elementChoices();
    ctx.isReact = d.actionType === "react";
    ctx.isStrike = d.effect === "strike";
    // Damage Type only shows for Effects that use one (Strike / Affinity).
    ctx.showDamageType = cfg.damageEffects.includes(d.effect);
    // The damage/heal die choice shows for Strike / Mend.
    ctx.showDamageDie = cfg.dieEffects.includes(d.effect);
    // The HP/Energy pool field shows for Strike (damage pool) and Sustain (regen pool).
    ctx.showDamagePool = cfg.poolEffects.includes(d.effect);
    ctx.poolLabel = d.effect === "sustain" ? "PROJECTANIME.Skill.field.regenPool" : "PROJECTANIME.Skill.field.damagePool";
    ctx.showEffectExtras = ctx.showDamageDie || ctx.showDamageType || ctx.showDamagePool;
    // Bolster/Hinder auto-apply: show a 3rd Attribute at ⭐⭐⭐⭐⭐ (3 affected) + a Duration for ACTIVE
    // Skills (blank = the scene, cleared after combat; Passives stay on, so no duration field).
    ctx.isBolsterHinder = d.effect === "bolster" || d.effect === "hinder";
    ctx.showAttrC = ctx.isBolsterHinder && Number(d.rank) >= 5;
    ctx.showEffectDuration = ctx.isBolsterHinder && d.actionType !== "passive";
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

    const heavy = cfg.heavyModifiers;
    const used = d.modifiers.reduce((n, m) => n + (heavy.includes(m) ? 2 : 1), 0);
    const max = cfg.skillRanks[d.rank]?.maxModifiers ?? d.rank;
    ctx.modUsed = used;
    ctx.modMax = max;
    ctx.modOver = used > max;
    ctx.modifierList = Object.entries(cfg.skillModifiers).map(([key, label]) => {
      const isHeavy = heavy.includes(key);
      const selected = d.modifiers.includes(key);
      return {
        key,
        label: game.i18n.localize(label),
        desc: game.i18n.localize(`PROJECTANIME.Skill.modifierDesc.${key}`),
        heavy: isHeavy,
        selected,
        blocked: !selected && used + (isHeavy ? 2 : 1) > max
      };
    });

    // "Secondary Effect" Modifier — when selected, the Modifiers step shows a second Effect picker
    // (mirroring the primary's die/type/pool extras). The draft defaults the secondary to a real
    // Effect, so it always resolves once the Modifier is on.
    const secActive = d.modifiers.includes("secondaryEffect");
    const secEffect = d.secondaryEffect || "strike";
    ctx.secondaryActive = secActive;
    ctx.secondaryEffectDesc = game.i18n.localize(`PROJECTANIME.Skill.effectDesc.${secEffect}`);
    ctx.showSecondaryDie = cfg.dieEffects.includes(secEffect);
    ctx.showSecondaryType = cfg.damageEffects.includes(secEffect);
    ctx.showSecondaryPool = cfg.poolEffects.includes(secEffect);
    ctx.showSecondaryExtras = ctx.showSecondaryDie || ctx.showSecondaryType || ctx.showSecondaryPool;
    ctx.secondaryDieLabel = secEffect === "mend" ? "PROJECTANIME.Skill.field.healDie" : "PROJECTANIME.Skill.field.damageDie";
    ctx.secondaryPoolLabel = secEffect === "sustain" ? "PROJECTANIME.Skill.field.regenPool" : "PROJECTANIME.Skill.field.damagePool";

    const rank = cfg.skillRanks[d.rank] ?? {};
    const dtLabels = elementChoices();
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
      secondaryEffect: secActive ? game.i18n.localize(cfg.skillEffects[secEffect] ?? "") : "",
      damageDie: ctx.showDamageDie ? game.i18n.localize(cfg.attributes[d[d.damageAttr]] ?? "") : "",
      damageType: (ctx.showDamageType && d.damageType) ? (dtLabels[d.damageType] ?? d.damageType) : "",
      damagePool: ctx.showDamagePool ? game.i18n.localize(cfg.damagePools[d.damagePool] ?? "") : "",
      trigger: ctx.isReact && d.trigger ? game.i18n.localize(cfg.triggers[d.trigger] ?? "") : "",
      modifiers: d.modifiers.map((m) => game.i18n.localize(cfg.skillModifiers[m] ?? m)),
      spCost: rank.sp ?? d.rank,
      energyCost: d.actionType === "passive" ? 0 : (rank.energy ?? d.rank * 2)
    };
    const rankCost = rank.sp ?? d.rank;
    ctx.affordable = rankCost <= budget;
    // Edit mode swaps "Learn (cost)" for "Save Changes (net SP)" — the net is the new Rank
    // cost minus what's already logged (negative = a refund), blank when it nets to zero.
    ctx.isEditing = !!this.#editId;
    ctx.finishLabel = game.i18n.localize(this.#editId ? "PROJECTANIME.SkillBuilder.saveChanges" : "PROJECTANIME.SkillBuilder.learn");
    if (this.#editId) {
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
      accuracyMod: accuracy,
      modUsed: used,
      modMax: max,
      modifiers: (sys.modifiers ?? []).map((m) => game.i18n.localize(cfg.skillModifiers[m] ?? m))
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

    const heavy = cfg.heavyModifiers;
    ctx.addableModifiers = Object.entries(cfg.skillModifiers)
      .filter(([key]) => !(sys.modifiers ?? []).includes(key))
      .map(([key, label]) => {
        const isHeavy = heavy.includes(key);
        const cost = isHeavy ? 2 : 1;
        return {
          key,
          label: game.i18n.localize(label),
          desc: game.i18n.localize(`PROJECTANIME.Skill.modifierDesc.${key}`),
          heavy: isHeavy,
          blocked: used + cost > max,
          disabled: used + cost > max || !canAfford
        };
      });

    // "Tune a Modifier" (rules): grow the numeric value of a Modifier the Skill already has
    // (Burst radius, Chain targets). 1 SP each. Only Modifiers in growableModifiers qualify.
    const growable = cfg.growableModifiers ?? {};
    ctx.growableMods = (sys.modifiers ?? [])
      .filter((key) => growable[key])
      .map((key) => {
        const base = growable[key].base ?? 0;
        const growth = sys.modifierGrowth?.[key] ?? 0;
        return {
          key,
          label: game.i18n.localize(cfg.skillModifiers[key] ?? key),
          unit: game.i18n.localize(growable[key].unit ?? ""),
          base,
          growth,
          current: base + growth,
          next: base + growth + 1,
          disabled: !canAfford
        };
      });
  }

  /* -------------------------------------------- */
  /*  Render                                      */
  /* -------------------------------------------- */

  /** @override — live-refresh on actor changes; theme + wire build-mode selects. */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.actor.apps[this.id] = this;
    if (this.#mode !== "build") return;
    enhanceSelects(this.element);
    // Re-render when a select that drives dependent fields changes (action type
    // reveals the React Trigger; effect changes its description / damage fields).
    for (const sel of this.element.querySelectorAll('select[name="actionType"], select[name="effect"], select[name="secondaryEffect"], select[name="rangeScope"]')) {
      sel.addEventListener("change", () => { this.#sync(); this.render(); });
    }
  }

  _onClose(options) {
    delete this.actor.apps[this.id];
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
    if (data.effect) d.effect = data.effect;
    if (data.damageAttr) d.damageAttr = data.damageAttr;
    if (data.damagePool) d.damagePool = data.damagePool;
    if ("damageType" in data) d.damageType = data.damageType ?? "";
    if ("attrC" in data) d.attrC = data.attrC ?? "";
    if ("effectDuration" in data) {
      const n = Math.round(Number(data.effectDuration));
      d.effectDuration = Number.isFinite(n) && n >= 1 ? n : null; // blank/invalid → null = scene
    }
    // Secondary Effect fields (only present on the Modifiers step while the Modifier is selected).
    if (data.secondaryEffect) d.secondaryEffect = data.secondaryEffect;
    if (data.secondaryDamageAttr) d.secondaryDamageAttr = data.secondaryDamageAttr;
    if (data.secondaryDamagePool) d.secondaryDamagePool = data.secondaryDamagePool;
    if ("secondaryDamageType" in data) d.secondaryDamageType = data.secondaryDamageType ?? "";
    if ("trigger" in data) d.trigger = data.trigger ?? "";
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
   */
  static async #onEditEffects(event, target) {
    const id = target.closest("[data-skill-id]")?.dataset.skillId;
    const item = this.actor.items.get(id);
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

  /** Block leaving a step that isn't valid yet (a React Skill needs a Trigger). */
  #validateStep() {
    const d = this.#draft;
    if (STEPS[this.#step] === "concept" && d.actionType === "react" && !d.trigger) {
      ui.notifications.warn(game.i18n.localize("PROJECTANIME.Skill.reactNeedsTrigger"));
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
    const cfg = CONFIG.PROJECTANIME;
    const heavy = cfg.heavyModifiers;
    const mods = this.#draft.modifiers;
    const at = mods.indexOf(key);
    if (at >= 0) {
      mods.splice(at, 1);
    } else {
      const used = mods.reduce((n, m) => n + (heavy.includes(m) ? 2 : 1), 0);
      const cost = heavy.includes(key) ? 2 : 1;
      const max = cfg.skillRanks[this.#draft.rank]?.maxModifiers ?? this.#draft.rank;
      if (used + cost > max) return ui.notifications.warn(game.i18n.localize("PROJECTANIME.SkillBuilder.modBudgetFull"));
      mods.push(key);
    }
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
    // A React Skill must carry a Trigger (re-check in case steps were jumped).
    if (d.actionType === "react" && !d.trigger) {
      this.#step = STEPS.indexOf("concept");
      ui.notifications.warn(game.i18n.localize("PROJECTANIME.Skill.reactNeedsTrigger"));
      return this.render();
    }
    const name = (d.name || "").trim() || game.i18n.localize("PROJECTANIME.SkillBuilder.newSkillName");
    const rankCost = cfg.skillRanks[d.rank]?.sp ?? d.rank;
    // The Secondary Effect persists only while its Modifier is selected; otherwise it's cleared.
    const hasSecondary = d.modifiers.includes("secondaryEffect");
    const system = {
      description: d.description ?? "",
      rank: d.rank,
      actionType: d.actionType,
      attributes: { attrA: d.attrA, attrB: d.attrB, attrC: d.attrC ?? "" },
      damageAttr: d.damageAttr,
      range: d.range,
      effect: d.effect,
      // Only damage Effects (Strike / Affinity) keep a damage type.
      damageType: cfg.damageEffects.includes(d.effect) ? (d.damageType ?? "") : "",
      damagePool: d.damagePool,
      effectDuration: d.effectDuration ?? null,
      secondaryEffect: hasSecondary ? (d.secondaryEffect || "") : "",
      secondaryDamageAttr: d.secondaryDamageAttr,
      secondaryDamagePool: d.secondaryDamagePool,
      secondaryDamageType: hasSecondary && cfg.damageEffects.includes(d.secondaryEffect) ? (d.secondaryDamageType ?? "") : "",
      trigger: d.actionType === "react" ? d.trigger : "",
      modifiers: [...d.modifiers]
    };
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
    const item = this.actor.items.get(this.#editId);
    if (!item) { this.#mode = "hub"; this.#draft = null; this.#editId = null; return this.render(); }

    // Rewrite the Skill (flattened so any removed Modifier-growth keys can be deleted cleanly).
    const update = foundry.utils.flattenObject({
      name, img: this.#draft.img || DEFAULT_SKILL_IMG,
      system: { ...system, accuracyMod: 0, damageMod: 0, energyReduction: 0 }
    });
    for (const key of Object.keys(item.system.modifierGrowth ?? {})) update[`system.modifierGrowth.-=${key}`] = null;

    if (!item.getFlag("project-anime", "granted")) {
      const logged = this.#loggedFor(this.#editId);
      const value = this.actor.system.skillPoints?.value ?? 0;
      const newValue = value + logged - rankCost;
      if (newValue < 0) {
        return ui.notifications.warn(game.i18n.format("PROJECTANIME.SkillBuilder.notEnoughSp", { cost: rankCost - logged, sp: value }));
      }
      const log = (this.actor.system.skillPoints?.log ?? []).filter((e) => e.ref !== this.#editId);
      log.push({ id: foundry.utils.randomID(), label: name, amount: rankCost, kind: "skill", ref: this.#editId, data: {}, time: Date.now() });
      await this.actor.update({ "system.skillPoints.value": newValue, "system.skillPoints.log": log });
    }
    await item.update(update);

    ui.notifications.info(game.i18n.format("PROJECTANIME.SkillBuilder.updated", { name }));
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
    const cfg = CONFIG.PROJECTANIME;
    const mods = item.system.modifiers ?? [];
    if (mods.includes(key)) return;
    const cost = cfg.heavyModifiers.includes(key) ? 2 : 1;
    if ((item.system.modifiersUsed ?? 0) + cost > (item.system.maxModifiers ?? 0)) {
      return ui.notifications.warn(game.i18n.localize("PROJECTANIME.SkillBuilder.modBudgetFull"));
    }
    await this.#spend(1, () => item.update({ "system.modifiers": [...mods, key] }), this.#improveMeta(item, "modifier", key));
  }

  /** "Tune a Modifier": grow a numeric Modifier's value by 1 (1 SP). */
  static async #onTurnModifier(event, target) {
    const item = this.#advanceSkill();
    if (!item) return;
    const key = target.closest("[data-modifier]")?.dataset.modifier;
    if (!key || !CONFIG.PROJECTANIME.growableModifiers?.[key]) return;
    if (!(item.system.modifiers ?? []).includes(key)) return;
    const cur = item.system.modifierGrowth?.[key] ?? 0;
    await this.#spend(1, () => item.update({ [`system.modifierGrowth.${key}`]: cur + 1 }), this.#improveMeta(item, "growth", key));
  }
}
