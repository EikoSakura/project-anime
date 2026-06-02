/**
 * Project: Anime — step-by-step Monster Creator.
 *
 * A guided ApplicationV2 that builds a combat NPC ("monster") on the SAME rules as a
 * Player Character — the five Attributes start at d4 and you spend Step-Ups; HP =
 * ⟪Might⟫×2, Energy = ⟪Spirit⟫×2 — then scales it by an anime power **Tier** (Minion /
 * Elite / Boss / Raid Boss; see PROJECTANIME.monsterTiers). The Tier sets the Step-Up
 * budget, multiplies HP / Energy, grants flat Evasion / Defense, and hands out Skill
 * Points to build the monster's powers with the in-game Skill Builder.
 *
 * It is a deliberately simple STARTING point — generate a reasonable statblock fast,
 * then hand-tune any number on the sheet afterwards (the Tier values live in config and
 * are meant to be rebalanced). Like the Character Creator it operates on the LIVE actor
 * and registers in `actor.apps`, so changes refresh it live; it sets the same
 * `flags.project-anime.creationComplete` on finish.
 *
 * Reuses the Character Creator's `.cc-*` stylesheet via the shared `character-creator`
 * class (plus `monster-creator` for the Tier-specific bits).
 */
import { SkillBuilderApp } from "./skill-builder.mjs";
import { tierScaling, getEncounterPower } from "../helpers/config.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Creation steps, in order. */
const STEPS = ["concept", "tier", "attributes", "stats", "abilities", "finish"];

/** Stable ordering: by sort, then name. */
const bySort = (a, b) => (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name);

export class MonsterCreatorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor, options = {}) {
    super({ ...options, id: `pa-monster-creator-${actor.id}` });
    this.actor = actor;
  }

  static DEFAULT_OPTIONS = {
    // `character-creator` pulls in the shared creator stylesheet; `monster-creator`
    // carries the Tier-specific deltas.
    classes: ["project-anime", "character-creator", "monster-creator"],
    tag: "form",
    position: { width: 660, height: "auto" },
    window: { title: "PROJECTANIME.MonsterCreator.title", icon: "fa-solid fa-dragon" },
    form: { handler: MonsterCreatorApp.#onFormSubmit, submitOnChange: false, closeOnSubmit: false },
    actions: {
      stepNext: MonsterCreatorApp.#onStepNext,
      stepBack: MonsterCreatorApp.#onStepBack,
      gotoStep: MonsterCreatorApp.#onGotoStep,
      pickImage: MonsterCreatorApp.#onPickImage,
      pickTier: MonsterCreatorApp.#onPickTier,
      raiseAttr: MonsterCreatorApp.#onRaiseAttr,
      lowerAttr: MonsterCreatorApp.#onLowerAttr,
      recalcVitals: MonsterCreatorApp.#onRecalcVitals,
      openSkillBuilder: MonsterCreatorApp.#onOpenSkillBuilder,
      removeSkill: MonsterCreatorApp.#onRemoveSkill,
      finish: MonsterCreatorApp.#onFinish
    }
  };

  static PARTS = {
    body: { template: "systems/project-anime/templates/apps/monster-creator.hbs", scrollable: [""] }
  };

  /** Current step index. */
  #step = 0;

  get title() {
    return `${game.i18n.localize("PROJECTANIME.MonsterCreator.title")} — ${this.actor.name}`;
  }

  /* -------------------------------------------- */
  /*  Tier helpers                                */
  /* -------------------------------------------- */

  /** The selected Tier's EFFECTIVE entry at the current Encounter Power (scaled Skill
   *  Points + HP multiplier, fixed knobs spread through), or null while untiered. */
  #tier() {
    return this.actor.system.tier ? tierScaling(this.actor.system.tier) : null;
  }

  /** Attribute Step-Up budget = the selected Tier's allotment (0 until one is picked). */
  #budget() {
    return this.#tier()?.stepUps ?? 0;
  }

  /** HP / Energy multiplier from the Tier (1 while untiered). */
  #mult() {
    return this.#tier()?.vitalMult ?? 1;
  }

  /** Step-Ups already spent = sum over attributes of (steps above d4). */
  #stepsUsed() {
    const attrs = this.actor.system.attributes;
    return CONFIG.PROJECTANIME.attributeKeys.reduce(
      (n, k) => n + Math.max(0, ((attrs[k].base ?? 4) - 4) / 2),
      0
    );
  }

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext() {
    const cfg = CONFIG.PROJECTANIME;
    const sys = this.actor.system;
    const stepKey = STEPS[this.#step];
    const ctx = { config: cfg };

    ctx.steps = STEPS.map((k, i) => ({
      key: k,
      num: i + 1,
      label: game.i18n.localize(`PROJECTANIME.MonsterCreator.step.${k}`),
      index: i,
      active: i === this.#step,
      done: i < this.#step
    }));
    ctx.stepLabel = game.i18n.format("PROJECTANIME.MonsterCreator.stepOf", { n: this.#step + 1, total: STEPS.length });
    ctx.stepTitle = game.i18n.localize(`PROJECTANIME.MonsterCreator.step.${stepKey}`);
    ctx.isFirst = this.#step === 0;
    ctx.isLast = this.#step === STEPS.length - 1;
    ctx.onConcept = stepKey === "concept";
    ctx.onTier = stepKey === "tier";
    ctx.onAttributes = stepKey === "attributes";
    ctx.onStats = stepKey === "stats";
    ctx.onAbilities = stepKey === "abilities";
    ctx.onFinish = stepKey === "finish";

    // Identity.
    ctx.name = this.actor.name;
    ctx.img = this.actor.img;
    ctx.biography = sys.biography ?? "";
    ctx.disposition = sys.disposition ?? "neutral";

    // Tier — the cards (Skill Points + HP multiplier scaled to the current Encounter
    // Power) + the selected key. The dial readout shows the basis for those numbers.
    const power = getEncounterPower();
    ctx.encounterPower = power;
    ctx.tierKey = sys.tier ?? "";
    ctx.tiers = cfg.monsterTierKeys.map((k) => {
      const t = cfg.monsterTiers[k];
      const s = tierScaling(k, power);
      return {
        key: k,
        label: game.i18n.localize(t.label),
        icon: t.icon,
        color: t.color,
        stepUps: t.stepUps,
        vitalMult: Math.round(s.vitalMult * 10) / 10,
        evasion: t.evasion,
        defense: t.defense,
        skillPoints: s.skillPoints,
        selected: sys.tier === k
      };
    });

    // Attributes — Step-Ups against the Tier budget.
    const used = this.#stepsUsed();
    const budget = this.#budget();
    ctx.hasTier = !!this.#tier();
    ctx.stepsUsed = used;
    ctx.stepsTotal = budget;
    ctx.stepsLeft = Math.max(0, budget - used);
    ctx.overSpent = used > budget;
    ctx.attributes = cfg.attributeKeys.map((k) => {
      const a = sys.attributes[k];
      return {
        key: k,
        label: game.i18n.localize(cfg.attributes[k]),
        icon: cfg.attributeIcons?.[k] ?? "",
        base: a.base,
        die: `d${a.base}`,
        canRaise: a.base < 12 && used < budget,
        canLower: a.base > 4
      };
    });

    // Combat Stats (derived from the current attributes × the Tier).
    const might = sys.attributes.might.base;
    const spirit = sys.attributes.spirit.base;
    const rawMult = this.#mult();          // exact multiplier used to derive HP/Energy
    ctx.mult = Math.round(rawMult * 10) / 10;   // tidy value for the on-screen note
    ctx.tierName = this.#tier() ? game.i18n.localize(this.#tier().label) : game.i18n.localize("PROJECTANIME.MonsterCreator.noTier");
    ctx.vitals = {
      hp: sys.hp.max,
      energy: sys.energy.max,
      evasion: sys.evasion.value,
      defense: sys.defense.value,
      movement: sys.movement.value,
      carry: sys.carryingCapacity.max
    };
    ctx.vitalNote = game.i18n.format("PROJECTANIME.MonsterCreator.vitalNote", { mult: ctx.mult, tier: ctx.tierName });
    ctx.vitalsStale = sys.hp.max !== Math.round(might * 2 * rawMult) || sys.energy.max !== Math.round(spirit * 2 * rawMult);

    // Abilities — the Tier's Skill Points and what's been built.
    ctx.sp = sys.skillPoints?.value ?? 0;
    ctx.skills = this.actor.items
      .filter((i) => i.type === "skill")
      .sort(bySort)
      .map((i) => ({
        id: i.id,
        name: i.name,
        img: i.img,
        stars: cfg.skillRanks[i.system.rank]?.stars ?? "",
        actionLabel: game.i18n.localize(cfg.actionTypes[i.system.actionType] ?? ""),
        energyCost: i.system.energyCost ?? 0,
        passive: i.system.actionType === "passive"
      }));

    // Review (last step) — a compact summary card.
    ctx.tierBadge = this.#tier()
      ? { label: ctx.tierName, icon: this.#tier().icon, color: this.#tier().color }
      : null;
    ctx.skillCount = ctx.skills.length;

    return ctx;
  }

  /* -------------------------------------------- */
  /*  Render lifecycle                            */
  /* -------------------------------------------- */

  /** @override — live-refresh on actor changes by joining the document app registry. */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.actor.apps[this.id] = this;
  }

  _onClose(options) {
    delete this.actor.apps[this.id];
    super._onClose?.(options);
  }

  /* -------------------------------------------- */
  /*  Form persistence                            */
  /* -------------------------------------------- */

  static #onFormSubmit() {
    return this.#sync();
  }

  /** Persist the open step's text inputs (name + any system.* fields) to the actor. */
  async #sync() {
    if (!this.element || !this.actor.isOwner) return;
    const data = foundry.utils.flattenObject(new foundry.applications.ux.FormDataExtended(this.element).object);
    const update = {};
    if (typeof data.name === "string" && data.name !== this.actor.name) update.name = data.name;
    for (const [key, val] of Object.entries(data)) {
      if (key.startsWith("system.")) update[key] = val;
    }
    if (Object.keys(update).length) await this.actor.update(update);
  }

  /* -------------------------------------------- */
  /*  Navigation                                  */
  /* -------------------------------------------- */

  static async #onStepNext() {
    await this.#sync();
    if (!this.#validateStep()) return;
    if (this.#step < STEPS.length - 1) this.#step += 1;
    await this.#onEnterStep();
    this.render();
  }

  static async #onStepBack() {
    await this.#sync();
    if (this.#step > 0) this.#step -= 1;
    await this.#onEnterStep();
    this.render();
  }

  static async #onGotoStep(event, target) {
    await this.#sync();
    const i = Number(target.dataset.step);
    if (i >= 0 && i < STEPS.length) this.#step = i;
    await this.#onEnterStep();
    this.render();
  }

  /** Block leaving a step that isn't legal yet: a Tier must be chosen, then all of its
   *  Step-Ups distributed (exactly — no under- or over-spend). */
  #validateStep() {
    const key = STEPS[this.#step];
    // A Tier gates the Step-Up budget — require one before leaving either step (the
    // step dots allow free jumping, so guard attributes too, not just the Tier step).
    if ((key === "tier" || key === "attributes") && !this.#tier()) {
      ui.notifications.warn(game.i18n.localize("PROJECTANIME.MonsterCreator.pickTierFirst"));
      return false;
    }
    if (key === "attributes") {
      const left = this.#budget() - this.#stepsUsed();
      if (left !== 0) {
        ui.notifications.warn(game.i18n.format("PROJECTANIME.MonsterCreator.stepsRemaining", { n: Math.abs(left) }));
        return false;
      }
    }
    return true;
  }

  /** Side effect on entering the Combat Stats step: keep HP/Energy synced to the
   *  attributes × the Tier multiplier (creation only — don't clobber later hand-tuning). */
  async #onEnterStep() {
    const key = STEPS[this.#step];
    if (key === "stats" && !this.actor.getFlag("project-anime", "creationComplete")) {
      await this.#applyVitals();
    }
  }

  /** Set HP and Energy to full from the current attributes × the Tier multiplier. */
  async #applyVitals() {
    const a = this.actor.system.attributes;
    const mult = this.#mult();
    const hp = Math.round(a.might.base * 2 * mult);
    const energy = Math.round(a.spirit.base * 2 * mult);
    await this.actor.update({
      "system.hp.max": hp,
      "system.hp.value": hp,
      "system.energy.max": energy,
      "system.energy.value": energy
    });
  }

  /* -------------------------------------------- */
  /*  Concept                                     */
  /* -------------------------------------------- */

  static async #onPickImage() {
    const FP = foundry.applications.apps.FilePicker?.implementation
      ?? foundry.applications.apps.FilePicker
      ?? globalThis.FilePicker;
    const fp = new FP({
      type: "image",
      current: this.actor.img || "",
      callback: (path) => this.actor.update({ img: path }).catch((err) => ui.notifications.error(err.message))
    });
    return fp.browse();
  }

  /* -------------------------------------------- */
  /*  Tier                                        */
  /* -------------------------------------------- */

  /** Pick a Tier: stamp it, apply its flat Evasion/Defense, grant its Skill Points,
   *  re-fit the Step-Up budget, and re-derive HP/Energy (all while still creating). */
  static async #onPickTier(event, target) {
    const key = target.closest("[data-tier]")?.dataset.tier;
    const tier = tierScaling(key);   // scaled to the current Encounter Power
    if (!tier) return;
    const creating = !this.actor.getFlag("project-anime", "creationComplete");
    const update = {
      "system.tier": key,
      "system.evasion.bonus": tier.evasion,
      "system.defense.bonus": tier.defense
    };
    // Seed the Skill-Point pool to the Tier's (scaled) grant — only while creating, so
    // re-opening the creator on a finished monster never wipes points it has already spent.
    if (creating) update["system.skillPoints.value"] = tier.skillPoints;
    await this.actor.update(update);
    // If the new Tier has a smaller budget than what's already spent, trim the excess.
    await this.#fitStepUps(tier.stepUps);
    if (creating) await this.#applyVitals();
    this.render();
  }

  /** Lower the largest dice (one step at a time) until spent Step-Ups fit `budget`. */
  async #fitStepUps(budget) {
    const keys = CONFIG.PROJECTANIME.attributeKeys;
    const update = {};
    const baseOf = (key) => update[`system.attributes.${key}.base`] ?? this.actor.system.attributes[key].base;
    const usedNow = () => keys.reduce((n, key) => n + Math.max(0, (baseOf(key) - 4) / 2), 0);
    while (usedNow() > budget) {
      const highest = keys.filter((key) => baseOf(key) > 4).sort((a, b) => baseOf(b) - baseOf(a))[0];
      if (!highest) break;
      update[`system.attributes.${highest}.base`] = baseOf(highest) - 2;
    }
    if (Object.keys(update).length) await this.actor.update(update);
  }

  /* -------------------------------------------- */
  /*  Attributes (Step-Ups)                       */
  /* -------------------------------------------- */

  static async #onRaiseAttr(event, target) {
    const key = target.closest("[data-attribute]")?.dataset.attribute;
    const attr = this.actor.system.attributes[key];
    if (!attr || attr.base >= 12) return;
    if (this.#stepsUsed() >= this.#budget()) {
      return ui.notifications.warn(game.i18n.localize("PROJECTANIME.MonsterCreator.noStepsLeft"));
    }
    await this.actor.update({ [`system.attributes.${key}.base`]: attr.base + 2 });
  }

  static async #onLowerAttr(event, target) {
    const key = target.closest("[data-attribute]")?.dataset.attribute;
    const attr = this.actor.system.attributes[key];
    if (!attr || attr.base <= 4) return;
    await this.actor.update({ [`system.attributes.${key}.base`]: attr.base - 2 });
  }

  /* -------------------------------------------- */
  /*  Combat Stats                                */
  /* -------------------------------------------- */

  static async #onRecalcVitals() {
    await this.#applyVitals();
  }

  /* -------------------------------------------- */
  /*  Abilities (Skill Builder hand-off)          */
  /* -------------------------------------------- */

  /** Open (or focus) the in-game Skill Builder, jumping straight into Build mode. */
  static #onOpenSkillBuilder() {
    const id = `pa-skill-builder-${this.actor.id}`;
    const existing = foundry.applications.instances.get(id);
    if (existing) return existing.bringToFront();
    return new SkillBuilderApp(this.actor, { startMode: "build" }).render(true);
  }

  /** Delete a built ability (creation is a sandbox — undo is free). */
  static async #onRemoveSkill(event, target) {
    const id = target.closest("[data-skill-id]")?.dataset.skillId;
    const item = this.actor.items.get(id);
    if (!item || item.type !== "skill") return;
    if (item.getFlag("project-anime", "granted")) return;
    await item.delete();
    this.render();
  }

  /* -------------------------------------------- */
  /*  Finish                                      */
  /* -------------------------------------------- */

  static async #onFinish() {
    await this.#sync();
    await this.actor.setFlag("project-anime", "creationComplete", true);
    ui.notifications.info(game.i18n.format("PROJECTANIME.MonsterCreator.done", { name: this.actor.name }));
    this.close();
  }
}
