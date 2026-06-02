import { ShardsItemSheet } from "./item-sheet.mjs";

/**
 * Dedicated sheet for the Manacite item type.
 * Crystal-themed header with rank badge, manacite type, and skill granted display.
 * Tabs: Description (with data fields) + Effects.
 */
export class ShardsManaciteSheet extends ShardsItemSheet {

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["shards-of-mana", "item-sheet", "manacite-sheet"],
    position: { width: 520, height: 480 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      ...ShardsItemSheet.DEFAULT_OPTIONS.actions
    }
  };

  /** @override */
  static PARTS = {
    header: {
      template: "systems/shards-of-mana/templates/items/manacite/manacite-header.hbs"
    },
    tabs: {
      template: "templates/generic/tab-navigation.hbs"
    },
    description: {
      template: "systems/shards-of-mana/templates/items/manacite/tab-description.hbs",
      scrollable: [""]
    },
    effects: {
      template: "systems/shards-of-mana/templates/items/manacite/tab-effects.hbs",
      scrollable: [""]
    }
  };

  /** @override */
  static TABS = {
    primary: {
      tabs: [
        { id: "description", group: "primary", icon: "fa-solid fa-book", label: "SHARDS.Manacite.Tabs.Description" },
        { id: "effects", group: "primary", icon: "fa-solid fa-sparkles", label: "SHARDS.Effects.ActiveEffects" }
      ],
      initial: "description",
      labelPrefix: "SHARDS.Manacite.Tabs"
    }
  };

  /* -------------------------------------------- */
  /*  Context Preparation                          */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.document.system;

    // School options for dropdown
    context.schoolOptions = Object.entries(CONFIG.SHARDS.schools).map(([key, cfg]) => ({
      key,
      label: game.i18n.localize(cfg.label),
      selected: system.school === key
    }));

    // Manacite type options for the dropdown
    context.manaciteTypeOptions = Object.entries(CONFIG.SHARDS.manaciteTypes).map(([key, labelKey]) => ({
      key,
      label: game.i18n.localize(labelKey),
      selected: system.manaciteType === key
    }));

    // XP progress — threshold for next SL
    const thresholds = CONFIG.SHARDS?.manaciteXpThresholds ?? [0, 0, 50, 150, 350, 750];
    context.xpNextThreshold = thresholds[system.skillLevel + 1] ?? thresholds[thresholds.length - 1];

    return context;
  }

  /** @override */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if (["description", "effects"].includes(partId)) {
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
      section.classList.toggle("active", section.dataset.tab === activeTab);
    }
  }
}
