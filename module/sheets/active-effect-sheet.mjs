const { ActiveEffectConfig } = foundry.applications.sheets;

/**
 * Custom Active Effect configuration sheet for Shards of Mana.
 * Extends the built-in ActiveEffectConfig (which already applies
 * HandlebarsApplicationMixin + DocumentSheetV2) with a Shards-themed UI
 * and dropdowns for common change targets.
 */
export class ShardsActiveEffectSheet extends ActiveEffectConfig {

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["shards-of-mana", "shards-ae-sheet"],
    position: { width: 480, height: 500 },
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      addChange: ShardsActiveEffectSheet.#onAddChange,
      deleteChange: ShardsActiveEffectSheet.#onDeleteChange
    }
  };

  /** @override */
  static PARTS = {
    header: {
      template: "systems/shards-of-mana/templates/effects/ae-header.hbs"
    },
    tabs: {
      template: "templates/generic/tab-navigation.hbs"
    },
    details: {
      template: "systems/shards-of-mana/templates/effects/ae-details.hbs"
    },
    changes: {
      template: "systems/shards-of-mana/templates/effects/ae-changes.hbs",
      scrollable: [""]
    },
    duration: {
      template: "systems/shards-of-mana/templates/effects/ae-duration.hbs"
    }
  };

  /** @override */
  static TABS = {
    primary: {
      tabs: [
        { id: "details", group: "primary", icon: "fa-solid fa-circle-info", label: "SHARDS.AE.TabDetails" },
        { id: "changes", group: "primary", icon: "fa-solid fa-list", label: "SHARDS.AE.TabChanges" },
        { id: "duration", group: "primary", icon: "fa-solid fa-clock", label: "SHARDS.AE.TabDuration" }
      ],
      initial: "details",
      labelPrefix: "SHARDS.AE"
    }
  };

  /** @override */
  get title() {
    return `${this.document.name}`;
  }

  /* -------------------------------------------- */
  /*  Context Preparation                         */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const effect = this.document;

    context.effect = effect;
    context.source = effect.toObject();
    context.isDisabled = effect.disabled;
    context.isTemporary = effect.isTemporary;

    // Changes with enriched display info
    context.changes = effect.changes.map((change, index) => {
      const category = this._categorizeKey(change.key);
      const modeLabel = this._getModeLabel(change.mode);
      return {
        ...change,
        index,
        category,
        modeLabel
      };
    });

    // Dropdown options for the changes tab
    context.changeTargets = this._buildChangeTargets();
    context.changeModes = this._buildChangeModes();

    // Duration
    context.duration = effect.duration;
    context.hasCombat = !!game.combat;

    return context;
  }

  /** @override */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    const tabIds = ["details", "changes", "duration"];
    if (tabIds.includes(partId)) {
      context.tab = context.tabs?.primary?.[partId] ?? context.tabs?.[partId];
    }
    return context;
  }

  /* -------------------------------------------- */
  /*  Helpers                                      */
  /* -------------------------------------------- */

  /**
   * Categorize a change key for display.
   * @param {string} key
   * @returns {string} Display label
   */
  _categorizeKey(key) {
    if (key.startsWith("system.stats.") && key.endsWith(".bonus")) {
      const stat = key.split(".")[2];
      return `Stat: ${game.i18n.localize(CONFIG.SHARDS.stats[stat] ?? stat)}`;
    }
    if (key.startsWith("system.conditions.")) {
      const cond = key.split(".")[2];
      return `Condition: ${game.i18n.localize(CONFIG.SHARDS.conditions[cond] ?? cond)}`;
    }
    if (key.startsWith("system.elementResistances.")) {
      const elem = key.split(".")[2];
      const dmgKey = `SHARDS.DamageType.${elem.charAt(0).toUpperCase() + elem.slice(1)}`;
      return `Elemental Resistance: ${game.i18n.localize(dmgKey)}`;
    }
    if (key.startsWith("system.conditionResistances.")) {
      const cond = key.split(".")[2];
      return `Condition Resistance: ${game.i18n.localize(`SHARDS.Condition.${cond}`) ?? cond}`;
    }
    if (key.startsWith("system.derived.")) {
      const derived = key.split(".")[2];
      return `Derived: ${game.i18n.localize(CONFIG.SHARDS.derivedStats[derived] ?? derived)}`;
    }
    if (key === "system.mov") return "Movement";
    if (key === "system.health.max") return "HP Max";
    if (key === "system.mana.max") return "MP Max";
    return key;
  }

  /**
   * Get a human-readable label for an AE mode.
   * @param {number} mode
   * @returns {string}
   */
  _getModeLabel(mode) {
    const labels = {
      0: "Custom",
      1: "Multiply",
      2: "Add",
      3: "Downgrade",
      4: "Upgrade",
      5: "Override"
    };
    return labels[mode] ?? `Mode ${mode}`;
  }

  /**
   * Build grouped change target options for the dropdown.
   * @returns {object[]}
   */
  _buildChangeTargets() {
    const targets = [];

    // Stats
    for (const [key, label] of Object.entries(CONFIG.SHARDS.stats)) {
      targets.push({
        value: `system.stats.${key}.bonus`,
        label: `Stat: ${game.i18n.localize(label)}`,
        group: "Stats"
      });
    }

    // Derived Stats
    for (const [key, label] of Object.entries(CONFIG.SHARDS.derivedStats)) {
      targets.push({
        value: `system.derived.${key}`,
        label: `Derived: ${game.i18n.localize(label)}`,
        group: "Derived Stats"
      });
    }

    // Elemental Resistances
    for (const [key, label] of Object.entries(CONFIG.SHARDS.damageTypes)) {
      if (key === "healing") continue;
      targets.push({
        value: `system.elementResistances.${key}`,
        label: `Elemental Resistance: ${game.i18n.localize(label)}`,
        group: "Elemental Resistance"
      });
    }

    // Condition Immunities (boolean)
    const negConditions = ["poison","burn","stun","blind","silence","slow","root","weaken","downed"];
    for (const key of negConditions) {
      const label = CONFIG.SHARDS.conditions[key];
      if (!label) continue;
      targets.push({
        value: `system.conditionResistances.${key}`,
        label: `Condition Immunity: ${game.i18n.localize(label)}`,
        group: "Condition Immunity"
      });
    }

    // Conditions
    for (const [key, label] of Object.entries(CONFIG.SHARDS.conditions)) {
      targets.push({
        value: `system.conditions.${key}`,
        label: `Condition: ${game.i18n.localize(label)}`,
        group: "Conditions"
      });
    }

    // Misc
    targets.push(
      { value: "system.mov", label: "Movement (MOV)", group: "Other" },
      { value: "system.health.max", label: "HP Max", group: "Other" },
      { value: "system.mana.max", label: "MP Max", group: "Other" },
      { value: "system.pips.max", label: "Pips Max", group: "Other" }
    );

    return targets;
  }

  /**
   * Build mode options for the dropdown.
   * @returns {object[]}
   */
  _buildChangeModes() {
    return [
      { value: 0, label: "Custom" },
      { value: 1, label: "Multiply" },
      { value: 2, label: "Add" },
      { value: 3, label: "Downgrade (min)" },
      { value: 4, label: "Upgrade (max)" },
      { value: 5, label: "Override" }
    ];
  }

  /* -------------------------------------------- */
  /*  Form Handling                                 */
  /* -------------------------------------------- */

  /**
   * Guard against race condition where a form change triggers a re-render
   * that removes the element before the parent's handler calls querySelector.
   * @override
   */
  _onChangeForm(formConfig, event) {
    if (!this.element) return;
    super._onChangeForm(formConfig, event);
  }

  /* -------------------------------------------- */
  /*  Action Handlers                              */
  /* -------------------------------------------- */

  static async #onAddChange(event, target) {
    const changes = [...this.document.changes, {
      key: "system.stats.str.bonus",
      mode: 2,
      value: "0"
    }];
    await this.document.update({ changes });
  }

  static async #onDeleteChange(event, target) {
    const idx = Number(target.dataset.changeIndex);
    const changes = this.document.changes.filter((_, i) => i !== idx);
    await this.document.update({ changes });
  }
}
