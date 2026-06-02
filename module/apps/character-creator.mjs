/**
 * Project: Anime — step-by-step Character Creator.
 *
 * A guided ApplicationV2 that walks a new Player Character through the rulebook's
 * six creation steps (p.6):
 *   1. Concept        — portrait, name, and a concept / appearance blurb.
 *   2. Attributes     — the five Attributes start at d4; spend 5 free Step-Ups.
 *   3. Combat Stats   — HP = ⟪Might⟫×2, Energy = ⟪Spirit⟫×2 (set to full), the
 *                       derived Evasion/Carry/Movement, and 3 Luck Dice (⟪Charm⟫).
 *   4. Create Skills  — begin with 6 SP; hands off to the in-game Skill Builder.
 *   5. Purchase Gear  — a 1500G budget shop over this system's Item compendiums
 *                       + world Items (weapons/armor/shields/consumables/gear only).
 *   6. Finishing      — pronouns and the GM-configurable dossier fields.
 *
 * Like the Skill Builder and Advancement apps, it operates on the LIVE actor and
 * registers in `actor.apps`, so changes made here — or in the Skill Builder it
 * launches — refresh it live. Sets `flags.project-anime.creationComplete` on finish
 * (the actor sheet auto-opens this once for an owner until that flag is set).
 */
import { SkillBuilderApp } from "./skill-builder.mjs";
import { getBioFields } from "../helpers/bio-fields.mjs";
import { isImageIcon } from "../helpers/elements.mjs";
import { collectLuckSteps, stepUpDie } from "../helpers/effects.mjs";
import { getCreationConfig } from "../helpers/creation.mjs";
import { postRollCard } from "../helpers/dice.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Base creation steps, in rulebook order. The optional "choose" step (Race/Class/…) is
 *  inserted after Concept only when the GM has configured creation Choices. */
const BASE_STEPS = ["concept", "attributes", "stats", "skills", "gear", "finish"];

/** Stable ordering: by sort, then name. */
const bySort = (a, b) => (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name);

export class CharacterCreatorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor, options = {}) {
    super({ ...options, id: `pa-character-creator-${actor.id}` });
    this.actor = actor;
  }

  static DEFAULT_OPTIONS = {
    classes: ["project-anime", "character-creator"],
    tag: "form",
    position: { width: 660, height: "auto" },
    window: { title: "PROJECTANIME.Creator.title", icon: "fa-solid fa-user-plus" },
    // No real submit — navigation and commits run through the action buttons below.
    // (Enter in a text field still routes here, so we persist the open step's fields.)
    form: { handler: CharacterCreatorApp.#onFormSubmit, submitOnChange: false, closeOnSubmit: false },
    actions: {
      stepNext: CharacterCreatorApp.#onStepNext,
      stepBack: CharacterCreatorApp.#onStepBack,
      gotoStep: CharacterCreatorApp.#onGotoStep,
      pickImage: CharacterCreatorApp.#onPickImage,
      raiseAttr: CharacterCreatorApp.#onRaiseAttr,
      lowerAttr: CharacterCreatorApp.#onLowerAttr,
      recalcVitals: CharacterCreatorApp.#onRecalcVitals,
      rollLuck: CharacterCreatorApp.#onRollLuck,
      openSkillBuilder: CharacterCreatorApp.#onOpenSkillBuilder,
      editSkill: CharacterCreatorApp.#onEditSkill,
      removeSkill: CharacterCreatorApp.#onRemoveSkill,
      chooseOption: CharacterCreatorApp.#onChooseOption,
      shopFilter: CharacterCreatorApp.#onShopFilter,
      refreshShop: CharacterCreatorApp.#onRefreshShop,
      buyItem: CharacterCreatorApp.#onBuyItem,
      sellItem: CharacterCreatorApp.#onSellItem,
      finish: CharacterCreatorApp.#onFinish
    }
  };

  static PARTS = {
    body: { template: "systems/project-anime/templates/apps/character-creator.hbs", scrollable: [""] }
  };

  /** Current step index. */
  #step = 0;
  /** Cached shop entries (compendium + world Items of the allowed types); null = unloaded. */
  #shop = null;
  /** Shop type filter ("all" | one of the configured purchasable types). */
  #shopType = "all";

  get title() {
    return `${game.i18n.localize("PROJECTANIME.Creator.title")} — ${this.actor.name}`;
  }

  /** The active step keys — "choose" is present only when the GM configured Choices. */
  #stepKeys() {
    const keys = [...BASE_STEPS];
    if (getCreationConfig().choices?.length) keys.splice(1, 0, "choose");
    return keys;
  }

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext() {
    const cfg = CONFIG.PROJECTANIME;
    const creation = getCreationConfig();
    const sys = this.actor.system;
    const steps = this.#stepKeys();
    const stepKey = steps[this.#step];
    const ctx = { config: cfg };

    ctx.steps = steps.map((k, i) => ({
      key: k,
      num: i + 1,
      label: game.i18n.localize(`PROJECTANIME.Creator.step.${k}`),
      index: i,
      active: i === this.#step,
      done: i < this.#step
    }));
    ctx.stepLabel = game.i18n.format("PROJECTANIME.Creator.stepOf", { n: this.#step + 1, total: steps.length });
    ctx.stepTitle = game.i18n.localize(`PROJECTANIME.Creator.step.${stepKey}`);
    ctx.isFirst = this.#step === 0;
    ctx.isLast = this.#step === steps.length - 1;
    ctx.onConcept = stepKey === "concept";
    ctx.onChoose = stepKey === "choose";
    ctx.onAttributes = stepKey === "attributes";
    ctx.onStats = stepKey === "stats";
    ctx.onSkills = stepKey === "skills";
    ctx.onGear = stepKey === "gear";
    ctx.onFinish = stepKey === "finish";

    // Creation Choices (Race/Class/…) — each offers Package options that grant abilities
    // for free. Current selection(s) = the chosen-option Packages already on the actor.
    if (stepKey === "choose") {
      ctx.choices = creation.choices.map((choice) => {
        const chosen = this.#chosenUuidsFor(choice.id);
        return {
          id: choice.id,
          label: choice.label,
          pickN: choice.mode === "pickN",
          n: choice.n,
          chosenCount: chosen.size,
          options: choice.options.map((opt) => ({
            uuid: opt.uuid,
            label: opt.label,
            img: opt.img || "icons/svg/item-bag.svg",
            selected: chosen.has(opt.uuid)
          }))
        };
      });
    }

    // Identity.
    ctx.name = this.actor.name;
    ctx.img = this.actor.img;
    ctx.biography = sys.biography ?? "";
    ctx.pronouns = sys.pronouns ?? "";

    // Attributes — the free creation Step-Ups (count from the GM setting).
    const used = this.#stepsUsed();
    ctx.stepsUsed = used;
    ctx.stepsTotal = creation.stepUps;
    ctx.stepsLeft = Math.max(0, creation.stepUps - used);
    ctx.overSpent = used > creation.stepUps;
    ctx.attributes = cfg.attributeKeys.map((k) => {
      const a = sys.attributes[k];
      return {
        key: k,
        label: game.i18n.localize(cfg.attributes[k]),
        icon: cfg.attributeIcons?.[k] ?? "",
        base: a.base,
        die: `d${a.base}`,
        canRaise: a.base < 12 && ctx.stepsLeft > 0,
        canLower: a.base > 4
      };
    });

    // Combat Stats (computed from the current attributes; the model derives the rest).
    const might = sys.attributes.might.base;
    const spirit = sys.attributes.spirit.base;
    ctx.vitals = {
      hp: sys.hp.max,
      energy: sys.energy.max,
      evasion: sys.evasion.value,
      carry: sys.carryingCapacity.max,
      movement: sys.movement.value
    };
    ctx.vitalsStale = sys.hp.max !== might * 2 || sys.energy.max !== spirit * 2;
    ctx.luckDice = sys.luckDice ?? [];
    ctx.charmDie = `d${sys.attributes.charm.base}`;

    // Skills — the starting 6 SP and what's been built.
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
        spCost: i.system.spCost ?? i.system.rank ?? 0,
        passive: i.system.actionType === "passive"
      }));

    // Gear shop (lazy-load the catalogue the first time this step is shown).
    if (stepKey === "gear") {
      if (this.#shop === null) await this.#loadShop();
      const gold = sys.gold ?? 0;
      ctx.gold = gold;
      ctx.budget = creation.gold;
      ctx.shopFilters = [
        { key: "all", label: game.i18n.localize("PROJECTANIME.Creator.all"), active: this.#shopType === "all" },
        ...creation.allowedTypes.map((t) => ({ key: t, label: game.i18n.localize(`TYPES.Item.${t}`), active: this.#shopType === t }))
      ];
      ctx.shop = (this.#shop ?? [])
        .filter((e) => this.#shopType === "all" || e.type === this.#shopType)
        .map((e) => ({ ...e, affordable: e.cost <= gold }));
      ctx.owned = this.actor.items
        .filter((i) => creation.allowedTypes.includes(i.type))
        .sort(bySort)
        .map((i) => ({ id: i.id, name: i.name, img: i.img, cost: Number(i.system?.cost ?? 0) || 0 }));
    }

    // Finishing Touches — pronouns + the GM-configurable dossier fields.
    ctx.bioFields = getBioFields().map((f) => ({
      key: f.key,
      label: f.label,
      long: f.type === "long",
      icon: f.icon,
      iconImg: f.icon ? isImageIcon(f.icon) : false,
      value: sys.details?.[f.key] ?? ""
    }));

    return ctx;
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
    // Enter in a field routes here — persist the open step's inputs.
    return this.#sync();
  }

  /** Persist the open step's text inputs (name + any system.* fields) to the actor. */
  async #sync() {
    if (!this.element || !this.actor.isOwner) return;
    // Flatten so dotted (`system.details.age`) keys resolve whether FormDataExtended
    // returns a flat or a nested object.
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
    if (this.#step < this.#stepKeys().length - 1) this.#step += 1;
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
    if (i >= 0 && i < this.#stepKeys().length) this.#step = i;
    await this.#onEnterStep();
    this.render();
  }

  /** Block leaving a step that isn't legal yet: all Step-Ups distributed; every single-pick
   *  Choice (Race/Class) selected. */
  #validateStep() {
    const creation = getCreationConfig();
    const key = this.#stepKeys()[this.#step];
    if (key === "attributes" && this.#stepsUsed() < creation.stepUps) {
      ui.notifications.warn(game.i18n.format("PROJECTANIME.Creator.stepsRemaining", {
        n: creation.stepUps - this.#stepsUsed()
      }));
      return false;
    }
    if (key === "choose") {
      const missing = creation.choices.find((c) => c.mode === "single" && this.#chosenUuidsFor(c.id).size === 0);
      if (missing) {
        ui.notifications.warn(game.i18n.format("PROJECTANIME.Creator.chooseRequired", { label: missing.label }));
        return false;
      }
    }
    return true;
  }

  /** Side effects on entering a step: keep HP/Energy synced; grant the gear budget once. */
  async #onEnterStep() {
    const key = this.#stepKeys()[this.#step];
    if (key === "stats") {
      // During initial creation, keep HP/Energy synced to the attributes (rules: set
      // at creation from ⟪Might⟫/⟪Spirit⟫). Once creation is finished, don't auto-reset
      // — that would wipe HP/Energy bought later via Advancement; the manual Recalculate
      // button still lets them re-derive on purpose.
      const a = this.actor.system.attributes;
      const stale = this.actor.system.hp.max !== a.might.base * 2 || this.actor.system.energy.max !== a.spirit.base * 2;
      if (stale && !this.actor.getFlag("project-anime", "creationComplete")) await this.#applyVitals();
    } else if (key === "gear") {
      // Grant the starting Gold budget exactly once (so re-running the creator, or
      // stepping back and forth, never resets gold the player has spent).
      if (!this.actor.getFlag("project-anime", "creatorBudget")) {
        await this.actor.update({ "system.gold": getCreationConfig().gold });
        await this.actor.setFlag("project-anime", "creatorBudget", true);
      }
    }
  }

  /** Set HP and Energy to full from the current attributes (rules p.6). */
  async #applyVitals() {
    const a = this.actor.system.attributes;
    const hp = a.might.base * 2;
    const energy = a.spirit.base * 2;
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
  /*  Attributes (free Step-Ups)                  */
  /* -------------------------------------------- */

  static async #onRaiseAttr(event, target) {
    const key = target.closest("[data-attribute]")?.dataset.attribute;
    const attr = this.actor.system.attributes[key];
    if (!attr || attr.base >= 12) return;
    if (this.#stepsUsed() >= getCreationConfig().stepUps) {
      return ui.notifications.warn(game.i18n.localize("PROJECTANIME.Creator.noStepsLeft"));
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

  static async #onRollLuck() {
    // A Lucky Pendant (or any "luck" effect) Steps Up the Charm die for this roll.
    const steps = collectLuckSteps(this.actor);
    const die = stepUpDie(this.actor.system.attributes.charm.value, steps);
    const roll = await new Roll(`3d${die}`).evaluate();
    const values = roll.dice[0].results.map((r) => r.result);
    await this.actor.update({ "system.luckDice": values });
    const lines = [`${game.i18n.localize("PROJECTANIME.Stat.luckDice")}: <strong>${values.join(", ")}</strong>`];
    if (steps > 0) lines.push(`<em class="muted">${game.i18n.localize("PROJECTANIME.Effect.luckStepUp")}</em>`);
    await postRollCard(this.actor, {
      title: game.i18n.localize("PROJECTANIME.Advancement.rollLuck"),
      roll, lines
    });
    this.render();
  }

  /* -------------------------------------------- */
  /*  Skills (Skill Builder hand-off)             */
  /* -------------------------------------------- */

  /** Open (or focus) the in-game Skill Builder, jumping straight into Build mode. */
  static #onOpenSkillBuilder() {
    const id = `pa-skill-builder-${this.actor.id}`;
    const existing = foundry.applications.instances.get(id);
    if (existing) return existing.bringToFront();
    return new SkillBuilderApp(this.actor, { startMode: "build" }).render(true);
  }

  /** Edit a built Skill in the full Skill Builder, pre-loaded with all its choices. */
  static #onEditSkill(event, target) {
    const id = target.closest("[data-skill-id]")?.dataset.skillId;
    const item = this.actor.items.get(id);
    if (!item || item.type !== "skill") return;
    return SkillBuilderApp.open(this.actor, { skillId: id });
  }

  /** Delete a built Skill (creation is a sandbox — undo is free). Deleting a Skill refunds its
   *  logged SP and prunes its ledger entries automatically via the deleteItem hook. */
  static async #onRemoveSkill(event, target) {
    const id = target.closest("[data-skill-id]")?.dataset.skillId;
    const item = this.actor.items.get(id);
    if (!item || item.type !== "skill") return;
    // Granted (free) abilities never charged SP and are managed by their source bundle.
    if (item.getFlag("project-anime", "granted")) return;
    await item.delete();
    this.render();
  }

  /* -------------------------------------------- */
  /*  Choices (Race/Class — grant Packages free)  */
  /* -------------------------------------------- */

  /** The source-uuids currently chosen for a choice = its choice-flagged Packages on the actor. */
  #chosenUuidsFor(choiceId) {
    const set = new Set();
    for (const item of this.actor.items) {
      if (item.type !== "package" || item.getFlag("project-anime", "choice") !== choiceId) continue;
      const src = item.getFlag("project-anime", "chosenOption");
      if (src) set.add(src);
    }
    return set;
  }

  /** Add an option's Package to the actor (flagged with its choice) — the Grant engine then
   *  grants its abilities for free. */
  async #addChoicePackage(choiceId, uuid) {
    const src = await fromUuid(uuid);
    if (!src || src.type !== "package") {
      return ui.notifications.warn(game.i18n.localize("PROJECTANIME.Creator.choiceMissing"));
    }
    const data = src.toObject();
    delete data._id;
    foundry.utils.setProperty(data, "flags.project-anime.choice", choiceId);
    foundry.utils.setProperty(data, "flags.project-anime.chosenOption", uuid);
    await this.actor.createEmbeddedDocuments("Item", [data]);
  }

  /** Pick (or, for pick-N, toggle) a choice option. Single-pick swaps the previous Package;
   *  the dynamic Grant link then swaps the granted abilities to match. */
  static async #onChooseOption(event, target) {
    const choiceId = target.closest("[data-choice-id]")?.dataset.choiceId;
    const uuid = target.closest("[data-option-uuid]")?.dataset.optionUuid;
    if (!choiceId || !uuid) return;
    const choice = getCreationConfig().choices.find((c) => c.id === choiceId);
    if (!choice) return;
    const existing = this.actor.items.filter((i) => i.type === "package" && i.getFlag("project-anime", "choice") === choiceId);
    const already = existing.find((i) => i.getFlag("project-anime", "chosenOption") === uuid);

    if (choice.mode === "pickN") {
      if (already) {
        await already.delete();
      } else if (existing.length >= (choice.n || 1)) {
        return ui.notifications.warn(game.i18n.format("PROJECTANIME.Creator.choosePickMax", { n: choice.n || 1, label: choice.label }));
      } else {
        await this.#addChoicePackage(choiceId, uuid);
      }
    } else {
      if (already) return; // re-clicking the selected single option — keep it
      if (existing.length) await this.actor.deleteEmbeddedDocuments("Item", existing.map((i) => i.id));
      await this.#addChoicePackage(choiceId, uuid);
    }
    this.render();
  }

  /* -------------------------------------------- */
  /*  Gear shop                                   */
  /* -------------------------------------------- */

  /** Build the purchasable catalogue from the GM-configured open compendium packs,
   *  filtered to the allowed Item types. Compendium-only (no world-Items scan). */
  async #loadShop() {
    const { allowedTypes, packs } = getCreationConfig();
    const allowed = new Set(allowedTypes);
    const open = new Set(packs);
    const entries = [];
    for (const pack of game.packs ?? []) {
      if (pack.documentName !== "Item" || !open.has(pack.collection)) continue;
      try {
        for (const item of await pack.getDocuments()) {
          if (!allowed.has(item.type)) continue;
          entries.push({
            uuid: item.uuid,
            name: item.name,
            img: item.img,
            type: item.type,
            typeLabel: game.i18n.localize(`TYPES.Item.${item.type}`),
            cost: Number(item.system?.cost ?? 0) || 0
          });
        }
      } catch (_e) {
        /* unreadable pack — skip it */
      }
    }
    entries.sort((a, b) => allowedTypes.indexOf(a.type) - allowedTypes.indexOf(b.type) || a.name.localeCompare(b.name));
    this.#shop = entries;
  }

  static #onShopFilter(event, target) {
    this.#shopType = target.dataset.type || "all";
    this.render();
  }

  static #onRefreshShop() {
    this.#shop = null;
    this.render();
  }

  static async #onBuyItem(event, target) {
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    if (!uuid) return;
    const src = await fromUuid(uuid);
    if (!src) return;
    const cost = Number(src.system?.cost ?? 0) || 0;
    const gold = this.actor.system.gold ?? 0;
    if (cost > gold) {
      return ui.notifications.warn(game.i18n.format("PROJECTANIME.Creator.cantAfford", { name: src.name, cost, gold }));
    }
    const data = src.toObject();
    delete data._id;
    await this.actor.createEmbeddedDocuments("Item", [data]);
    if (cost > 0) await this.actor.update({ "system.gold": gold - cost });
    ui.notifications.info(game.i18n.format("PROJECTANIME.Creator.bought", { name: src.name, cost }));
    this.render();
  }

  static async #onSellItem(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    const item = this.actor.items.get(id);
    if (!item) return;
    const cost = Number(item.system?.cost ?? 0) || 0;
    await item.delete();
    if (cost > 0) await this.actor.update({ "system.gold": (this.actor.system.gold ?? 0) + cost });
    this.render();
  }

  /* -------------------------------------------- */
  /*  Finish                                      */
  /* -------------------------------------------- */

  static async #onFinish() {
    await this.#sync();
    await this.actor.setFlag("project-anime", "creationComplete", true);
    ui.notifications.info(game.i18n.format("PROJECTANIME.Creator.done", { name: this.actor.name }));
    this.close();
  }
}
