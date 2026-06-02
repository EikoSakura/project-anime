import { ShardsStatTestDialog } from "../apps/stat-test-dialog.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

/**
 * Shared base sheet for all Shards of Mana actor types.
 * Extends ApplicationV2 via HandlebarsApplicationMixin + ActorSheetV2.
 */
export class ShardsActorSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["shards-of-mana", "actor-sheet"],
    position: { width: 700, height: 720 },
    window: {
      resizable: true
    },
    form: {
      submitOnChange: true
    },
    actions: {
      rollStat: ShardsActorSheet.#onRollStat,
      deleteItem: ShardsActorSheet.#onDeleteItem,
      editItem: ShardsActorSheet.#onEditItem,
      useItem: ShardsActorSheet.#onUseItem
    }
  };

  /** @override */
  static PARTS = {
    header: {
      template: "systems/shards-of-mana/templates/actors/parts/actor-header.hbs"
    },
    tabs: {
      template: "templates/generic/tab-navigation.hbs"
    },
    stats: {
      template: "systems/shards-of-mana/templates/actors/parts/actor-stats.hbs",
      scrollable: [""]
    },
    combat: {
      template: "systems/shards-of-mana/templates/actors/parts/actor-combat.hbs",
      scrollable: [""]
    },
    inventory: {
      template: "systems/shards-of-mana/templates/actors/parts/actor-inventory.hbs",
      scrollable: [".item-list"]
    },
    biography: {
      template: "systems/shards-of-mana/templates/actors/parts/actor-biography.hbs",
      scrollable: [""]
    }
  };

  /** @override */
  static TABS = {
    primary: {
      tabs: [
        { id: "stats", group: "primary", icon: "fa-solid fa-chart-bar", label: "SHARDS.Tabs.Stats" },
        { id: "combat", group: "primary", icon: "fa-solid fa-swords", label: "SHARDS.Tabs.Combat" },
        { id: "inventory", group: "primary", icon: "fa-solid fa-suitcase", label: "SHARDS.Tabs.Inventory" },
        { id: "biography", group: "primary", icon: "fa-solid fa-book", label: "SHARDS.Tabs.Biography" }
      ],
      initial: "stats",
      labelPrefix: "SHARDS.Tabs"
    }
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const system = actor.system;

    context.actor = actor;
    context.system = system;
    context.systemFields = system.schema.fields;

    // Organize items by type
    context.items = {
      equipment: [],
      manacite: [],
      trait: [],
      skill: [],
      job: []
    };
    for (const item of actor.items) {
      if (context.items[item.type]) {
        context.items[item.type].push(item);
      }
    }

    // Enrich biography HTML
    const TE = foundry.applications.ux.TextEditor.implementation;
    context.enrichedBiography = await TE.enrichHTML(system.biography, {
      async: true,
      relativeTo: actor
    });

    // Config data for dropdowns
    context.config = CONFIG.SHARDS;

    return context;
  }

  /** @override */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    switch (partId) {
      case "stats":
      case "combat":
      case "inventory":
      case "biography":
        context.tab = context.tabs?.primary?.[partId] ?? context.tabs?.[partId];
        break;
    }
    return context;
  }

  /**
   * Roll a stat test.
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static #onRollStat(event, target) {
    const stat = target.dataset.stat;
    if (!stat) return;
    new ShardsStatTestDialog({ actor: this.actor, statKey: stat }).render(true);
  }

  /**
   * Delete an owned item.
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static #onDeleteItem(event, target) {
    const itemId = target.closest("[data-item-id]")?.dataset.itemId;
    const item = this.actor.items.get(itemId);
    if (item) item.delete();
  }

  /**
   * Open an owned item's sheet.
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static #onEditItem(event, target) {
    const itemId = target.closest("[data-item-id]")?.dataset.itemId;
    const item = this.actor.items.get(itemId);
    if (item) item.sheet.render(true);
  }

  /**
   * Use/roll an owned item.
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static #onUseItem(event, target) {
    const itemId = target.closest("[data-item-id]")?.dataset.itemId;
    const item = this.actor.items.get(itemId);
    if (item) item.roll();
  }
}
