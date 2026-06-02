const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/**
 * Mana's Codex — Reusable base class for item type browsers.
 * Subclasses override static properties and mapping methods to customize per item type.
 * Queries both game.items (world) and system compendium packs, merging results.
 * Supports full CRUD: create (world items), edit, delete with right-click context menu.
 */
export class ShardsItemBrowser extends HandlebarsApplicationMixin(ApplicationV2) {

  /** Hook IDs for live re-rendering. */
  #hookIds = [];

  /* -------------------------------------------- */
  /*  Subclass Configuration (override these)     */
  /* -------------------------------------------- */

  /** The item type this browser shows (e.g. "skill"). @type {string} */
  static ITEM_TYPE = "";

  /** Compendium pack names to search. @type {string[]} */
  static COMPENDIUM_PACKS = [];

  /* -------------------------------------------- */
  /*  Default Options                              */
  /* -------------------------------------------- */

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["shards-of-mana", "item-browser"],
    position: { width: 680, height: 580 },
    window: {
      resizable: true,
      icon: "fa-solid fa-book-sparkles"
    },
    actions: {
      viewItem: ShardsItemBrowser.#onViewItem,
      flipCard: ShardsItemBrowser.#onFlipCard,
      createItem: ShardsItemBrowser.#onCreateItem
    }
  };

  /** @override */
  static PARTS = {
    header: {
      template: "systems/shards-of-mana/templates/apps/item-browser-header.hbs"
    },
    list: {
      template: "systems/shards-of-mana/templates/apps/item-browser-list.hbs",
      scrollable: [""]
    }
  };

  /* -------------------------------------------- */
  /*  Filter State                                 */
  /* -------------------------------------------- */

  /** Active filter values keyed by filter key. */
  _filters = {};

  /** Search text. */
  _searchText = "";

  /* -------------------------------------------- */
  /*  Lifecycle                                    */
  /* -------------------------------------------- */

  /** @override */
  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    const itemType = this.constructor.ITEM_TYPE;
    const cb = (item) => {
      if (item.type === itemType && !item.parent) this.render();
    };
    this.#hookIds = [
      Hooks.on("createItem", cb),
      Hooks.on("updateItem", cb),
      Hooks.on("deleteItem", cb)
    ];
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);

    // Bind dragstart and double-click on all cards
    for (const card of this.element.querySelectorAll(".item-browser-card[data-uuid]")) {
      card.addEventListener("dragstart", this.#onDragStart.bind(this));
      card.addEventListener("dblclick", this.#onCardDoubleClick.bind(this));
    }

    // Bind right-click context menu on cards (GM only)
    if (game.user.isGM) {
      for (const card of this.element.querySelectorAll(".item-browser-card[data-uuid]")) {
        card.addEventListener("contextmenu", this._onCardContextMenu.bind(this));
      }
    }

    // Bind search input
    const searchInput = this.element.querySelector(".item-browser-search");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        this._searchText = e.target.value;
        this.render({ parts: ["list"] });
      });
    }

    // Bind filter selects (change event, not data-action)
    for (const select of this.element.querySelectorAll(".item-browser-filter")) {
      select.addEventListener("change", (e) => {
        this._filters[e.target.dataset.filterKey] = e.target.value;
        this.render({ parts: ["list"] });
      });
    }
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    const hookNames = ["createItem", "updateItem", "deleteItem"];
    for (let i = 0; i < hookNames.length; i++) {
      Hooks.off(hookNames[i], this.#hookIds[i]);
    }
    this.#hookIds = [];
  }

  /* -------------------------------------------- */
  /*  Context                                      */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const itemType = this.constructor.ITEM_TYPE;

    // Gather from world items
    let allItems = game.items.filter(i => i.type === itemType).map(item => ({
      ...this._mapItemToCard(item),
      uuid: item.uuid,
      source: "world",
      sourceLabel: game.i18n.localize("SHARDS.Browser.SourceWorld")
    }));

    // Gather from compendium packs
    for (const packName of this.constructor.COMPENDIUM_PACKS) {
      const pack = game.packs.get(packName);
      if (!pack) continue;
      const indexFields = this._getIndexFields();
      const index = indexFields.length
        ? await pack.getIndex({ fields: indexFields })
        : await pack.getIndex();
      for (const entry of index) {
        // Skip if a world item with the same name exists (world takes priority)
        if (allItems.some(i => i.name === entry.name && i.source === "world")) continue;
        allItems.push({
          ...this._mapIndexToCard(entry, pack),
          uuid: entry.uuid,
          source: "compendium",
          sourceLabel: pack.metadata.label
        });
      }
    }

    // Apply type-specific filters
    allItems = this._applyFilters(allItems);

    // Apply search text
    if (this._searchText) {
      const search = this._searchText.toLowerCase();
      allItems = allItems.filter(i => i.name.toLowerCase().includes(search));
    }

    // Sort alphabetically
    allItems.sort((a, b) => a.name.localeCompare(b.name));

    context.items = allItems;
    context.itemCount = allItems.length;
    context.config = CONFIG.SHARDS;
    context.filters = this._buildFilterContext();
    context.searchText = this._searchText;
    context.emptyMessage = this._getEmptyMessage();
    context.isGM = game.user.isGM;
    return context;
  }

  /* -------------------------------------------- */
  /*  Subclass Hooks (override in subclasses)     */
  /* -------------------------------------------- */

  /**
   * Map a world Item document to a normalized card display object.
   * @param {Item} item
   * @returns {object}
   */
  _mapItemToCard(item) { return { name: item.name, img: item.img }; }

  /**
   * Map a compendium index entry to a normalized card display object.
   * @param {object} entry
   * @param {CompendiumCollection} pack
   * @returns {object}
   */
  _mapIndexToCard(entry, pack) { return { name: entry.name, img: entry.img }; }

  /**
   * Fields to include in pack.getIndex() for efficient querying.
   * @returns {string[]}
   */
  _getIndexFields() { return []; }

  /** Localization key for the empty state message. */
  _getEmptyMessage() { return "SHARDS.Browser.NoItems"; }

  /**
   * Apply type-specific filters to the items array.
   * @param {object[]} items
   * @returns {object[]}
   */
  _applyFilters(items) { return items; }

  /**
   * Build filter dropdown context for the header template.
   * @returns {object[]}
   */
  _buildFilterContext() { return []; }

  /**
   * Return the default data for creating a new item of this type.
   * Subclasses can override for custom default images.
   * @returns {object}
   */
  _getDefaultItemData() {
    return {
      name: game.i18n.localize(`TYPES.Item.${this.constructor.ITEM_TYPE}`),
      type: this.constructor.ITEM_TYPE,
      img: "icons/svg/item-bag.svg"
    };
  }

  /* -------------------------------------------- */
  /*  Drag & Action Handlers                       */
  /* -------------------------------------------- */

  #onDragStart(event) {
    const uuid = event.currentTarget.dataset.uuid;
    if (!uuid) return;
    event.dataTransfer.setData("text/plain", JSON.stringify({
      type: "Item",
      uuid
    }));
  }

  static async #onViewItem(event, target) {
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    if (!uuid) return;
    const doc = await fromUuid(uuid);
    doc?.sheet?.render(true);
  }

  static #onFlipCard(event, target) {
    const card = target.closest(".item-browser-card");
    if (!card) return;
    const flipContainer = card.querySelector(".item-browser-card__flip");
    if (flipContainer) flipContainer.classList.toggle("flipped");
  }

  /**
   * Create a new world item and open its sheet.
   * The browser auto-refreshes via the createItem hook.
   */
  static async #onCreateItem(event, target) {
    if (!game.user.isGM) return;
    const itemData = this._getDefaultItemData();
    const doc = await Item.create(itemData);
    doc.sheet.render(true);
  }

  /* -------------------------------------------- */
  /*  Double-Click → Add to Character              */
  /* -------------------------------------------- */

  /**
   * Double-click a card to add the item to the user's assigned character.
   * The assigned character is set via Player Configuration (game.user.character).
   * @param {MouseEvent} event
   */
  async #onCardDoubleClick(event) {
    // Ignore double-clicks on action buttons (view/flip)
    if (event.target.closest("[data-action]")) return;

    const uuid = event.currentTarget.dataset.uuid;
    if (!uuid) return;

    // If opened from a wizard, delegate to the wizard instead
    if (this._wizardRef) {
      const item = await fromUuid(uuid);
      if (item) this._wizardRef.addItemFromBrowser(item);
      return;
    }

    // Require an assigned character
    const character = game.user.character;
    if (!character) {
      ui.notifications.warn(game.i18n.localize("SHARDS.Browser.NoCharacter"));
      return;
    }

    // Only adventurers can receive items
    if (character.type !== "adventurer") {
      ui.notifications.warn(game.i18n.localize("SHARDS.Browser.NotAdventurer"));
      return;
    }

    // Resolve the source item
    const item = await fromUuid(uuid);
    if (!item) return;

    // Check for duplicate by name + type (stackable skills are exempt)
    const existing = character.items.find(i => i.type === item.type && i.name === item.name);
    if (existing && !(item.type === "skill" && item.system?.stackable)) {
      ui.notifications.warn(game.i18n.localize("SHARDS.Browser.ItemAlreadyOwned"));
      return;
    }

    // Create a copy on the character
    const [created] = await character.createEmbeddedDocuments("Item", [item.toObject()]);
    if (created) {
      ui.notifications.info(game.i18n.format("SHARDS.Browser.ItemAdded", { name: item.name }));
    }
  }

  /* -------------------------------------------- */
  /*  Right-Click Context Menu                     */
  /* -------------------------------------------- */

  /**
   * Show a context menu on right-click with Edit / Delete options.
   * Works for both world items and compendium items.
   * @param {PointerEvent} event
   */
  async _onCardContextMenu(event) {
    event.preventDefault();
    // Remove any existing context menu
    this.element.querySelector(".item-browser-context")?.remove();

    const card = event.currentTarget;
    const uuid = card.dataset.uuid;
    const item = await fromUuid(uuid);
    if (!item) return;

    // Build the menu
    const menu = document.createElement("div");
    menu.classList.add("item-browser-context");
    menu.innerHTML = `
      <ul class="item-browser-context__list">
        <li class="item-browser-context__item" data-ctx-action="edit">
          <i class="fa-solid fa-pen-to-square"></i> ${game.i18n.localize("SHARDS.Edit")}
        </li>
        <li class="item-browser-context__item item-browser-context__item--danger" data-ctx-action="delete">
          <i class="fa-solid fa-trash"></i> ${game.i18n.localize("SHARDS.Delete")}
        </li>
      </ul>
    `;

    // Position relative to the app element
    const appRect = this.element.getBoundingClientRect();
    let x = event.clientX - appRect.left;
    let y = event.clientY - appRect.top;
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    this.element.appendChild(menu);

    // Clamp if overflowing
    const menuRect = menu.getBoundingClientRect();
    if (menuRect.right > appRect.right) {
      x -= (menuRect.right - appRect.right + 4);
      menu.style.left = `${x}px`;
    }
    if (menuRect.bottom > appRect.bottom) {
      y -= (menuRect.bottom - appRect.bottom + 4);
      menu.style.top = `${y}px`;
    }

    // Click handlers
    menu.querySelector('[data-ctx-action="edit"]').addEventListener("click", () => {
      item.sheet.render(true);
      menu.remove();
    });

    menu.querySelector('[data-ctx-action="delete"]').addEventListener("click", async () => {
      menu.remove();
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.localize("SHARDS.Delete") },
        content: `<p>${game.i18n.format("SHARDS.Browser.ConfirmDelete", { name: item.name })}</p>`,
        yes: { default: true }
      });
      if (confirmed) {
        await item.delete();
        // Compendium deletes don't trigger world item hooks, so manually refresh
        this.render();
      }
    });

    // Dismiss on click elsewhere or right-click elsewhere
    const dismiss = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener("click", dismiss, true);
        document.removeEventListener("contextmenu", dismiss, true);
      }
    };
    // Use setTimeout so the current event doesn't immediately dismiss
    setTimeout(() => {
      document.addEventListener("click", dismiss, true);
      document.addEventListener("contextmenu", dismiss, true);
    }, 0);
  }
}
