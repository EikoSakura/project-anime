const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

/**
 * Merchant sheet — shop-focused with inventory table.
 */
export class ShardsMerchantSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["shards-of-mana", "merchant-sheet"],
    position: { width: 640, height: 560 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      addShopEntry: ShardsMerchantSheet.#onAddShopEntry,
      deleteShopEntry: ShardsMerchantSheet.#onDeleteShopEntry,
      editItem: ShardsMerchantSheet.#onEditItem
    }
  };

  /** @override */
  static PARTS = {
    header: {
      template: "systems/shards-of-mana/templates/actors/merchant/merchant-header.hbs"
    },
    tabs: {
      template: "templates/generic/tab-navigation.hbs"
    },
    shop: {
      template: "systems/shards-of-mana/templates/actors/merchant/tab-shop.hbs",
      scrollable: [""]
    },
    biography: {
      template: "systems/shards-of-mana/templates/actors/merchant/tab-biography.hbs",
      scrollable: [""]
    }
  };

  /** @override */
  static TABS = {
    primary: {
      tabs: [
        { id: "shop", group: "primary", icon: "fa-solid fa-shop", label: "SHARDS.Tabs.Shop" },
        { id: "biography", group: "primary", icon: "fa-solid fa-book", label: "SHARDS.Tabs.Biography" }
      ],
      initial: "shop",
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
    context.config = CONFIG.SHARDS;

    // Enriched biography
    const TE = foundry.applications.ux.TextEditor.implementation;
    context.enrichedBiography = await TE.enrichHTML(
      system.biography, { async: true, relativeTo: actor }
    );

    return context;
  }

  /** @override */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    const tabIds = ["shop", "biography"];
    if (tabIds.includes(partId)) {
      context.tab = context.tabs?.primary?.[partId] ?? context.tabs?.[partId];
    }
    return context;
  }

  static async #onAddShopEntry(event, target) {
    const inventory = [...this.actor.system.inventory, {
      itemId: "", name: "New Item", price: 0, stock: -1, available: 1
    }];
    await this.actor.update({ "system.inventory": inventory });
  }

  static async #onDeleteShopEntry(event, target) {
    const idx = Number(target.dataset.shopIndex);
    const inventory = this.actor.system.inventory.filter((_, i) => i !== idx);
    await this.actor.update({ "system.inventory": inventory });
  }

  static #onEditItem(event, target) {
    const itemId = target.closest("[data-item-id]")?.dataset.itemId;
    const item = this.actor.items.get(itemId);
    if (item) item.sheet.render(true);
  }
}
