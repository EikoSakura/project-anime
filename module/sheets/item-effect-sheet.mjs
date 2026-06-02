import { ShardsItemSheet } from "./item-sheet.mjs";

/**
 * Sheet for the Effect item type.
 * Features:
 * - Crystal header with portrait, name, and effect count badge
 * - Description tab: rich-text editor
 * - Effects tab: Active Effects panel (add/edit/toggle/delete)
 *
 * Effect items are draggable containers for Active Effects.
 * Dragging onto an actor transfers the AEs directly.
 */
export class ShardsEffectItemSheet extends ShardsItemSheet {

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["shards-of-mana", "item-sheet", "effect-item-sheet"],
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
      template: "systems/shards-of-mana/templates/items/effect/effect-header.hbs"
    },
    tabs: {
      template: "templates/generic/tab-navigation.hbs"
    },
    description: {
      template: "systems/shards-of-mana/templates/items/effect/tab-description.hbs",
      scrollable: [""]
    },
    effects: {
      template: "systems/shards-of-mana/templates/items/effect/tab-effects.hbs",
      scrollable: [""]
    }
  };

  /** @override */
  static TABS = {
    primary: {
      tabs: [
        { id: "description", group: "primary", icon: "fa-solid fa-book", label: "SHARDS.EffectItem.Tabs.Description" },
        { id: "effects", group: "primary", icon: "fa-solid fa-sparkles", label: "SHARDS.Effects.ActiveEffects" }
      ],
      initial: "effects",
      labelPrefix: "SHARDS.EffectItem.Tabs"
    }
  };

  /* -------------------------------------------- */
  /*  Context Preparation                          */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);

    // Count of embedded Active Effects for the header badge
    context.effectCount = this.document.effects.size;

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

    // Ensure the active tab content is visible after render
    const activeTab = this.tabGroups?.primary ?? "effects";
    for (const section of this.element.querySelectorAll("[data-group='primary'][data-tab]")) {
      section.classList.toggle("active", section.dataset.tab === activeTab);
    }
  }
}
