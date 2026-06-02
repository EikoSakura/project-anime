import { ShardsItemSheet } from "./item-sheet.mjs";
import { evaluateFormula, buildFormulaContext } from "../helpers/formulas.mjs";

/**
 * Sheet for the Skill item type.
 * Features:
 * - Description tab with auto-generated MMO-style skill tooltip card
 * - Details tab (GM-only by default) with structured combat/usage panels
 * - Effects tab for Active Effects management
 * - Formula evaluation for pip cost, MP cost, damage
 * - Freeform tag chips with Enter-to-add
 * - Stat toggle chips for skill rate calculation
 * - Permission-gated visibility via system setting
 */
export class ShardsSkillSheet extends ShardsItemSheet {

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["shards-of-mana", "item-sheet", "skill-sheet"],
    position: { width: 600, height: 640 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      ...ShardsItemSheet.DEFAULT_OPTIONS.actions,
      removeTag: ShardsSkillSheet.#onRemoveTag,
      toggleSkillStat: ShardsSkillSheet.#onToggleSkillStat
    }
  };

  /** @override */
  static PARTS = {
    header: {
      template: "systems/shards-of-mana/templates/items/skill/skill-header.hbs"
    },
    tabs: {
      template: "templates/generic/tab-navigation.hbs"
    },
    description: {
      template: "systems/shards-of-mana/templates/items/skill/tab-description.hbs",
      scrollable: [""]
    },
    details: {
      template: "systems/shards-of-mana/templates/items/skill/tab-details.hbs",
      scrollable: [""]
    },
    effects: {
      template: "systems/shards-of-mana/templates/items/skill/tab-effects.hbs",
      scrollable: [""]
    }
  };

  /** @override */
  static TABS = {
    primary: {
      tabs: [
        { id: "description", group: "primary", icon: "fa-solid fa-book", label: "SHARDS.Skill.Tabs.Description" },
        { id: "details", group: "primary", icon: "fa-solid fa-chart-line", label: "SHARDS.Skill.Tabs.Details" },
        { id: "effects", group: "primary", icon: "fa-solid fa-sparkles", label: "SHARDS.Skill.Tabs.Effects" }
      ],
      initial: "description",
      labelPrefix: "SHARDS.Skill.Tabs"
    }
  };

  /* -------------------------------------------- */
  /*  Context Preparation                          */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.document.system;
    const actor = this.document.parent;
    const isGM = game.user.isGM;
    const playersCanView = game.settings.get("shards-of-mana", "playersCanViewSkillDetails");

    // Permission flags
    context.canEditDetails = isGM;
    context.canViewDetails = isGM || playersCanView;
    context.isOwned = !!actor;

    // Build formula context from owning actor
    const formulaCtx = buildFormulaContext(actor, this.document);
    context.hasFormulaContext = !!formulaCtx;

    // Evaluate formula fields
    context.computedPipCost = formulaCtx
      ? evaluateFormula(system.pipCost || "0", formulaCtx)
      : (system.pipCost || "0");
    context.computedMpCost = formulaCtx
      ? evaluateFormula(system.mpCost || "0", formulaCtx)
      : (system.mpCost || "0");
    const dmgFormula = system.effectiveFormula || system.damageFormula || "0";
    context.computedDamage = formulaCtx
      ? evaluateFormula(dmgFormula, formulaCtx)
      : (dmgFormula || "");
    context.computedRange = formulaCtx
      ? evaluateFormula(system.range || "0", formulaCtx)
      : (system.range || "0");

    // Skill Rate: skillBase + highest of selected stats
    context.skillRate = null;
    context.skillRateStatLabel = null;
    context.allSkillStatLabels = null;
    if (system.skillStats.length > 0) {
      context.allSkillStatLabels = system.skillStats
        .map(k => game.i18n.localize(CONFIG.SHARDS.stats[k] ?? k.toUpperCase()))
        .join(", ");

      if (formulaCtx) {
        let bestStat = 0;
        for (const statKey of system.skillStats) {
          const val = formulaCtx[statKey.toUpperCase()] ?? 0;
          if (val > bestStat) bestStat = val;
        }
        context.skillRate = system.skillBase + bestStat;
      }
    }

    // Actor-derived combat stats for the description card
    const derived = actor?.system?.derived;
    context.actorDerived = null;
    if (derived) {
      context.actorDerived = {
        hitStat: derived.acc,
        dmgStat: null,
        hitLabel: "ACC",
        dmgLabel: null,
        totalHit: (derived.acc != null && context.skillRate != null)
          ? context.skillRate + derived.acc : null,
        totalDamage: typeof context.computedDamage === "number"
          ? context.computedDamage : null,
        crit: derived.crit
      };
    }

    // Dropdown option arrays
    context.skillTypeOptions = this.#buildOptions(CONFIG.SHARDS.skillTypes, system.skillType);
    context.timingOptions = this.#buildOptions(CONFIG.SHARDS.skillTimings, system.timing);
    context.targetOptions = this.#buildOptions(CONFIG.SHARDS.targetTypes, system.target);
    context.areaShapeOptions = this.#buildOptions(CONFIG.SHARDS.areaShapes, system.areaShape);
    context.aoeFilterOptions = this.#buildOptions(CONFIG.SHARDS.aoeFilters ?? {}, system.aoeFilter);
    context.defenseTypeOptions = this.#buildOptions(CONFIG.SHARDS.defenseTypes, system.defenseType);
    context.damageTypeOptions = this.#buildOptions(CONFIG.SHARDS.damageTypes, system.damageType);
    context.conditionOptions = this.#buildOptions(CONFIG.SHARDS.conditions, system.conditionApplied);

    // Power tier options
    context.powerTierOptions = Object.entries(CONFIG.SHARDS.powerTiers ?? {}).map(([key, val]) => ({
      key,
      label: game.i18n.localize(val.label ?? key),
      selected: system.powerTier === key
    }));

    // Auto-formula state
    context.autoFormula = system.autoFormula;
    context.effectiveFormula = system.effectiveFormula ?? system.damageFormula ?? "";

    // Skill template options
    context.skillTemplateOptions = Object.entries(CONFIG.SHARDS.skillTemplates ?? {}).map(([key, tpl]) => ({
      key,
      label: game.i18n.localize(tpl.label ?? key)
    }));

    // Stat toggle chips
    context.statChips = Object.entries(CONFIG.SHARDS.stats).map(([key, labelKey]) => ({
      key,
      label: game.i18n.localize(labelKey),
      selected: system.skillStats.includes(key)
    }));

    // Tags as array
    context.tagArray = [...system.tags];

    // Derived display flags
    context.isPassive = system.isPassive;
    context.showAreaFields = system.target === "area";

    // Localized labels for auto-card
    context.skillTypeLabel = game.i18n.localize(
      CONFIG.SHARDS.skillTypes[system.skillType] ?? system.skillType
    );
    context.timingLabel = game.i18n.localize(
      CONFIG.SHARDS.skillTimings[system.timing] ?? system.timing
    );
    context.targetLabel = game.i18n.localize(
      CONFIG.SHARDS.targetTypes[system.target] ?? system.target
    );
    context.areaShapeLabel = system.areaShape
      ? game.i18n.localize(CONFIG.SHARDS.areaShapes[system.areaShape] ?? "")
      : "";
    context.damageTypeLabel = system.damageType
      ? game.i18n.localize(CONFIG.SHARDS.damageTypes[system.damageType] ?? system.damageType)
      : "";
    context.defenseTypeLabel = system.defenseType && system.defenseType !== "none"
      ? game.i18n.localize(CONFIG.SHARDS.defenseTypes[system.defenseType] ?? "")
      : "";
    context.conditionLabel = system.conditionApplied
      ? game.i18n.localize(CONFIG.SHARDS.conditions[system.conditionApplied] ?? system.conditionApplied)
      : "";

    // Tier display
    context.tierStars = Array.from({ length: system.tier }, (_, i) => i);

    return context;
  }

  /** @override */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if (partId === "details" || partId === "description" || partId === "effects") {
      context.tab = context.tabs?.primary?.[partId] ?? context.tabs?.[partId];
    }
    return context;
  }

  /* -------------------------------------------- */
  /*  Render Hooks                                 */
  /* -------------------------------------------- */

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);

    // Ensure the active tab content + nav button are visible after render
    const activeTab = this.tabGroups?.primary ?? "description";
    for (const section of this.element.querySelectorAll("[data-group='primary'][data-tab]")) {
      const isActive = section.dataset.tab === activeTab;
      section.classList.toggle("active", isActive);
    }

    // Template picker: change event (not data-action, since select needs change not click)
    const templatePicker = this.element.querySelector(".template-picker-select");
    if (templatePicker) {
      templatePicker.addEventListener("change", async (e) => {
        const key = e.target.value;
        if (!key) return;
        const template = CONFIG.SHARDS.skillTemplates?.[key];
        if (!template) return;
        const updates = {};
        for (const [field, value] of Object.entries(template.data)) {
          updates[`system.${field}`] = value;
        }
        await this.document.update(updates);
        // Reset picker to placeholder
        e.target.value = "";
      });
    }

    // Tag input: Enter key to add tag
    const tagInput = this.element.querySelector(".skill-tag-input");
    if (tagInput) {
      tagInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          this.#addTagFromInput(tagInput);
        }
      });
    }

    // Tab visibility: hide Details tab nav if player cannot see it
    if (!context.canViewDetails) {
      const detailsNavBtn = this.element.querySelector('[data-tab="details"][role="tab"]');
      if (detailsNavBtn) detailsNavBtn.style.display = "none";
    }

    // Read-only mode: disable all inputs in details tab if player can view but not edit
    if (context.canViewDetails && !context.canEditDetails) {
      const detailsSection = this.element.querySelector(".tab.details");
      if (detailsSection) {
        for (const el of detailsSection.querySelectorAll("input, select, textarea, button")) {
          el.disabled = true;
        }
      }

      // Also disable tag input and remove buttons in header
      const headerTagInput = this.element.querySelector(".skill-tag-input");
      if (headerTagInput) headerTagInput.disabled = true;
      for (const btn of this.element.querySelectorAll(".skill-tag-remove")) {
        btn.disabled = true;
      }
    }
  }

  /* -------------------------------------------- */
  /*  Helpers                                      */
  /* -------------------------------------------- */

  /**
   * Build an options array for a select dropdown.
   * @param {Object<string, string>} configMap - e.g. CONFIG.SHARDS.skillTypes
   * @param {string} currentValue - currently selected value
   * @returns {Array<{key: string, label: string, selected: boolean}>}
   */
  #buildOptions(configMap, currentValue) {
    if (!configMap) return [];
    return Object.entries(configMap).map(([key, labelKey]) => ({
      key,
      label: game.i18n.localize(labelKey),
      selected: currentValue === key
    }));
  }

  /**
   * Add a tag from the input field.
   * @param {HTMLInputElement} input
   */
  async #addTagFromInput(input) {
    const tagValue = input.value.trim();
    if (!tagValue) return;
    const tags = new Set(this.document.system.tags);
    tags.add(tagValue);
    input.value = "";
    await this.document.update({ "system.tags": [...tags] });
  }

  /* -------------------------------------------- */
  /*  Tag & Stat Actions                           */
  /* -------------------------------------------- */

  static async #onRemoveTag(event, target) {
    const tag = target.dataset.tag;
    if (!tag) return;
    const tags = new Set(this.document.system.tags);
    tags.delete(tag);
    await this.document.update({ "system.tags": [...tags] });
  }

  static async #onToggleSkillStat(event, target) {
    const statKey = target.dataset.stat;
    if (!statKey) return;
    const current = [...this.document.system.skillStats];
    const idx = current.indexOf(statKey);
    if (idx >= 0) {
      current.splice(idx, 1);
    } else {
      current.push(statKey);
    }
    await this.document.update({ "system.skillStats": current });
  }

}
